#!/usr/bin/env node
/**
 * Parses @tc metadata blocks from test source files.
 *
 * Scans:
 *   backend/tests/ (Python)
 *   frontend/src/__tests__/ (JS/JSX)
 *   functional/tests/ (Playwright specs)
 *
 * Outputs JSON array of test case definitions to stdout.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const SCAN_DIRS = [
  { dir: path.join(ROOT, 'backend', 'tests'), ext: '.py', comment: '#' },
  { dir: path.join(ROOT, 'frontend', 'src', '__tests__'), ext: '.jsx', comment: '//' },
  { dir: path.join(ROOT, 'frontend', 'src', '__tests__'), ext: '.js', comment: '//' },
  { dir: path.join(ROOT, 'functional', 'tests'), ext: '.spec.js', comment: '//' },
];

const FIELDS = ['tc', 'test', 'story', 'ac', 'type', 'scenario', 'preconditions', 'steps', 'test_data', 'expected'];

function extractBlocks(filePath, commentPrefix) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const blocks = [];
  let current = null;

  for (const line of lines) {
    const trimmed = line.trim();
    const match = trimmed.match(new RegExp('^' + commentPrefix + '\\s*@([a-z_]+):\\s*(.+)$'));

    if (match) {
      const [, key, value] = match;
      if (key === 'tc') {
        // New block starts
        if (current && current.tc) blocks.push(current);
        current = { tc: value.trim() };
      } else if (current && FIELDS.includes(key)) {
        current[key === 'test_data' ? 'testData' : key] = value.trim();
      }
    } else if (current && !trimmed.startsWith(commentPrefix) && trimmed !== '') {
      // Non-comment, non-empty line ends the metadata block
      if (current.tc) blocks.push(current);
      current = null;
    }
  }
  if (current && current.tc) blocks.push(current);

  return blocks;
}

function scanDirectory(dir, ext, comment) {
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter(f => f.endsWith(ext));
  const results = [];

  for (const file of files) {
    const filePath = path.join(dir, file);
    const blocks = extractBlocks(filePath, comment);
    results.push(...blocks);
  }

  return results;
}

function main() {
  const allCases = [];

  for (const { dir, ext, comment } of SCAN_DIRS) {
    allCases.push(...scanDirectory(dir, ext, comment));
  }

  // Deduplicate by tcId (last wins)
  const byId = {};
  for (const tc of allCases) {
    byId[tc.tc] = tc;
  }

  const testCases = Object.values(byId).map(tc => ({
    tcId: tc.tc,
    test: tc.test || '',
    story: tc.story || '',
    ac: tc.ac || '',
    type: tc.type || '',
    scenario: tc.scenario || '',
    preconditions: tc.preconditions || '',
    steps: tc.steps || '',
    testData: tc.testData || '',
    expected: tc.expected || '',
  }));

  console.log(JSON.stringify(testCases, null, 2));
}

main();
