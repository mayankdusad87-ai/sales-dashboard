# Sales Dashboard: KPI logic (final, v1)

Source: Google Sheet "All Data.xlsx". Tabs used: **Walk-in**, **Closing Targets**, **Sourcing Targets**, **Inventory Status**.
There is no booking tracker yet, so sale value, realisation and ₹ views are not shown.

## 1. Columns used

### Walk-in (header row 1)
| Col | Header | Used for |
|---|---|---|
| B | Project Name | Project filter |
| C | Date of Visit | Walk-in month / week |
| J–P | Age, Gender, Ethnicity, Accompanied By, Employment, City, Location | Breakdown |
| T | Preferred Configuration | Breakdown |
| U–Y | Budget, Area, Construction Status, Purpose, Source of Funding | Breakdown |
| Z | Source | Source, Direct vs Indirect |
| AA | Channel Partner Company | Channel partner views |
| AI | Sourcing Manager | Sourcing views |
| AJ | Closing Manager | Closing views |
| AM | Customer Affinity | Hot leads, affinity mix |
| AP | Reason for Lost | Why lost |
| AR | Booking Done | Booking flag |
| AT | Booking Date | Booking month |
| AU | Booking Cancellation | Cancellation flag |
| AV | Cancellation Date | Cancellation month |
| **AW** | **Customer Fresh/Revisit** | **Fresh walk-ins ("Fresh") and revisits** |

**Never loaded:** F–H (mobile, email, nationality), Q (pincode), AB–AC (CP name, mobile), AG–AH (referral), AO (remarks). They are dropped on the server before anything reaches the browser.

**Loaded only with a password:** E (customer name) is sent only when `DASHBOARD_PASSWORD` is set in Vercel, and only if the heading of column E says "name" (so a moved column can never expose a phone number). A (Form No) is always loaded; it is an internal reference.

**Column check:** the headings of every column used are checked on each load. If one does not match (a column was added, removed or moved), a red warning shows above the tiles.

### Closing Targets (header row 3)
B Closing manager · F Month & Year · G Monthly bookings target · H–M Week 1–6 targets.

### Sourcing Targets (header row 3)
B Sourcing manager · F Month & Year · G Bookings target · I Walk-ins target · J–O Week 1–6 walk-in targets. (H Active CPs target: not used.)

### Inventory Status
B Project · C Unit Name · D Sub Type (floor) · E Unit Status · F Total Area · G Type (configuration). Always "as of now"; not filtered by period.

## 2. Cleaning
- Dates accept real date cells, M/D/YYYY (visit date), D/M/YYYY (booking and cancellation dates) and text dates ("12 Jul, 2026", "31 January 2023").
- Y / Yes in any case = yes.
- Project names: Anantha → Ananta; inventory "Raghav Nova" → Nova. Bldg No 4, Bldg No 118 and One45 are real projects and are shown as they are; "All" and blank stay as their own rows.
- Source: Walk-IN / Walkin / Walk in → Walk-in.
- Manager names: upper case, trimmed, "MR. / MISS. / MRS. / MS." removed, known variants merged (SHARON → SHARON BARSE, TEJAS ANGARKHE → TEJAS ANGARAKHE, RISHAB SHAW → RISHABH SHAW, SIDDHESH → SIDDHESH VASAIKAR). The alias list is one setting in the code.
- Week of month: Monday-start weeks inside the month (matches column AX on 16,290 of 16,291 rows).

## 3. Definitions
| Term | Rule |
|---|---|
| Fresh walk-in | AW = "Fresh". Month from C |
| Unique revisit | AW = "Unique Revisit" only (Second, Third, Fourth and plain "Revisit" are not counted). Month from C |
| Booking (gross) | Booking Date (AT) filled **or** Booking Done (AR) = Y. Month from AT (C if AT is empty) |
| Cancellation | AU = Y/Yes. Rows cancelled but not marked booked are counted as booked, then cancelled. Month from AV (AT if AV is empty) |
| Net bookings | Gross bookings − cancellations in the same period |
| Conversion | Gross bookings ÷ fresh walk-ins, same period |
| Direct / Indirect | Source = Channel Partner → Indirect; anything else → Direct |
| Hot lead | Fresh walk-in with AM = Hot, not booked |
| Active CP firms | Distinct Channel Partner Company (AA) with a walk-in in the period, Source = Channel Partner |
| Visit to booking | **On hold.** The booking is usually logged on the visit row itself, so this gives 0 days. Needs a customer key that links a customer's visits |
| Inventory | Sold = Sold + Booked + Overdue · On hold = Reserved + Blocked · Unsold = Available |

## 4. Targets
- **Bookings target** = Closing Targets G, summed over months in the period. Filtered by closing manager → that manager's rows. Filtered by sourcing manager → Sourcing Targets G for that manager.
- **Walk-ins target** = Sourcing Targets I (compared with fresh walk-ins). Filtered by sourcing manager → that manager's rows.
- Targets are not by project, source or configuration: with those filters the target is hidden.
- % achieved uses months that have a target in the period.

## 5. Management tab
Tiles: Net Bookings vs Target · Fresh Walk-ins vs Target · Conversion % · Unique Revisits · Cancellations · Hot Leads · Active CP Firms · Unsold Inventory.
Target status uses pace: by today, the share of the target expected (days elapsed in the target months). ✓ at or above pace, ! within 80% of pace, ✕ below that. Manager tables use only months that have a target, so they match the tile.
Cards: Monthly trend (weekly if one month) · Projects · Closing Managers · Sourcing Managers · Channel (Direct vs Indirect, top CP firms) · Why (breakdowns).
Clicking a row filters the whole page (drill-down); clicking a tile opens Tile Focus.

## 6. Site Head tab (one project)
Tiles: Net Bookings · Fresh Walk-ins · Conversion % · Revisits · Hot Leads · Unsold Units.
Cards: Weekly trend · Closing Managers · Sourcing Managers · Source & CP · Why lost · Inventory by configuration.

## 7. Defaults (change any time)
- Default period: current financial year (Apr 2026 onwards).
- Data refresh: server reads the sheet at most every 5 minutes; the page refreshes itself every 5 minutes.

## Booking details (5th tab of All Data.xlsx)
Read from the same workbook: the tab with an "Overall Status" heading in its first 10 rows (a tab named with "booking" is tried first). A separate file can still be used through `BOOKING_FILE_ID` in Vercel. When it is connected, **all bookings come from here** and the Walk-in sheet's booking columns (AR, AT, AU, AV) are ignored.

| Col | Header | Used for |
|---|---|---|
| B | Form No | Link to Walk-in column A (spaces, dashes, case and leading zeros ignored) |
| V | Cancellation Date | Month a cancellation is counted (Booking Date when empty) |
| AD | Carpet Area | ₹ per sq ft |
| AH | Agreement Value (excl. GST and stamp duty) | Sales value, ₹ per sq ft (rupees, lakhs or crores detected automatically) |
| AN | Booking Date | Booking month |
| AS | Project Name | Project of the booking |
| (by heading) | Overall Status | Booked = Booking Date and Overall Status filled; "Cancelled at Booking" (any status with "cancel") = cancelled |
| (by heading) | Closing / Sourcing Manager, CP firm | Credit; win over the Walk-in sheet when filled |

Nothing else in Booking details is read.

- **Sales value** = agreement value of bookings in the period − agreement value of bookings cancelled in the period.
- **Net realisation** = agreement value ÷ carpet area, over bookings in the period that are not cancelled and have both values.
- **Booking TAT** = Booking Date − first visit (earliest Date of Visit for that Form No), median, in days.
- **No matching walk-in**: the booking still counts (project from AS, managers and CP from Booking details), source shows "Not linked", it is left out of Booking TAT, and it is listed under Data checks and Data to fix.
