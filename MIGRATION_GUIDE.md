# Plate Cutting Migration Guide - Option 2

## Overview
This implementation moves plate cutting status tracking from Orders tab columns E & F to the Production_Log tab, while keeping all functionality exactly the same.

## What Changed in the Code

### Added Helper Functions
- `getPlateCuttingStatus(ss, orderNum)` - Queries Production_Log to determine current plate cutting status for an order
- `setPlateCuttingStatus()` - No-op function (kept for compatibility)
- `clearPlateCuttingStatus()` - No-op function (kept for compatibility)

### Modified Functions
- `getOrdersForRole()` - Now uses `getPlateCuttingStatus()` instead of reading Orders columns E & F
- `startOrder()` - Now uses `getPlateCuttingStatus()` to check if job is already assigned
- `finishOrder()` - No longer updates Orders columns E & F

### How It Works
Plate cutting status is now automatically derived from Production_Log entries:

1. **Available** - No Production_Log entry exists for that order with Role = "Plate Cutting"
2. **In Progress** - Production_Log entry exists with Role = "Plate Cutting" and no End Time
3. **Finished** - Production_Log entry exists with Role = "Plate Cutting" and has an End Time

## What You Need to Do in Google Sheets

### Step 1: No Changes Required!
The code now reads from Production_Log, which already exists. You don't need to add any columns.

### Step 2: Clean Up Orders Tab (Optional)
Since columns E (Plate Status) and F (Plate Cutter) are no longer used:

**Option A - Delete the columns (Recommended):**
1. Right-click on column E header
2. Select "Delete column"
3. Right-click on column F header
4. Select "Delete column"

**Option B - Leave them as-is:**
- The code will ignore these columns
- They won't affect the system

### Step 3: Migration of Active Jobs
If you have active plate cutting jobs in the old system (Orders columns E & F show "Plate Cutting"):

1. For each active job, the worker will need to:
   - Finish the current job (if possible)
   - OR you can manually add an entry to Production_Log:
     * Column A: Unique ID (use `=CONCATENATE("PC-", NOW())`)
     * Column B: Order Number
     * Column C: Worker Name
     * Column D: "Plate Cutting"
     * Column E: "Plate Cutting"  
     * Column F: Start time
     * Column G: Leave empty (job in progress)

2. After migration, delete or clear Orders columns E & F

### Step 4: Deploy the Updated Code
1. Open your Google Sheet
2. Go to **Extensions > Apps Script**
3. Replace `Code.gs` with the updated version
4. Click **Save** (💾)
5. Close the Apps Script editor

### Step 5: Test
1. Log in as a Plate Cutting worker
2. Verify that available orders show up
3. Start a plate cutting job
4. Verify it shows as "In Progress"
5. Finish the job
6. Verify it no longer appears in the dashboard

## Benefits

✅ **Same Functionality** - Everything works exactly as before  
✅ **Cleaner Orders Tab** - Fewer columns to manage  
✅ **Better Data Model** - Plate cutting tracked same way as other tasks  
✅ **No Data Loss** - History preserved in Production_Log  

## Troubleshooting

**Q: Orders not showing for Plate Cutting workers**  
A: Check Production_Log - if there are completed entries (with End Time), orders won't show. This is correct behavior.

**Q: Can I undo this?**  
A: Yes, revert the Code.gs file to the previous version. Old data in Orders columns E & F is still there unless you deleted it.

**Q: What if I have active jobs in Orders columns E & F?**  
A: See Step 3 above for migration instructions.

## Technical Details

### Data Flow

**Before:**
```
Orders Tab:
Order | Status  | Worker | Plate Status    | Plate Cutter
123   | Welding | Alice  | Plate Cutting   | Bob
```

**After:**
```
Orders Tab:
Order | Status  | Worker
123   | Welding | Alice

Production_Log:
Log ID | Order | Worker | Role          | Status        | Start | End
uuid-1 | 123   | Alice  | Welding       | Welding       | ...   | 
uuid-2 | 123   | Bob    | Plate Cutting | Plate Cutting | ...   | (empty=in progress)
```

The code queries Production_Log to find Bob's active plate cutting job when needed.
