#!/usr/bin/env node
/**
 * CI logging script: collects test results and POSTs to Google Sheets.
 *
 * Usage:
 *   node scripts/log-results.js --commit <sha> --pr <number> --webhook <url>
 *
 * Reads test results from:
 *   backend/junit.xml          (pytest --junitxml)
 *   frontend/vitest-report.json (vitest --reporter=json)
 *   functional/test-results/functional-results.json (playwright)
 *
 * Parses @tc metadata from test files to map results to TC IDs.
 * POSTs test case definitions and execution logs to the Apps Script webhook.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

// --- CLI args ---
const args = process.argv.slice(2);
function getArg(name) {
  const idx = args.indexOf('--' + name);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : null;
}

const COMMIT = getArg('commit') || 'unknown';
const PR = getArg('pr') || '0';
const WEBHOOK = getArg('webhook');
const RUN_ID = `PR-${PR}-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`;
const NOW = new Date().toISOString();

if (!WEBHOOK) {
  console.error('ERROR: --webhook <url> is required');
  process.exit(1);
}

// --- Step 1: Parse @tc metadata ---
console.log('Step 1: Parsing @tc metadata from test files...');
let testCases = [];
try {
  const metaOut = execSync(`node "${path.join(ROOT, 'scripts', 'parse-metadata.js')}"`, {
    encoding: 'utf-8',
    maxBuffer: 10 * 1024 * 1024,
  });
  testCases = JSON.parse(metaOut);
  console.log(`  Found ${testCases.length} test cases with @tc metadata`);
} catch (err) {
  console.error('  WARNING: Failed to parse metadata:', err.message);
}

// --- Build TC ID lookup maps ---
const tcLookupByName = {};
const tcLookupById = {};
for (const tc of testCases) {
  tcLookupById[tc.tcId] = tc.tcId;
  if (tc.test) {
    tcLookupByName[tc.test.toLowerCase().trim()] = tc.tcId;
  }
}

// --- Step 2: Collect results from all frameworks ---
console.log('Step 2: Collecting test results...');
const results = [];

// Pytest (JUnit XML)
collectPytestResults(results);
// Vitest (JSON reporter)
collectVitestResults(results);
// Playwright (JSON reporter)
collectPlaywrightResults(results);

console.log(`  Collected ${results.length} test results`);

// --- Step 3: POST test cases (upsert) ---
if (testCases.length > 0) {
  console.log('Step 3: Syncing test cases to sheet...');
  postToSheet({ action: 'testcases', testCases });
}

// --- Step 4: POST executions (append) ---
if (results.length > 0) {
  console.log('Step 4: Logging executions to sheet...');
  const executions = results.map(r => ({
    runId: RUN_ID,
    tcId: r.tcId,
    date: NOW,
    commit: COMMIT.slice(0, 7),
    executedBy: 'GitHub Actions',
    actualResult: r.actualResult || '',
    status: r.status,
    remarks: `PR #${PR}`,
  }));
  postToSheet({ action: 'executions', executions });
}

console.log('Done.');

// ============================================================
// Collection functions
// ============================================================

function collectPytestResults(results) {
  const junitPath = path.join(ROOT, 'backend', 'junit.xml');
  if (!fs.existsSync(junitPath)) {
    console.log('  pytest: no junit.xml found, skipping');
    return;
  }

  const xml = fs.readFileSync(junitPath, 'utf-8');
  // Parse <testcase classname="..." name="..." ...> ... </testcase>
  const testcaseRegex = /<testcase\s+[^>]*classname="([^"]*)"[^>]*name="([^"]*)"[^>]*?(?:\/>|>([\s\S]*?)<\/testcase>)/g;
  let match;

  while ((match = testcaseRegex.exec(xml)) !== null) {
    const [, classname, name, body] = match;
    const failed = body && (body.includes('<failure') || body.includes('<error'));
    const tcId = findTcId('pytest', classname, name);
    results.push({
      tcId: tcId || `${classname}::${name}`,
      status: failed ? 'Fail' : 'Pass',
      actualResult: failed ? extractFailureMessage(body) : 'Passed',
    });
  }
  console.log(`  pytest: ${results.length} results from junit.xml`);
}

function collectVitestResults(results) {
  const reportPath = path.join(ROOT, 'frontend', 'vitest-report.json');
  if (!fs.existsSync(reportPath)) {
    console.log('  vitest: no vitest-report.json found, skipping');
    return;
  }

  let report;
  try {
    report = JSON.parse(fs.readFileSync(reportPath, 'utf-8'));
  } catch {
    console.log('  vitest: failed to parse JSON, skipping');
    return;
  }

  const baseCount = results.length;

  function walkSuites(suites) {
    if (!suites) return;
    for (const suite of suites) {
      if (suite.assertionResults) {
        for (const test of suite.assertionResults) {
          const fullName = test.fullName || test.title || '';
          const tcId = findTcId('vitest', suite.name || '', test.title || '');
          results.push({
            tcId: tcId || fullName,
            status: test.status === 'passed' ? 'Pass' : 'Fail',
            actualResult: test.status === 'passed' ? 'Passed' : (test.failureMessages || ['Failed']).join('; ').slice(0, 200),
          });
        }
      }
      if (suite.suite) walkSuites(suite.suite);
      if (suite.suites) walkSuites(suite.suites);
    }
  }

  if (report.testResults) walkSuites(report.testResults);
  console.log(`  vitest: ${results.length - baseCount} results from JSON report`);
}

function collectPlaywrightResults(results) {
  const reportPath = path.join(ROOT, 'functional', 'test-results', 'functional-results.json');
  if (!fs.existsSync(reportPath)) {
    console.log('  playwright: no results.json found, skipping');
    return;
  }

  let report;
  try {
    report = JSON.parse(fs.readFileSync(reportPath, 'utf-8'));
  } catch {
    console.log('  playwright: failed to parse JSON, skipping');
    return;
  }

  const baseCount = results.length;

  function walkSuites(suites) {
    if (!suites) return;
    for (const suite of suites) {
      if (suite.specs) {
        for (const spec of suite.specs) {
          const tcId = findTcId('playwright', suite.file || '', spec.title);
          const passed = spec.ok !== false && spec.tests &&
            spec.tests.every(t => t.status === 'expected' || t.results?.every(r => r.status === 'passed'));
          results.push({
            tcId: tcId || spec.title,
            status: passed ? 'Pass' : 'Fail',
            actualResult: passed ? 'Passed' : 'Failed',
          });
        }
      }
      if (suite.suites) walkSuites(suite.suites);
    }
  }

  if (report.suites) walkSuites(report.suites);
  console.log(`  playwright: ${results.length - baseCount} results from JSON report`);
}

// ============================================================
// TC ID matching
// ============================================================

/**
 * Try to find a TC ID for a given test result.
 */
function findTcId(framework, className, testName) {
  // Exact match on @test field
  const nameKey = testName.toLowerCase().trim();
  if (tcLookupByName[nameKey]) return tcLookupByName[nameKey];

  // Fuzzy: check if any known test name is contained in the result name
  for (const [key, tcId] of Object.entries(tcLookupByName)) {
    if (nameKey.includes(key) || key.includes(nameKey)) {
      return tcId;
    }
  }

  // Direct TC ID match
  if (tcLookupById[testName]) return tcLookupById[testName];

  return null;
}

function extractFailureMessage(body) {
  if (!body) return '';
  const match = body.match(/<failure[^>]*message="([^"]*)"/);
  return match ? match[1].slice(0, 200) : 'Failed';
}

// ============================================================
// HTTP POST
// ============================================================

async function postToSheet(payload) {
  try {
    const response = await fetch(WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const text = await response.text();
    console.log(`  POST ${payload.action}: ${response.status} — ${text}`);
    if (!response.ok) {
      console.error(`  WARNING: Sheet update returned ${response.status}`);
    }
  } catch (err) {
    console.error(`  WARNING: Failed to POST to sheet: ${err.message}`);
    // Don't fail CI just because sheet logging failed
  }
}
