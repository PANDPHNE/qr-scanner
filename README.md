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

## Safety features in the sheet

- `_SCAN_LOG` tab (hidden, protected): one line per saved scan — saved time, scan time, code, tab, row, scan ID, phone ID.
- The Item Code and Timestamp columns of every scanned tab are protected: only the spreadsheet owner (and the scanner) can edit or delete them. Turn off with `PROTECT_SCANNER_COLUMNS: false` in Code.gs.
