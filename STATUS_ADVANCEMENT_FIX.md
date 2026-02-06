# Status Advancement Fix

## Issue Report

**User Comment:** "When I started a profile cutting process the process got listed as 'Not yet started' in google sheets."

## Problem Analysis

When a Profile Cutting worker started a job, the order status in Google Sheets remained "Not yet started" instead of advancing to "Profile Cutting".

### Root Cause

The `getNextStatus()` function uses `indexOf()` to find the current status in the workflow array:

```javascript
var flow = ["Not Yet Started", "Ready for Steelwork", "Profile Cutting", ...];
var idx = flow.indexOf(String(current).trim());
```

**The Issue:**
- Google Sheets has: `"Not yet started"` (lowercase 'y' and 's')
- Flow array has: `"Not Yet Started"` (title case)
- `indexOf("Not yet started")` returns -1 (no match found)
- Function returns current status unchanged
- Order status stays "Not yet started" instead of advancing

### Code Flow

1. Worker clicks "Start" on a Profile Cutting job
2. `startOrder()` is called with role = "Profile Cutting"
3. `getNextStatus("Not yet started")` is called
4. `indexOf()` fails to find a match due to case difference
5. Returns "Not yet started" (unchanged)
6. Status is written back to Google Sheets as "Not yet started"
7. **Expected:** "Profile Cutting" | **Actual:** "Not yet started" ❌

## Solution (Commit: 5301f80)

Updated `getNextStatus()` to use case-insensitive matching:

```javascript
function getNextStatus(current) {
  var flow = ["Not Yet Started", "Ready for Steelwork", "Profile Cutting", ...];
  
  // Case-insensitive search for current status
  var currentTrimmed = String(current).trim();
  var currentLower = currentTrimmed.toLowerCase();
  var idx = -1;
  
  for (var i = 0; i < flow.length; i++) {
    if (flow[i].toLowerCase() === currentLower) {
      idx = i;
      break;
    }
  }
  
  return (idx > -1 && idx < flow.length - 1) ? flow[idx + 1] : current;
}
```

### How It Works Now

1. Worker clicks "Start" on a Profile Cutting job
2. `startOrder()` is called with role = "Profile Cutting"
3. `getNextStatus("Not yet started")` is called
4. Converts to lowercase: `"not yet started"`
5. Loops through flow array comparing lowercase versions
6. Finds match: `"not yet started"` === `"not yet started"` ✓
7. Returns next status in flow: `"Ready for Steelwork"`
8. Auto-skip logic processes "Ready for..." statuses
9. Final status set to: `"Profile Cutting"` ✓
10. **Result:** Status correctly advances from "Not yet started" → "Profile Cutting"

## Testing Verification

To verify the fix works:

1. **Set up test order:**
   - In Google Sheets, set an order status to "Not yet started" (lowercase)

2. **Start Profile Cutting job:**
   - Log in as a Profile Cutting worker
   - Start the job on that order

3. **Verify result:**
   - Check Google Sheets - status should now be "Profile Cutting"
   - Not "Not yet started" (the old broken behavior)

4. **Test other statuses:**
   - Try starting jobs with various status capitalizations
   - All should advance correctly now

## Impact

This fix ensures:
- ✅ All job starts advance status correctly
- ✅ Works regardless of capitalization in Google Sheets
- ✅ Profile Cutting workers can now properly start jobs
- ✅ All other workflow roles also benefit from the fix
- ✅ Consistent with the other case-insensitive fixes

## Related Fixes

This is part of a comprehensive case sensitivity fix:
- Commit 72a08a6: Fixed orders not loading (case-insensitive status matching in `getOrdersForRole()`)
- Commit 5301f80: Fixed status advancement (case-insensitive status lookup in `getNextStatus()`)

Together, these fixes ensure the entire workflow is case-insensitive and robust.
