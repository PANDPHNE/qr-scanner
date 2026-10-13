# Kitang Aya — Inventory Scanner

Phone barcode scanner for the logbook. Staff open it in the phone browser.

```
phone → scanner page (this repo, GitHub Pages) → Apps Script server → Google Sheet
```

## Files

| File | What it is |
|---|---|
| `setup.html` | Pick the Google Sheet, tab and columns to scan into |
| `index.html` | The scanner (camera, SCAN NEXT button, sounds, recent scans) |
| `scanner-sync.js` | Save queue: keeps scans on the phone until Google confirms, sends in batches, retries by itself |
| `vendor/html5-qrcode-2.3.8.min.js` | Fixed copy of the barcode reader library (do not load it from a CDN) |
| `version.json` | Latest scanner version — phones on an older copy show "TAP TO UPDATE" |
| `apps-script/Code.gs` | **Backup copy** of the Apps Script server. GitHub does not run it. |

## Rules the scanner follows

- Item codes: `KA` + 3, 4 or 5 digits.
- One item per tap. Reading pauses after each item, so no stray code is saved.
- An item needs 3 identical reads before it counts.
- The "ding-ding" plays only after the server confirms the row is written.
- A scan is removed from the phone's queue only after that confirmation.
- The server ignores a retried scan it already wrote (duplicate guard by scan ID, 6 hours).

## Releasing a scanner change (GitHub)

Set the **same new version** in all three places, then push:

1. `index.html` → `const SCANNER_VERSION = "…"`
2. `index.html` → `<script src="scanner-sync.js?v=…">`
3. `version.json`

Phones show **TAP TO UPDATE** within 5 minutes.

## Releasing a server change (Apps Script)

1. Paste `apps-script/Code.gs` into the Apps Script editor's Code.gs and save.
2. **Deploy → Manage deployments → pencil on the existing deployment → Version: New version → Deploy.**
3. Never use **New deployment** — it changes the web address and the scanner loses its connection.
4. Bump `CONFIG.VERSION` in Code.gs so the scanner's settings panel shows the new server version.

## Staff registration (server 3.1+)

Each staff member registers **their own phone** with a personal **staff code**, then sets a 4-digit PIN.

- **Codes live only in a private spreadsheet** in the owner's Drive: **SCANNER STAFF CODES (PRIVATE)**, never shared. They are never written into the logbook (staff can open the logbook).
- Created once by running **`setupStaffCodes`** in the Apps Script editor. It also adds a code for every staff member and turns on the MAKE NEW CODE checkbox. Safe to run again.
- **Codes don't expire.** Staff keep theirs like a password and use it again if they forget their PIN.
- **Code leaked?** Tick **MAKE NEW CODE** on that row → a new code appears, and the phone registered with the old code is signed out. Hand them the new code.
- **One phone per staff member:** registering a phone signs out their previous phone.
- **New staff** in the logbook's STAFF tab get a code automatically the next time the private sheet is opened.
- Only staff with **ACTIVE (YES/NO) = YES** in STAFF can register or scan. Set NO → their phone stops within 5 minutes.
- Wrong codes: 5 per phone, then a 15-minute wait; 30 from all phones together pauses registration for 15 minutes.
- Each phone gets its own random key; only its fingerprint is stored, in the hidden `_STAFF_SESSIONS` tab (set ACTIVE = NO there to sign out one phone).
- Every scan writes `Name, gmail` into the tab's **BY (NAME, GMAIL)** column and into `_SCAN_LOG`.
- **Who scanned = the BY column, nothing else.** Every scan writes `Name, gmail` of the signed-in staff member into the tab's **BY (NAME, GMAIL)** column. There is no separate name column any more (older setups that had one are ignored). The logbook uses BY as the only source of who did each scan; NOTE is only for a customer name or a reason.
- PIN asked each time the scanner opens and after the phone was away 2+ minutes. 5 wrong PINs → enter the staff code again.
- `CONFIG.REQUIRE_SIGN_IN: false` turns registration off again.

## Safety features in the sheet

- `_SCAN_LOG` tab (hidden, protected): one line per saved scan — saved time, scan time, code, tab, row, scan ID, phone ID.
- The Item Code and Timestamp columns of every scanned tab are protected: only the spreadsheet owner (and the scanner) can edit or delete them. Turn off with `PROTECT_SCANNER_COLUMNS: false` in Code.gs.
