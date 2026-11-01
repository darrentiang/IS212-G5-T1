#!/usr/bin/env node
/**
 * Parses @tc link headers from Playwright spec files.
 *
 * Scans functional/tests/*.spec.js only. Unit tests carry @story/@ac for
 * human traceability but no TC ID, so CI does not parse them.
 *
 * A header is the comment block above a test():
 *   // @tc: TC-SCRUM-26-03
 *   // @test: wrong password is refused
 *   // @story: SCRUM-26
 *   // @ac: 3
 *
 * Outputs a JSON array of { tcId, test, story, ac, file } to stdout.
 * Warns on stderr when @test does not match the test('…') name that follows.
 * traceability.js requires extractBlocks() to index the same headers.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const SCAN_DIR = path.join(ROOT, 'functional', 'tests');
const COMMENT = '//';
const FIELDS = ['tc', 'test', 'story', 'ac'];

function extractBlocks(filePath, warn = console.error) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const blocks = [];
  const rel = path.relative(ROOT, filePath).replace(/\\/g, '/');
  let current = null;

  for (const line of lines) {
    const trimmed = line.trim();
    const match = trimmed.match(new RegExp('^' + COMMENT + '\\s*@([a-z_]+):\\s*(.+)$'));

    if (match) {
      const [, key, value] = match;
      if (key === 'tc') {
        if (current) blocks.push(current);
        current = { tc: value.trim(), file: rel };
      } else if (current && FIELDS.includes(key)) {
        current[key] = value.trim();
      }
    } else if (current && !trimmed.startsWith(COMMENT) && trimmed !== '') {
      // First code line after the header: should be the test() call.
      const nameMatch = trimmed.match(/^test(?:\.\w+)?\(\s*(['"`])(.+?)\1/);
      if (nameMatch) {
        const actual = nameMatch[2];
        if (!current.test) {
          current.test = actual;
        } else if (current.test !== actual) {
          warn(`WARNING ${rel}: @test "${current.test}" does not match test('${actual}')`);
        }
      }
      blocks.push(current);
      current = null;
    }
  }
  if (current) blocks.push(current);
  return blocks;
}

function main() {
  const all = [];
  if (fs.existsSync(SCAN_DIR)) {
    for (const file of fs.readdirSync(SCAN_DIR).filter(f => f.endsWith('.spec.js'))) {
      all.push(...extractBlocks(path.join(SCAN_DIR, file)));
    }
  }

  // One entry per TC ID (last wins); warn on duplicates.
  const byId = {};
  for (const b of all) {
    if (byId[b.tc]) console.error(`WARNING duplicate @tc ${b.tc} in ${byId[b.tc].file} and ${b.file}`);
    byId[b.tc] = b;
  }

  const out = Object.values(byId).map(b => ({
    tcId: b.tc,
    test: b.test || '',
    story: b.story || '',
    ac: b.ac || '',
    file: b.file,
  }));

  console.log(JSON.stringify(out, null, 2));
}

if (require.main === module) main();

module.exports = { extractBlocks, SCAN_DIR };
