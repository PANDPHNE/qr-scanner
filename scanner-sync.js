/************************************************************
 * ==========================================================
 * QR SCANNER — BACKGROUND SYNC EXTENSION
 * ==========================================================
 *
 * PURPOSE
 *
 * This file handles ONLY what happens AFTER a verified
 * item reaches the scanner handoff point.
 *
 * It does NOT control:
 *
 * - camera
 * - autofocus
 * - barcode detection
 * - 3-scan verification
 * - KA + 3/4/5 digit validation
 * - scanner UI
 *
 *
 * FLOW
 *
 * VERIFIED
 *    ↓
 * create scan ID
 *    ↓
 * save destination snapshot
 *    ↓
 * local queue
 *    ↓
 * "Queued for saving"
 *    ↓
 * scanner is immediately available
 *    ↓
 * background upload
 *    ↓
 * Apps Script
 *    ↓
 * Google Sheets
 *    ↓
 * "Saved"
 *
 ************************************************************/


/************************************************************
 * ==========================================================
 * CONFIGURATION
 * ==========================================================
 ************************************************************/

const SCANNER_SYNC_CONFIG = {

  /*
   * Current Apps Script deployment.
   *
   * This is the latest backend URL you supplied.
   */
  APPS_SCRIPT_URL:
    'https://script.google.com/macros/s/AKfycbw5UNZLFYecKu-uh0_6mI1QsyyTXlmBb9OfVCYs-c3vTtbKawphBD0ClrFy1fVExmpo/exec',


  /*
   * Local storage key for our queue.
   *
   * This is NEW and separate from the destination
   * configuration.
   */
  QUEUE_STORAGE_KEY:
    'qrScannerSyncQueueV1',


  /*
   * Last status information.
   */
  STATUS_STORAGE_KEY:
    'qrScannerSyncStatusV1',


  /*
   * Maximum number of retry attempts before an item
   * is left pending.
   *
   * We do NOT delete failed scans.
   */
  MAX_RETRIES:
    20,


  /*
   * Small delay between background uploads.
   *
   * This prevents us from hammering Apps Script.
   */
  UPLOAD_DELAY_MS:
    150,


  /*
   * Only one upload at a time.
   *
   * This keeps the queue orderly.
   */
  MAX_SIMULTANEOUS_UPLOADS:
    1,


  /*
   * Most scans sent in one request.
   */
  MAX_BATCH_SIZE:
    20,


  /*
   * Give up waiting for one request after this long
   * (it is then retried; the server ignores duplicates).
   */
  REQUEST_TIMEOUT_MS:
    30000

};


/************************************************************
 * ==========================================================
 * INTERNAL STATE
 * ==========================================================
 ************************************************************/

let scannerSyncUploading =
  false;


/************************************************************
 * ==========================================================
 * INITIALIZE
 * ==========================================================
 ************************************************************/

function initializeScannerSync() {

  createScannerSyncStatusBar();

  /*
   * RECOVER STUCK SCANS.
   *
   * If the page was closed, refreshed, or left (BACK TO SETUP)
   * while a scan was uploading, it stayed marked 'uploading'
   * forever and was never sent again. Put those back in line.
   */
  recoverStuckScannerSyncItems();

  refreshScannerSyncStatus();

  /*
   * Retry automatically when the connection comes back or
   * when the phone screen / tab becomes active again.
   */
  window.addEventListener(
    'online',
    function() {
      scheduleScannerSyncRetry(0);
    }
  );

  document.addEventListener(
    'visibilitychange',
    function() {
      if (document.visibilityState === 'visible') {
        scheduleScannerSyncRetry(0);
      }
    }
  );

  /*
   * Warn before leaving the page while scans are unsaved.
   */
  window.addEventListener(
    'beforeunload',
    function(event) {
      if (
        !window.scannerSyncLeaveConfirmed &&
        getScannerSyncPendingCount() > 0
      ) {
        event.preventDefault();
        event.returnValue = '';
      }
    }
  );

  /*
   * Begin background processing.
   *
   * If there is nothing in the queue,
   * this does nothing.
   */
  processScannerSyncQueue();

}


/************************************************************
 * ==========================================================
 * CREATE PHONE-STYLE STATUS BAR
 * ==========================================================
 ************************************************************/

function createScannerSyncStatusBar() {

  /*
   * Don't create it twice.
   */
  if (
    document.getElementById(
      'scannerSyncStatusBar'
    )
  ) {

    return;

  }


  const bar =
    document.createElement(
      'div'
    );


  bar.id =
    'scannerSyncStatusBar';


  /*
   * Inline styles intentionally keep this module
   * independent from the existing scanner CSS.
   */
  bar.style.cssText = [

    'position:sticky',

    'top:0',

    'z-index:9999',

    'width:100%',

    'box-sizing:border-box',

    'padding:8px 12px',

    'background:#111827',

    'color:#ffffff',

    'font-family:Arial,sans-serif',

    'font-size:13px',

    'font-weight:600',

    'display:flex',

    'align-items:center',

    'justify-content:space-between',

    'gap:10px',

    'border-bottom:1px solid rgba(255,255,255,0.12)',

    'box-shadow:0 2px 8px rgba(0,0,0,0.15)'

  ].join(';');


  bar.innerHTML =

    '<div id="scannerSyncMessage">' +

      '● Scanner ready' +

    '</div>' +

    '<div id="scannerSyncCounts">' +

      'Saved 0 · Queued 0' +

    '</div>';


  /*
   * Put the bar at the very top of the page.
   */
  if (
    document.body.firstChild
  ) {

    document.body.insertBefore(
      bar,
      document.body.firstChild
    );

  }

  else {

    document.body.appendChild(
      bar
    );

  }

}


/************************************************************
 * ==========================================================
 * STATUS MESSAGE
 * ==========================================================
 ************************************************************/

function setScannerSyncMessage(
  message,
  type
) {

  const element =
    document.getElementById(
      'scannerSyncMessage'
    );


  if (!element) {

    return;

  }


  element.textContent =
    message;


  /*
   * Colors:
   *
   * queued  = yellow
   * saved   = green
   * error   = red
   * normal  = white
   */

  if (
    type === 'queued'
  ) {

    element.style.color =
      '#facc15';

  }

  else if (
    type === 'saved'
  ) {

    element.style.color =
      '#4ade80';

  }

  else if (
    type === 'error'
  ) {

    element.style.color =
      '#f87171';

  }

  else {

    element.style.color =
      '#ffffff';

  }

}


/************************************************************
 * ==========================================================
 * LOAD QUEUE
 * ==========================================================
 ************************************************************/

function getScannerSyncQueue() {

  try {

    const raw =
      localStorage.getItem(
        SCANNER_SYNC_CONFIG.QUEUE_STORAGE_KEY
      );


    if (!raw) {

      return [];

    }


    const parsed =
      JSON.parse(
        raw
      );


    if (
      !Array.isArray(parsed)
    ) {

      return [];

    }


    return parsed;

  }

  catch (error) {

    console.error(
      'SCANNER SYNC QUEUE READ ERROR:',
      error
    );


    return [];

  }

}


/************************************************************
 * ==========================================================
 * SAVE QUEUE
 * ==========================================================
 ************************************************************/

function saveScannerSyncQueue(
  queue
) {

  try {

    localStorage.setItem(

      SCANNER_SYNC_CONFIG.QUEUE_STORAGE_KEY,

      JSON.stringify(
        queue
      )

    );

    return true;

  }

  catch (error) {

    console.error(
      'SCANNER SYNC QUEUE WRITE ERROR:',
      error
    );

    setScannerSyncMessage(
      '⚠ PHONE STORAGE ERROR — scan not kept',
      'error'
    );

    return false;

  }

}


/************************************************************
 * ==========================================================
 * RECOVERY + RETRY HELPERS
 * ==========================================================
 ************************************************************/

let scannerSyncRetryTimer =
  null;


function recoverStuckScannerSyncItems() {

  const queue =
    getScannerSyncQueue();

  let changed =
    false;

  queue.forEach(
    function(item) {
      if (item && item.status === 'uploading') {
        item.status = 'queued';
        changed = true;
      }
    }
  );

  if (changed) {
    console.warn('SCANNER SYNC: recovered stuck uploads.');
    saveScannerSyncQueue(queue);
  }

}


function scheduleScannerSyncRetry(
  delayMs
) {

  if (scannerSyncRetryTimer) {
    clearTimeout(scannerSyncRetryTimer);
  }

  scannerSyncRetryTimer =
    setTimeout(
      function() {
        scannerSyncRetryTimer = null;
        processScannerSyncQueue();
      },
      delayMs
    );

}


/*
 * Events the scanner page listens to:
 *   scansync:queued  — stored on the phone, sending
 *   scansync:saved   — Apps Script confirmed the save
 *   scansync:retry   — send failed, will retry by itself
 */
function emitScannerSyncEvent(
  name,
  detail
) {

  try {

    if (
      typeof window.dispatchEvent === 'function' &&
      typeof CustomEvent === 'function'
    ) {

      window.dispatchEvent(
        new CustomEvent(
          'scansync:' + name,
          { detail: detail }
        )
      );

    }

  }

  catch (error) {

    console.error('SCANNER SYNC EVENT ERROR:', error);

  }

}


function getScannerSyncPendingCount() {

  return getScannerSyncQueue().filter(
    function(item) {
      return (
        item &&
        (item.status === 'queued' || item.status === 'uploading')
      );
    }
  ).length;

}


/************************************************************
 * ==========================================================
 * CREATE UNIQUE SCAN ID
 * ==========================================================
 ************************************************************/

function createScannerSyncScanId(
  itemCode
) {

  /*
   * UUID is preferred.
   */
  let randomPart = '';


  if (
    window.crypto &&
    typeof window.crypto.randomUUID ===
      'function'
  ) {

    randomPart =
      window.crypto.randomUUID();

  }

  else {

    randomPart =
      Math.random()
        .toString(36)
        .substring(2) +

      Math.random()
        .toString(36)
        .substring(2);

  }


  return (

    'SCAN-' +

    Date.now() +

    '-' +

    String(
      itemCode
    )
    .trim()
    .toUpperCase() +

    '-' +

    randomPart

  );

}


/************************************************************
 * ==========================================================
 * DESTINATION CONFIGURATION
 * ==========================================================
 *
 * IMPORTANT:
 *
 * We deliberately look for a saved destination rather
 * than hard-coding Display 1 / Column A / Column B.
 *
 * This allows the setup page to remain responsible for
 * destination selection.
 *
 ************************************************************/

function getScannerSyncDestination() {

  /*
   * First check the canonical configuration key that
   * we may establish later.
   */
  const preferredKeys = [

    /* What setup.html saves today — always wins. */
    'qrScannerDestination',

    'qrScannerDestinationConfig',

    'qrScannerConfig',

    'scannerDestinationConfig',

    'universalQrScannerConfig'

  ];


  for (
    const key of preferredKeys
  ) {

    const result =
      readScannerSyncConfigKey(
        key
      );


    if (
      result
    ) {

      const normalized =
        normalizeScannerSyncDestination(
          result
        );


      if (
        normalized
      ) {

        return normalized;

      }

    }

  }


  /*
   * Fallback:
   *
   * Search localStorage for a JSON object that looks
   * like a Google Sheet destination.
   *
   * This makes the sync module more tolerant of the
   * current setup.html implementation.
   */
  for (
    let i = 0;
    i < localStorage.length;
    i++
  ) {

    const key =
      localStorage.key(
        i
      );


    if (!key) {

      continue;

    }


    /*
     * Never accidentally inspect our own queue.
     */
    if (
      key ===
      SCANNER_SYNC_CONFIG.QUEUE_STORAGE_KEY
    ) {

      continue;

    }


    const result =
      readScannerSyncConfigKey(
        key
      );


    if (
      !result
    ) {

      continue;

    }


    const normalized =
      normalizeScannerSyncDestination(
        result
      );


    if (
      normalized
    ) {

      return normalized;

    }

  }


  return null;

}


/************************************************************
 * ==========================================================
 * READ CONFIG KEY
 * ==========================================================
 ************************************************************/

function readScannerSyncConfigKey(
  key
) {

  try {

    const raw =
      localStorage.getItem(
        key
      );


    if (!raw) {

      return null;

    }


    return JSON.parse(
      raw
    );

  }

  catch (error) {

    return null;

  }

}


/************************************************************
 * ==========================================================
 * NORMALIZE DESTINATION
 * ==========================================================
 ************************************************************/

function normalizeScannerSyncDestination(
  config
) {

  if (
    !config ||
    typeof config !== 'object'
  ) {

    return null;

  }


  /*
   * Spreadsheet URL.
   *
   * We support both names in case the setup module
   * uses one or the other.
   */
  const spreadsheetUrl =
    String(

      config.spreadsheetUrl ||

      config.sheetUrl ||

      ''

    )
    .trim();


  const sheetName =
    String(

      config.sheetName ||

      ''

    )
    .trim();


  /*
   * Item code column.
   *
   * New setup:
   * itemCodeColumn
   *
   * Older setup:
   * columnNumber
   */
  const itemCodeColumn =
    Number(

      config.itemCodeColumn ||

      config.columnNumber ||

      0

    );


  /*
   * Timestamp enabled.
   */
  let timestampEnabled;


  if (
    config.timestampEnabled !==
    undefined
  ) {

    timestampEnabled =
      Boolean(
        config.timestampEnabled
      );

  }

  else {

    /*
     * Older configuration may not have timestamp
     * functionality.
     *
     * Default to false rather than inventing a
     * timestamp destination.
     */
    timestampEnabled =
      false;

  }


  /*
   * Timestamp column.
   */
  const timestampColumn =
    Number(

      config.timestampColumn ||

      0

    );


  /*
   * Scanner Name column chosen on the phone (used only when the owner's rule for the
   * tab is STAFF CHOOSES; REQUIRED / NOT ALLOWED are enforced by the server).
   */
  const nameColumn =
    config.nameEnabled === true
      ? Number(config.nameColumn || 0)
      : 0;


  /*
   * Basic validation.
   */
  if (
    !spreadsheetUrl ||
    !sheetName ||
    !Number.isInteger(
      itemCodeColumn
    ) ||
    itemCodeColumn < 1
  ) {

    return null;

  }


  if (
    timestampEnabled &&
    (
      !Number.isInteger(
        timestampColumn
      ) ||
      timestampColumn < 1
    )
  ) {

    return null;

  }


  return {

    spreadsheetUrl:
      spreadsheetUrl,

    sheetName:
      sheetName,

    itemCodeColumn:
      itemCodeColumn,

    timestampEnabled:
      timestampEnabled,

    timestampColumn:
      timestampEnabled
        ? timestampColumn
        : null,

    nameEnabled:
      Number.isInteger(nameColumn) && nameColumn > 0,

    nameColumn:
      Number.isInteger(nameColumn) && nameColumn > 0
        ? nameColumn
        : null,

    /* The owner's rule, shown on the setup page (the server enforces it). */
    nameRule:
      String(config.nameRule || ''),

    nameLetter:
      String(config.nameLetter || '')

  };

}


/************************************************************
 * ==========================================================
 * STAFF SESSION (signed-in Gmail on this phone)
 * ==========================================================
 ************************************************************/

const SCANNER_SESSION_KEY =
  'qrScannerSessionV1';


function getScannerSession() {

  try {

    const session =
      JSON.parse(localStorage.getItem(SCANNER_SESSION_KEY) || 'null');

    return session && session.sessionKey ? session : null;

  }

  catch (error) {

    return null;

  }

}


function setScannerSession(session) {

  localStorage.setItem(
    SCANNER_SESSION_KEY,
    JSON.stringify({
      sessionKey: session.sessionKey,
      name: session.name,
      gmail: session.gmail,
      signedInAt: new Date().toISOString()
    })
  );

}


function clearScannerSession() {

  try {
    localStorage.removeItem(SCANNER_SESSION_KEY);
  } catch (error) { /* ignore */ }

}


/*
 * After signing in again (new key), unsaved scans waiting on
 * this phone are sent with the new key so they don't get
 * stuck. Only this phone's own queue is touched.
 */
function attachSessionToPendingScans(session) {

  const queue =
    getScannerSyncQueue();

  let changed =
    false;

  queue.forEach(function(item) {

    if (
      item &&
      (item.status === 'queued' || item.status === 'uploading') &&
      (!item.staffGmail || item.staffGmail === session.gmail)
    ) {

      item.sessionKey = session.sessionKey;
      item.staffName = session.name;
      item.staffGmail = session.gmail;
      item.status = 'queued';
      changed = true;

    }

  });

  if (changed) {
    saveScannerSyncQueue(queue);
  }

  scheduleScannerSyncRetry(0);

}


/************************************************************
 * ==========================================================
 * QUEUE VERIFIED SCAN
 * ==========================================================
 *
 * THIS is the function that the existing scanner will
 * eventually call after the 3rd successful verification.
 *
 * IMPORTANT:
 *
 * It returns immediately.
 *
 * Google Sheets is NOT contacted here.
 *
 ************************************************************/

function queueVerifiedScan(
  itemCode
) {

  const normalizedItemCode =
    String(
      itemCode || ''
    )
    .trim()
    .toUpperCase();


  /*
   * Extra frontend protection.
   *
   * The scanner already validates KA + 3 to 5 digits,
   * but we keep this boundary check here too.
   */
  if (
    !/^KA\d{3,5}$/.test(
      normalizedItemCode
    )
  ) {

    console.error(
      'SYNC REJECTED — INVALID ITEM CODE:',
      normalizedItemCode
    );


    setScannerSyncMessage(
      '⚠ Invalid item code',
      'error'
    );


    return {

      success: false,

      error:
        'Invalid item code.'

    };

  }


  /*
   * Capture the destination NOW.
   *
   * This is extremely important.
   *
   * If the user changes destination later, this queued
   * scan keeps the original destination.
   */
  const destination =
    getScannerSyncDestination();


  if (
    !destination
  ) {

    setScannerSyncMessage(
      '⚠ No scan destination',
      'error'
    );


    console.error(
      'SCANNER SYNC: No destination configuration found.'
    );


    return {

      success: false,

      error:
        'No saved scan destination was found.'

    };

  }


  /*
   * Who is scanning. (The scanner page blocks scanning when
   * no one is signed in; this is a second safety check.)
   */
  const session =
    getScannerSession();

  if (
    !session &&
    window.scannerSignInRequired === true
  ) {

    setScannerSyncMessage(
      '⚠ Not signed in',
      'error'
    );

    return {

      success: false,

      error:
        'This phone is not signed in.'

    };

  }


  /*
   * Create unique ID.
   */
  const scanId =
    createScannerSyncScanId(
      normalizedItemCode
    );


  /*
   * Create immutable queue item.
   */
  const queueItem = {

    scanId:
      scanId,

    itemCode:
      normalizedItemCode,

    destination: {

      spreadsheetUrl:
        destination.spreadsheetUrl,

      sheetName:
        destination.sheetName,

      itemCodeColumn:
        destination.itemCodeColumn,

      timestampEnabled:
        destination.timestampEnabled,

      timestampColumn:
        destination.timestampColumn,

      nameColumn:
        destination.nameColumn

    },

    queuedAt:
      new Date().toISOString(),

    sessionKey:
      session ? session.sessionKey : '',

    staffName:
      session ? session.name : '',

    staffGmail:
      session ? session.gmail : '',

    status:
      'queued',

    retries:
      0,

    lastError:
      null

  };


  /*
   * Load current queue.
   */
  const queue =
    getScannerSyncQueue();


  /*
   * Add item.
   */
  queue.push(
    queueItem
  );


  /*
   * Save immediately. If the phone could not store it,
   * tell the scanner so it does NOT look like a success.
   */
  if (
    !saveScannerSyncQueue(
      queue
    )
  ) {

    return {

      success: false,

      error:
        'Could not store the scan on this phone.'

    };

  }


  /*
   * Update UI immediately.
   *
   * This happens without waiting for Google.
   */
  setScannerSyncMessage(

    normalizedItemCode +
    ' — Saving…',

    'queued'

  );


  emitScannerSyncEvent(
    'queued',
    { scanId: scanId, itemCode: normalizedItemCode }
  );


  refreshScannerSyncStatus();


  /*
   * Start background processing.
   *
   * We intentionally do NOT await it.
   */
  setTimeout(
    function() {

      processScannerSyncQueue();

    },
    50
  );


  /*
   * Return immediately to scanner.
   */
  return {

    success: true,

    scanId:
      scanId,

    itemCode:
      normalizedItemCode,

    status:
      'queued'

  };

}


/************************************************************
 * ==========================================================
 * PROCESS QUEUE — BATCHES
 * ==========================================================
 *
 * Sends up to MAX_BATCH_SIZE scans per request (all going to
 * the same sheet tab/columns). The server writes them in one
 * go and answers per scan.
 *
 * IMPORTANT: after waiting for Google we NEVER save an old
 * copy of the queue. Every update re-reads storage and only
 * changes the scans in this batch, by scanId. (Saving an old
 * copy erased scans made during the upload — the original
 * "scanned but not saved" bug.)
 *
 ************************************************************/

let scannerSyncBatchSupported =
  true;


function sameScannerSyncDestination(a, b) {

  return (
    a.spreadsheetUrl === b.spreadsheetUrl &&
    a.sheetName === b.sheetName &&
    Number(a.itemCodeColumn) === Number(b.itemCodeColumn) &&
    Boolean(a.timestampEnabled) === Boolean(b.timestampEnabled) &&
    Number(a.timestampColumn || 0) === Number(b.timestampColumn || 0) &&
    Number(a.nameColumn || 0) === Number(b.nameColumn || 0)
  );

}


async function processScannerSyncQueue() {

  if (scannerSyncUploading) {
    return;
  }

  scannerSyncUploading = true;

  try {

    while (true) {

      const queue = getScannerSyncQueue();

      const first = queue.find(function(item) {
        return item && item.status === 'queued';
      });

      if (!first) {
        break;
      }

      /*
       * Pick this batch: queued scans with the same
       * destination as the oldest one, in scan order.
       */
      const limit = scannerSyncBatchSupported
        ? SCANNER_SYNC_CONFIG.MAX_BATCH_SIZE
        : 1;

      const batch = queue.filter(function(item) {
        return (
          item &&
          item.status === 'queued' &&
          sameScannerSyncDestination(item.destination, first.destination) &&
          (item.sessionKey || '') === (first.sessionKey || '')
        );
      }).slice(0, limit);

      const batchIds = {};

      batch.forEach(function(item) {
        item.status = 'uploading';
        batchIds[item.scanId] = true;
      });

      /* Safe: no waiting between reading and saving here. */
      saveScannerSyncQueue(queue);

      refreshScannerSyncStatus();


      /*
       * SEND
       */
      let perScan = {};      // scanId → server result
      let requestError = null;

      try {

        if (scannerSyncBatchSupported) {

          const response = await uploadScannerSyncBatch(
            first.destination,
            batch,
            first.sessionKey
          );

          if (response.serverVersion) {
            try {
              localStorage.setItem('qrScannerServerVersionV1', response.serverVersion);
            } catch (e) { /* ignore */ }
          }

          (response.results || []).forEach(function(result) {
            if (result && result.scanId) {
              perScan[result.scanId] = result;
            }
          });

        }

        else {

          const response = await uploadScannerSyncItem(batch[0]);

          perScan[batch[0].scanId] = {
            scanId: batch[0].scanId,
            success: true,
            row: response.row
          };

        }

      }

      catch (error) {

        requestError = String(
          error && error.message ? error.message : error
        );

        /*
         * Server not updated yet → it doesn't know the batch
         * action. Switch to one-by-one and try again at once.
         */
        if (
          scannerSyncBatchSupported &&
          /unknown get action/i.test(requestError)
        ) {

          console.warn(
            'SCANNER SYNC: server has no batch save yet — sending one by one.'
          );

          scannerSyncBatchSupported = false;

          const resetQueue = getScannerSyncQueue();

          resetQueue.forEach(function(item) {
            if (item && batchIds[item.scanId]) {
              item.status = 'queued';
            }
          });

          saveScannerSyncQueue(resetQueue);

          continue;

        }

      }


      /*
       * APPLY RESULTS to a FRESH copy of the queue.
       */
      const freshQueue = getScannerSyncQueue();

      const savedNow = [];
      const failedNow = [];

      const keep = freshQueue.filter(function(item) {

        if (!item || !batchIds[item.scanId]) {
          return true;  // not in this batch — untouched
        }

        const result = perScan[item.scanId];

        if (!requestError && result && result.success) {

          savedNow.push(item);
          return false; // saved → leave the queue

        }

        item.status = 'queued';
        item.retries = Number(item.retries || 0) + 1;
        item.lastError = requestError ||
          (result && result.error) ||
          'No answer for this scan.';

        failedNow.push(item);

        return true;

      });

      saveScannerSyncQueue(keep);


      savedNow.forEach(function(item) {

        incrementScannerSyncSavedCount();

        /*
         * Fired ONLY after Apps Script confirmed the row is
         * written. The scanner plays the success sound on this.
         */
        emitScannerSyncEvent('saved', {
          scanId: item.scanId,
          itemCode: item.itemCode
        });

      });

      /*
       * Ask the logbook for the RESULT at once (not awaited:
       * the next scans keep saving meanwhile).
       */
      if (savedNow.length && scannerSyncBatchSupported) {

        requestLogbookResults(
          first.destination,
          first.sessionKey,
          savedNow
            .map(function(item) {
              const result = perScan[item.scanId] || {};
              return {
                scanId: item.scanId,
                itemCode: item.itemCode,
                row: Number(result.row || 0)
              };
            })
            .filter(function(entry) {
              return entry.row > 0;
            })
        );

      }

      if (savedNow.length) {

        setScannerSyncMessage(
          savedNow.length === 1
            ? savedNow[0].itemCode + ' — Saved ✓'
            : savedNow.length + ' scans saved ✓',
          'saved'
        );

      }


      failedNow.forEach(function(item) {

        console.error(
          'SCANNER SYNC UPLOAD ERROR:',
          item.itemCode,
          item.lastError
        );

        emitScannerSyncEvent('retry', {
          scanId: item.scanId,
          itemCode: item.itemCode,
          retries: item.retries,
          error: item.lastError
        });

      });

      refreshScannerSyncStatus();


      /*
       * The server says this phone's sign-in is no longer
       * valid → ask the person to sign in again. The scans
       * stay on the phone and are sent after sign-in.
       */
      if (
        requestError &&
        /NOT_SIGNED_IN/.test(requestError)
      ) {

        emitScannerSyncEvent('signedout', {
          error: requestError.replace(/^.*NOT_SIGNED_IN:\s*/, '')
        });

        setScannerSyncMessage(
          'Sign in again to save ' + failedNow.length + ' scan(s)',
          'error'
        );

        break;

      }


      if (failedNow.length) {

        setScannerSyncMessage(
          failedNow.length === 1
            ? failedNow[0].itemCode + ' — Not saved yet, retrying…'
            : failedNow.length + ' scans not saved yet, retrying…',
          'error'
        );

        /*
         * Retry by itself: 2s, 4s, 8s ... up to 30s.
         */
        const retries = Math.max.apply(
          null,
          failedNow.map(function(item) { return item.retries; })
        );

        scheduleScannerSyncRetry(
          Math.min(30000, 2000 * Math.pow(2, Math.min(retries - 1, 4)))
        );

        break;

      }

      await scannerSyncDelay(
        SCANNER_SYNC_CONFIG.UPLOAD_DELAY_MS
      );

    }

  }

  finally {

    scannerSyncUploading = false;

    refreshScannerSyncStatus();

  }

}


/************************************************************
 * ==========================================================
 * LOGBOOK RESULTS
 * ==========================================================
 *
 * After a save, asks the server for the logbook's RESULT of
 * each saved row and fires scansync:result per scan:
 *   { scanId, itemCode, result }
 * Server or logbook not set up → stops asking for an hour;
 * the RESULT then appears in the sheet within a minute.
 ************************************************************/

let logbookResultsOffUntil = 0;

function requestLogbookResults(
  destination,
  sessionKey,
  entries,
  attempt
) {

  if (!entries || !entries.length) return;

  if (Date.now() < logbookResultsOffUntil) return;

  const params = new URLSearchParams();

  params.set('action', 'logbookResults');

  if (sessionKey) {
    params.set('sessionKey', sessionKey);
  }

  params.set('deviceId', getScannerDeviceId());
  params.set('spreadsheetUrl', destination.spreadsheetUrl);
  params.set('sheetName', destination.sheetName);

  params.set(
    'rows',
    JSON.stringify(entries.map(function(entry) {
      return [entry.row, entry.itemCode];
    }))
  );

  scannerSyncJsonp(params)
    .then(function(response) {

      if (!response.configured) {
        logbookResultsOffUntil = Date.now() + 3600000;
        emitScannerSyncEvent('resultoff', {});
        return;
      }

      const byRow = {};

      (response.results || []).forEach(function(result, index) {
        if (result) byRow[index] = result;
      });

      const waiting = [];

      entries.forEach(function(entry, index) {

        const found = byRow[index];

        if (found && found.result) {

          emitScannerSyncEvent('result', {
            scanId: entry.scanId,
            itemCode: entry.itemCode,
            result: String(found.result),
            card: found   // word, detail, next, item, last
          });

        }

        else {

          waiting.push(entry);

        }

      });

      /* The logbook was busy: ask once more shortly. */
      if (waiting.length && !attempt) {
        setTimeout(function() {
          requestLogbookResults(destination, sessionKey, waiting, 1);
        }, 4000);
      }

      else if (waiting.length) {
        emitScannerSyncEvent('resultlate', {
          scanIds: waiting.map(function(entry) { return entry.scanId; })
        });
      }

    })
    .catch(function(error) {

      const message =
        String(error && error.message ? error.message : error);

      console.warn('LOGBOOK RESULTS:', message);

      /* Older server without this action → stop asking. */
      if (/unknown get action/i.test(message)) {
        logbookResultsOffUntil = Date.now() + 3600000;
        emitScannerSyncEvent('resultoff', {});
      }

      else if (!attempt) {
        setTimeout(function() {
          requestLogbookResults(destination, sessionKey, entries, 1);
        }, 4000);
      }

      else {
        emitScannerSyncEvent('resultlate', {
          scanIds: entries.map(function(entry) { return entry.scanId; })
        });
      }

    });

}


/************************************************************
 * ==========================================================
 * JSONP REQUEST
 * ==========================================================
 ************************************************************/

function scannerSyncJsonp(
  params
) {

  return new Promise(function(resolve, reject) {

    const callbackName =
      'scannerSyncCallback_' +
      Date.now() + '_' +
      Math.floor(Math.random() * 100000);

    const script =
      document.createElement('script');

    let finished = false;

    function cleanup() {

      if (script && script.parentNode) {
        script.parentNode.removeChild(script);
      }

      try {
        delete window[callbackName];
      }

      catch (error) {
        window[callbackName] = undefined;
      }

    }

    /*
     * A slow request never blocks the scanner, and thanks to
     * the server's duplicate guard a retry after a timeout
     * can't write the same scan twice.
     */
    const timeout = setTimeout(function() {

      if (finished) return;

      finished = true;
      cleanup();

      reject(new Error('Apps Script request timed out.'));

    }, SCANNER_SYNC_CONFIG.REQUEST_TIMEOUT_MS);

    window[callbackName] = function(response) {

      if (finished) return;

      finished = true;
      clearTimeout(timeout);
      cleanup();

      if (response && response.success) {
        resolve(response);
      }

      else {
        reject(new Error(
          response && response.error
            ? response.error
            : 'Unknown save error.'
        ));
      }

    };

    params.set('callback', callbackName);

    script.src =
      SCANNER_SYNC_CONFIG.APPS_SCRIPT_URL + '?' + params.toString();

    script.async = true;

    script.onerror = function() {

      if (finished) return;

      finished = true;
      clearTimeout(timeout);
      cleanup();

      reject(new Error('Could not contact Apps Script.'));

    };

    document.head.appendChild(script);

  });

}


/*
 * A short random ID per phone, kept forever, so the
 * _SCAN_LOG tab shows which phone saved each scan.
 */
function getScannerDeviceId() {

  const key = 'qrScannerDeviceIdV1';

  try {

    let id = localStorage.getItem(key);

    if (!id) {

      const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

      id = 'P-';

      for (let i = 0; i < 6; i++) {
        id += letters.charAt(Math.floor(Math.random() * letters.length));
      }

      localStorage.setItem(key, id);

    }

    return id;

  }

  catch (error) {

    return 'P-UNKNOWN';

  }

}


function addScannerSyncDestinationParams(
  params,
  destination
) {

  params.set('deviceId', getScannerDeviceId());

  params.set('spreadsheetUrl', destination.spreadsheetUrl);
  params.set('sheetName', destination.sheetName);
  params.set('itemCodeColumn', String(destination.itemCodeColumn));
  params.set('timestampEnabled', String(destination.timestampEnabled));

  if (destination.timestampEnabled) {
    params.set('timestampColumn', String(destination.timestampColumn));
  }

  if (destination.nameColumn) {
    params.set('nameColumn', String(destination.nameColumn));
  }

}


/*
 * Many scans, one request.
 * items = [[scanId, itemCode, scannedAt], ...]
 */
function uploadScannerSyncBatch(
  destination,
  items,
  sessionKey
) {

  const params = new URLSearchParams();

  params.set('action', 'saveQueuedScans');

  if (sessionKey) {
    params.set('sessionKey', sessionKey);
  }

  addScannerSyncDestinationParams(params, destination);

  params.set(
    'items',
    JSON.stringify(items.map(function(item) {
      return [item.scanId, item.itemCode, item.queuedAt];
    }))
  );

  return scannerSyncJsonp(params);

}


/*
 * One scan (used if the server has no batch save yet).
 */
function uploadScannerSyncItem(
  item
) {

  const params = new URLSearchParams();

  params.set('action', 'saveQueuedScan');

  if (item.sessionKey) {
    params.set('sessionKey', item.sessionKey);
  }

  params.set('scanId', item.scanId);
  params.set('itemCode', item.itemCode);
  params.set('scannedAt', item.queuedAt);

  addScannerSyncDestinationParams(params, item.destination);

  return scannerSyncJsonp(params);

}


/************************************************************
 * ==========================================================
 * DELAY
 * ==========================================================
 ************************************************************/

function scannerSyncDelay(
  milliseconds
) {

  return new Promise(

    function(resolve) {

      setTimeout(
        resolve,
        milliseconds
      );

    }

  );

}


/************************************************************
 * ==========================================================
 * STATUS COUNTS
 * ==========================================================
 ************************************************************/

function refreshScannerSyncStatus() {

  const queue =
    getScannerSyncQueue();


  const savedCount =
    Number(
      localStorage.getItem(
        SCANNER_SYNC_CONFIG
          .STATUS_STORAGE_KEY
      ) || 0
    );


  const queuedCount =
    queue.filter(

      function(item) {

        return (
          item.status ===
            'queued' ||
          item.status ===
            'uploading'
        );

      }

    ).length;


  const element =
    document.getElementById(
      'scannerSyncCounts'
    );


  if (
    element
  ) {

    element.textContent =

      'Saved ' +
      savedCount +

      ' · Unsaved ' +
      queuedCount;

    /*
     * Make unsaved scans impossible to miss.
     */
    element.style.color =
      queuedCount > 0 ? '#facc15' : '#4ade80';

  }


  const bar =
    document.getElementById(
      'scannerSyncStatusBar'
    );

  if (bar) {

    const waitingTooLong =
      queue.some(
        function(item) {
          return item && Number(item.retries || 0) >= 3;
        }
      );

    bar.style.background =
      waitingTooLong ? '#7f1d1d' : '#111827';

  }

}


/************************************************************
 * ==========================================================
 * RECORD LOCAL SAVED COUNT
 * ==========================================================
 ************************************************************/

function incrementScannerSyncSavedCount() {

  const current =
    Number(

      localStorage.getItem(

        SCANNER_SYNC_CONFIG
          .STATUS_STORAGE_KEY

      ) || 0

    );


  localStorage.setItem(

    SCANNER_SYNC_CONFIG
      .STATUS_STORAGE_KEY,

    String(
      current + 1
    )

  );

}


/************************************************************
 * ==========================================================
 * REMOVE OLD SAVED ITEMS
 * ==========================================================
 *
 * The active queue only contains pending items.
 *
 * Saved count is kept separately.
 *
 ************************************************************/


/************************************************************
 * ==========================================================
 * AUTOMATIC INITIALIZATION
 * ==========================================================
 ************************************************************/

if (
  document.readyState ===
  'loading'
) {

  document.addEventListener(

    'DOMContentLoaded',

    initializeScannerSync

  );

}

else {

  initializeScannerSync();

}
