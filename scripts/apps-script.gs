/**
 * IS212 G5 T1 — Google Sheets CI Logging
 *
 * Deploy as a Web App:
 *   Extensions → Apps Script → paste this → Deploy → New deployment
 *   Execute as: Me
 *   Who has access: Anyone
 *
 * Two endpoints (same URL, different ?action=):
 *   ?action=testcases  — upsert test case definitions (no dupes)
 *   ?action=executions — append execution log rows
 */

var SHEET_TEST_CASES = 'Test cases';
var SHEET_EXECUTIONS = 'Executions';

// Column index in Test cases sheet (A=1, B=2, ...)
var TC_COLS = {
  story: 1,       // A
  tcId: 2,        // B
  ac: 3,          // C
  step: 4,        // D
  scenario: 5,    // E
  preconditions: 6, // F
  steps: 7,       // G
  testData: 8,    // H
  expected: 9,    // I
  draftedBy: 10,  // J
  curatedBy: 11,  // K
  reviewedBy: 12  // L
};

// Column index in Executions sheet
var EX_COLS = {
  runId: 1,       // A
  tcId: 2,        // B
  date: 3,        // C
  commit: 4,      // D
  executedBy: 5,  // E
  actualResult: 6,// F
  status: 7,      // G
  remarks: 8      // H
};

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var data = JSON.parse(e.postData.contents);
    var action = data.action || (e.parameter && e.parameter.action);

    if (action === 'testcases') {
      return upsertTestCases(data.testCases || []);
    } else if (action === 'executions') {
      return appendExecutions(data.executions || []);
    } else {
      return jsonResponse(400, { error: 'Unknown action: ' + action });
    }
  } catch (err) {
    return jsonResponse(500, { error: err.toString() });
  } finally {
    lock.releaseLock();
  }
}

/**
 * Upsert test cases: update if TC ID exists, append if new.
 */
function upsertTestCases(testCases) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_TEST_CASES);
  if (!sheet) return jsonResponse(500, { error: 'Sheet not found: ' + SHEET_TEST_CASES });

  var existing = buildTcIndex(sheet);
  var now = new Date();
  var updated = 0;
  var inserted = 0;

  testCases.forEach(function (tc) {
    if (!tc.tcId) return;

    var row = [
      tc.story || '',
      tc.tcId,
      tc.ac || '',
      tc.type || '',
      tc.scenario || '',
      tc.preconditions || '',
      tc.steps || '',
      tc.testData || '',
      tc.expected || '',
      'CI, ' + Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyy-MM-dd'),
      tc.curatedBy || '—',
      tc.reviewedBy || '—'
    ];

    if (existing[tc.tcId] !== undefined) {
      var rowNum = existing[tc.tcId];
      sheet.getRange(rowNum, 1, 1, row.length).setValues([row]);
      updated++;
    } else {
      sheet.appendRow(row);
      inserted++;
    }
  });

  return jsonResponse(200, {
    status: 'ok',
    action: 'testcases',
    updated: updated,
    inserted: inserted,
    total: testCases.length
  });
}

/**
 * Append execution log rows.
 */
function appendExecutions(executions) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_EXECUTIONS);
  if (!sheet) return jsonResponse(500, { error: 'Sheet not found: ' + SHEET_EXECUTIONS });

  var appended = 0;
  executions.forEach(function (ex) {
    if (!ex.tcId) return;
    sheet.appendRow([
      ex.runId || '',
      ex.tcId,
      ex.date || new Date().toISOString(),
      ex.commit || '',
      ex.executedBy || 'GitHub Actions',
      ex.actualResult || '',
      ex.status || '',
      ex.remarks || ''
    ]);
    appended++;
  });

  return jsonResponse(200, {
    status: 'ok',
    action: 'executions',
    appended: appended,
    total: executions.length
  });
}

/**
 * Build a map of TC ID → row number (last occurrence wins).
 */
function buildTcIndex(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return {};

  var ids = sheet.getRange(2, TC_COLS.tcId, lastRow - 1, 1).getValues();
  var index = {};
  for (var i = 0; i < ids.length; i++) {
    var val = ids[i][0];
    if (val) index[val] = i + 2; // +2 because range starts at row 2, and 1-indexed
  }
  return index;
}

function jsonResponse(code, obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
