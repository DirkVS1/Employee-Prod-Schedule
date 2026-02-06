# Plate Cutting Migration Guide

## Overview
This guide explains the changes made to move plate cutting status tracking from the **Orders** tab to the **Production_Log** tab in your Google Sheets.

---

## What Changed?

### Before (Old System)
- **Orders Tab** had two columns for plate cutting:
  - Column E: Plate Status (empty, "Plate Cutting", or "Finished")
  - Column F: Plate Cutter (worker name assigned to plate cutting)

### After (New System)
- Plate cutting status is now tracked **only** in the **Production_Log** tab
- Columns E and F in the Orders tab are **no longer used** for plate cutting
- All plate cutting jobs are logged in Production_Log with Role = "Plate Cutting"

---

## What You Need to Do in Google Sheets

### Step 1: Clean Up Orders Tab (Optional but Recommended)
Since columns E and F are no longer needed for plate cutting, you can:

1. **Option A - Delete the columns:**
   - Right-click on column E header
   - Select "Delete column"
   - Repeat for column F

2. **Option B - Repurpose the columns:**
   - You can use these columns for other data if needed
   - Just make sure to clear any existing plate cutting data first

3. **Option C - Leave them as-is:**
   - The code will ignore these columns now
   - They won't affect the system, but may be confusing

**Recommendation:** Delete columns E and F to keep your sheet clean and avoid confusion.

### Step 2: Verify Production_Log Structure
Your **Production_Log** tab should have these columns (in order):

| Column | Header | Description |
|--------|--------|-------------|
| A | Log ID | Unique identifier for each log entry |
| B | Order Number | The order being worked on |
| C | Worker Name | Name of the worker |
| D | Role | Worker's role (e.g., "Plate Cutting", "Welding", etc.) |
| E | Status/Task | The task status (e.g., "Plate Cutting", "Welding", etc.) |
| F | Start Time | When the task started |
| G | End Time | When the task finished (empty if still in progress) |
| H | Results/QC Data | Task results or QC checklist responses |
| I | Signature URL | Signature image URL (for QC tasks) |

**Note:** If your Production_Log already has these columns, no changes are needed.

### Step 3: Migrate Existing Data (If Applicable)
If you have active plate cutting jobs in the old system (Orders columns E & F), you need to:

1. Check the **Orders** tab for any rows where:
   - Column E = "Plate Cutting" (job in progress)
   - Column F has a worker name

2. For each such row, manually add an entry to **Production_Log**:
   - Column A: Generate a unique ID (or use a tool like `=CONCATENATE("PC-", NOW())`)
   - Column B: Copy the Order Number from Orders tab Column B
   - Column C: Copy the worker name from Orders tab Column F
   - Column D: Enter "Plate Cutting"
   - Column E: Enter "Plate Cutting"
   - Column F: Enter the current date/time or when they started
   - Column G: Leave empty (job in progress)
   - Columns H-I: Leave empty

3. After migrating, clear the old data from Orders columns E & F

**Important:** Only migrate jobs that are **currently in progress**. Completed plate cutting jobs don't need to be migrated.

---

## How the New System Works

### For Plate Cutting Workers:
1. When a plate cutting worker starts a job, a new entry is created in **Production_Log** with:
   - Role = "Plate Cutting"
   - Status = "Plate Cutting"
   - End Time = empty

2. While working, the worker's name appears in the Production_Log

3. When they finish, the End Time is filled in

4. The system checks Production_Log to determine:
   - Which orders have plate cutting available
   - Which orders have plate cutting in progress
   - Which orders have plate cutting finished

### Visibility:
- Orders show as "Available" if no active or completed plate cutting entry exists
- Orders show as "In Progress" if an active (no end time) plate cutting entry exists
- Orders are hidden from the plate cutting dashboard if a completed (has end time) entry exists

---

## Benefits of This Change

1. **Centralized Tracking:** All work activities (including plate cutting) are now tracked in one place
2. **Better History:** You can see the complete history of plate cutting jobs in Production_Log
3. **Cleaner Orders Tab:** Fewer columns to maintain in the Orders tab
4. **Consistent Data Model:** Plate cutting follows the same pattern as other tasks

---

## Troubleshooting

### Problem: Plate cutting jobs not showing in dashboard
**Solution:** Check Production_Log to see if there's already a completed entry for that order. If so, the system considers plate cutting finished for that order.

### Problem: Worker can't start plate cutting job (says "locked")
**Solution:** Check Production_Log for an active entry (no end time) for that order with Role = "Plate Cutting". Someone else may have already started it.

### Problem: Old data still visible in Orders columns E & F
**Solution:** This won't affect the system - it's ignored. You can safely clear or delete these columns.

---

## Questions?

If you encounter any issues or have questions about this migration, please open an issue in the repository.
