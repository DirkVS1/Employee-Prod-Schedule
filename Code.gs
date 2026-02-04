// UPDATED SHEET ID
var SHEET_ID = "11SGM3_REEC7O-zWoazApGp-7wzFoEg8GrRCk2Ot9UyQ"; 

var TAB_ORDERS = "Orders";
var TAB_USERS = "Users";
var TAB_LOGS = "Production_Log";

function doGet() {
  return HtmlService.createTemplateFromFile('index')
      .evaluate()
      .setTitle('Studio Delta Production')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
      .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=0'); 
}

function getSpreadsheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) { try { ss = SpreadsheetApp.openById("YOUR_ID_HERE"); } catch(e) { } }
  return ss;
}

function getSheetOrDie(ss, tabName) {
  var sheet = ss.getSheetByName(tabName);
  if (!sheet) throw new Error("Missing Tab: '" + tabName + "'");
  return sheet;
}

// --- CORE ---
function getUsersAndRoles() {
  var ss = getSpreadsheet();
  var sheet = getSheetOrDie(ss, TAB_USERS); 
  var data = sheet.getDataRange().getValues();
  if (data.length <= 1) return []; 
  data.shift(); 
  return data.map(row => ({ name: row[0], role: row[1] }));
}

function verifyLogin(role, name, password) {
  var ss = getSpreadsheet();
  var sheet = getSheetOrDie(ss, TAB_USERS);
  var data = sheet.getDataRange().getValues();
  
  for (var i = 1; i < data.length; i++) {
    if (role === 'Admin' && data[i][1] === 'Admin' && data[i][2] == password) return { success: true };
    if (role === data[i][1] && name === data[i][0] && data[i][2] == password) return { success: true };
  }
  return { success: false, error: "Incorrect Access Code" };
}

// --- WORKER APP ---
function getOrdersForRole(role) {
  var ss = getSpreadsheet();
  var sheet = getSheetOrDie(ss, TAB_ORDERS);
  var data = sheet.getDataRange().getValues();
  var relevantOrders = [];
  
  var visibilityMap = {
    'Cutting': ['not yet started', 'ready for steelwork', 'cutting steel'],
    'Tagging': ['ready for tagging', 'tagging'],
    'Welding': ['ready for welding', 'welding'],
    'Grinding': ['ready for grinding', 'grinding'],
    'Quality Control': ['ready for pre-powder coating', 'pre-powder coating', 'ready for powder coating', 'powder coating', 'ready for delivery', 'out for delivery'],
    'Assembly': ['ready for assembly', 'assembly']
  };

  var allowedStatuses = visibilityMap[role] || [];
  
  for (var i = 1; i < data.length; i++) {
    var statusLower = String(data[i][2]).toLowerCase().trim();
    if (role === 'Admin' || allowedStatuses.includes(statusLower)) {
      relevantOrders.push({
        rowIndex: i + 1,
        order: data[i][1],
        status: data[i][2],
        assigned: data[i][3]
      });
    }
  }
  return relevantOrders;
}

function startOrder(rowIndex, workerName, role) {
  var ss = getSpreadsheet();
  var sheet = getSheetOrDie(ss, TAB_ORDERS);
  var logSheet = getSheetOrDie(ss, TAB_LOGS);
  
  var currentAssigned = sheet.getRange(rowIndex, 4).getValue();
  if (currentAssigned !== "" && currentAssigned !== workerName) throw new Error("Order locked by " + currentAssigned);
  
  var currentStatus = sheet.getRange(rowIndex, 3).getValue();
  var nextStatus = getNextStatus(currentStatus);
  
  if (nextStatus.toLowerCase().startsWith("ready") || currentStatus.toLowerCase().startsWith("ready")) {
      while (nextStatus.toLowerCase().startsWith("ready")) { nextStatus = getNextStatus(nextStatus); if (!nextStatus) break; }
  }

  sheet.getRange(rowIndex, 3).setValue(nextStatus);
  sheet.getRange(rowIndex, 4).setValue(workerName);
  
  var uniqueId = Utilities.getUuid();
  logSheet.appendRow([uniqueId, sheet.getRange(rowIndex, 2).getValue(), workerName, role, nextStatus, new Date(), ""]);
  SpreadsheetApp.flush();
  return { success: true, newStatus: nextStatus, logId: uniqueId };
}

function finishOrder(rowIndex, logId, qcData, signatureUrl) {
  var ss = getSpreadsheet();
  var sheet = getSheetOrDie(ss, TAB_ORDERS);
  var logSheet = getSheetOrDie(ss, TAB_LOGS);
  
  var nextStep = getNextStatus(sheet.getRange(rowIndex, 3).getValue()); 
  sheet.getRange(rowIndex, 3).setValue(nextStep);
  sheet.getRange(rowIndex, 4).setValue(""); 
  
  var logs = logSheet.getDataRange().getValues();
  for (var i = 0; i < logs.length; i++) {
    if (logs[i][0] == logId) {
      logSheet.getRange(i+1, 7).setValue(new Date()); 
      var qcString = qcData ? qcData.map(function(item){ return item.q + ": " + item.a; }).join("\n") : "Skipped";
      logSheet.getRange(i+1, 8).setValue(qcString);
      if(signatureUrl) logSheet.getRange(i+1, 9).setValue(signatureUrl);
      break;
    }
  }
  SpreadsheetApp.flush();
  return { success: true };
}

// --- ADMIN FEATURES ---

function getProductionOverview() {
  var ss = getSpreadsheet();
  var logSheet = getSheetOrDie(ss, TAB_LOGS);
  var data = logSheet.getDataRange().getValues();
  data.shift(); // Remove header

  // Return raw log data enriched with duration
  return data.map(row => {
    var start = row[5] ? new Date(row[5]) : null;
    var end = row[6] ? new Date(row[6]) : null;
    var duration = calculateWorkMinutes(start, end);

    return {
      order: row[1],
      worker: row[2],
      role: row[3],
      task: row[4],
      start: start,
      end: end,
      durationMins: duration,
      qc: row[7] // QC Data
    };
  });
}

function getWorkerStats() {
  var ss = getSpreadsheet();
  var logSheet = getSheetOrDie(ss, TAB_LOGS);
  var data = logSheet.getDataRange().getValues();
  data.shift();

  var workers = {};
  
  data.forEach(row => {
    var name = row[2];
    if (!name) return;
    if (!workers[name]) workers[name] = { totalMins: 0, weeklyMins: {}, logs: [] };
    
    var start = row[5] ? new Date(row[5]) : null;
    var end = row[6] ? new Date(row[6]) : null;
    var duration = calculateWorkMinutes(start, end);
    
    workers[name].totalMins += duration;
    
    // Calculate week key (ISO week)
    if (start) {
      var weekKey = getWeekKey(start);
      if (!workers[name].weeklyMins[weekKey]) workers[name].weeklyMins[weekKey] = 0;
      workers[name].weeklyMins[weekKey] += duration;
    }
    
    workers[name].logs.push({
      task: row[4],
      order: row[1],
      start: start,
      end: end,
      duration: duration,
      role: row[3]
    });
  });
  
  return workers;
}

// Helper to get ISO week key (YYYY-Wxx)
// ISO week calculation: Week 1 is the first week with a Thursday in it
// Algorithm adjusts date to Thursday of the same week, then calculates week number
function getWeekKey(date) {
  var d = new Date(date.getTime());
  d.setHours(0, 0, 0, 0);
  // Set to Thursday of the current week (ISO week starts on Monday)
  d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
  // Get first Thursday of the year (week 1)
  var week1 = new Date(d.getFullYear(), 0, 4);
  // Calculate week number: days between divided by 7, adjusted for day of week
  var weekNum = 1 + Math.round(((d.getTime() - week1.getTime()) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
  return d.getFullYear() + '-W' + (weekNum < 10 ? '0' : '') + weekNum;
}

// --- UTILS ---

function getNextStatus(current) {
  var flow = ["not yet started", "ready for steelwork", "cutting steel", "ready for tagging", "tagging", "ready for welding", "welding", "ready for grinding", "grinding", "ready for pre-powder coating", "pre-powder coating", "ready for powder coating", "powder coating", "ready for assembly", "assembly", "ready for delivery", "out for delivery", "delivered"];
  var idx = flow.indexOf(String(current).toLowerCase().trim());
  return (idx > -1 && idx < flow.length - 1) ? flow[idx + 1] : current; 
}

// THE TIME CALCULATOR (07:30 - 15:45)
function calculateWorkMinutes(start, end) {
  if (!start) return 0;
  if (!end) end = new Date(); // If running, calc up to now
  
  var totalMinutes = 0;
  var current = new Date(start.getTime());
  
  // Safety break to prevent infinite loops (max 30 days)
  var safety = 0;
  
  while (current < end && safety < 30) {
    // Define shift start/end for THIS day
    var shiftStart = new Date(current);
    shiftStart.setHours(7, 30, 0, 0);
    
    var shiftEnd = new Date(current);
    shiftEnd.setHours(15, 45, 0, 0);
    
    // Determine the overlapping window
    var windowStart = (current > shiftStart) ? current : shiftStart;
    var windowEnd = (end < shiftEnd) ? end : shiftEnd; // Cap at shift end or actual end
    
    // If we have a valid window for this day
    if (windowStart < windowEnd) {
      var diffMs = windowEnd - windowStart;
      totalMinutes += (diffMs / 1000 / 60);
    }
    
    // Move to next day 07:30
    current.setDate(current.getDate() + 1);
    current.setHours(7, 30, 0, 0);
    safety++;
  }
  
  return Math.floor(totalMinutes);
}
