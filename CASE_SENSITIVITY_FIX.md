# Case Sensitivity Fix - Status Comparisons

## Problems Identified

There were **two separate case sensitivity issues** causing different problems:

### Issue 1: Orders Not Loading
**Symptom:** Orders not loading for any process  
**Root Cause:** Case sensitivity mismatch in status comparisons in `getOrdersForRole()`

**Example:**
- Google Sheets has: `"Not yet started"` (lowercase 'y' and 's')
- Code expects: `"Not Yet Started"` (title case with capital Y and S)
- JavaScript's `includes()` method does exact string matching
- Result: Status check fails, orders don't appear

### Issue 2: Status Not Advancing When Starting Jobs
**Symptom:** When starting a Profile Cutting job, status remains "Not yet started" instead of advancing to "Profile Cutting"  
**Root Cause:** Case sensitivity in `getNextStatus()` function

**Example:**
- Current status in Google Sheets: `"Not yet started"`
- `getNextStatus("Not yet started")` calls `indexOf("Not yet started")`
- Flow array has: `"Not Yet Started"` (title case)
- `indexOf()` doesn't find a match → returns -1
- Function returns current status unchanged
- Result: Order status doesn't advance

## Solutions Implemented

### Solution 1: Orders Not Loading (Commit: 72a08a6)

Added case-insensitive comparison helper:

```javascript
function includesStatusCaseInsensitive(statusArray, statusToCheck) {
  if (!statusToCheck) return false;
  var lowerStatus = String(statusToCheck).toLowerCase().trim();
  for (var i = 0; i < statusArray.length; i++) {
    if (String(statusArray[i]).toLowerCase() === lowerStatus) {
      return true;
    }
  }
  return false;
}
```

Updated status checks in `getOrdersForRole()`:
```javascript
if (includesStatusCaseInsensitive(plateCuttingEligible, mainStatus)) { ... }
if (includesStatusCaseInsensitive(allowedStatuses, mainStatus)) { ... }
```

### Solution 2: Status Not Advancing (Commit: 5301f80)

Updated `getNextStatus()` to use case-insensitive search:

```javascript
function getNextStatus(current) {
  var flow = ["Not Yet Started", "Ready for Steelwork", "Profile Cutting", ...];
  
  // Case-insensitive search for current status
  var currentLower = String(current).trim().toLowerCase();
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

## How It Works

Both solutions follow the same pattern:
1. Convert the status from Google Sheets to lowercase
2. Convert each comparison value to lowercase
3. Compare the lowercase versions
4. Original status values are preserved for display purposes

## Benefits

✅ **Flexible** - Works with any capitalization in Google Sheets  
✅ **Non-breaking** - Doesn't change existing data  
✅ **Consistent** - All status operations now use case-insensitive logic  
✅ **Future-proof** - No need to worry about exact capitalization  

## Testing

The fixes should resolve both issues. Test by:

1. **Test orders loading:**
   - Set order statuses with various capitalizations in Google Sheets
   - Log in with different worker roles
   - Verify orders appear correctly

2. **Test status advancement:**
   - Set order status to "Not yet started" (lowercase) in Google Sheets
   - Start a Profile Cutting (or any other) job
   - Verify status advances to the next step (e.g., "Profile Cutting")
   - Check that the new status appears in Google Sheets

3. **Try variations:**
   - "Not Yet Started" (original)
   - "Not yet started" (lowercase)
   - "not yet started" (all lowercase)
   - "NOT YET STARTED" (all uppercase)

All variations should work correctly now for both:
- Loading orders in worker dashboards
- Advancing statuses when starting jobs

## Additional Notes

This fix applies to all statuses in the workflow:
- "Not Yet Started" / "not yet started"
- "Ready for Steelwork" / "ready for steelwork"
- "Profile Cutting" / "profile cutting"
- "Welding" / "welding"
- "Grinding" / "grinding"
- etc.

The case-insensitive matching ensures the system is robust and user-friendly, allowing flexibility in how statuses are entered in Google Sheets while maintaining consistent behavior.
