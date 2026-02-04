// --- CONFIGURATION ---
var SHEET_ID = "11SGM3_REEC7O-zWoazApGp-7wzFoEg8GrRCk2Ot9UyQ"; // Your provided ID
var TAB_ORDERS = "Orders";
var TAB_USERS = "Users";
var TAB_LOGS = "Production_Log";
var TAB_OVERVIEW = "Overview";

function doGet() {
  return HtmlService.createTemplateFromFile('index')
      .evaluate()
      .setTitle('Studio Delta Production')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
      .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=0'); 
}

function getSpreadsheet() {
  return SpreadsheetApp.openById(SHEET_ID);
}

function getSheetOrDie(ss, tabName) {
  var sheet = ss.getSheetByName(tabName);
  if (!sheet) throw new Error("Missing Tab: '" + tabName + "'. Please create it.");
  return sheet;
}

// --- CORE: USERS & LOGIN ---
function getUsersAndRoles() {
  var ss = getSpreadsheet();
  var sheet = getSheetOrDie(ss, TAB_USERS); 
  var data = sheet.getDataRange().getValues();
  if (data.length <= 1) return []; 
  data.shift(); // Remove headers
  // Col A=Name, Col B=Role
  return data.map(function(row) { return { name: row[0], role: row[1] }; });
}

function verifyLogin(role, name, password) {
  var ss = getSpreadsheet();
  var sheet = getSheetOrDie(ss, TAB_USERS);
  var data = sheet.getDataRange().getValues();
  
  var adminPassword = null;
  // Find Admin password first (fallback)
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][1]).toLowerCase() === 'admin') {
      adminPassword = data[i][2];
      break;
    }
  }

  for (var i = 1; i < data.length; i++) {
    var rowName = data[i][0];
    var rowRole = data[i][1];
    var rowPass = data[i][2];

    if (role === rowRole && name === rowName) {
      // Check specific user password OR master admin password
      if (String(password) == String(rowPass) || (adminPassword && String(password) == String(adminPassword))) {
        return { success: true, isAdmin: (role === 'Admin') };
      }
    }
  }
  return { success: false, error: "Incorrect Access Code" };
}

// --- WORKER DASHBOARD: GET ORDERS ---
function getOrdersForRole(role) {
  var ss = getSpreadsheet();
  var sheet = getSheetOrDie(ss, TAB_ORDERS);
  var data = sheet.getDataRange().getValues();
  var relevantOrders = [];
  
  // Mapping Roles to Visible Statuses
  var visibilityMap = {
    'Cutting': ['not yet started', 'ready for steelwork', 'cutting steel'],
    'Tagging': ['ready for tagging', 'tagging'],
    'Welding': ['ready for welding', 'welding'],
    'Grinding': ['ready for grinding', 'grinding'],
    // Quality Control handles the paint/powder/delivery flow in this system
    'Quality Control': [
      'ready for pre-powder coating', 'pre-powder coating', 
      'ready for powder coating', 'powder coating', 
      'ready for delivery', 'out for delivery'
    ],
    'Assembly': ['ready for assembly', 'assembly']
  };

  var allowedStatuses = visibilityMap[role] || [];
  
  // Start loop at 1 to skip headers
  for (var i = 1; i < data.length; i++) {
    var orderNum = data[i][1]; // Col B
    var status = String(data[i][2]).toLowerCase().trim(); // Col C
    var assigned = data[i][3]; // Col D

    if (role === 'Admin' || allowedStatuses.includes(status)) {
      relevantOrders.push({
        rowIndex: i + 1, // Store 1-based index for updates
        order: orderNum,
        status: data[i][2], // Keep original case for display
        assigned: assigned
      });
    }
  }
  return relevantOrders;
}

// --- ACTION: START ORDER ---
function startOrder(rowIndex, orderCheck, workerName, role) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  
  try {
    var ss = getSpreadsheet();
    var sheet = getSheetOrDie(ss, TAB_ORDERS);
    var logSheet = getSheetOrDie(ss, TAB_LOGS);
    var overviewSheet = ss.getSheetByName(TAB_OVERVIEW); // Optional
    
    // SAFETY CHECK: Ensure the row hasn't moved
    var currentRowOrder = sheet.getRange(rowIndex, 2).getValue();
    if (String(currentRowOrder) !== String(orderCheck)) {
      throw new Error("Row mismatch. The sheet may have been sorted. Please refresh.");
    }

    var currentAssigned = sheet.getRange(rowIndex, 4).getValue();
    if (currentAssigned === workerName) return { success: true, message: "Already started by you." };
    if (currentAssigned !== "") throw new Error("Order is currently locked by " + currentAssigned);
    
    var currentStatus = sheet.getRange(rowIndex, 3).getValue();
    var nextStatus = getNextStatus(currentStatus);
    
    // Auto-advance if the next status is just a "Ready" state
    // e.g. If current is "Ready for Welding", change to "Welding" immediately
    if (nextStatus.toLowerCase().startsWith("ready") || currentStatus.toLowerCase().startsWith("ready")) {
        var safety = 0;
        while (nextStatus.toLowerCase().startsWith("ready") && safety < 5) { 
          var temp = getNextStatus(nextStatus); 
          if (!temp) break; 
          nextStatus = temp;
          safety++;
        }
    }

    // Update Orders Tab
    sheet.getRange(rowIndex, 3).setValue(nextStatus);
    sheet.getRange(rowIndex, 4).setValue(workerName);
    
    var uniqueId = Utilities.getUuid();
    var startTime = new Date();

    // 1. Update Production_Log
    // [ID, Order, Worker, Role, Task, Start, End, QC, Sig]
    logSheet.appendRow([uniqueId, currentRowOrder, workerName, role, nextStatus, startTime, "", "", ""]);
    
    // 2. Update Overview Tab
    if (overviewSheet) {
      // [ID, Order, Worker, Process, Start, End, Duration]
      overviewSheet.appendRow([uniqueId, currentRowOrder, workerName, nextStatus, startTime, "", ""]);
    }
    
    SpreadsheetApp.flush();
    return { success: true, newStatus: nextStatus, logId: uniqueId };
    
  } finally {
    lock.releaseLock();
  }
}

// --- ACTION: FINISH ORDER ---
function finishOrder(rowIndex, orderCheck, logId, qcData, signatureUrl) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  
  try {
    var ss = getSpreadsheet();
    var sheet = getSheetOrDie(ss, TAB_ORDERS);
    var logSheet = getSheetOrDie(ss, TAB_LOGS);
    var overviewSheet = ss.getSheetByName(TAB_OVERVIEW);
    
    // SAFETY CHECK
    var currentRowOrder = sheet.getRange(rowIndex, 2).getValue();
    if (String(currentRowOrder) !== String(orderCheck)) {
      throw new Error("Row mismatch. Please refresh.");
    }

    var currentStatus = sheet.getRange(rowIndex, 3).getValue();
    var nextStep = getNextStatus(currentStatus); 
    
    // Release the Order
    sheet.getRange(rowIndex, 3).setValue(nextStep);
    sheet.getRange(rowIndex, 4).setValue(""); // Clear assigned worker
    
    var endTime = new Date();

    // --- UPDATE PRODUCTION LOG ---
    var logs = logSheet.getDataRange().getValues();
    var rowToUpdate = -1;
    var startTime = null;
    var processName = "";

    // Find the log entry
    if (logId) {
      for (var i = 0; i < logs.length; i++) {
        if (logs[i][0] == logId) { 
          rowToUpdate = i + 1; 
          startTime = logs[i][5] ? new Date(logs[i][5]) : null;
          processName = logs[i][4];
          break; 
        }
      }
    }

    // Fallback search if ID logic failed (e.g. manual sheet edit)
    if (rowToUpdate === -1) {
      for (var i = logs.length - 1; i >= 0; i--) {
        // Match Order + Status + Empty End Time
        if (String(logs[i][1]) == String(currentRowOrder) && String(logs[i][4]) == String(currentStatus) && logs[i][6] === "") {
          rowToUpdate = i + 1;
          startTime = logs[i][5] ? new Date(logs[i][5]) : null;
          processName = logs[i][4];
          break;
        }
      }
    }

    if (rowToUpdate > 0) {
      logSheet.getRange(rowToUpdate, 7).setValue(endTime); // End Time
      
      var qcString = qcData ? qcData.map(function(item){ return item.q + ": " + item.a; }).join("\n") : "Skipped";
      logSheet.getRange(rowToUpdate, 8).setValue(qcString); // QC Data
      
      if(signatureUrl) {
        logSheet.getRange(rowToUpdate, 9).setValue(signatureUrl); // Signature
      }
    }

    // --- UPDATE OVERVIEW TAB ---
    if (overviewSheet && rowToUpdate > 0) { 
      var ovData = overviewSheet.getDataRange().getValues();
      var ovRow = -1;
      
      if (logId) {
        for (var k = 0; k < ovData.length; k++) {
          if (ovData[k][0] == logId) { ovRow = k + 1; break; }
        }
      } 
      
      if (ovRow === -1) {
         for (var k = ovData.length - 1; k >= 0; k--) {
            if (String(ovData[k][1]) == String(currentRowOrder) && String(ovData[k][3]) == String(currentStatus) && ovData[k][5] === "") {
               ovRow = k + 1;
               break;
            }
         }
      }

      if (ovRow > 0) {
        var durationMins = calculateWorkMinutesServer(startTime, endTime, processName);
        var durationStr = formatDurationServer(durationMins);
        overviewSheet.getRange(ovRow, 6).setValue(endTime); 
        overviewSheet.getRange(ovRow, 7).setValue(durationStr);
      }
    }
    
    SpreadsheetApp.flush();
    return { success: true };
    
  } finally {
    lock.releaseLock();
  }
}

// --- SERVER SIDE TIME CALCULATION ---
function calculateWorkMinutesServer(start, end, taskName) {
  if (!start || !end) return 0;
  
  // Powder Coating runs 24/7 (Oven time)
  if (taskName && taskName.toLowerCase().includes('powder')) {
    return (end.getTime() - start.getTime()) / 1000 / 60;
  }

  // Standard Shifts: 07:30 to 15:45
  var totalMinutes = 0;
  var current = new Date(start.getTime());
  var safety = 0;

  while (current < end && safety < 1000) {
    safety++;
    var day = current.getDay();
    // Skip Weekend (0=Sun, 6=Sat)
    if (day === 0 || day === 6) {
      current.setDate(current.getDate() + 1);
      current.setHours(7, 30, 0, 0);
      continue;
    }

    var shiftStart = new Date(current);
    shiftStart.setHours(7, 30, 0, 0);
    var shiftEnd = new Date(current);
    shiftEnd.setHours(15, 45, 0, 0);

    // Determine overlap
    var windowStart = (current > shiftStart) ? current : shiftStart;
    var windowEnd = (end < shiftEnd) ? end : shiftEnd;

    if (windowStart < windowEnd) {
      totalMinutes += (windowEnd.getTime() - windowStart.getTime()) / 1000 / 60;
    }

    if (end < shiftEnd) {
      break;
    } else {
      current.setDate(current.getDate() + 1);
      current.setHours(7, 30, 0, 0);
    }
  }
  return totalMinutes;
}

function formatDurationServer(totalMins) {
  var h = Math.floor(totalMins / 60);
  var m = Math.floor(totalMins % 60);
  return (h < 10 ? "0"+h : h) + ":" + (m < 10 ? "0"+m : m);
}

// --- ADMIN DASHBOARD DATA ---
function getAdminDashboardData() {
  var ss = getSpreadsheet();
  
  var logSheet = getSheetOrDie(ss, TAB_LOGS);
  var logData = logSheet.getDataRange().getValues();
  // Headers in Log: ID, Order, Worker, Role, Task, Start, End, QC, Sig
  
  var logs = [];
  if (logData.length > 1) {
    logData.shift(); 
    logs = logData.map(function(row) {
      return {
        order: row[1],
        worker: row[2],
        role: row[3],
        task: row[4],
        start: row[5] ? new Date(row[5]).getTime() : null,
        end: row[6] ? new Date(row[6]).getTime() : null,
        qc: row[7]
      };
    });
  }

  var orderSheet = getSheetOrDie(ss, TAB_ORDERS);
  var orderData = orderSheet.getDataRange().getValues();
  var orders = [];
  if (orderData.length > 1) {
    orderData.shift(); 
    orders = orderData.map(function(row) {
      return { order: row[1], status: row[2] };
    });
  }

  return { logs: logs, orders: orders };
}

// --- STATUS FLOW LOGIC ---
function getNextStatus(current) {
  var c = String(current).toLowerCase().trim();
  
  var flow = [
    "not yet started", 
    "ready for steelwork", "cutting steel", 
    "ready for tagging", "tagging", 
    "ready for welding", "welding", 
    "ready for grinding", "grinding", 
    "ready for pre-powder coating", "pre-powder coating", // Corrected flow
    "ready for powder coating", "powder coating", 
    "ready for assembly", "assembly", 
    "ready for delivery", "out for delivery", 
    "delivered"
  ];
  
  var idx = flow.indexOf(c);
  // If found and not last item, return next
  return (idx > -1 && idx < flow.length - 1) ? flow[idx + 1] : c; 
}
