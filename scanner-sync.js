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
 * - KA + 4 digit validation
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
    1

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

  refreshScannerSyncStatus();

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

  localStorage.setItem(

    SCANNER_SYNC_CONFIG.QUEUE_STORAGE_KEY,

    JSON.stringify(
      queue
    )

  );

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

  'qrScannerDestinationConfig',

  'qrScannerConfig',

  'scannerDestinationConfig',

  'universalQrScannerConfig'

];
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
        : null

  };

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
   * The scanner already validates KA + 4 digits,
   * but we keep this boundary check here too.
   */
  if (
    !/^KA\d{4}$/.test(
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
        destination.timestampColumn

    },

    queuedAt:
      new Date().toISOString(),

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
   * Save immediately.
   */
  saveScannerSyncQueue(
    queue
  );


  /*
   * Update UI immediately.
   *
   * This happens without waiting for Google.
   */
  setScannerSyncMessage(

    normalizedItemCode +
    ' — Queued for saving',

    'queued'

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
 * PROCESS QUEUE
 * ==========================================================
 ************************************************************/

async function processScannerSyncQueue() {

  /*
   * Only one uploader is allowed.
   */
  if (
    scannerSyncUploading
  ) {

    return;

  }


  scannerSyncUploading =
    true;


  try {

    while (
      true
    ) {

      const queue =
        getScannerSyncQueue();


      /*
       * Find the first pending item.
       */
      const index =
        queue.findIndex(

          function(item) {

            return (
              item &&
              item.status ===
                'queued'
            );

          }

        );


      /*
       * Nothing left to upload.
       */
      if (
        index === -1
      ) {

        break;

      }


      const item =
        queue[index];


      /*
       * Mark as uploading.
       */
      item.status =
        'uploading';


      saveScannerSyncQueue(
        queue
      );


      refreshScannerSyncStatus();


      try {

        /*
         * Upload ONE item.
         *
         * This function currently uses the Apps Script
         * JSONP bridge.
         */
        const result =
          await uploadScannerSyncItem(
            item
          );


        /*
         * SUCCESS
         */
        if (
          result &&
          result.success
        ) {

          item.status =
            'saved';
          
          incrementScannerSyncSavedCount();


          item.savedAt =
            new Date().toISOString();


          item.serverResult =
            result;


          setScannerSyncMessage(

            item.itemCode +
            ' — Saved',

            'saved'

          );

        }

        else {

          throw new Error(

            result &&
            result.error

              ? result.error

              : 'Google Sheets save failed.'

          );

        }

      }

      catch (error) {

        item.status =
          'queued';


        item.retries =
          Number(
            item.retries || 0
          ) + 1;


        item.lastError =
          String(
            error &&
            error.message
              ? error.message
              : error
          );


        console.error(
          'SCANNER SYNC UPLOAD ERROR:',
          item.lastError
        );


        /*
         * Don't delete it.
         *
         * It remains in the queue and can retry later.
         */
        setScannerSyncMessage(

          item.itemCode +
          ' — Waiting to retry',

          'error'

        );


        /*
         * Save the failed state.
         */
        saveScannerSyncQueue(
          queue
        );


        refreshScannerSyncStatus();


        /*
         * Stop this cycle.
         *
         * This prevents a temporary network/backend
         * problem from creating a tight retry loop.
         */
        break;

      }


      /*
       * Remove successfully saved item from the
       * active queue.
       *
       * We keep the queue small.
       */
      if (
        item.status ===
        'saved'
      ) {

        queue.splice(
          index,
          1
        );

      }


      saveScannerSyncQueue(
        queue
      );


      refreshScannerSyncStatus();


      /*
       * Small pause between uploads.
       */
      await scannerSyncDelay(

        SCANNER_SYNC_CONFIG
          .UPLOAD_DELAY_MS

      );

    }

  }

  finally {

    scannerSyncUploading =
      false;


    refreshScannerSyncStatus();

  }

}


/************************************************************
 * ==========================================================
 * UPLOAD ONE QUEUED ITEM
 * ==========================================================
 *
 * NOTE:
 *
 * The Apps Script JSONP save endpoint will be connected
 * in the next backend step.
 *
 ************************************************************/

function uploadScannerSyncItem(
  item
) {

  return new Promise(

    function(resolve, reject) {

      const callbackName =

        'scannerSyncCallback_' +

        Date.now() +

        '_' +

        Math.floor(
          Math.random() * 100000
        );


      let script =
        document.createElement(
          'script'
        );


      let finished =
        false;


      /*
       * Cleanup.
       */
      function cleanup() {

        if (
          script &&
          script.parentNode
        ) {

          script.parentNode.removeChild(
            script
          );

        }


        try {

          delete window[
            callbackName
          ];

        }

        catch (error) {

          window[
            callbackName
          ] =
            undefined;

        }

      }


      /*
       * Timeout.
       *
       * A slow request should NEVER block the scanner.
       */
      const timeout =
        setTimeout(

          function() {

            if (
              finished
            ) {

              return;

            }


            finished =
              true;


            cleanup();


            reject(

              new Error(
                'Apps Script request timed out.'
              )

            );

          },

          15000

        );


      /*
       * JSONP callback.
       */
      window[
        callbackName
      ] =

        function(response) {

          if (
            finished
          ) {

            return;

          }


          finished =
            true;


          clearTimeout(
            timeout
          );


          cleanup();


          if (
            response &&
            response.success
          ) {

            resolve(
              response
            );

          }

          else {

            reject(

              new Error(

                response &&
                response.error

                  ? response.error

                  : 'Unknown save error.'

              )

            );

          }

        };


      /*
       * Build request.
       */
      const params =
        new URLSearchParams();


      params.set(
        'action',
        'saveQueuedScan'
      );


      params.set(
        'callback',
        callbackName
      );


      params.set(
        'scanId',
        item.scanId
      );


      params.set(
        'itemCode',
        item.itemCode
      );


      params.set(

        'spreadsheetUrl',

        item.destination
          .spreadsheetUrl

      );


      params.set(

        'sheetName',

        item.destination
          .sheetName

      );


      params.set(

        'itemCodeColumn',

        String(
          item.destination
            .itemCodeColumn
        )

      );


      params.set(

        'timestampEnabled',

        String(
          item.destination
            .timestampEnabled
        )

      );


      if (
        item.destination
          .timestampEnabled
      ) {

        params.set(

          'timestampColumn',

          String(
            item.destination
              .timestampColumn
          )

        );

      }


      /*
       * Create JSONP request.
       */
      script.src =

        SCANNER_SYNC_CONFIG
          .APPS_SCRIPT_URL +

        '?' +

        params.toString();


      script.async =
        true;


      script.onerror =

        function() {

          if (
            finished
          ) {

            return;

          }


          finished =
            true;


          clearTimeout(
            timeout
          );


          cleanup();


          reject(

            new Error(
              'Could not contact Apps Script.'
            )

          );

        };


      document
        .head
        .appendChild(
          script
        );

    }

  );

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

      ' · Queued ' +
      queuedCount;

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
