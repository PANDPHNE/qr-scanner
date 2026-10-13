/************************************************************
 * ==========================================================
 * QR CODE SCANNER — GOOGLE APPS SCRIPT BACKEND V3
 * ==========================================================
 *
 * PURPOSE
 *
 * GitHub Scanner / Setup UI
 *          ↓
 * Google Apps Script
 *          ↓
 * Google Sheets
 *
 *
 * CURRENT FEATURES
 *
 * ✓ Ping backend
 * ✓ Load spreadsheet tabs
 * ✓ Load sheet columns
 * ✓ Verify destination
 * ✓ Optional timestamp
 * ✓ KA + 3/4/5 digit item-code validation
 * ✓ Batch save (saveQueuedScans) — many scans, one request
 * ✓ Duplicate guard by scanId (a retried scan is never
 *   written twice)
 * ✓ Next row found from the Item Code / Timestamp columns
 *   only, so other columns can't push scans far down
 * ✓ _SCAN_LOG tab: hidden, append-only record of every
 *   saved scan (code, times, tab, row, scanId, phone)
 * ✓ Scanner columns protected: only the owner (and this
 *   script) can edit or delete scanned rows
 * ✓ Staff sign in with Gmail (checked against the STAFF
 *   tab); every scan records who scanned it
 * ✓ Save every successful scan as a NEW ROW
 * ✓ Save with timestamp
 * ✓ Save without timestamp
 * ✓ JSONP support for external GitHub setup page
 *
 *
 * NOT IMPLEMENTED YET
 *
 * - Attendance
 * - Movement
 * - Staff accounts
 * - User permissions
 *
 ************************************************************/


/************************************************************
 * ==========================================================
 * CONFIGURATION
 * ==========================================================
 ************************************************************/

const CONFIG = {

  /*
   * Server version — shown on the scanner's settings panel.
   */
  VERSION:
    '3.0.0',


  /*
   * ── STAFF SIGN-IN ───────────────────────────────────────
   *
   * GOOGLE_CLIENT_ID: paste the "Client ID" from Google Cloud
   * (ends with .apps.googleusercontent.com). The scanner
   * reads it from here — it is not a secret.
   */
  GOOGLE_CLIENT_ID:
    'PASTE-YOUR-CLIENT-ID-HERE.apps.googleusercontent.com',


  /*
   * Only Gmails listed in this tab with ACTIVE = YES can sign
   * in. Columns: A STAFF NAME, B GMAIL, C ACTIVE (YES/NO).
   */
  STAFF_SPREADSHEET_ID:
    '1YW50gqsr5eEQu5ouhn-tU_5SjqJJga4Enq_GQSIcgbk',

  STAFF_SHEET_NAME:
    'STAFF',


  /*
   * Hidden tab listing every signed-in phone. Set a row's
   * ACTIVE to NO to sign that one phone out.
   */
  SESSIONS_SHEET_NAME:
    '_STAFF_SESSIONS',


  /*
   * true  = scans are only saved from a signed-in staff phone
   * false = scans without sign-in are still accepted
   */
  REQUIRE_SIGN_IN:
    true,


  /*
   * The scanner writes "Name, gmail" into the column whose
   * header starts with this text (e.g. "BY (NAME, GMAIL)"),
   * if the tab has one.
   */
  BY_HEADER_PREFIX:
    'BY',


  /*
   * Hidden, append-only log of every saved scan.
   * Created automatically in each spreadsheet that
   * receives scans.
   */
  SCAN_LOG_SHEET_NAME:
    '_SCAN_LOG',


  /*
   * Protect the Item Code / Timestamp columns of every tab
   * the scanner writes to, so staff can view but not type
   * over or delete scanned rows. The spreadsheet owner can
   * still edit. Set to false to turn off.
   */
  PROTECT_SCANNER_COLUMNS:
    true,


  /*
   * Header row in the destination sheet.
   */
  HEADER_ROW: 1,


  /*
   * Timestamp format.
   */
  TIMESTAMP_FORMAT:
    'yyyy-MM-dd HH:mm:ss',


  /*
   * Valid item-code format.
   *
   * KA123
   * KA7195
   * KA12345
   *
   * KA + 3, 4 or 5 digits
   */
  ITEM_CODE_REGEX:
    /^KA\d{3,5}$/,


  /*
   * How long (seconds) a saved scanId is remembered for the
   * duplicate guard. 21600 = 6 hours (Google's maximum).
   */
  DUPLICATE_GUARD_SECONDS:
    21600,


  /*
   * Most scans accepted in one batch request.
   */
  MAX_BATCH_SIZE:
    25

};


/************************************************************
 * ==========================================================
 * GET REQUEST
 * ==========================================================
 *
 * Examples:
 *
 * ?action=ping
 *
 * ?action=sheets
 * &spreadsheetUrl=...
 *
 * ?action=columns
 * &spreadsheetUrl=...
 * &sheetName=Display%201
 *
 * ?action=verifyDestination
 * &spreadsheetUrl=...
 * &sheetName=Display%201
 * &itemCodeColumn=1
 * &timestampEnabled=true
 * &timestampColumn=2
 *
 *
 * JSONP:
 *
 * Same request can include:
 *
 * &callback=scannerCallback123
 *
 ************************************************************/

function doGet(e) {

  try {

    const params =
      e && e.parameter
        ? e.parameter
        : {};


    const action =
      String(
        params.action || 'ping'
      )
      .trim()
      .toLowerCase();


    const callback =
      String(
        params.callback || ''
      )
      .trim();


    /******************************************************
     * PING
     ******************************************************/

    if (
      action === 'ping'
    ) {

      const result = {

        success: true,

        action: 'ping',

        message:
          'Scanner Backend is online.',

        version:
          CONFIG.VERSION,

        googleClientId:
          CONFIG.GOOGLE_CLIENT_ID,

        signInRequired:
          CONFIG.REQUIRE_SIGN_IN,

        timestamp:
          new Date().toISOString()

      };


      return responseForRequest(
        result,
        callback
      );

    }


    /******************************************************
     * STAFF SIGN-IN (Google ID token → phone key)
     ******************************************************/

    if (
      action === 'signin'
    ) {

      return responseForRequest(
        signInResponse(
          params.idToken,
          params.deviceId
        ),
        callback
      );

    }


    /******************************************************
     * SIGN OUT (switch off this phone's key)
     ******************************************************/

    if (
      action === 'signout'
    ) {

      return responseForRequest(
        signOutResponse(params.sessionKey),
        callback
      );

    }


    /******************************************************
     * WHO AM I (is this phone key still valid?)
     ******************************************************/

    if (
      action === 'whoami'
    ) {

      const staff =
        resolveSession(params.sessionKey);

      return responseForRequest(
        {
          success: true,
          name: staff.name,
          gmail: staff.gmail
        },
        callback
      );

    }


    /******************************************************
     * GET SHEET TABS
     ******************************************************/

    if (
      action === 'sheets' ||
      action === 'getsheets'
    ) {

      const response =
        getSheetsResponse(
          params.spreadsheetUrl
        );


      return responseForRequest(
        JSON.parse(
          response.getContent()
        ),
        callback
      );

    }


    /******************************************************
     * GET COLUMNS
     ******************************************************/

    if (
      action === 'columns' ||
      action === 'getcolumns'
    ) {

      const response =
        getColumnsResponse(

          params.spreadsheetUrl,

          params.sheetName

        );


      return responseForRequest(
        JSON.parse(
          response.getContent()
        ),
        callback
      );

    }


    /******************************************************
     * VERIFY DESTINATION
     ******************************************************/

    if (
      action === 'verifydestination'
    ) {

      const response =
        verifyDestinationResponse({

          spreadsheetUrl:
            params.spreadsheetUrl,

          sheetName:
            params.sheetName,

          itemCodeColumn:
            params.itemCodeColumn,

          timestampEnabled:
            params.timestampEnabled,

          timestampColumn:
            params.timestampColumn

        });


      return responseForRequest(
        JSON.parse(
          response.getContent()
        ),
        callback
      );

    }
    /******************************************************
 * SAVE QUEUED SCAN
 ******************************************************
 *
 * Used by the GitHub scanner's background queue.
 *
 * This is intentionally GET + JSONP because the
 * scanner is hosted on GitHub Pages and the Apps Script
 * backend is on another domain.
 *
 ******************************************************/

if (
  action === 'savequeuedscan'
) {

  const result =
    saveQueuedScanResponse({

      scanId:
        params.scanId,

      itemCode:
        params.itemCode,

      spreadsheetUrl:
        params.spreadsheetUrl,

      sheetName:
        params.sheetName,

      itemCodeColumn:
        params.itemCodeColumn,

      timestampEnabled:
        params.timestampEnabled,

      timestampColumn:
        params.timestampColumn,

      deviceId:
        params.deviceId,

      sessionKey:
        params.sessionKey

    });


  return responseForRequest(
    result,
    callback
  );

}


    /******************************************************
     * SAVE MANY QUEUED SCANS (BATCH)
     ******************************************************
     *
     * items = JSON array of [scanId, itemCode, scannedAt]
     *
     ******************************************************/

    if (
      action === 'savequeuedscans'
    ) {

      let items;

      try {

        items = JSON.parse(
          String(params.items || '[]')
        );

      }

      catch (parseError) {

        throw new Error(
          'Batch items could not be read.'
        );

      }

      const result =
        saveScansCore(
          {
            spreadsheetUrl: params.spreadsheetUrl,
            sheetName: params.sheetName,
            itemCodeColumn: params.itemCodeColumn,
            timestampEnabled: params.timestampEnabled,
            timestampColumn: params.timestampColumn,
            deviceId: params.deviceId,
            sessionKey: params.sessionKey
          },
          (Array.isArray(items) ? items : []).map(
            function(entry) {
              return {
                scanId: entry && entry[0],
                itemCode: entry && entry[1],
                scannedAt: entry && entry[2]
              };
            }
          )
        );

      return responseForRequest(
        result,
        callback
      );

    }


    /******************************************************
     * UNKNOWN ACTION
     ******************************************************/

    return responseForRequest(

      {

        success: false,

        error:
          'Unknown GET action: ' +
          action

      },

      callback

    );

  }


  catch (error) {

    return responseForRequest(

      {

        success: false,

        error:
          getErrorMessage(
            error
          )

      },

      e &&
      e.parameter
        ? e.parameter.callback
        : ''

    );

  }

}


/************************************************************
 * ==========================================================
 * POST REQUEST
 * ==========================================================
 *
 * Currently supports:
 *
 * saveScan
 * verifyDestination
 *
 ************************************************************/

function doPost(e) {

  try {

    if (
      !e ||
      !e.postData ||
      !e.postData.contents
    ) {

      throw new Error(
        'No POST data was received.'
      );

    }


    const body =
      JSON.parse(
        e.postData.contents
      );


    const action =
      String(
        body.action || 'saveScan'
      )
      .trim()
      .toLowerCase();


    /******************************************************
     * SAVE SCAN
     ******************************************************/

    if (
      action === 'savescan'
    ) {

      return saveScanResponse(
        body
      );

    }


    /******************************************************
     * VERIFY DESTINATION
     ******************************************************/

    if (
      action === 'verifydestination'
    ) {

      return verifyDestinationResponse(
        body
      );

    }


    throw new Error(
      'Unknown POST action: ' +
      action
    );

  }


  catch (error) {

    return jsonResponse({

      success: false,

      error:
        getErrorMessage(
          error
        )

    });

  }

}


/************************************************************
 * ==========================================================
 * RESPONSE ROUTER
 * ==========================================================
 *
 * If callback exists:
 *
 * callback({...});
 *
 * Otherwise:
 *
 * normal JSON response.
 *
 ************************************************************/

function responseForRequest(
  data,
  callback
) {

  if (
    callback
  ) {

    return jsonpResponse(
      data,
      callback
    );

  }


  return jsonResponse(
    data
  );

}


/************************************************************
 * ==========================================================
 * JSON RESPONSE
 * ==========================================================
 ************************************************************/

function jsonResponse(
  data
) {

  return ContentService

    .createTextOutput(
      JSON.stringify(
        data
      )
    )

    .setMimeType(
      ContentService.MimeType.JSON
    );

}


/************************************************************
 * ==========================================================
 * JSONP RESPONSE
 * ==========================================================
 *
 * Used by GitHub-hosted setup.html.
 *
 ************************************************************/

function jsonpResponse(
  data,
  callback
) {

  const safeCallback =
    String(
      callback || ''
    )
    .trim();


  /*
   * Only allow valid JavaScript function names.
   *
   * This prevents arbitrary JavaScript from being
   * injected through the callback parameter.
   */

  if (
    !/^[A-Za-z_$][0-9A-Za-z_$\.]*$/.test(
      safeCallback
    )
  ) {

    throw new Error(
      'Invalid JSONP callback.'
    );

  }


  return ContentService

    .createTextOutput(

      safeCallback +
      '(' +
      JSON.stringify(
        data
      ) +
      ');'

    )

    .setMimeType(
      ContentService.MimeType.JAVASCRIPT
    );

}


/************************************************************
 * ==========================================================
 * GET SHEETS
 * ==========================================================
 ************************************************************/

function getSheetsResponse(
  spreadsheetUrl
) {

  const spreadsheetId =
    extractSpreadsheetId(
      spreadsheetUrl
    );


  const spreadsheet =
    SpreadsheetApp.openById(
      spreadsheetId
    );


  const sheets =
    spreadsheet
      .getSheets()
      .map(

        function(sheet) {

          return {

            name:
              sheet.getName(),

            gid:
              sheet.getSheetId(),

            index:
              sheet.getIndex()

          };

        }

      );


  return jsonResponse({

    success: true,

    spreadsheetId:
      spreadsheetId,

    spreadsheetName:
      spreadsheet.getName(),

    sheets:
      sheets

  });

}


/************************************************************
 * ==========================================================
 * GET COLUMNS
 * ==========================================================
 ************************************************************/

function getColumnsResponse(

  spreadsheetUrl,

  sheetName

) {

  if (
    !sheetName
  ) {

    throw new Error(
      'Sheet name is required.'
    );

  }


  const spreadsheetId =
    extractSpreadsheetId(
      spreadsheetUrl
    );


  const spreadsheet =
    SpreadsheetApp.openById(
      spreadsheetId
    );


  const sheet =
    spreadsheet.getSheetByName(
      sheetName
    );


  if (!sheet) {

    throw new Error(

      'Sheet tab "' +
      sheetName +
      '" was not found.'

    );

  }


  /*
   * At least one column must be available.
   */

  const lastColumn =
    Math.max(
      sheet.getLastColumn(),
      1
    );


  const headers =
    sheet
      .getRange(

        CONFIG.HEADER_ROW,

        1,

        1,

        lastColumn

      )
      .getDisplayValues()[0];


  const columns = [];


  for (
    let i = 1;
    i <= lastColumn;
    i++
  ) {

    columns.push({

      columnNumber:
        i,

      letter:
        columnNumberToLetter(
          i
        ),

      header:
        String(
          headers[i - 1] || ''
        )
        .trim()

    });

  }


  return jsonResponse({

    success: true,

    spreadsheetId:
      spreadsheetId,

    spreadsheetName:
      spreadsheet.getName(),

    sheetName:
      sheetName,

    columns:
      columns

  });

}


/************************************************************
 * ==========================================================
 * VERIFY DESTINATION
 * ==========================================================
 *
 * IMPORTANT:
 *
 * This function DOES NOT write anything.
 *
 * It only confirms that the selected destination exists
 * and that the selected columns are valid.
 *
 ************************************************************/

function verifyDestinationResponse(
  data
) {

  if (!data) {

    throw new Error(
      'No destination data was received.'
    );

  }


  /******************************************************
   * SPREADSHEET URL
   ******************************************************/

  const spreadsheetUrl =
    String(
      data.spreadsheetUrl || ''
    )
    .trim();


  if (!spreadsheetUrl) {

    throw new Error(
      'Google Sheet link is required.'
    );

  }


  /******************************************************
   * SHEET NAME
   ******************************************************/

  const sheetName =
    String(
      data.sheetName || ''
    )
    .trim();


  if (!sheetName) {

    throw new Error(
      'Sheet tab is required.'
    );

  }


  /******************************************************
   * ITEM CODE COLUMN
   ******************************************************/

  const itemCodeColumn =
    Number(
      data.itemCodeColumn
    );


  if (
    !Number.isInteger(
      itemCodeColumn
    ) ||
    itemCodeColumn < 1
  ) {

    throw new Error(
      'A valid Item Code column is required.'
    );

  }


  /******************************************************
   * TIMESTAMP MODE
   ******************************************************
   *
   * Timestamp is enabled unless explicitly false.
   *
   ******************************************************/

  const timestampEnabled =
    String(
      data.timestampEnabled
    )
    .toLowerCase() !== 'false';


  /******************************************************
   * TIMESTAMP COLUMN
   ******************************************************/

  let timestampColumn =
    null;


  if (
    timestampEnabled
  ) {

    timestampColumn =
      Number(
        data.timestampColumn
      );


    if (
      !Number.isInteger(
        timestampColumn
      ) ||
      timestampColumn < 1
    ) {

      throw new Error(

        'A valid Timestamp column is required when timestamp is enabled.'

      );

    }


    if (
      itemCodeColumn ===
      timestampColumn
    ) {

      throw new Error(

        'Item Code and Timestamp must use different columns.'

      );

    }

  }


  /******************************************************
   * SPREADSHEET ID
   ******************************************************/

  const spreadsheetId =
    extractSpreadsheetId(
      spreadsheetUrl
    );


  /******************************************************
   * OPEN SPREADSHEET
   ******************************************************/

  const spreadsheet =
    SpreadsheetApp.openById(
      spreadsheetId
    );


  /******************************************************
   * FIND SHEET
   ******************************************************/

  const sheet =
    spreadsheet.getSheetByName(
      sheetName
    );


  if (!sheet) {

    throw new Error(

      'Sheet tab "' +
      sheetName +
      '" was not found.'

    );

  }


  /******************************************************
   * AVAILABLE COLUMNS
   ******************************************************/

  const lastColumn =
    Math.max(
      sheet.getLastColumn(),
      1
    );


  if (
    itemCodeColumn >
    lastColumn
  ) {

    throw new Error(

      'Item Code column ' +
      columnNumberToLetter(
        itemCodeColumn
      ) +
      ' does not exist in this sheet.'

    );

  }


  if (
    timestampEnabled &&
    timestampColumn >
    lastColumn
  ) {

    throw new Error(

      'Timestamp column ' +
      columnNumberToLetter(
        timestampColumn
      ) +
      ' does not exist in this sheet.'

    );

  }


  /******************************************************
   * HEADERS
   ******************************************************/

  const headers =
    sheet
      .getRange(

        CONFIG.HEADER_ROW,

        1,

        1,

        lastColumn

      )
      .getDisplayValues()[0];


  /******************************************************
   * ITEM CODE HEADER
   ******************************************************/

  const itemCodeHeader =
    String(
      headers[
        itemCodeColumn - 1
      ] || ''
    )
    .trim();


  /******************************************************
   * TIMESTAMP HEADER
   ******************************************************/

  let timestampHeader =
    '';


  if (
    timestampEnabled
  ) {

    timestampHeader =
      String(
        headers[
          timestampColumn - 1
        ] || ''
      )
      .trim();

  }


  /******************************************************
   * SUCCESS
   ******************************************************/

  return jsonResponse({

    success: true,

    valid: true,

    message:
      'Destination is ready.',

    spreadsheetId:
      spreadsheetId,

    spreadsheetName:
      spreadsheet.getName(),

    sheetName:
      sheet.getName(),

    itemCode: {

      columnNumber:
        itemCodeColumn,

      letter:
        columnNumberToLetter(
          itemCodeColumn
        ),

      header:
        itemCodeHeader

    },

    timestamp:

      timestampEnabled

        ? {

            enabled:
              true,

            columnNumber:
              timestampColumn,

            letter:
              columnNumberToLetter(
                timestampColumn
              ),

            header:
              timestampHeader

          }

        : {

            enabled:
              false

          }

  });

}


/************************************************************
 * ==========================================================
 * SAVE SCAN
 * ==========================================================
 *
 * Every successful scan creates a NEW ROW.
 *
 * Expected data:
 *
 * {
 *
 *   action: "saveScan",
 *
 *   spreadsheetUrl: "...",
 *
 *   sheetName: "Display 1",
 *
 *   itemCodeColumn: 1,
 *
 *   timestampEnabled: true,
 *
 *   timestampColumn: 2,
 *
 *   itemCode: "KA7195"
 *
 * }
 *
 ************************************************************/

function saveScanResponse(
  body
) {

  if (!body) {

    throw new Error(
      'No scan data was received.'
    );

  }


  /******************************************************
   * SPREADSHEET URL
   ******************************************************/

  if (
    !body.spreadsheetUrl
  ) {

    throw new Error(
      'spreadsheetUrl is required.'
    );

  }


  /******************************************************
   * SHEET
   ******************************************************/

  if (
    !body.sheetName
  ) {

    throw new Error(
      'sheetName is required.'
    );

  }


  /******************************************************
   * ITEM CODE
   ******************************************************/

  if (
    !body.itemCode
  ) {

    throw new Error(
      'itemCode is required.'
    );

  }


  const itemCode =
    String(
      body.itemCode
    )
    .trim()
    .toUpperCase();


  /******************************************************
   * VALIDATE KA + 3 TO 5 DIGITS
   ******************************************************/

  if (
    !CONFIG.ITEM_CODE_REGEX.test(
      itemCode
    )
  ) {

    throw new Error(

      'Invalid item code "' +
      itemCode +
      '". Expected KA + 3 to 5 digits.'

    );

  }


  /******************************************************
   * ITEM CODE COLUMN
   ******************************************************/

  const itemCodeColumn =
    Number(
      body.itemCodeColumn || 1
    );


  if (
    !Number.isInteger(
      itemCodeColumn
    ) ||
    itemCodeColumn < 1
  ) {

    throw new Error(
      'Invalid Item Code column.'
    );

  }


  /******************************************************
   * TIMESTAMP MODE
   ******************************************************/

  const timestampEnabled =
    String(
      body.timestampEnabled
    )
    .toLowerCase() !== 'false';


  /******************************************************
   * TIMESTAMP COLUMN
   ******************************************************/

  let timestampColumn =
    null;


  if (
    timestampEnabled
  ) {

    timestampColumn =
      Number(
        body.timestampColumn
      );


    if (
      !Number.isInteger(
        timestampColumn
      ) ||
      timestampColumn < 1
    ) {

      throw new Error(
        'Invalid Timestamp column.'
      );

    }


    if (
      itemCodeColumn ===
      timestampColumn
    ) {

      throw new Error(

        'Item Code and Timestamp must use different columns.'

      );

    }

  }


  /******************************************************
   * OPEN SPREADSHEET
   ******************************************************/

  const spreadsheetId =
    extractSpreadsheetId(
      body.spreadsheetUrl
    );


  const spreadsheet =
    SpreadsheetApp.openById(
      spreadsheetId
    );


  /******************************************************
   * OPEN SHEET
   ******************************************************/

  const sheet =
    spreadsheet.getSheetByName(
      body.sheetName
    );


  if (!sheet) {

    throw new Error(

      'Sheet tab "' +
      body.sheetName +
      '" was not found.'

    );

  }


  /******************************************************
   * LOCK
   *
   * Prevent two phones from writing to the same row
   * simultaneously.
   ******************************************************/

  const lock =
    LockService.getScriptLock();


  lock.waitLock(
    30000
  );


  try {


    /****************************************************
     * RECHECK COLUMNS
     ****************************************************/

    const lastColumn =
      Math.max(
        sheet.getLastColumn(),
        1
      );


    if (
      itemCodeColumn >
      lastColumn
    ) {

      throw new Error(

        'Item Code column ' +
        columnNumberToLetter(
          itemCodeColumn
        ) +
        ' does not exist.'

      );

    }


    if (
      timestampEnabled &&
      timestampColumn >
      lastColumn
    ) {

      throw new Error(

        'Timestamp column ' +
        columnNumberToLetter(
          timestampColumn
        ) +
        ' does not exist.'

      );

    }


    /****************************************************
     * NEXT ROW
     ****************************************************/

    const nextRow =
      findLastDataRow(
        sheet,
        timestampEnabled
          ? [itemCodeColumn, timestampColumn]
          : [itemCodeColumn]
      ) + 1;


    /****************************************************
     * TIMESTAMP
     ****************************************************/

    const timestamp =
      timestampEnabled
        ? new Date()
        : null;


    /****************************************************
     * WRITE ITEM CODE
     ****************************************************/

    const itemCell =
      sheet.getRange(

        nextRow,

        itemCodeColumn

      );


    /*
     * Keep item codes as text.
     */

    itemCell
      .setNumberFormat(
        '@'
      );


    itemCell
      .setValue(
        itemCode
      );


    /****************************************************
     * WRITE TIMESTAMP
     ****************************************************/

    if (
      timestampEnabled
    ) {

      const timestampCell =
        sheet.getRange(

          nextRow,

          timestampColumn

        );


      timestampCell
        .setNumberFormat(

          CONFIG.TIMESTAMP_FORMAT

        );


      timestampCell
        .setValue(
          timestamp
        );

    }


    SpreadsheetApp.flush();


    /****************************************************
     * SUCCESS
     ****************************************************/

    return jsonResponse({

      success: true,

      message:
        'Scan saved successfully.',

      itemCode:
        itemCode,

      timestamp:

        timestampEnabled

          ? Utilities.formatDate(

              timestamp,

              Session.getScriptTimeZone(),

              CONFIG.TIMESTAMP_FORMAT

            )

          : null,

      row:
        nextRow,

      spreadsheetId:
        spreadsheetId,

      spreadsheetName:
        spreadsheet.getName(),

      sheetName:
        sheet.getName(),

      itemCodeColumn:
        itemCodeColumn,

      itemCodeColumnLetter:
        columnNumberToLetter(
          itemCodeColumn
        ),

      timestampEnabled:
        timestampEnabled,

      timestampColumn:

        timestampEnabled
          ? timestampColumn
          : null,

      timestampColumnLetter:

        timestampEnabled
          ? columnNumberToLetter(
              timestampColumn
            )
          : null

    });

  }


  finally {

    lock.releaseLock();

  }

}



/************************************************************
 * ==========================================================
 * SAVE QUEUED SCAN (ONE) — used by older scanner pages
 * ==========================================================
 ************************************************************/

function saveQueuedScanResponse(
  data
) {

  const result =
    saveScansCore(
      data,
      [
        {
          scanId: data.scanId,
          itemCode: data.itemCode,
          scannedAt: data.scannedAt
        }
      ]
    );

  const first =
    result.results && result.results[0];

  if (
    !first ||
    !first.success
  ) {

    return {

      success: false,

      error:
        first && first.error
          ? first.error
          : (result.error || 'Scan was not saved.')

    };

  }

  return {

    success: true,

    message:
      first.duplicate
        ? 'Scan was already saved.'
        : 'Scan saved successfully.',

    scanId:
      first.scanId,

    itemCode:
      first.itemCode,

    row:
      first.row,

    duplicate:
      Boolean(first.duplicate),

    sheetName:
      result.sheetName

  };

}


/************************************************************
 * ==========================================================
 * SAVE SCANS — CORE (one or many)
 * ==========================================================
 *
 * Writes every valid, not-yet-saved scan as a NEW ROW, all
 * at once, under a lock.
 *
 * Replies success for a scan ONLY after the row is written
 * and flushed to the sheet. The scanner's success sound
 * depends on this.
 *
 * Duplicate guard:
 * every saved scanId is remembered for 6 hours. If the
 * phone retries a scan that was already written (because
 * Google's reply was slow or lost), it is NOT written
 * again — the reply says duplicate: true, success: true.
 *
 ************************************************************/

function saveScansCore(
  destination,
  items
) {

  /******************************************************
   * DESTINATION
   ******************************************************/

  const spreadsheetUrl =
    String(destination.spreadsheetUrl || '').trim();

  const sheetName =
    String(destination.sheetName || '').trim();

  const itemCodeColumn =
    Number(destination.itemCodeColumn || 1);

  const timestampEnabled =
    String(destination.timestampEnabled).toLowerCase() !== 'false';

  const timestampColumn =
    timestampEnabled
      ? Number(destination.timestampColumn)
      : null;

  const deviceId =
    String(destination.deviceId || '').trim().substring(0, 60);


  /*
   * WHO IS SCANNING — from the phone's sign-in key.
   */
  let staff =
    null;

  if (destination.sessionKey) {

    staff =
      resolveSession(destination.sessionKey, deviceId);

  }

  else if (CONFIG.REQUIRE_SIGN_IN) {

    throw new Error(
      'NOT_SIGNED_IN: This phone is not signed in. Sign in with your Gmail.'
    );

  }


  if (!spreadsheetUrl) {
    throw new Error('spreadsheetUrl is required.');
  }

  if (!sheetName) {
    throw new Error('sheetName is required.');
  }

  if (
    !Number.isInteger(itemCodeColumn) ||
    itemCodeColumn < 1
  ) {
    throw new Error('Invalid Item Code column.');
  }

  if (timestampEnabled) {

    if (
      !Number.isInteger(timestampColumn) ||
      timestampColumn < 1
    ) {
      throw new Error('Invalid Timestamp column.');
    }

    if (itemCodeColumn === timestampColumn) {
      throw new Error('Item Code and Timestamp must use different columns.');
    }

  }


  if (
    !Array.isArray(items) ||
    items.length === 0
  ) {
    throw new Error('No scans were received.');
  }

  if (items.length > CONFIG.MAX_BATCH_SIZE) {
    throw new Error(
      'Too many scans in one request (max ' +
      CONFIG.MAX_BATCH_SIZE + ').'
    );
  }


  /******************************************************
   * VALIDATE EACH SCAN (before opening anything)
   ******************************************************/

  const results = [];

  const toCheck = [];

  const seenInBatch = {};


  items.forEach(function(raw) {

    const scanId =
      String(raw && raw.scanId || '').trim();

    const itemCode =
      String(raw && raw.itemCode || '').trim().toUpperCase();

    const result = {
      scanId: scanId,
      itemCode: itemCode,
      success: false
    };

    results.push(result);

    if (!scanId || scanId.length > 200) {
      result.error = 'Missing or invalid scanId.';
      return;
    }

    if (!CONFIG.ITEM_CODE_REGEX.test(itemCode)) {
      result.error =
        'Invalid item code "' + itemCode + '". Expected KA + 3 to 5 digits.';
      result.permanent = true;
      return;
    }

    /* Same scan twice in one request → write once. */
    if (seenInBatch[scanId]) {
      result.sameAs = seenInBatch[scanId];
      return;
    }

    seenInBatch[scanId] = result;

    result.timestamp =
      chooseScanTimestamp(raw && raw.scannedAt);

    toCheck.push(result);

  });


  /******************************************************
   * OPEN SHEET
   ******************************************************/

  const spreadsheetId =
    extractSpreadsheetId(spreadsheetUrl);

  const spreadsheet =
    SpreadsheetApp.openById(spreadsheetId);

  const sheet =
    spreadsheet.getSheetByName(sheetName);

  if (!sheet) {
    throw new Error('Sheet tab "' + sheetName + '" was not found.');
  }


  const cache =
    CacheService.getScriptCache();


  /******************************************************
   * LOCK — one writer at a time (all phones)
   ******************************************************/

  const lock =
    LockService.getScriptLock();

  lock.waitLock(30000);

  try {

    /****************************************************
     * DUPLICATE GUARD
     ****************************************************/

    const cacheKeys =
      toCheck.map(function(result) {
        return 'scan:' + result.scanId;
      });

    const already =
      cacheKeys.length
        ? cache.getAll(cacheKeys)
        : {};

    const toWrite = [];

    toCheck.forEach(function(result) {

      const previous =
        already['scan:' + result.scanId];

      if (previous) {

        let info = {};

        try { info = JSON.parse(previous); } catch (e) { info = {}; }

        result.success = true;
        result.duplicate = true;
        result.row = info.row || null;

      }

      else {

        toWrite.push(result);

      }

    });


    if (toWrite.length > 0) {

      /**************************************************
       * COLUMNS STILL EXIST?
       **************************************************/

      const lastColumn =
        Math.max(sheet.getLastColumn(), 1);

      if (itemCodeColumn > lastColumn) {
        throw new Error(
          'Item Code column ' + columnNumberToLetter(itemCodeColumn) +
          ' does not exist.'
        );
      }

      if (timestampEnabled && timestampColumn > lastColumn) {
        throw new Error(
          'Timestamp column ' + columnNumberToLetter(timestampColumn) +
          ' does not exist.'
        );
      }


      /**************************************************
       * NEXT ROW — from OUR columns only
       **************************************************/

      const firstRow =
        findLastDataRow(
          sheet,
          timestampEnabled
            ? [itemCodeColumn, timestampColumn]
            : [itemCodeColumn]
        ) + 1;

      const count =
        toWrite.length;


      /* Make room if the tab is full. */
      const lastNeededRow =
        firstRow + count - 1;

      if (lastNeededRow > sheet.getMaxRows()) {

        sheet.insertRowsAfter(
          sheet.getMaxRows(),
          lastNeededRow - sheet.getMaxRows() + 100
        );

        /* New rows → re-check the column protection now. */
        cache.remove(
          'protected:' + spreadsheetId + ':' + sheet.getSheetId() + ':' +
          (timestampEnabled
            ? [itemCodeColumn, timestampColumn]
            : [itemCodeColumn]).join(',')
        );

      }


      /**************************************************
       * WRITE ALL ROWS AT ONCE
       **************************************************/

      const itemRange =
        sheet.getRange(firstRow, itemCodeColumn, count, 1);

      itemRange.setNumberFormat('@');

      itemRange.setValues(
        toWrite.map(function(result) {
          return [result.itemCode];
        })
      );

      if (timestampEnabled) {

        const timestampRange =
          sheet.getRange(firstRow, timestampColumn, count, 1);

        timestampRange.setNumberFormat(CONFIG.TIMESTAMP_FORMAT);

        timestampRange.setValues(
          toWrite.map(function(result) {
            return [result.timestamp];
          })
        );

      }


      /**************************************************
       * BY (NAME, GMAIL) — if the tab has that column
       **************************************************/

      const byColumn =
        staff
          ? findByColumn(sheet)
          : 0;

      if (
        byColumn &&
        byColumn !== itemCodeColumn &&
        byColumn !== timestampColumn
      ) {

        const byText =
          staff.name + ', ' + staff.gmail;

        sheet
          .getRange(firstRow, byColumn, count, 1)
          .setValues(
            toWrite.map(function() {
              return [byText];
            })
          );

      }


      /**************************************************
       * SCAN LOG + PROTECTION
       *
       * Never allowed to fail the save itself — the rows
       * above are already written.
       **************************************************/

      const savedAt =
        new Date();

      try {

        appendToScanLog(
          spreadsheet,
          toWrite.map(function(result, index) {
            return [
              savedAt,
              result.timestamp,
              result.itemCode,
              sheet.getName(),
              firstRow + index,
              result.scanId,
              deviceId,
              CONFIG.VERSION,
              staff ? staff.name : '',
              staff ? staff.gmail : ''
            ];
          })
        );

      }

      catch (logError) {

        console.error('Scan log error: ' + logError);

      }

      try {

        const protectColumns =
          timestampEnabled
            ? [itemCodeColumn, timestampColumn]
            : [itemCodeColumn];

        if (
          byColumn &&
          protectColumns.indexOf(byColumn) === -1
        ) {
          protectColumns.push(byColumn);
        }

        ensureScannerColumnsProtected(
          spreadsheetId,
          sheet,
          protectColumns,
          cache
        );

      }

      catch (protectError) {

        console.error('Protection error: ' + protectError);

      }


      /* Make sure it is really in the sheet before replying. */
      SpreadsheetApp.flush();


      /**************************************************
       * REMEMBER SAVED scanIds
       **************************************************/

      const remember = {};

      toWrite.forEach(function(result, index) {

        result.success = true;
        result.row = firstRow + index;

        remember['scan:' + result.scanId] =
          JSON.stringify({ row: result.row, sheet: sheetName });

      });

      try {

        cache.putAll(remember, CONFIG.DUPLICATE_GUARD_SECONDS);

      }

      catch (cacheError) {

        console.error('Duplicate guard cache error: ' + cacheError);

      }

    }

  }

  finally {

    lock.releaseLock();

  }


  /******************************************************
   * Same-scan-twice entries copy the first one's result.
   ******************************************************/

  results.forEach(function(result) {

    if (result.sameAs) {

      result.success = result.sameAs.success;
      result.duplicate = true;
      result.row = result.sameAs.row;
      result.error = result.sameAs.error;

      delete result.sameAs;

    }

    delete result.timestamp;

  });


  const savedCount =
    results.filter(function(result) {
      return result.success;
    }).length;


  return {

    success: true,

    serverVersion: CONFIG.VERSION,

    saved: savedCount,

    total: results.length,

    sheetName: sheet.getName(),

    staffName: staff ? staff.name : '',

    results: results

  };

}




/************************************************************
 * ==========================================================
 * STAFF SIGN-IN
 * ==========================================================
 *
 * 1. The phone signs in with Google and sends us Google's
 *    ID token.
 * 2. We ask Google to confirm the token is genuine, was made
 *    for OUR app (Client ID), and the Gmail is verified.
 * 3. The Gmail must be in the STAFF tab with ACTIVE = YES.
 * 4. We create a long random key for that phone, store only
 *    its fingerprint (hash) in _STAFF_SESSIONS, and give the
 *    key to the phone. Every scan sends that key.
 *
 * Remove access: set ACTIVE = NO in STAFF (all their phones)
 * or ACTIVE (column F) = NO on a row in _STAFF_SESSIONS
 * (one phone).
 *
 ************************************************************/

function signInResponse(
  idToken,
  deviceId
) {

  if (/PASTE-YOUR-CLIENT-ID/.test(CONFIG.GOOGLE_CLIENT_ID)) {
    throw new Error(
      'Sign-in is not set up yet: paste the Google Client ID into CONFIG.GOOGLE_CLIENT_ID.'
    );
  }

  const token =
    String(idToken || '').trim();

  if (!token) {
    throw new Error('No Google sign-in was received.');
  }

  /*
   * Ask Google to verify the token.
   */
  const response =
    UrlFetchApp.fetch(
      'https://oauth2.googleapis.com/tokeninfo?id_token=' +
        encodeURIComponent(token),
      { muteHttpExceptions: true }
    );

  if (response.getResponseCode() !== 200) {
    throw new Error('Google could not confirm this sign-in. Please try again.');
  }

  const info =
    JSON.parse(response.getContentText());

  if (info.aud !== CONFIG.GOOGLE_CLIENT_ID) {
    throw new Error('This sign-in was not made for the scanner.');
  }

  if (
    info.iss !== 'accounts.google.com' &&
    info.iss !== 'https://accounts.google.com'
  ) {
    throw new Error('Sign-in did not come from Google.');
  }

  if (String(info.email_verified) !== 'true') {
    throw new Error('This Gmail address is not verified by Google.');
  }

  if (Number(info.exp) * 1000 < Date.now()) {
    throw new Error('Sign-in expired. Please sign in again.');
  }

  const gmail =
    String(info.email || '').trim().toLowerCase();


  /*
   * Must be active staff.
   */
  const member =
    getStaffByGmail(gmail, true);

  if (!member) {
    throw new Error(
      gmail + ' is not on the STAFF list (or ACTIVE is not YES). Ask the owner to add you.'
    );
  }


  /*
   * New key for this phone.
   */
  const sessionKey =
    Utilities.getUuid().replace(/-/g, '') +
    Utilities.getUuid().replace(/-/g, '');

  const sessions =
    getSessionsSheet();

  const lock =
    LockService.getScriptLock();

  lock.waitLock(30000);

  try {

    sessions.appendRow([
      hashSessionKey(sessionKey),
      gmail,
      member.name,
      String(deviceId || '').substring(0, 60),
      new Date(),
      'YES',
      ''
    ]);

  }

  finally {

    lock.releaseLock();

  }

  return {

    success: true,

    sessionKey: sessionKey,

    name: member.name,

    gmail: gmail

  };

}


function signOutResponse(
  sessionKey
) {

  const key =
    String(sessionKey || '').trim();

  if (!key) {
    return { success: true };
  }

  const hash =
    hashSessionKey(key);

  const sheet =
    getSessionsSheet();

  const lock =
    LockService.getScriptLock();

  lock.waitLock(30000);

  try {

    const lastRow =
      sheet.getLastRow();

    if (lastRow >= 2) {

      const hashes =
        sheet.getRange(2, 1, lastRow - 1, 1).getValues();

      for (let i = 0; i < hashes.length; i++) {

        if (hashes[i][0] === hash) {

          sheet.getRange(i + 2, 6, 1, 2).setValues([['NO', 'Signed out on the phone']]);

        }

      }

    }

  }

  finally {

    lock.releaseLock();

  }

  CacheService.getScriptCache().remove('session:' + hash);

  return { success: true };

}


/*
 * Phone key → { name, gmail }. Throws NOT_SIGNED_IN if the
 * key is unknown, switched off, or the staff member is no
 * longer active.
 */
function resolveSession(
  sessionKey,
  deviceId
) {

  const key =
    String(sessionKey || '').trim();

  if (!key) {
    throw new Error('NOT_SIGNED_IN: This phone is not signed in.');
  }

  const hash =
    hashSessionKey(key);

  const cache =
    CacheService.getScriptCache();

  const cacheKey =
    'session:' + hash;

  let session =
    null;

  const cached =
    cache.get(cacheKey);

  if (cached) {

    session = JSON.parse(cached);

  }

  else {

    const sheet =
      getSessionsSheet();

    const lastRow =
      sheet.getLastRow();

    if (lastRow >= 2) {

      const rows =
        sheet.getRange(2, 1, lastRow - 1, 7).getValues();

      for (let i = rows.length - 1; i >= 0; i--) {

        if (rows[i][0] === hash) {

          session = {
            gmail: String(rows[i][1]).toLowerCase(),
            active: String(rows[i][5]).trim().toUpperCase() === 'YES'
          };

          break;

        }

      }

    }

    if (session) {
      /* Short cache, so switching a phone off works within 5 min. */
      cache.put(cacheKey, JSON.stringify(session), 300);
    }

  }

  if (!session || !session.active) {
    throw new Error(
      'NOT_SIGNED_IN: This phone was signed out. Sign in with your Gmail again.'
    );
  }

  const member =
    getStaffByGmail(session.gmail, true);

  if (!member) {
    throw new Error(
      'NOT_SIGNED_IN: ' + session.gmail + ' is no longer active on the STAFF list.'
    );
  }

  return {
    name: member.name,
    gmail: session.gmail
  };

}


/*
 * Read the STAFF tab (cached 5 minutes).
 */
function getStaffByGmail(
  gmail,
  activeOnly
) {

  const cache =
    CacheService.getScriptCache();

  let list =
    null;

  const cached =
    cache.get('staff-list');

  if (cached) {

    list = JSON.parse(cached);

  }

  else {

    const sheet =
      SpreadsheetApp
        .openById(CONFIG.STAFF_SPREADSHEET_ID)
        .getSheetByName(CONFIG.STAFF_SHEET_NAME);

    if (!sheet) {
      throw new Error('The STAFF tab was not found.');
    }

    const lastRow =
      sheet.getLastRow();

    const rows =
      lastRow >= 2
        ? sheet.getRange(2, 1, lastRow - 1, 3).getDisplayValues()
        : [];

    list =
      rows
        .filter(function(row) {
          return String(row[1]).trim() !== '';
        })
        .map(function(row) {
          return {
            name: String(row[0]).trim(),
            gmail: String(row[1]).trim().toLowerCase(),
            active: String(row[2]).trim().toUpperCase() === 'YES'
          };
        });

    cache.put('staff-list', JSON.stringify(list), 300);

  }

  const target =
    String(gmail || '').trim().toLowerCase();

  const member =
    list.find(function(item) {
      return item.gmail === target;
    });

  if (!member) {
    return null;
  }

  if (activeOnly && !member.active) {
    return null;
  }

  return member;

}


function hashSessionKey(
  key
) {

  return Utilities
    .computeDigest(
      Utilities.DigestAlgorithm.SHA_256,
      String(key),
      Utilities.Charset.UTF_8
    )
    .map(function(byte) {
      return ('0' + (byte & 0xff).toString(16)).slice(-2);
    })
    .join('');

}


function getSessionsSheet() {

  const spreadsheet =
    SpreadsheetApp.openById(CONFIG.STAFF_SPREADSHEET_ID);

  let sheet =
    spreadsheet.getSheetByName(CONFIG.SESSIONS_SHEET_NAME);

  if (!sheet) {

    sheet =
      spreadsheet.insertSheet(CONFIG.SESSIONS_SHEET_NAME);

    sheet
      .getRange(1, 1, 1, 7)
      .setValues([[
        'KEY FINGERPRINT (not the key)',
        'GMAIL',
        'STAFF NAME',
        'PHONE',
        'SIGNED IN',
        'ACTIVE (YES/NO)',
        'NOTE'
      ]])
      .setFontWeight('bold');

    sheet.setFrozenRows(1);

    try {

      restrictProtectionToOwner(
        sheet.protect().setDescription('Staff phone sign-ins — owner only')
      );

    }

    catch (error) {

      console.error('Sessions protection error: ' + error);

    }

    sheet.hideSheet();

  }

  return sheet;

}


/*
 * Column whose header starts with "BY" (e.g. "BY (NAME, GMAIL)").
 * Returns 0 if the tab has none.
 */
function findByColumn(
  sheet
) {

  const lastColumn =
    Math.max(sheet.getLastColumn(), 1);

  const headers =
    sheet
      .getRange(CONFIG.HEADER_ROW, 1, 1, lastColumn)
      .getDisplayValues()[0];

  const prefix =
    CONFIG.BY_HEADER_PREFIX.toUpperCase();

  for (let i = 0; i < headers.length; i++) {

    const header =
      String(headers[i]).trim().toUpperCase();

    if (
      header === prefix ||
      header.indexOf(prefix + ' ') === 0 ||
      header.indexOf(prefix + '(') === 0
    ) {
      return i + 1;
    }

  }

  return 0;

}

/************************************************************
 * ==========================================================
 * _SCAN_LOG — HIDDEN, APPEND-ONLY RECORD
 * ==========================================================
 *
 * One line per saved scan. Only this script writes here;
 * the tab is hidden and protected (owner only). If rows in
 * a display tab are ever deleted or sorted by mistake, this
 * log still shows every scan: what, when, where, which phone.
 *
 ************************************************************/

const SCAN_LOG_HEADERS = [
  'SAVED AT',
  'SCANNED AT',
  'ITEM CODE',
  'TAB',
  'ROW',
  'SCAN ID',
  'PHONE',
  'SERVER VERSION',
  'STAFF NAME',
  'STAFF GMAIL'
];


function appendToScanLog(
  spreadsheet,
  rows
) {

  if (!rows.length) {
    return;
  }

  let log =
    spreadsheet.getSheetByName(CONFIG.SCAN_LOG_SHEET_NAME);

  if (!log) {

    log =
      spreadsheet.insertSheet(CONFIG.SCAN_LOG_SHEET_NAME);

    log
      .getRange(1, 1, 1, SCAN_LOG_HEADERS.length)
      .setValues([SCAN_LOG_HEADERS])
      .setFontWeight('bold');

    log.setFrozenRows(1);

    log.getRange('A:B').setNumberFormat(CONFIG.TIMESTAMP_FORMAT);

    log.getRange('C:C').setNumberFormat('@');

    try {

      const protection =
        log.protect().setDescription(
          'Scanner log — written by the scanner only'
        );

      restrictProtectionToOwner(protection);

    }

    catch (error) {

      console.error('Scan log protection error: ' + error);

    }

    log.hideSheet();

  }

  /* Logs made by version 2.1 have 8 columns — add the rest. */
  if (log.getRange(1, SCAN_LOG_HEADERS.length).getValue() === '') {

    if (log.getMaxColumns() < SCAN_LOG_HEADERS.length) {
      log.insertColumnsAfter(
        log.getMaxColumns(),
        SCAN_LOG_HEADERS.length - log.getMaxColumns()
      );
    }

    log
      .getRange(1, 1, 1, SCAN_LOG_HEADERS.length)
      .setValues([SCAN_LOG_HEADERS])
      .setFontWeight('bold');

  }

  const start =
    log.getLastRow() + 1;

  if (start + rows.length - 1 > log.getMaxRows()) {
    log.insertRowsAfter(
      log.getMaxRows(),
      rows.length + 500
    );
  }

  log
    .getRange(start, 1, rows.length, rows[0].length)
    .setValues(rows);

}


/************************************************************
 * ==========================================================
 * PROTECT THE SCANNER COLUMNS
 * ==========================================================
 *
 * Protects e.g. A2:A and B2:B (open-ended, so new rows are
 * covered too). Only the spreadsheet owner and this script
 * can edit them; staff can still view, sort views, filter.
 *
 * Checked at most every 6 hours per tab (cached), so it
 * does not slow scanning down.
 *
 ************************************************************/

function ensureScannerColumnsProtected(
  spreadsheetId,
  sheet,
  columns,
  cache
) {

  if (!CONFIG.PROTECT_SCANNER_COLUMNS) {
    return;
  }

  const cacheKey =
    'protected:' + spreadsheetId + ':' + sheet.getSheetId() + ':' + columns.join(',');

  if (cache.get(cacheKey)) {
    return;
  }

  const description =
    'Scanner column — written by the scanner only';

  const maxRows =
    sheet.getMaxRows();

  const ours =
    sheet
      .getProtections(SpreadsheetApp.ProtectionType.RANGE)
      .filter(function(protection) {
        return protection.getDescription() === description;
      });

  columns.forEach(function(column) {

    const current =
      ours.filter(function(protection) {
        return protection.getRange().getColumn() === column;
      });

    /* Already protected down to the last row of the tab? */
    const covered =
      current.some(function(protection) {
        return protection.getRange().getLastRow() >= maxRows;
      });

    if (covered) {
      return;
    }

    /* The tab grew — replace the old, shorter protection. */
    current.forEach(function(protection) {
      protection.remove();
    });

    const protection =
      sheet
        .getRange(
          CONFIG.HEADER_ROW + 1,
          column,
          maxRows - CONFIG.HEADER_ROW,
          1
        )
        .protect()
        .setDescription(description);

    restrictProtectionToOwner(protection);

  });

  cache.put(cacheKey, '1', CONFIG.DUPLICATE_GUARD_SECONDS);

}


function restrictProtectionToOwner(
  protection
) {

  /*
   * Google's documented pattern: keep the account running
   * this script as an editor, remove everyone else. The
   * spreadsheet owner can always edit.
   */
  protection.addEditor(
    Session.getEffectiveUser()
  );

  const editors =
    protection.getEditors();

  if (editors.length) {
    protection.removeEditors(editors);
  }

  if (protection.canDomainEdit()) {
    protection.setDomainEdit(false);
  }

}

/************************************************************
 * ==========================================================
 * TIMESTAMP FOR A SCAN
 * ==========================================================
 *
 * Use the time the item was actually scanned on the phone,
 * so a scan that waited for Wi-Fi still shows the real
 * scan time. Fall back to "now" if the phone's time looks
 * wrong (missing, in the future, or older than 7 days).
 *
 ************************************************************/

function chooseScanTimestamp(
  scannedAt
) {

  const now =
    new Date();

  if (!scannedAt) {
    return now;
  }

  const time =
    new Date(String(scannedAt));

  if (isNaN(time.getTime())) {
    return now;
  }

  const ageMs =
    now.getTime() - time.getTime();

  if (
    ageMs < -5 * 60 * 1000 ||
    ageMs > 7 * 24 * 60 * 60 * 1000
  ) {
    return now;
  }

  return time;

}


/************************************************************
 * ==========================================================
 * LAST USED ROW IN THE GIVEN COLUMNS
 * ==========================================================
 *
 * Only looks at the Item Code / Timestamp columns, so a
 * formula or note further down in another column can't push
 * new scans to the bottom of the sheet.
 *
 ************************************************************/

function findLastDataRow(
  sheet,
  columns
) {

  const lastRow =
    sheet.getLastRow();

  if (lastRow <= CONFIG.HEADER_ROW) {
    return CONFIG.HEADER_ROW;
  }

  const height =
    lastRow - CONFIG.HEADER_ROW;

  let found =
    CONFIG.HEADER_ROW;

  columns.forEach(function(column) {

    const values =
      sheet
        .getRange(CONFIG.HEADER_ROW + 1, column, height, 1)
        .getValues();

    for (let i = values.length - 1; i >= 0; i--) {

      if (
        values[i][0] !== '' &&
        values[i][0] !== null
      ) {

        found =
          Math.max(found, CONFIG.HEADER_ROW + 1 + i);

        break;

      }

    }

  });

  return found;

}

/************************************************************
 * ==========================================================
 * EXTRACT SPREADSHEET ID
 * ==========================================================
 ************************************************************/

function extractSpreadsheetId(
  spreadsheetUrl
) {

  const value =
    String(
      spreadsheetUrl || ''
    )
    .trim();


  if (!value) {

    throw new Error(
      'Google Sheet URL is empty.'
    );

  }


  /******************************************************
   * GOOGLE SHEETS URL
   ******************************************************/

  const match =
    value.match(

      /\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/

    );


  if (match) {

    return match[1];

  }


  /******************************************************
   * DIRECT SPREADSHEET ID
   ******************************************************/

  if (
    /^[a-zA-Z0-9-_]+$/.test(
      value
    )
  ) {

    return value;

  }


  throw new Error(

    'Could not extract Spreadsheet ID from the provided Google Sheet link.'

  );

}


/************************************************************
 * ==========================================================
 * COLUMN NUMBER → LETTER
 * ==========================================================
 ************************************************************/

function columnNumberToLetter(
  columnNumber
) {

  let letter =
    '';

  let number =
    Number(
      columnNumber
    );


  while (
    number > 0
  ) {

    const remainder =
      (number - 1) % 26;


    letter =
      String.fromCharCode(
        65 + remainder
      ) +
      letter;


    number =
      Math.floor(
        (number - 1) / 26
      );

  }


  return letter;

}


/************************************************************
 * ==========================================================
 * ERROR MESSAGE
 * ==========================================================
 ************************************************************/

function getErrorMessage(
  error
) {

  if (
    error &&
    error.message
  ) {

    return String(
      error.message
    );

  }


  return String(
    error ||
    'Unknown error.'
  );

}


/************************************************************
 * ==========================================================
 * TEST — PING
 * ==========================================================
 ************************************************************/

function testPing() {

  const result = {

    success:
      true,

    message:
      'Scanner Backend V1 is working.',

    timestamp:
      new Date().toISOString()

  };


  Logger.log(
    JSON.stringify(
      result,
      null,
      2
    )
  );


  return result;

}


/************************************************************
 * ==========================================================
 * TEST — VERIFY WITH TIMESTAMP
 * ==========================================================
 *
 * DOES NOT WRITE TO SHEET.
 *
 ************************************************************/

function testVerifyDestination() {

  const testData = {

    spreadsheetUrl:

      'https://docs.google.com/spreadsheets/d/1YW50gqsr5eEQu5ouhn-tU_5SjqJJga4Enq_GQSIcgbk/edit',

    sheetName:
      'Display 1',

    itemCodeColumn:
      1,

    timestampEnabled:
      true,

    timestampColumn:
      2

  };


  const response =
    verifyDestinationResponse(
      testData
    );


  Logger.log(
    response.getContent()
  );


  return response;

}


/************************************************************
 * ==========================================================
 * TEST — VERIFY WITHOUT TIMESTAMP
 * ==========================================================
 *
 * DOES NOT WRITE TO SHEET.
 *
 ************************************************************/

function testVerifyDestinationNoTimestamp() {

  const testData = {

    spreadsheetUrl:

      'https://docs.google.com/spreadsheets/d/1YW50gqsr5eEQu5ouhn-tU_5SjqJJga4Enq_GQSIcgbk/edit',

    sheetName:
      'Display 1',

    itemCodeColumn:
      1,

    timestampEnabled:
      false

  };


  const response =
    verifyDestinationResponse(
      testData
    );


  Logger.log(
    response.getContent()
  );


  return response;

}


/************************************************************
 * ==========================================================
 * TEST — SAVE WITH TIMESTAMP
 * ==========================================================
 *
 * WARNING:
 * THIS WRITES A NEW ROW.
 *
 ************************************************************/

function testSaveScan() {

  const testData = {

    action:
      'saveScan',

    spreadsheetUrl:

      'https://docs.google.com/spreadsheets/d/1YW50gqsr5eEQu5ouhn-tU_5SjqJJga4Enq_GQSIcgbk/edit',

    sheetName:
      'Display 1',

    itemCodeColumn:
      1,

    timestampEnabled:
      true,

    timestampColumn:
      2,

    itemCode:
      'KA7195'

  };


  const response =
    saveScanResponse(
      testData
    );


  Logger.log(
    response.getContent()
  );


  return response;

}


/************************************************************
 * ==========================================================
 * TEST — SAVE WITHOUT TIMESTAMP
 * ==========================================================
 *
 * WARNING:
 * THIS WRITES A NEW ROW.
 *
 ************************************************************/

function testSaveScanNoTimestamp() {

  const testData = {

    action:
      'saveScan',

    spreadsheetUrl:

      'https://docs.google.com/spreadsheets/d/1YW50gqsr5eEQu5ouhn-tU_5SjqJJga4Enq_GQSIcgbk/edit',

    sheetName:
      'Display 1',

    itemCodeColumn:
      1,

    timestampEnabled:
      false,

    itemCode:
      'KA7195'

  };


  const response =
    saveScanResponse(
      testData
    );


  Logger.log(
    response.getContent()
  );


  return response;

}


/************************************************************
 * ==========================================================
 * TEST — GET SHEETS
 * ==========================================================
 *
 * DOES NOT WRITE TO SHEET.
 *
 ************************************************************/

function testGetSheets() {

  const spreadsheetUrl =

    'https://docs.google.com/spreadsheets/d/1YW50gqsr5eEQu5ouhn-tU_5SjqJJga4Enq_GQSIcgbk/edit';


  const response =
    getSheetsResponse(
      spreadsheetUrl
    );


  Logger.log(
    response.getContent()
  );


  return response;

}


/************************************************************
 * ==========================================================
 * TEST — GET COLUMNS
 * ==========================================================
 *
 * DOES NOT WRITE TO SHEET.
 *
 ************************************************************/

function testGetColumns() {

  const spreadsheetUrl =

    'https://docs.google.com/spreadsheets/d/1YW50gqsr5eEQu5ouhn-tU_5SjqJJga4Enq_GQSIcgbk/edit';


  const sheetName =
    'Display 1';


  const response =
    getColumnsResponse(

      spreadsheetUrl,

      sheetName

    );


  Logger.log(
    response.getContent()
  );


  return response;

}