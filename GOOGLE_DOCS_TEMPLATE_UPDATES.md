# Google Docs Template Update Guide

## Overview
This guide explains what placeholders need to be added, changed, or removed in your Google Docs templates for the PDF generation to work correctly.

---

## Pre-Powder Coating Template

### Changes Required:

#### 1. **RENAME** the following placeholders:
- `{{Image_Side}}` → `{{Image_LeftSide}}`
- `{{Image_Side2}}` → `{{Image_RightSide}}`
- `{{Image_SpiritLevel}}` → `{{Image_Level2}}`

#### 2. **ADD** the following new placeholders:
- `{{Image_Top}}` - This is OPTIONAL, will be removed from PDF if not submitted
- `{{Image_Level1}}` - This is REQUIRED

#### 3. **KEEP** these placeholders unchanged:
- `{{Image_Front}}`
- `{{Image_Back}}`
- `{{Image_Open}}`
- `{{Signature}}`
- `{{WorkerName}}`
- `{{Timestamp}}`
- `{{OrderNumber}}`
- `{{Q1}}`, `{{Q2}}`, etc. (for checklist answers)

### Final List of Image Placeholders (in order):
1. `{{Image_Front}}` - Required
2. `{{Image_LeftSide}}` - Required
3. `{{Image_RightSide}}` - Required
4. `{{Image_Back}}` - Required
5. `{{Image_Open}}` - Required
6. `{{Image_Top}}` - **Optional** (will be hidden if not provided)
7. `{{Image_Level1}}` - Required
8. `{{Image_Level2}}` - **Optional** (will be hidden if not provided)

---

## Finished Goods Template

### Changes Required:

#### 1. **RENAME** the following placeholders:
- `{{Image_Level}}` → `{{Image_Level1}}`
- `{{Image_Side}}` → `{{Image_LeftSide}}`
- `{{Image_Side2}}` → `{{Image_RightSide}}`
- `{{Image_SpiritLevel}}` → `{{Image_Level2}}`

#### 2. **ADD** the following new placeholders:
- `{{Image_Front}}` - This is REQUIRED for this template
- `{{Image_Top}}` - This is OPTIONAL for this template

#### 3. **KEEP** these placeholders unchanged:
- `{{Image_Back}}`
- `{{Image_Card}}`
- `{{Image_Open}}`
- `{{Signature}}`
- `{{WorkerName}}`
- `{{Timestamp}}`
- `{{OrderNumber}}`
- `{{Q1}}`, `{{Q2}}`, etc. (for checklist answers)

### Final List of Image Placeholders (in order):
1. `{{Image_Front}}` - Required
2. `{{Image_Level1}}` - Required
3. `{{Image_Back}}` - Required
4. `{{Image_LeftSide}}` - Required
5. `{{Image_RightSide}}` - Required
6. `{{Image_Card}}` - Required
7. `{{Image_Open}}` - Required
8. `{{Image_Top}}` - **Optional** (will be hidden if not provided)
9. `{{Image_Level2}}` - **Optional** (will be hidden if not provided)

---

## Important Notes:

1. **Placeholder Format**: All placeholders must be exactly as shown, including the double curly braces `{{` and `}}`

2. **Optional Images**: When an optional image is not submitted by the user:
   - The placeholder text will be completely removed from the PDF
   - No "No photo provided" message will appear
   - This keeps the PDF clean and professional

3. **Required Images**: When a required image is not submitted:
   - The placeholder will show: "[Image Name]: No photo provided"
   - This indicates to the user that a required photo was missing

4. **Testing**: After updating your templates, test by:
   - Completing a QC task with all photos
   - Completing a QC task with only required photos (skipping optional ones)
   - Verify the PDF generates correctly in both cases

5. **Template IDs**: Make sure your template IDs are correctly set in `Code.gs`:
   - `TEMP_ID_PRE_POWDER` for Pre-Powder Coating template
   - `TEMP_ID_FINISHED` for Finished Goods template

---

## Quick Reference Table

### Pre-Powder Coating Template Changes:
| Old Placeholder | New Placeholder | Status | Notes |
|----------------|-----------------|--------|-------|
| `{{Image_Side}}` | `{{Image_LeftSide}}` | Changed | Required |
| `{{Image_Side2}}` | `{{Image_RightSide}}` | Changed | Required |
| `{{Image_SpiritLevel}}` | `{{Image_Level2}}` | Changed | **Optional** |
| N/A | `{{Image_Top}}` | Added | **Optional** |
| N/A | `{{Image_Level1}}` | Added | Required |

### Finished Goods Template Changes:
| Old Placeholder | New Placeholder | Status | Notes |
|----------------|-----------------|--------|-------|
| `{{Image_Level}}` | `{{Image_Level1}}` | Changed | Required |
| `{{Image_Side}}` | `{{Image_LeftSide}}` | Changed | Required |
| `{{Image_Side2}}` | `{{Image_RightSide}}` | Changed | Required |
| `{{Image_SpiritLevel}}` | `{{Image_Level2}}` | Changed | **Optional** |
| N/A | `{{Image_Front}}` | Added | Required |
| N/A | `{{Image_Top}}` | Added | **Optional** |
