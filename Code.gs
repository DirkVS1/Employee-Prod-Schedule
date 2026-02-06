// --- CONFIGURATION ---
var SHEET_ID = "11SGM3_REEC7O-zWoazApGp-7wzFoEg8GrRCk2Ot9UyQ"; // Your provided ID
var TAB_ORDERS = "Orders";
var TAB_USERS = "Users";
var TAB_LOGS = "Production_Log";
var TAB_OVERVIEW = "Overview";
var FOLDER_NAME = "Studio_Delta_QC_Records"; // Folder created in Drive for PDFs

// *** CRITICAL: PASTE YOUR TEMPLATE IDs HERE ***
var TEMP_ID_PRE_POWDER = "18gdKTtaJFqG7EALy-OofLoBxcJ873U4sUTUks3_2oEo";
var TEMP_ID_FINISHED   = "1WXW4F_PIjcA5v2ZSqJDptQrKtlikiVuqOeUy706rV7I";
var QC_EMAIL_RECIPIENT = "dirk.visser1805@gmail.com"; // <--- CHANGE THIS TO YOUR EMAIL

// Production_Log Column Indices (0-based for array access)
var LOG_COL_ID = 0;          // Column A: Unique ID
var LOG_COL_ORDER = 1;       // Column B: Order Number
var LOG_COL_WORKER = 2;      // Column C: Worker Name
var LOG_COL_ROLE = 3;        // Column D: Role
var LOG_COL_STATUS = 4;      // Column E: Status/Task
var LOG_COL_START = 5;       // Column F: Start Time
var LOG_COL_END = 6;         // Column G: End Time
var LOG_COL_RESULTS = 7;     // Column H: Results/QC Data
var LOG_COL_SIGNATURE = 8;   // Column I: Signature URL

function doGet() {
  return HtmlService.createTemplateFromFile('index')
      .evaluate()
      .setTitle('Studio Delta Production')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
      .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=0'); 
}

function getSpreadsheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) { 
    try { 
      // Fallback: Enter your Sheet ID here if running as standalone
      ss = SpreadsheetApp.openById("YOUR_ID_HERE"); 
    } catch(e) { 
      throw new Error("Could not find spreadsheet. Please open the script from the Google Sheet.");
    } 
  }
  return ss;
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
  data.shift(); // Remove header
  return data.map(function(row) { return { name: row[0], role: row[1] }; });
}

function verifyLogin(role, name, password) {
  var ss = getSpreadsheet();
  var sheet = getSheetOrDie(ss, TAB_USERS);
  var data = sheet.getDataRange().getValues();
  
  // 1. Find the Admin Password first (Master Key)
  var adminPassword = null;
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][1]).toLowerCase() === 'admin') {
      adminPassword = data[i][2];
      break;
    }
  }

  // 2. Check Credentials
  for (var i = 1; i < data.length; i++) {
    var rowName = data[i][0];
    var rowRole = data[i][1];
    var rowPass = data[i][2];

    // Target Match
    if (role === rowRole && name === rowName) {
      
      // A. Normal User Login
      if (String(password) == String(rowPass)) {
        var isAdmin = (role === 'Admin'); 
        return { success: true, isAdmin: isAdmin };
      }
      
      // B. Admin "Master Key" Login (Admin logging into a Worker profile)
      if (adminPassword && String(password) == String(adminPassword)) {
        return { success: true, isAdmin: true }; // Grants Read-Only access in UI
      }
    }
  }
  
  return { success: false, error: "Incorrect Access Code" };
}

// --- WORKER DASHBOARD ---
function getOrdersForRole(role) {
  var ss = getSpreadsheet();
  var sheet = getSheetOrDie(ss, TAB_ORDERS);
  var data = sheet.getDataRange().getValues();
  var relevantOrders = [];
  
  // MAIN FLOW VISIBILITY
  var mainVisibilityMap = {
    'Profile Cutting': ['Not Yet Started', 'Ready for Steelwork', 'Profile Cutting'],
    'Tagging': ['Ready for Tagging', 'Tagging'],
    'Welding': ['Ready for Welding', 'Welding'],
    'Grinding': ['Ready for Grinding', 'Grinding'],
    'Quality Control': [
      'Ready for Pre-Powder Coating', 'Pre-Powder Coating', 
      'Ready for Powder Coating', 'Powder Coating', 
      'Ready for Final QC', 'Final QC',
      'Ready for Delivery', 'Out for Delivery'
    ],
    'Assembly': ['Ready for Assembly', 'Assembly']
  };

  // PLATE CUTTING IS SPECIAL (Independent)
  // It can happen anytime from start until Grinding begins
  var plateCuttingEligible = ['Not Yet Started', 'Ready for Steelwork', 'Profile Cutting', 'Ready for Tagging', 'Tagging', 'Ready for Welding', 'Welding'];

  // For plate cutting, we need to read status from Production_Log instead of Orders tab
  var plateCuttingStatusMap = {}; // orderNum -> {status, assigned}
  if (role === 'Plate Cutting') {
    var logSheet = getSheetOrDie(ss, TAB_LOGS);
    var logData = logSheet.getDataRange().getValues();
    
    // Build a map of plate cutting status for each order
    for (var j = 1; j < logData.length; j++) {
      var logOrderNum = logData[j][LOG_COL_ORDER];
      var logRole = logData[j][LOG_COL_ROLE];
      var logStatus = logData[j][LOG_COL_STATUS];
      var logWorker = logData[j][LOG_COL_WORKER];
      var logEndTime = logData[j][LOG_COL_END];
      
      if (logRole === 'Plate Cutting') {
        if (!logEndTime) {
          // Active plate cutting job - always prioritize active jobs
          plateCuttingStatusMap[logOrderNum] = {status: 'Plate Cutting', assigned: logWorker};
        } else if (!plateCuttingStatusMap[logOrderNum]) {
          // Finished plate cutting - only set if no active job already found
          plateCuttingStatusMap[logOrderNum] = {status: 'Finished', assigned: ''};
        }
      }
    }
  }

  // Start loop at 1 to skip header
  for (var i = 1; i < data.length; i++) {
    var orderNum = data[i][1];
    var mainStatus = String(data[i][2]).trim();
    
    // 1. HANDLE PLATE CUTTING (Parallel Process)
    if (role === 'Plate Cutting') {
      // Check if main status allows it AND it hasn't been finished yet
      // Read plate status from Production_Log instead of Orders columns
      var plateInfo = plateCuttingStatusMap[orderNum] || {status: '', assigned: ''};
      var plateStatus = plateInfo.status;
      var plateAssigned = plateInfo.assigned;

      // Show if order is in eligible phase AND plate cutting isn't finished
      if (plateCuttingEligible.includes(mainStatus) && plateStatus !== 'Finished') {
        relevantOrders.push({
          rowIndex: i + 1,
          order: orderNum,
          status: plateStatus === 'Plate Cutting' ? 'In Progress' : 'Available', // Display status
          assigned: plateAssigned,
          isPlateOrder: true // Flag for frontend logic
        });
      }
      continue; // Skip standard logic for this role
    }

    // 2. HANDLE STANDARD ROLES
    var allowedStatuses = mainVisibilityMap[role] || [];
    
    if (role === 'Admin' || allowedStatuses.includes(mainStatus)) {
      relevantOrders.push({
        rowIndex: i + 1,
        order: orderNum,
        status: data[i][2],
        assigned: data[i][3],
        isPlateOrder: false
      });
    }
  }
  return relevantOrders;
}

function startOrder(rowIndex, workerName, role) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000); 
  
  try {
    var ss = getSpreadsheet();
    var sheet = getSheetOrDie(ss, TAB_ORDERS);
    var logSheet = getSheetOrDie(ss, TAB_LOGS);
    var overviewSheet = ss.getSheetByName(TAB_OVERVIEW);
    
    // Get current status to determine next status
    var currentStatus = sheet.getRange(rowIndex, 3).getValue();
    var nextStatus = "";
    
    // Determine what the next status will be to check if it's delivery
    if (role === 'Plate Cutting') {
      nextStatus = "Plate Cutting";
    } else {
      nextStatus = getNextStatus(currentStatus);
      // Auto-skip "Ready" statuses
      if (nextStatus && nextStatus.startsWith("Ready") || currentStatus && currentStatus.startsWith("Ready")) {
        while (nextStatus && nextStatus.startsWith("Ready")) { 
          var temp = getNextStatus(nextStatus); 
          if (!temp) break; 
          nextStatus = temp;
        }
      }
    }
    
    // CHECK FOR ACTIVE ORDERS (Worker can only work on one order at a time)
    // Exception: Delivery can have multiple in progress
    var isDelivery = nextStatus && nextStatus === 'Out for Delivery';
    if (!isDelivery) {
      var logData = logSheet.getDataRange().getValues();
      for (var i = 1; i < logData.length; i++) { // Skip header
        var logWorker = logData[i][LOG_COL_WORKER];
        var logStatus = logData[i][LOG_COL_STATUS] ? String(logData[i][LOG_COL_STATUS]) : "";
        var endTime = logData[i][LOG_COL_END];
        
        // If this worker has an active order (no end time) that isn't delivery
        if (logWorker === workerName && !endTime && logStatus && logStatus !== 'Out for Delivery') {
          var activeOrderNum = logData[i][LOG_COL_ORDER];
          throw new Error("You already have an active order: " + activeOrderNum + ". Please finish it before starting a new one.");
        }
      }
    }
    
    var uniqueId = Utilities.getUuid();
    var startTime = new Date();

    // --- BRANCH: PLATE CUTTING (PARALLEL) ---
    if (role === 'Plate Cutting') {
      // Check if there's already an active plate cutting job for this order in Production_Log
      var orderNum = sheet.getRange(rowIndex, 2).getValue();
      var logData = logSheet.getDataRange().getValues();
      var currentAssigned = "";
      
      for (var i = 1; i < logData.length; i++) {
        var logOrderNum = logData[i][LOG_COL_ORDER];
        var logRole = logData[i][LOG_COL_ROLE];
        var logWorker = logData[i][LOG_COL_WORKER];
        var logEndTime = logData[i][LOG_COL_END];
        
        // If there's an active plate cutting job for this order
        if (logOrderNum === orderNum && logRole === 'Plate Cutting' && !logEndTime) {
          currentAssigned = logWorker;
          break;
        }
      }
      
      if (currentAssigned === workerName) return { success: true, message: "Already started by you." };
      if (currentAssigned !== "") throw new Error("Order locked by " + currentAssigned);
      
      // No need to update Orders tab columns - status tracked in Production_Log only
    } 
    // --- BRANCH: MAIN FLOW ---
    else {
      var currentAssigned = sheet.getRange(rowIndex, 4).getValue();
      if (currentAssigned === workerName) return { success: true, message: "Already started by you." };
      if (currentAssigned !== "") throw new Error("Order locked by " + currentAssigned);
      
      sheet.getRange(rowIndex, 3).setValue(nextStatus);
      sheet.getRange(rowIndex, 4).setValue(workerName);
    }

    // LOGGING (Same for both)
    logSheet.appendRow([uniqueId, sheet.getRange(rowIndex, 2).getValue(), workerName, role, nextStatus, startTime, "", "", ""]);
    
    // Overview Logging
    if (overviewSheet) {
      overviewSheet.appendRow([uniqueId, sheet.getRange(rowIndex, 2).getValue(), workerName, nextStatus, startTime, "", ""]);
    }
    
    SpreadsheetApp.flush();
    return { success: true, newStatus: nextStatus, logId: uniqueId };
    
  } finally {
    lock.releaseLock();
  }
}

function finishOrder(rowIndex, logId, qcData, signatureUrl, filesData) {
  var lock = LockService.getScriptLock();
  lock.waitLock(120000); 
  
  try {
    var ss = getSpreadsheet();
    var sheet = getSheetOrDie(ss, TAB_ORDERS);
    var logSheet = getSheetOrDie(ss, TAB_LOGS);
    var overviewSheet = ss.getSheetByName(TAB_OVERVIEW);
    var endTime = new Date(); // Capture time immediately
    
    // --- STEP 1: FIND LOG ENTRY TO DETERMINE ROLE ---
    // We need to know which role is being finished (Plate Cutting vs Main Flow)
    var logs = logSheet.getDataRange().getValues();
    var rowToUpdate = -1;
    var processName = "";
    var startTime = null;
    var orderNum = "";
    var role = "";

    // Find Log Entry
    if (logId) {
      for (var i = 0; i < logs.length; i++) {
        if (logs[i][LOG_COL_ID] == logId) { 
          rowToUpdate = i + 1; 
          role = logs[i][LOG_COL_ROLE]; 
          processName = logs[i][LOG_COL_STATUS];
          startTime = logs[i][LOG_COL_START] ? new Date(logs[i][LOG_COL_START]) : null;
          orderNum = logs[i][LOG_COL_ORDER];
          break; 
        }
      }
    }

    // Fallback search if ID missing
    if (rowToUpdate === -1) {
       orderNum = sheet.getRange(rowIndex, 2).getValue();
       for (var i = logs.length - 1; i >= 0; i--) {
         if (logs[i][LOG_COL_ORDER] == orderNum && logs[i][LOG_COL_END] === "") {
            rowToUpdate = i + 1;
            role = logs[i][LOG_COL_ROLE];
            processName = logs[i][LOG_COL_STATUS];
            startTime = logs[i][LOG_COL_START] ? new Date(logs[i][LOG_COL_START]) : null;
            break;
         }
       }
    }

    // --- STEP 2: UPDATE STATUS IMMEDIATELY & SAVE ---
    // We update the status first so if the dashboard refreshes, it sees the order is done.
    
    var currentStatus = sheet.getRange(rowIndex, 3).getValue();
    var isPlateCutting = false;
    
    // Check if it's Plate Cutting (use role from log, not column E)
    if(role === 'Plate Cutting') {
        isPlateCutting = true;
        // No need to update Orders tab columns - status tracked in Production_Log only
    } else {
        // Main Flow
        var nextStep = getNextStatus(currentStatus); 
        sheet.getRange(rowIndex, 3).setValue(nextStep);
        sheet.getRange(rowIndex, 4).setValue(""); 
    }

    // *** THE MAGIC FIX ***
    // This forces the sheet to save changes NOW, before the slow PDF generation starts.
    SpreadsheetApp.flush(); 
    // *********************

    // --- STEP 3: LOGGING & PDF (The Slow Part) ---

    var resultStr = "";
    if (rowToUpdate > 0) {
      logSheet.getRange(rowToUpdate, 7).setValue(endTime); 
      resultStr = qcData ? qcData.map(function(i){return i.q+": "+i.a}).join("\n") : "Complete";
      logSheet.getRange(rowToUpdate, 8).setValue(resultStr);
      if(signatureUrl) logSheet.getRange(rowToUpdate, 9).setValue(signatureUrl);
    }

    // PDF GENERATION
    var pdfUrl = "";
    if (rowToUpdate > 0 && (role === 'Quality Control' || role === 'Assembly') && qcData && signatureUrl && processName !== 'Powder Coating') {
        var templateId = TEMP_ID_PRE_POWDER;
        if (processName === 'Final QC') {
            templateId = TEMP_ID_FINISHED;
        }
        
        if(templateId && templateId.length > 5) {
            try {
              var workerName = logs[rowToUpdate-1][2];
              // Call the PDF generator
              pdfUrl = generateQCPdf(templateId, orderNum, workerName, qcData, signatureUrl, filesData);
              
              if(pdfUrl) {
                resultStr += "\n\nQC PDF: " + pdfUrl;
                logSheet.getRange(rowToUpdate, 8).setValue(resultStr);
              }
            } catch(pdfError) {
              Logger.log("PDF generation failed: " + pdfError.toString());
              resultStr += "\n\nPDF Error: " + pdfError.toString();
              logSheet.getRange(rowToUpdate, 8).setValue(resultStr);
            }
        }
    }

    // UPDATE OVERVIEW
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
            if (ovData[k][1] == orderNum && ovData[k][3] == processName && ovData[k][5] === "") {
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
    
    return { success: true };
    
  } catch(e) {
    return { success: false, error: e.toString() };
  } finally {
    lock.releaseLock();
  }
}

function generateQCPdf(templateId, orderNum, workerName, qcAnswers, sigBase64, photos) {
  var folder = getFolder();
  var templateFile = DriveApp.getFileById(templateId);
  var newFile = templateFile.makeCopy(orderNum + "_QC_" + new Date().toISOString().slice(0,10), folder);
  var doc = DocumentApp.openById(newFile.getId());
  var body = doc.getBody();

  // 1. Text Replacements
  body.replaceText("{{WorkerName}}", workerName);
  body.replaceText("{{Timestamp}}", new Date().toLocaleString());
  body.replaceText("{{OrderNumber}}", orderNum);

  // 2. Answer Replacements (Y/N -> Yes/No)
  if (qcAnswers) {
    for (var i = 0; i < qcAnswers.length; i++) {
      var answerRaw = qcAnswers[i].a;
      var answerFormatted = answerRaw;
      if (answerRaw === "Y") answerFormatted = "Yes";
      if (answerRaw === "N") answerFormatted = "No";
      body.replaceText("{{Q" + (i+1) + "}}", answerFormatted);
    }
  }

  // --- HELPER FUNCTION FOR IMAGES WITH HEADERS ---
  function replaceImageTagWithHeader(tag, base64Data, isOptional, displayName) {
    var r = body.findText(tag);
    if (r) {
      var element = r.getElement();
      var parent = element.getParent();
      
      // Use provided display name or generate from tag
      var headerText = displayName;
      if (!headerText) {
        headerText = tag.replace("{{Image_", "").replace("}}", "").replace("{{", "").replace("}}", "");
        // Insert space before capital letters to separate words
        headerText = headerText.replace(/([A-Z])/g, ' $1').trim();
      }

      if (base64Data) {
        // 1. Update the text to be the Header
        var text = element.asText();
        text.setText(headerText + "\r"); // \r adds a new line
        text.setBold(true);
        text.setFontSize(11); // Optional: ensure header size

        // 2. Insert Image BELOW the header
        var imgBlob = Utilities.newBlob(Utilities.base64Decode(base64Data), 'image/png');
        var img = parent.insertInlineImage(parent.getChildIndex(element)+1, imgBlob);
        
        // 3. Set Size (Large)
        img.setWidth(350).setHeight(350);
      } else if (!isOptional) {
        // No photo provided for required image
        element.asText().setText(headerText + ": No photo provided");
        element.asText().setBold(false);
      } else {
        // Optional image not provided - remove the placeholder entirely
        parent.removeChild(element);
      }
    }
  }

  // 3. Signature (Special handling for size)
  var sigTag = "{{Signature}}";
  var sigRange = body.findText(sigTag);
  if (sigRange) {
      var sigElem = sigRange.getElement();
      var sigParent = sigElem.getParent();
      
      // Set Header
      sigElem.asText().setText("Signature\r");
      sigElem.asText().setBold(true);

      if (sigBase64) {
        // Note: Signature from canvas usually has "data:image/png;base64," prefix, we must strip it
        var cleanSig = sigBase64.split(',')[1];
        var sigBlob = Utilities.newBlob(Utilities.base64Decode(cleanSig), 'image/png');
        
        var sigImg = sigParent.insertInlineImage(sigParent.getChildIndex(sigElem)+1, sigBlob);
        sigImg.setWidth(200).setHeight(100); // Keep signature smaller/rectangular
      } else {
        sigElem.asText().setText("Signature: Not signed");
      }
  }

  // 4. Process Photos using the new Helper
  // Pre-Powder Coating Template: Front, Left Side, Right Side, Back, Open, Top (optional), Level 1, Level 2 (optional)
  var mapPre = [
    {tag: "{{Image_Front}}", name: "Front", optional: false},
    {tag: "{{Image_LeftSide}}", name: "Left Side", optional: false},
    {tag: "{{Image_RightSide}}", name: "Right Side", optional: false},
    {tag: "{{Image_Back}}", name: "Back", optional: false},
    {tag: "{{Image_Open}}", name: "Open", optional: false},
    {tag: "{{Image_Top}}", name: "Top", optional: true},
    {tag: "{{Image_Level1}}", name: "Level 1", optional: false},
    {tag: "{{Image_Level2}}", name: "Level 2", optional: true}
  ];
  
  // Finished Goods Template: Front, Level 1, Back, Left Side, Right Side, Job Card, Open, Top (optional), Level 2 (optional)
  var mapFin = [
    {tag: "{{Image_Front}}", name: "Front", optional: false},
    {tag: "{{Image_Level1}}", name: "Level 1", optional: false},
    {tag: "{{Image_Back}}", name: "Back", optional: false},
    {tag: "{{Image_LeftSide}}", name: "Left Side", optional: false},
    {tag: "{{Image_RightSide}}", name: "Right Side", optional: false},
    {tag: "{{Image_Card}}", name: "Job Card", optional: false},
    {tag: "{{Image_Open}}", name: "Open", optional: false},
    {tag: "{{Image_Top}}", name: "Top", optional: true},
    {tag: "{{Image_Level2}}", name: "Level 2", optional: true}
  ];
  
  // Detect which template is being used based on tags present
  var useMap = body.findText("{{Image_Front}}") ? mapPre : mapFin;

  // Note: The photos array includes null entries for skipped optional photos
  // The array length matches the number of photo inputs, with null representing skipped optional photos
  for (var j = 0; j < useMap.length; j++) {
    var photoData = null;
    if (photos && j < photos.length && photos[j] !== null) {
      photoData = photos[j].data;
    }
    replaceImageTagWithHeader(useMap[j].tag, photoData, useMap[j].optional, useMap[j].name);
  }

  doc.saveAndClose();
  
  // Convert to PDF
  var pdfBlob = newFile.getAs('application/pdf');
  var pdfFile = folder.createFile(pdfBlob);
  
  // Trash the temp doc
  newFile.setTrashed(true);

  // --- EMAIL SECTION ---
  if (QC_EMAIL_RECIPIENT && QC_EMAIL_RECIPIENT !== "") {
    try {
      MailApp.sendEmail({
        to: QC_EMAIL_RECIPIENT,
        subject: "QC Report: " + orderNum + " (" + workerName + ")",
        htmlBody: "<p>Please find the attached QC report for Order <strong>" + orderNum + "</strong>.</p>" +
                  "<p>Completed by: " + workerName + "<br>Date: " + new Date().toLocaleString() + "</p>",
        attachments: [pdfBlob]
      });
    } catch (e) {
      Logger.log("Email failed: " + e.toString());
    }
  }
  
  return pdfFile.getUrl();
}

function getFolder() {
  var folders = DriveApp.getFoldersByName(FOLDER_NAME);
  return folders.hasNext() ? folders.next() : DriveApp.createFolder(FOLDER_NAME);
}

// --- CALCULATION LOGIC ---
function calculateWorkMinutesServer(start, end, taskName) {
  if (!start || !end) return 0;
  
  // POWDER COATING EXCEPTION: 24/7
  if (taskName && taskName.trim() === 'Powder Coating') {
    return (end.getTime() - start.getTime()) / 1000 / 60;
  }


  // STANDARD LOGIC: Mon-Fri, 07:30-15:45
  var totalMinutes = 0;
  var current = new Date(start.getTime());
  var safety = 0;

  while (current < end && safety < 2000) { // Safety limit prevents infinite loop
    safety++;
    var day = current.getDay();
    // Skip Weekend (0=Sun, 6=Sat)
    if (day === 0 || day === 6) {
      current.setDate(current.getDate() + 1);
      current.setHours(7, 30, 0, 0);
      continue;
    }
    var shiftStart = new Date(current); shiftStart.setHours(7, 30, 0, 0);
    var shiftEnd = new Date(current); shiftEnd.setHours(15, 45, 0, 0);
    var windowStart = (current > shiftStart) ? current : shiftStart;
    var windowEnd = (end < shiftEnd) ? end : shiftEnd;

    if (windowStart < windowEnd) {
      totalMinutes += (windowEnd.getTime() - windowStart.getTime()) / 1000 / 60;
    }
    if (end < shiftEnd) break;
    else { current.setDate(current.getDate() + 1); current.setHours(7, 30, 0, 0); }
  }
  return totalMinutes;
}

function formatDurationServer(totalMins) {
  var h = Math.floor(totalMins / 60);
  var m = Math.floor(totalMins % 60);
  return (h < 10 ? "0"+h : h) + ":" + (m < 10 ? "0"+m : m);
}

// --- ADMIN: FETCH ALL DATA ---
function getAdminDashboardData() {
  var ss = getSpreadsheet();
  
  var logSheet = getSheetOrDie(ss, TAB_LOGS);
  var logData = logSheet.getDataRange().getValues();
  logData.shift(); 
  var logs = logData.map(function(row) {
    return {
      order: row[LOG_COL_ORDER],
      worker: row[LOG_COL_WORKER],
      role: row[LOG_COL_ROLE],
      task: row[LOG_COL_STATUS],
      start: row[LOG_COL_START] ? new Date(row[LOG_COL_START]).getTime() : null,
      end: row[LOG_COL_END] ? new Date(row[LOG_COL_END]).getTime() : null,
      qc: row[LOG_COL_RESULTS]
    };
  });

  var orderSheet = getSheetOrDie(ss, TAB_ORDERS);
  var orderData = orderSheet.getDataRange().getValues();
  orderData.shift(); 
  var orders = orderData.map(function(row) {
    return { order: row[1], status: row[2] };
  });

  return { logs: logs, orders: orders };
}

// --- UTILS ---
function getNextStatus(current) {
  var flow = [
    "Not Yet Started", 
    "Ready for Steelwork", "Profile Cutting", 
    "Ready for Tagging", "Tagging", 
    "Ready for Welding", "Welding", 
    "Ready for Grinding", "Grinding", 
    "Ready for Pre-Powder Coating", "Pre-Powder Coating",
    "Ready for Powder Coating", // <--- ADDED THIS STEP
    "Powder Coating", 
    "Ready for Assembly", "Assembly", 
    "Ready for Final QC", "Final QC",
    "Ready for Delivery", "Out for Delivery", 
    "Delivered"
  ];
  
  var idx = flow.indexOf(String(current).trim());
  return (idx > -1 && idx < flow.length - 1) ? flow[idx + 1] : current; 
}
