var SHEET_ID = "1SK_vY3uvwnfE2veLaLb_ilbOoINPCECdCUaq63kOJks";
var SHEET_NAME = "Production_Log";

function doGet() {
  return HtmlService.createTemplateFromFile('index')
      .evaluate()
      .setTitle('Production Manager Pro')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function getData() {
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet) return { success: false, error: "Tab '" + SHEET_NAME + "' missing." };

    var data = sheet.getDataRange().getValues();
    if (data.length <= 1) return { success: true, rows: [] };

    data.shift(); // Remove headers
    
    // Map data to clean objects
    var rows = data.map(function(row) {
      return {
        id: row[0],
        order: row[1].toString().toUpperCase(),
        name: row[2],
        type: row[3],
        start: row[4] ? new Date(row[4]).toISOString() : "",
        end: row[5] ? new Date(row[5]).toISOString() : ""
      };
    });
    
    return { success: true, rows: rows };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function startTask(form) {
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName(SHEET_NAME);
    
    var uniqueId = Utilities.getUuid();
    var startTime = new Date();
    
    sheet.appendRow([
      uniqueId, 
      form.orderNumber.toString().toUpperCase(), 
      form.employeeName, 
      form.workType, 
      startTime, 
      ""
    ]);
    
    return { success: true, id: uniqueId, startTime: startTime.toISOString() };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function endTask(id) {
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName(SHEET_NAME);
    var data = sheet.getDataRange().getValues();
    
    for (var i = 0; i < data.length; i++) {
      if (data[i][0] == id) {
        sheet.getRange(i + 1, 6).setValue(new Date()); // Set End Time
        return { success: true, endTime: new Date().toISOString() };
      }
    }
    return { success: false, error: "ID not found." };
  } catch (e) {
    return { success: false, error: e.message };
  }
}
