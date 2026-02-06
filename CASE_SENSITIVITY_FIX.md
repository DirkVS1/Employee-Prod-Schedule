# Case Sensitivity Fix - Status Comparisons

## Problem Identified

The issue causing "orders not loading for any process" was a **case sensitivity mismatch** in status comparisons.

**Example of the problem:**
- Google Sheets has: `"Not yet started"` (lowercase 'y' and 's')
- Code expects: `"Not Yet Started"` (title case with capital Y and S)
- JavaScript's `includes()` method does exact string matching
- Result: Status check fails, orders don't appear

## Root Cause

In `getOrdersForRole()` function, the code was using:
```javascript
if (plateCuttingEligible.includes(mainStatus)) { ... }
if (allowedStatuses.includes(mainStatus)) { ... }
```

These comparisons are **case-sensitive**, so "Not yet started" ≠ "Not Yet Started"

## Solution Implemented (Commit: 72a08a6)

Added a case-insensitive comparison helper:

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

Updated both status checks to use this helper:
```javascript
if (includesStatusCaseInsensitive(plateCuttingEligible, mainStatus)) { ... }
if (includesStatusCaseInsensitive(allowedStatuses, mainStatus)) { ... }
```

## How It Works

1. Converts the status from Google Sheets to lowercase: `"Not yet started"` → `"not yet started"`
2. Converts each status in the allowed array to lowercase: `"Not Yet Started"` → `"not yet started"`
3. Compares the lowercase versions: `"not yet started"` === `"not yet started"` ✓ Match!
4. Original status values are preserved for display purposes

## Benefits

✅ **Flexible** - Works with any capitalization in Google Sheets  
✅ **Non-breaking** - Doesn't change existing data  
✅ **Consistent** - All status comparisons now use the same logic  
✅ **Future-proof** - No need to worry about exact capitalization  

## Testing

The fix should resolve the "orders not loading" issue. Test by:

1. Deploy the updated Code.gs to Google Apps Script
2. Log in with different worker roles
3. Verify orders appear correctly regardless of status capitalization in Google Sheets
4. Try variations like:
   - "Not Yet Started" (original)
   - "Not yet started" (lowercase)
   - "not yet started" (all lowercase)
   - "NOT YET STARTED" (all uppercase)

All variations should work correctly now.

## Additional Notes

This fix also applies to all other statuses in the system:
- "Ready for Steelwork" / "ready for steelwork"
- "Profile Cutting" / "profile cutting"
- "Welding" / "welding"
- etc.

The case-insensitive matching ensures the system is more robust and user-friendly.
