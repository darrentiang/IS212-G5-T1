#!/usr/bin/env node
/**
 * Test traceability index: where every functional test case and unit test lives.
 *
 * Usage:
 *   node .github/scripts/traceability.js [--out <folder>]
 *
 * Scans:
 *   functional/tests/*.spec.js               test('…')             @tc @test @story @ac
 *   backend/tests/test_*.py                  def / async def test_  @story @ac
 *   frontend/src/**\/__tests__/*.test.js(x)   it('…') / test('…')    @story @ac
 *
 * Writes two tab-separated files to --out (default: ../Claude outputs/ next to
 * the repository when it exists, otherwise ./traceability-out/, git-ignored):
 *   functional_test_files.tsv  TC ID, Story, AC, Test name, File, Line, Link
 *   unit_tests.tsv             Story, AC, Layer, File, Line, Test name, Link
 * and prints a summary (totals, untagged tests, tag problems) to stdout.
 *
 * Tags normally sit directly above the test. A block above a describe() or a
 * class, or one followed by other code (a file-level block), applies to the
 * tests after it in the same scope unless a test carries its own @story.
 * A test with no @story anywhere is listed as Untagged.
 *
 * TC IDs come from parse-metadata.js, the same headers CI maps results with;
 * this script adds the line of the test('…') each @test names.
 */

const fs = require('fs');
const path = require('path');
const { extractBlocks, SCAN_DIR: FUNCTIONAL_DIR } = require('./parse-metadata');

const ROOT = path.resolve(__dirname, '..', '..');
const REPO_URL = 'https://github.com/darrentiang/IS212-G5-T1/blob/main/';
const TAG = /^(?:\/\/|#)\s*@([a-z_]+):\s*(.*)$/;
const UNTAGGED = 'Untagged';

// --- CLI args ---
function outDir() {
  const args = process.argv.slice(2);
  const idx = args.findIndex(a => a === '--out' || a.startsWith('--out='));
  if (idx !== -1) {
    const value = args[idx].includes('=') ? args[idx].slice(args[idx].indexOf('=') + 1) : args[idx + 1];
    if (!value) {
      console.error('ERROR: --out needs a folder');
      process.exit(1);
    }
    return path.resolve(value);
  }
  const claudeOutputs = path.resolve(ROOT, '..', 'Claude outputs');
  return fs.existsSync(claudeOutputs) ? claudeOutputs : path.join(ROOT, 'traceability-out');
}

// --- Files ---
function walk(dir, keep, found = []) {
  if (!fs.existsSync(dir)) return found;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, keep, found);
    else if (keep(full)) found.push(full);
  }
  return found;
}

const relPath = file => path.relative(ROOT, file).replace(/\\/g, '/');
const natural = (a, b) => String(a).localeCompare(String(b), 'en', { numeric: true });
const link = (file, line) => (line ? `${REPO_URL}${file}#L${line}` : '');

// --- JavaScript calls ---

// Index just past the quote or bracket that closes the one at text[start], or -1.
function skipBalanced(text, start) {
  const open = text[start];
  if (open === '`' || open === '"' || open === "'") {
    for (let i = start + 1; i < text.length; i++) {
      if (text[i] === '\\') i++;
      else if (text[i] === open) return i + 1;
    }
    return -1;
  }
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (c === '`' || c === '"' || c === "'") {
      const end = skipBalanced(text, i);
      if (end === -1) return -1;
      i = end - 1;
    } else if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c) && --depth === 0) return i + 1;
  }
  return -1;
}

// The string literal at text[pos] (after whitespace), or null.
function stringAt(text, pos) {
  while (/\s/.test(text[pos] || '')) pos++;
  if (!["'", '"', '`'].includes(text[pos])) return null;
  const end = skipBalanced(text, pos);
  if (end === -1) return null;
  return text.slice(pos + 1, end - 1)
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\(.)/g, '$1');
}

const NOT_TESTS = new Set(['step', 'use', 'extend', 'expect', 'info', 'setTimeout',
  'beforeEach', 'afterEach', 'beforeAll', 'afterAll']);

// { kind: 'test' | 'describe', name } when text starts with an it/test/describe call.
function jsCall(text) {
  const m = text.match(/^(it|test|describe)((?:\.\w+)*)\s*/);
  if (!m) return null;
  const modifiers = m[2].split('.').filter(Boolean);
  const isDescribe = m[1] === 'describe' || modifiers.includes('describe');
  if (!isDescribe && modifiers.some(mod => NOT_TESTS.has(mod))) return null;

  let pos = m[0].length;
  if (modifiers.includes('each')) {
    // it.each([...])('name', fn) or it.each`table`('name', fn): one test in the source.
    pos = skipBalanced(text, pos);
    if (pos === -1) return null;
    while (/\s/.test(text[pos] || '')) pos++;
  }
  if (text[pos] !== '(') return null;
  const name = stringAt(text, pos + 1);
  if (name === null) return null; // e.g. test.skip(condition) inside a test
  return { kind: isDescribe ? 'describe' : 'test', name };
}

// --- Python definitions ---
function pyDef(text, indent, scopes) {
  const cls = text.match(/^class\s+(\w+)/);
  if (cls) return { kind: 'class', name: cls[1] };
  const def = text.match(/^(?:async\s+)?def\s+(\w+)\s*\(/);
  if (!def) return null;
  if (!/^test/.test(def[1])) return { kind: 'def', name: def[1] };
  // pytest collects module-level test functions and methods of Test* classes,
  // not functions nested inside another function.
  if (indent === 0) return { kind: 'test', name: def[1] };
  const parent = [...scopes].reverse().find(s => s.kind === 'class' || s.kind === 'def');
  if (parent && parent.kind === 'class' && /^Test/.test(parent.name)) {
    return { kind: 'test', name: `${parent.name}::${def[1]}` };
  }
  return { kind: 'def', name: def[1] };
}

function quoteCount(text, lang) {
  if (lang === 'py') return (text.match(/"""|'''/g) || []).length;
  return (text.replace(/\\`/g, '').replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"/g, '').match(/`/g) || []).length;
}

function bracketBalance(text) {
  let n = 0;
  for (const c of text.replace(/'[^']*'|"[^"]*"/g, '')) {
    if ('([{'.includes(c)) n++;
    else if (')]}'.includes(c)) n--;
  }
  return n;
}

// --- Scanner ---

/**
 * Lists the tests in one file with the @story/@ac that apply to each, and the
 * tag blocks that apply to no test. Scopes (describe blocks, classes,
 * file-level tag blocks) are tracked by indentation: a scope ends at the first
 * code line indented less than its contents.
 */
function scanFile(file, lang) {
  const lines = fs.readFileSync(file, 'utf-8').split(/\r?\n/);
  const tests = [];
  const strays = [];
  const scopes = []; // { minIndent, kind, name, tags, line, used }
  let pending = null; // a tag comment block waiting for the code it labels
  let inString = false; // inside a Python triple-quoted string or a JS template literal
  let inBlockComment = false;
  let decoratorDepth = 0;

  const close = s => {
    if (s.tags && s.used === 0) strays.push(s.line);
  };
  // Tags followed by other code label the rest of the scope they sit in.
  const pushFileScope = block => {
    const top = scopes[scopes.length - 1];
    if (top && top.kind === 'file' && top.minIndent === block.indent) close(scopes.pop());
    scopes.push({ minIndent: block.indent, kind: 'file', tags: block.tags, line: block.line, used: 0 });
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].replace(/\t/g, '    ');
    const text = raw.trim();
    const indent = raw.length - raw.trimStart().length;

    if (inString) {
      if (quoteCount(text, lang) % 2 === 1) inString = false;
      continue;
    }
    if (inBlockComment) {
      if (text.includes('*/')) inBlockComment = false;
      continue;
    }
    if (decoratorDepth > 0) {
      decoratorDepth += bracketBalance(text);
      continue;
    }
    if (text === '') continue;
    if (lang === 'js' && text.startsWith('/*')) {
      inBlockComment = !text.includes('*/');
      continue;
    }

    if (text.startsWith(lang === 'py' ? '#' : '//')) {
      const tag = text.match(TAG);
      if (tag) {
        if (!pending) pending = { tags: {}, indent, line: i + 1 };
        pending.tags[tag[1]] = tag[2].trim();
      }
      continue;
    }

    // A code line: first leave every scope it sits outside of.
    while (scopes.length && indent < scopes[scopes.length - 1].minIndent) close(scopes.pop());

    if (lang === 'py' && text.startsWith('@')) {
      decoratorDepth = bracketBalance(text); // the tags wait for the def below
      continue;
    }

    const block = pending;
    pending = null;
    if (quoteCount(text, lang) % 2 === 1) inString = true;

    const found = lang === 'py'
      ? pyDef(text, indent, scopes)
      : jsCall(lines.slice(i, i + 20).map(l => l.trim()).join('\n'));

    if (found && found.kind === 'test') {
      const own = block ? block.tags : {};
      let tags = own.story ? own : null;
      let source = 'test';
      if (!tags) {
        const scope = [...scopes].reverse().find(s => s.tags && s.tags.story);
        if (scope) {
          tags = scope.tags;
          source = scope.kind;
          scope.used++;
        }
      }
      tests.push({
        name: found.name,
        line: i + 1,
        story: tags ? tags.story : UNTAGGED,
        ac: tags ? tags.ac || '' : own.ac || '',
        source: tags ? source : null,
      });
      if (lang === 'py') scopes.push({ minIndent: indent + 1, kind: 'def', tags: null, used: 0 });
    } else if (found && found.kind === 'def') {
      // A helper function: tags above it label the rest of the file, like other code;
      // a def test_ inside its body is not collected.
      if (block) pushFileScope(block);
      scopes.push({ minIndent: indent + 1, kind: 'def', tags: null, used: 0 });
    } else if (found) {
      // describe() or class: its tags apply to the tests inside it.
      scopes.push({ minIndent: indent + 1, kind: found.kind, name: found.name,
        tags: block ? block.tags : null, line: block && block.line, used: 0 });
    } else if (block) {
      pushFileScope(block);
    }
  }
  while (scopes.length) close(scopes.pop());
  if (pending) strays.push(pending.line);
  return { tests, strays };
}

// --- Index ---
function main() {
  const out = outDir();
  const problems = [];

  const specs = walk(FUNCTIONAL_DIR, f => /\.spec\.js$/.test(f) && path.dirname(f) === FUNCTIONAL_DIR);
  const pyFiles = walk(path.join(ROOT, 'backend', 'tests'),
    f => /^test_.*\.py$/.test(path.basename(f)) && path.dirname(f) === path.join(ROOT, 'backend', 'tests'));
  const jsFiles = walk(path.join(ROOT, 'frontend', 'src'),
    f => /\.test\.jsx?$/.test(f) && path.basename(path.dirname(f)) === '__tests__');

  const layers = { Functional: [], Backend: [], Frontend: [] };
  const strays = [];
  const scan = (files, lang, layer) => {
    for (const f of files.sort(natural)) {
      const file = relPath(f);
      const result = scanFile(f, lang);
      for (const t of result.tests) layers[layer].push({ ...t, file, layer });
      for (const line of result.strays) strays.push(`${file}:${line}`);
    }
  };
  scan(specs, 'js', 'Functional');
  scan(pyFiles, 'py', 'Backend');
  scan(jsFiles, 'js', 'Frontend');

  // Functional rows: one per @tc header, located by the test('…') its @test names.
  const warnings = [];
  const blocks = specs.sort(natural).flatMap(f => extractBlocks(f, w => warnings.push(w)));
  const claimed = new Set();
  const functionalRows = blocks.map(b => {
    const t = layers.Functional.find(x => x.file === b.file && x.name === b.test);
    if (t) claimed.add(t);
    else problems.push(`${b.file}: @tc ${b.tc} names "${b.test || ''}", but no test('…') in the file has that name`);
    return [b.tc, b.story || UNTAGGED, b.ac || '', b.test || '', b.file, t ? t.line : '', link(b.file, t && t.line)];
  });
  for (const t of layers.Functional.filter(x => !claimed.has(x))) {
    functionalRows.push(['', t.story, t.ac, t.name, t.file, t.line, link(t.file, t.line)]);
  }
  functionalRows.sort((a, b) => natural(a[4], b[4]) || a[5] - b[5]);

  const unitRows = [...layers.Backend, ...layers.Frontend]
    .sort((a, b) => (a.story === UNTAGGED) - (b.story === UNTAGGED)
      || natural(a.story, b.story) || natural(a.file, b.file) || a.line - b.line)
    .map(t => [t.story, t.ac, t.layer, t.file, t.line, t.name, link(t.file, t.line)]);

  fs.mkdirSync(out, { recursive: true });
  const write = (name, header, rows) => {
    const clean = v => String(v).replace(/[\t\r\n]+/g, ' ');
    const body = [header, ...rows].map(r => r.map(clean).join('\t')).join('\n') + '\n';
    fs.writeFileSync(path.join(out, name), body, 'utf-8');
    return path.join(out, name);
  };
  const fPath = write('functional_test_files.tsv',
    ['TC ID', 'Story', 'AC', 'Test name', 'File', 'Line', 'Link'], functionalRows);
  const uPath = write('unit_tests.tsv',
    ['Story', 'AC', 'Layer', 'File', 'Line', 'Test name', 'Link'], unitRows);

  // --- Summary ---
  const tcIds = blocks.map(b => b.tc);
  const dupes = [...new Set(tcIds.filter((id, i) => tcIds.indexOf(id) !== i))];
  const byName = {};
  for (const b of blocks) {
    const key = (b.test || '').toLowerCase().trim();
    (byName[key] = byName[key] || new Set()).add(b.tc);
  }
  const sharedNames = Object.entries(byName).filter(([, ids]) => ids.size > 1);

  const lines = [];
  const say = s => lines.push(s);
  say(`Traceability index written to ${out}`);
  say(`  functional_test_files.tsv  ${functionalRows.length} rows`);
  say(`  unit_tests.tsv             ${unitRows.length} rows`);
  say('');
  say('Tests found (each/parametrize counted once, as written in the source)');
  say(`  Functional (Playwright)  ${layers.Functional.length} tests in ${specs.length} files, ${blocks.length} @tc headers`);
  say(`  Backend (pytest)         ${layers.Backend.length} tests in ${pyFiles.length} files`);
  say(`  Frontend (Vitest)        ${layers.Frontend.length} tests in ${jsFiles.length} files`);
  say('');
  for (const layer of Object.keys(layers)) {
    const inherited = layers[layer].filter(t => t.source && t.source !== 'test');
    if (!inherited.length) continue;
    const from = { describe: 'describe block', class: 'class', file: 'block above other code' };
    const key = t => `${t.file} (${from[t.source]})`;
    const files = [...new Set(inherited.map(key))];
    say(`${layer}: ${inherited.length} tests take @story from a describe or file-level block, not their own header:`);
    for (const f of files) say(`  ${inherited.filter(t => key(t) === f).length}\t${f}`);
  }
  say('');
  for (const layer of Object.keys(layers)) {
    const untagged = layers[layer].filter(t => t.story === UNTAGGED);
    say(`Untagged ${layer.toLowerCase()} tests (no @story): ${untagged.length}`);
    const counts = {};
    for (const t of untagged) counts[t.file] = (counts[t.file] || 0) + 1;
    for (const [file, n] of Object.entries(counts)) say(`  ${n}\t${file}`);
  }
  say('');
  say('Tag problems');
  say(`  @test that does not match its test('…') name: ${warnings.length}`);
  for (const w of warnings) say(`    ${w}`);
  say(`  TC IDs tagged more than once: ${dupes.length}`);
  for (const id of dupes) say(`    ${id}: ${blocks.filter(b => b.tc === id).map(b => b.file).join(', ')}`);
  say(`  @test names shared by more than one TC ID (CI maps results by name): ${sharedNames.length}`);
  for (const [name, ids] of sharedNames) say(`    "${name}": ${[...ids].join(', ')}`);
  say(`  @tc headers whose @test names no test: ${problems.length}`);
  for (const p of problems) say(`    ${p}`);
  say(`  Tag blocks that apply to no test: ${strays.length}`);
  for (const s of strays) say(`    ${s}`);

  console.log(lines.join('\n'));
  return { fPath, uPath };
}

if (require.main === module) main();

module.exports = { scanFile, jsCall };
