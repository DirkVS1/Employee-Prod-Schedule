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
    'Profile Cutting': ['not yet started', 'ready for steelwork', 'profile cutting'],
    'Tagging': ['ready for tagging', 'tagging'],
    'Welding': ['ready for welding', 'welding'],
    'Grinding': ['ready for grinding', 'grinding'],
    'Quality Control': [
      'ready for pre-powder coating', 'pre-powder coating', 
      'ready for powder coating', 'powder coating', 
      'ready for final qc', 'final qc',
      'ready for delivery', 'out for delivery'
    ],
    'Assembly': ['ready for assembly', 'assembly']
  };

  // PLATE CUTTING IS SPECIAL (Independent)
  // It can happen anytime from start until Grinding begins
  var plateCuttingEligible = ['not yet started', 'ready for steelwork', 'profile cutting', 'ready for tagging', 'tagging', 'ready for welding', 'welding'];

  // Start loop at 1 to skip header
  for (var i = 1; i < data.length; i++) {
    var orderNum = data[i][1];
    var mainStatus = String(data[i][2]).toLowerCase().trim();
    
    // 1. HANDLE PLATE CUTTING (Parallel Process)
    if (role === 'Plate Cutting') {
      // Check if main status allows it AND it hasn't been finished yet
      // We use Column E (index 4) for Plate Status and F (index 5) for Plate Assigned
      var plateStatus = data[i][4] ? String(data[i][4]).toLowerCase() : "";
      var plateAssigned = data[i][5];

      // Show if order is in eligible phase AND plate cutting isn't finished
      if (plateCuttingEligible.includes(mainStatus) && plateStatus !== 'finished') {
        relevantOrders.push({
          rowIndex: i + 1,
          order: orderNum,
          status: plateStatus === 'plate cutting' ? 'In Progress' : 'Available', // Display status
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
      nextStatus = "plate cutting";
    } else {
      nextStatus = getNextStatus(currentStatus);
      // Auto-skip "Ready" statuses
      if (nextStatus && nextStatus.toLowerCase().startsWith("ready") || currentStatus && currentStatus.toLowerCase().startsWith("ready")) {
        while (nextStatus && nextStatus.toLowerCase().startsWith("ready")) { 
          var temp = getNextStatus(nextStatus); 
          if (!temp) break; 
          nextStatus = temp;
        }
      }
    }
    
    // CHECK FOR ACTIVE ORDERS (Worker can only work on one order at a time)
    // Exception: Delivery can have multiple in progress
    var isDelivery = nextStatus && nextStatus.toLowerCase() === 'out for delivery';
    if (!isDelivery) {
      var logData = logSheet.getDataRange().getValues();
      for (var i = 1; i < logData.length; i++) { // Skip header
        var logWorker = logData[i][2]; // Column C: Worker Name
        var logStatus = logData[i][4] ? String(logData[i][4]).toLowerCase() : ""; // Column E: Status
        var endTime = logData[i][6]; // Column G: End Time
        
        // If this worker has an active order (no end time) that isn't delivery
        if (logWorker === workerName && !endTime && logStatus && logStatus !== 'out for delivery') {
          var activeOrderNum = logData[i][1]; // Column B: Order Number
          throw new Error("You already have an active order: " + activeOrderNum + ". Please finish it before starting a new one.");
        }
      }
    }
    
    var uniqueId = Utilities.getUuid();
    var startTime = new Date();

    // --- BRANCH: PLATE CUTTING (PARALLEL) ---
    if (role === 'Plate Cutting') {
      // Use Col 6 (F) for Assignee, Col 5 (E) for Status
      var currentAssigned = sheet.getRange(rowIndex, 6).getValue(); 
      
      if (currentAssigned === workerName) return { success: true, message: "Already started by you." };
      if (currentAssigned !== "") throw new Error("Order locked by " + currentAssigned);
      
      sheet.getRange(rowIndex, 5).setValue(nextStatus); // Col E
      sheet.getRange(rowIndex, 6).setValue(workerName); // Col F
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
    
    // --- STEP 1: UPDATE STATUS IMMEDIATELY & SAVE ---
    // We update the status first so if the dashboard refreshes, it sees the order is done.
    
    // Determine Flow Logic (Replicated from original to get correct status)
    var currentStatus = sheet.getRange(rowIndex, 3).getValue();
    var role = ""; 
    
    // We need to fetch the log briefly to check the role if not 'Plate Cutting'
    // But for speed, we can infer role from the Log Sheet later, 
    // here we just need to know if we should clear the row in Orders tab.
    
    // Check if it's Plate Cutting (Special case)
    var isPlateCutting = false;
    // We can check the columns. If Col 5 (E) has 'plate cutting', it's that.
    if(sheet.getRange(rowIndex, 5).getValue() == 'plate cutting') {
        isPlateCutting = true;
        sheet.getRange(rowIndex, 5).setValue("finished"); 
        sheet.getRange(rowIndex, 6).setValue("");
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

    // --- STEP 2: LOGGING & PDF (The Slow Part) ---
    var logs = logSheet.getDataRange().getValues();
    var rowToUpdate = -1;
    var processName = "";
    var startTime = null;
    var orderNum = "";

    // Find Log Entry
    if (logId) {
      for (var i = 0; i < logs.length; i++) {
        if (logs[i][0] == logId) { 
          rowToUpdate = i + 1; 
          role = logs[i][3]; 
          processName = logs[i][4];
          startTime = logs[i][5] ? new Date(logs[i][5]) : null;
          orderNum = logs[i][1];
          break; 
        }
      }
    }

    // Fallback search if ID missing
    if (rowToUpdate === -1) {
       orderNum = sheet.getRange(rowIndex, 2).getValue();
       for (var i = logs.length - 1; i >= 0; i--) {
         if (logs[i][1] == orderNum && logs[i][6] === "") {
            rowToUpdate = i + 1;
            role = logs[i][3];
            processName = logs[i][4];
            startTime = logs[i][5] ? new Date(logs[i][5]) : null;
            break;
         }
       }
    }

    var resultStr = "";
    if (rowToUpdate > 0) {
      logSheet.getRange(rowToUpdate, 7).setValue(endTime); 
      resultStr = qcData ? qcData.map(function(i){return i.q+": "+i.a}).join("\n") : "Complete";
      logSheet.getRange(rowToUpdate, 8).setValue(resultStr);
      if(signatureUrl) logSheet.getRange(rowToUpdate, 9).setValue(signatureUrl);
    }

    // PDF GENERATION
    var pdfUrl = "";
    if (rowToUpdate > 0 && (role === 'Quality Control' || role === 'Assembly') && qcData && signatureUrl && processName !== 'powder coating') {
        var templateId = TEMP_ID_PRE_POWDER;
        if (processName === 'final qc') {
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
  
  // Finished Goods Template: Level 1, Back, Left Side, Right Side, Job Card, Open, Top, Level 2 (optional)
  var mapFin = [
    {tag: "{{Image_Level1}}", name: "Level 1", optional: false},
    {tag: "{{Image_Back}}", name: "Back", optional: false},
    {tag: "{{Image_LeftSide}}", name: "Left Side", optional: false},
    {tag: "{{Image_RightSide}}", name: "Right Side", optional: false},
    {tag: "{{Image_Card}}", name: "Job Card", optional: false},
    {tag: "{{Image_Open}}", name: "Open", optional: false},
    {tag: "{{Image_Top}}", name: "Top", optional: false},
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
  if (taskName && taskName.toLowerCase().trim() === 'powder coating') {
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
      order: row[1],
      worker: row[2],
      role: row[3],
      task: row[4],
      start: row[5] ? new Date(row[5]).getTime() : null,
      end: row[6] ? new Date(row[6]).getTime() : null,
      qc: row[7]
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
    "not yet started", 
    "ready for steelwork", "profile cutting", 
    "ready for tagging", "tagging", 
    "ready for welding", "welding", 
    "ready for grinding", "grinding", 
    "ready for pre-powder coating", "pre-powder coating",
    "ready for powder coating", // <--- ADDED THIS STEP
    "powder coating", 
    "ready for assembly", "assembly", 
    "ready for final qc", "final qc",
    "ready for delivery", "out for delivery", 
    "delivered"
  ];
  
  var idx = flow.indexOf(String(current).toLowerCase().trim());
  return (idx > -1 && idx < flow.length - 1) ? flow[idx + 1] : current; 
}
