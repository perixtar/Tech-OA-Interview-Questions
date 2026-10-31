/**
 * Google Apps Script for Tech OA Question Bank Sync
 * 
 * SETUP INSTRUCTIONS:
 * 1. Open your Google Sheet.
 * 2. In top menu, click: Extensions > Apps Script.
 * 3. Delete any existing code and paste this entire script.
 * 4. Click 'Deploy' > 'New deployment'.
 * 5. Click the gear icon next to 'Select type' and choose 'Web app'.
 * 6. Set:
 *    - Description: "Tech OA Webhook"
 *    - Execute as: "Me"
 *    - Who has access: "Anyone"
 * 7. Click 'Deploy', authorize permissions if asked, and copy the Web App URL.
 * 8. Paste the Web App URL into the "Google Sheets" settings modal in your web app.
 */

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.tryLock(15000);

  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    
    // Ensure header row exists
    ensureHeaders(sheet);

    if (!e || !e.postData || !e.postData.contents) {
      return responseJSON({ status: 'error', message: 'No payload received' });
    }

    var payload = JSON.parse(e.postData.contents);

    // Ping check
    if (payload.action === 'ping') {
      return responseJSON({ status: 'success', message: 'Connection successful' });
    }

    // Batch sync
    if (payload.action === 'batch' && Array.isArray(payload.items)) {
      payload.items.forEach(function(item) {
        upsertProblem(sheet, item);
      });
      return responseJSON({ status: 'success', count: payload.items.length });
    }

    // Single item sync
    upsertProblem(sheet, payload);
    return responseJSON({ status: 'success', message: 'Problem updated' });

  } catch (err) {
    return responseJSON({ status: 'error', message: err.toString() });
  } finally {
    lock.releaseLock();
  }
}

function doGet(e) {
  return responseJSON({ status: 'success', message: 'Google Apps Script Webhook is active.' });
}

var SHEET_HEADERS = [
  'Problem Title',
  'Company',
  'Category',
  'Pattern',
  'Time Taken (mins)',
  'Quality',
  'Status',
  'Date Solved',
  'Problem Link',
  'Date Reported',
  'Comments'
];

/**
 * Run this function directly inside Google Apps Script (click Run) 
 * to instantly create and format all 11 column headers in your sheet.
 */
function setupSheetHeaders() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  sheet.getRange(1, 1, 1, SHEET_HEADERS.length).setValues([SHEET_HEADERS]);
  var range = sheet.getRange(1, 1, 1, SHEET_HEADERS.length);
  range.setFontWeight('bold');
  range.setBackground('#1e293b');
  range.setFontColor('#f8fafc');
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, SHEET_HEADERS.length);

  // Set Column H (Date Solved) to DD/MM/YYYY format
  sheet.getRange('H2:H').setNumberFormat('dd/MM/yyyy');
}

function ensureHeaders(sheet) {
  if (sheet.getLastRow() === 0 || sheet.getLastColumn() < SHEET_HEADERS.length) {
    setupSheetHeaders();
  }
}

function parseDate(val) {
  if (!val) return '';
  if (val instanceof Date) return val;
  if (typeof val === 'string') {
    var str = val.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
      var parts = str.split('-');
      return new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
    }
    if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(str)) {
      var parts = str.split('/');
      return new Date(parseInt(parts[2], 10), parseInt(parts[1], 10) - 1, parseInt(parts[0], 10));
    }
  }
  return val;
}

function upsertProblem(sheet, data) {
  var title = data.title || '';
  var company = data.company || '';
  var category = data.category || '';
  var pattern = data.pattern || '';
  var timeTaken = data.timeTaken || '';
  var quality = data.quality || 'Solved Clean';
  var status = data.status || 'Solved';
  var dateSolved = parseDate(data.dateSolved || new Date().toISOString().split('T')[0]);
  var link = data.link || '';
  var date = data.date || '';
  var comments = data.comments || '';

  var rowData = [
    title,
    company,
    category,
    pattern,
    timeTaken,
    quality,
    status,
    dateSolved,
    link,
    date,
    comments
  ];

  var lastRow = sheet.getLastRow();
  var existingRow = -1;

  if (lastRow > 1) {
    var values = sheet.getRange(2, 1, lastRow - 1, 9).getValues();
    for (var i = 0; i < values.length; i++) {
      var rowTitle = values[i][0];
      var rowLink = values[i][8];
      if ((link && rowLink === link) || (title && rowTitle === title)) {
        existingRow = i + 2;
        break;
      }
    }
  }

  var targetRow = existingRow > 0 ? existingRow : lastRow + 1;
  if (existingRow > 0) {
    sheet.getRange(existingRow, 1, 1, rowData.length).setValues([rowData]);
  } else {
    sheet.appendRow(rowData);
  }

  // Ensure cell in Column H is formatted as DD/MM/YYYY
  sheet.getRange(targetRow, 8).setNumberFormat('dd/MM/yyyy');
}

function responseJSON(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
