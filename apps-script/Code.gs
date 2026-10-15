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
 * ✓ Staff register their own phone with a personal staff
 *   code (kept in an owner-only spreadsheet) + PIN; every
 *   scan records who scanned it
 * ✓ Optional Scanner Name column, chosen in Destination
 *   Setup like Item Code / Timestamp
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
    '3.4.0',


  /*
   * ── STAFF REGISTRATION ──────────────────────────────────
   *
   * Each staff member has one secret code (like a password)
   * to register their own phone. Codes live ONLY in a private
   * spreadsheet in the owner's Drive, created by running
   * setupStaffCodes() once. Never in the shared logbook.
   */
  CODES_SPREADSHEET_NAME:
    'SCANNER STAFF CODES (PRIVATE)',

  CODES_SHEET_NAME:
    'CODES',

  /* Wrong codes allowed per phone before a 15-minute wait. */
  MAX_CODE_TRIES_PER_PHONE:
    5,

  /* Wrong codes allowed from ALL phones together per 15 min. */
  MAX_CODE_TRIES_TOTAL:
    30,


  /*
   * Only staff listed in this tab with ACTIVE = YES can
   * register a phone and scan.
   * Columns: A STAFF NAME, B GMAIL, C ACTIVE (YES/NO).
   */
  STAFF_SPREADSHEET_ID:
    '1YW50gqsr5eEQu5ouhn-tU_5SjqJJga4Enq_GQSIcgbk',

  STAFF_SHEET_NAME:
    'STAFF',


  /*
   * Hidden tab listing every registered phone. Set a row's
   * ACTIVE to NO to sign that one phone out.
   */
  SESSIONS_SHEET_NAME:
    '_STAFF_SESSIONS',


  /*
   * true  = scans are only saved from a registered staff phone
   * false = scans from unregistered phones are still accepted
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
     * STAFF CODE — check (shows whose code it is)
     ******************************************************/

    if (
      action === 'checkcode'
    ) {

      return responseForRequest(
        checkCodeResponse(
          params.code,
          params.deviceId
        ),
        callback
      );

    }


    /******************************************************
     * STAFF CODE — register this phone
     ******************************************************/

    if (
      action === 'registerphone'
    ) {

      return responseForRequest(
        registerPhoneResponse(
          params.code,
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
            params.timestampColumn,

          nameColumn:
            params.nameColumn

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
        params.sessionKey,

      nameColumn:
        params.nameColumn

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
            sessionKey: params.sessionKey,
            nameColumn: params.nameColumn
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
     * LOGBOOK RESULTS — asked by the phone right after a
     * save, so staff see the RESULT in seconds instead of
     * waiting for the logbook's every-minute run.
     ******************************************************/

    if (
      action === 'logbookresults'
    ) {

      resolveSession(params.sessionKey, params.deviceId);

      let rows;

      try {
        rows = JSON.parse(String(params.rows || '[]'));
      }

      catch (parseError) {
        rows = [];
      }

      return responseForRequest(
        fetchLogbookResults(
          params.spreadsheetUrl,
          params.sheetName,
          Array.isArray(rows) ? rows.slice(0, 200) : []
        ),
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
      columns,

    scannerName:
      scannerNameInfo(scannerNamePlan(spreadsheet, sheet, 0))

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
   * SCANNER NAME COLUMN (optional)
   ******************************************************/

  const nameColumn =
    data.nameColumn
      ? Number(data.nameColumn)
      : null;

  if (nameColumn !== null) {

    if (
      !Number.isInteger(nameColumn) ||
      nameColumn < 1
    ) {
      throw new Error('A valid Scanner Name column is required.');
    }

    if (
      nameColumn === itemCodeColumn ||
      (timestampEnabled && nameColumn === timestampColumn)
    ) {
      throw new Error('Scanner Name must use its own column (not the Item Code or Timestamp column).');
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


  if (
    nameColumn !== null &&
    nameColumn > lastColumn
  ) {

    throw new Error(
      'Scanner Name column ' +
      columnNumberToLetter(nameColumn) +
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

          },

    scannerName:
      scannerNameInfo(scannerNamePlan(spreadsheet, sheet, nameColumn || 0))

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

  /* Optional: column chosen in Destination Setup for the name. */
  const nameColumn =
    destination.nameColumn
      ? Number(destination.nameColumn)
      : 0;

  if (
    nameColumn &&
    (
      !Number.isInteger(nameColumn) ||
      nameColumn < 1 ||
      nameColumn === itemCodeColumn ||
      (timestampEnabled && nameColumn === timestampColumn)
    )
  ) {
    throw new Error('Invalid Scanner Name column.');
  }


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
      'NOT_SIGNED_IN: This phone is not registered. Enter your staff code.'
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
       * WHO SCANNED — written BEFORE the item codes, so the
       * logbook never sees an item code without its name.
       * The owner's rule (BOXES tab) decides; see scannerNamePlan.
       **************************************************/

      const plan =
        scannerNamePlan(spreadsheet, sheet, nameColumn);

      if (staff) {

        const own = [itemCodeColumn, timestampEnabled ? timestampColumn : 0];

        if (plan.byColumn && own.indexOf(plan.byColumn) < 0 && plan.byColumn <= sheet.getMaxColumns()) {
          const byText = staff.name + ', ' + staff.gmail;
          sheet.getRange(firstRow, plan.byColumn, count, 1)
            .setValues(toWrite.map(function() { return [byText]; }));
        }

        if (plan.column && plan.column !== plan.byColumn) {
          if (own.indexOf(plan.column) >= 0) {
            throw new Error('Scanner Name column ' + columnNumberToLetter(plan.column) +
              ' is the Item Code or Timestamp column. Fix it in the BOXES tab (column I).');
          }
          if (plan.column > sheet.getMaxColumns()) {
            throw new Error('Scanner Name column ' + columnNumberToLetter(plan.column) + ' does not exist.');
          }
          sheet.getRange(firstRow, plan.column, count, 1)
            .setValues(toWrite.map(function() { return [staff.name]; }));
        }

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
          staff &&
          plan.byColumn &&
          protectColumns.indexOf(plan.byColumn) === -1
        ) {
          protectColumns.push(plan.byColumn);
        }

        if (
          staff &&
          plan.column &&
          protectColumns.indexOf(plan.column) === -1
        ) {
          protectColumns.push(plan.column);
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
 * STAFF CODES — REGISTER A PHONE
 * ==========================================================
 *
 * 1. Each staff member has one secret code, kept ONLY in the
 *    owner's private spreadsheet (setupStaffCodes creates it).
 * 2. On their phone they enter the code once. The server
 *    finds whose code it is (must be ACTIVE = YES in STAFF),
 *    creates a long random key for that phone, stores only its
 *    fingerprint in _STAFF_SESSIONS, and gives the key to the
 *    phone. Every scan sends that key.
 * 3. One phone per staff member: registering a phone signs
 *    out their previous phone.
 * 4. Owner ticks MAKE NEW CODE → new code, and the phone
 *    registered with the old code is signed out.
 *
 * Remove access: ACTIVE = NO in STAFF (their phone stops
 * within 5 minutes), or ACTIVE (column F) = NO on one row of
 * _STAFF_SESSIONS (that phone only).
 *
 ************************************************************/

function checkCodeResponse(
  code,
  deviceId
) {

  const member =
    findStaffByCode(code, deviceId);

  return {
    success: true,
    name: member.name,
    gmail: member.gmail
  };

}


function registerPhoneResponse(
  code,
  deviceId
) {

  const member =
    findStaffByCode(code, deviceId);

  const phone =
    String(deviceId || '').substring(0, 60);

  const sessionKey =
    Utilities.getUuid().replace(/-/g, '') +
    Utilities.getUuid().replace(/-/g, '');

  const sessions =
    getSessionsSheet();

  const cache =
    CacheService.getScriptCache();

  const lock =
    LockService.getScriptLock();

  lock.waitLock(30000);

  try {

    /* One phone per staff member: sign out their other phones. */
    revokeSessionsForGmail(
      member.gmail,
      'Replaced by phone ' + phone,
      cache
    );

    sessions.appendRow([
      hashSessionKey(sessionKey),
      member.gmail,
      member.name,
      phone,
      new Date(),
      'YES',
      'Registered with staff code'
    ]);

    /* Show the phone in the private codes sheet. */
    try {

      const row =
        member.codesRow;

      if (row) {
        getCodesSheet()
          .getRange(row, 6, 1, 2)
          .setValues([[phone, new Date()]]);
      }

    }

    catch (error) {

      console.error('Codes sheet update error: ' + error);

    }

  }

  finally {

    lock.releaseLock();

  }

  return {

    success: true,

    sessionKey: sessionKey,

    name: member.name,

    gmail: member.gmail

  };

}


/*
 * Code → active staff member. Counts wrong codes per phone
 * and in total, and pauses after too many (stops guessing).
 */
function findStaffByCode(
  code,
  deviceId
) {

  const cache =
    CacheService.getScriptCache();

  const phone =
    String(deviceId || 'unknown').substring(0, 60);

  const phoneKey =
    'codefail:' + phone;

  const totalKey =
    'codefail:all';

  const phoneFails =
    Number(cache.get(phoneKey) || 0);

  const totalFails =
    Number(cache.get(totalKey) || 0);

  if (phoneFails >= CONFIG.MAX_CODE_TRIES_PER_PHONE) {
    throw new Error('Too many wrong codes. Wait 15 minutes, then try again.');
  }

  if (totalFails >= CONFIG.MAX_CODE_TRIES_TOTAL) {
    throw new Error('Registration is paused for 15 minutes because of too many wrong codes. Tell the owner.');
  }

  const cleaned =
    normalizeStaffCode(code);

  const entry =
    cleaned
      ? getCodesMap()[cleaned]
      : null;

  const member =
    entry
      ? getStaffByGmail(entry.gmail, true)
      : null;

  if (!member) {

    cache.put(phoneKey, String(phoneFails + 1), 900);
    cache.put(totalKey, String(totalFails + 1), 900);

    const left =
      CONFIG.MAX_CODE_TRIES_PER_PHONE - phoneFails - 1;

    if (entry && !member) {
      throw new Error('This staff member is not ACTIVE on the STAFF list. Ask the owner.');
    }

    throw new Error(
      'Wrong code.' + (left > 0 ? ' ' + left + ' tries left.' : ' Wait 15 minutes.')
    );

  }

  cache.remove(phoneKey);

  return {
    name: member.name,
    gmail: member.gmail,
    codesRow: entry.row
  };

}


function normalizeStaffCode(
  code
) {

  return String(code || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');

}


/*
 * code (no dash) → { gmail, row }  — cached 5 minutes,
 * cleared when a code is refreshed.
 */
function getCodesMap() {

  const cache =
    CacheService.getScriptCache();

  const cached =
    cache.get('codes-map');

  if (cached) {
    return JSON.parse(cached);
  }

  const sheet =
    getCodesSheet();

  const lastRow =
    sheet.getLastRow();

  const map = {};

  if (lastRow >= 2) {

    sheet
      .getRange(2, 1, lastRow - 1, 3)
      .getDisplayValues()
      .forEach(function(row, index) {

        const cleaned =
          normalizeStaffCode(row[2]);

        if (cleaned) {
          map[cleaned] = {
            gmail: String(row[1]).trim().toLowerCase(),
            row: index + 2
          };
        }

      });

  }

  cache.put('codes-map', JSON.stringify(map), 300);

  return map;

}


function revokeSessionsForGmail(
  gmail,
  note,
  cache
) {

  const sheet =
    getSessionsSheet();

  const lastRow =
    sheet.getLastRow();

  if (lastRow < 2) {
    return;
  }

  const rows =
    sheet.getRange(2, 1, lastRow - 1, 6).getValues();

  const target =
    String(gmail).toLowerCase();

  rows.forEach(function(row, index) {

    if (
      String(row[1]).toLowerCase() === target &&
      String(row[5]).trim().toUpperCase() === 'YES'
    ) {

      sheet
        .getRange(index + 2, 6, 1, 2)
        .setValues([['NO', note]]);

      cache.remove('session:' + row[0]);

    }

  });

}


/************************************************************
 * ==========================================================
 * PRIVATE CODES SPREADSHEET
 * ==========================================================
 ************************************************************/

/*
 * RUN THIS ONCE from the Apps Script editor:
 * choose "setupStaffCodes" in the function list → Run.
 *
 * Creates "SCANNER STAFF CODES (PRIVATE)" in your Drive
 * (never shared), fills it with a code for every staff
 * member, and turns on the MAKE NEW CODE checkbox.
 * Safe to run again — it won't duplicate anything.
 */
function setupStaffCodes() {

  const properties =
    PropertiesService.getScriptProperties();

  let spreadsheet =
    null;

  const existingId =
    properties.getProperty('CODES_SPREADSHEET_ID');

  if (existingId) {

    try {
      spreadsheet = SpreadsheetApp.openById(existingId);
    }

    catch (error) {
      spreadsheet = null;
    }

  }

  if (!spreadsheet) {

    spreadsheet =
      SpreadsheetApp.create(CONFIG.CODES_SPREADSHEET_NAME);

    properties.setProperty(
      'CODES_SPREADSHEET_ID',
      spreadsheet.getId()
    );

    const sheet =
      spreadsheet.getSheets()[0];

    sheet.setName(CONFIG.CODES_SHEET_NAME);

    sheet
      .getRange(1, 1, 1, 7)
      .setValues([[
        'STAFF NAME',
        'GMAIL',
        'CODE',
        'MAKE NEW CODE',
        'CODE CHANGED',
        'REGISTERED PHONE',
        'PHONE REGISTERED AT'
      ]])
      .setFontWeight('bold');

    sheet.setFrozenRows(1);

    sheet.getRange('C:C').setNumberFormat('@');

    sheet.getRange('E:E').setNumberFormat(CONFIG.TIMESTAMP_FORMAT);

    sheet.getRange('G:G').setNumberFormat(CONFIG.TIMESTAMP_FORMAT);

    sheet.setColumnWidth(1, 220);
    sheet.setColumnWidth(2, 260);
    sheet.setColumnWidth(3, 130);

  }

  /* Triggers: checkbox edits + sync new staff on open. */
  const id =
    spreadsheet.getId();

  const handlers =
    ScriptApp
      .getProjectTriggers()
      .filter(function(trigger) {
        return trigger.getTriggerSourceId() === id;
      })
      .map(function(trigger) {
        return trigger.getHandlerFunction();
      });

  if (handlers.indexOf('onCodesEdit') === -1) {
    ScriptApp.newTrigger('onCodesEdit').forSpreadsheet(id).onEdit().create();
  }

  if (handlers.indexOf('onCodesOpen') === -1) {
    ScriptApp.newTrigger('onCodesOpen').forSpreadsheet(id).onOpen().create();
  }

  syncStaffCodes();

  console.log('Private codes sheet ready: ' + spreadsheet.getUrl());

  return spreadsheet.getUrl();

}


function getCodesSheet() {

  const id =
    PropertiesService
      .getScriptProperties()
      .getProperty('CODES_SPREADSHEET_ID');

  if (!id) {
    throw new Error(
      'Staff codes are not set up yet. The owner must run setupStaffCodes once.'
    );
  }

  const sheet =
    SpreadsheetApp
      .openById(id)
      .getSheetByName(CONFIG.CODES_SHEET_NAME);

  if (!sheet) {
    throw new Error('The CODES tab is missing from the private codes sheet.');
  }

  return sheet;

}


/*
 * Add every STAFF member who has no code yet; keep names in
 * step with the STAFF tab. Never removes anyone.
 */
function syncStaffCodes() {

  const sheet =
    getCodesSheet();

  CacheService.getScriptCache().remove('staff-list');

  const staff =
    readStaffList();

  const lastRow =
    sheet.getLastRow();

  const existing =
    lastRow >= 2
      ? sheet.getRange(2, 1, lastRow - 1, 3).getDisplayValues()
      : [];

  const byGmail = {};

  const usedCodes = {};

  existing.forEach(function(row, index) {

    byGmail[String(row[1]).trim().toLowerCase()] = index + 2;

    usedCodes[normalizeStaffCode(row[2])] = true;

  });

  const newRows = [];

  staff.forEach(function(member) {

    const row =
      byGmail[member.gmail];

    if (row) {

      if (existing[row - 2][0] !== member.name) {
        sheet.getRange(row, 1).setValue(member.name);
      }

      return;

    }

    const code =
      generateStaffCode(usedCodes);

    newRows.push([member.name, member.gmail, code, false, new Date(), '', '']);

  });

  if (newRows.length) {

    const start =
      sheet.getLastRow() + 1;

    sheet
      .getRange(start, 1, newRows.length, 7)
      .setValues(newRows);

  }

  /* Checkbox in MAKE NEW CODE for every staff row. */
  const total =
    sheet.getLastRow() - 1;

  if (total > 0) {
    sheet.getRange(2, 4, total, 1).insertCheckboxes();
  }

  CacheService.getScriptCache().remove('codes-map');

}


/* Opening the private sheet adds any new staff. */
function onCodesOpen() {

  syncStaffCodes();

}


/*
 * Ticking MAKE NEW CODE: new code, untick, date, and sign
 * out the phone registered with the old code.
 */
function onCodesEdit(e) {

  if (!e || !e.range) {
    return;
  }

  const sheet =
    e.range.getSheet();

  if (sheet.getName() !== CONFIG.CODES_SHEET_NAME) {
    return;
  }

  if (
    e.range.getColumn() !== 4 ||
    e.range.getRow() < 2
  ) {
    return;
  }

  const lock =
    LockService.getScriptLock();

  lock.waitLock(30000);

  try {

    const cache =
      CacheService.getScriptCache();

    const height =
      e.range.getNumRows();

    const rows =
      sheet
        .getRange(e.range.getRow(), 1, height, 4)
        .getValues();

    const lastRow =
      sheet.getLastRow();

    const usedCodes = {};

    sheet
      .getRange(2, 3, Math.max(lastRow - 1, 1), 1)
      .getDisplayValues()
      .forEach(function(row) {
        usedCodes[normalizeStaffCode(row[0])] = true;
      });

    rows.forEach(function(row, index) {

      if (row[3] !== true) {
        return;
      }

      const rowNumber =
        e.range.getRow() + index;

      const gmail =
        String(row[1]).trim().toLowerCase();

      sheet
        .getRange(rowNumber, 3, 1, 5)
        .setValues([[
          generateStaffCode(usedCodes),
          false,
          new Date(),
          '',
          ''
        ]]);

      if (gmail) {
        revokeSessionsForGmail(gmail, 'Code refreshed by owner', cache);
      }

    });

    cache.remove('codes-map');

  }

  finally {

    lock.releaseLock();

  }

}


/*
 * 8 characters, shown as XXXX-XXXX. No 0/O, 1/I/L to avoid
 * mix-ups when reading it out. ~850 billion combinations.
 */
function generateStaffCode(
  usedCodes
) {

  const letters =
    'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

  for (let attempt = 0; attempt < 20; attempt++) {

    const hex =
      Utilities.getUuid().replace(/-/g, '') +
      Utilities.getUuid().replace(/-/g, '');

    let code = '';

    for (let i = 0; i < 8; i++) {
      code += letters.charAt(
        parseInt(hex.substr(i * 4, 4), 16) % letters.length
      );
    }

    if (!usedCodes[code]) {
      usedCodes[code] = true;
      return code.substring(0, 4) + '-' + code.substring(4);
    }

  }

  throw new Error('Could not create a unique code.');

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
    throw new Error('NOT_SIGNED_IN: This phone is not registered.');
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
      'NOT_SIGNED_IN: This phone was signed out. Enter your staff code again.'
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

    list = readStaffList();

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


/*
 * All rows of the STAFF tab: { name, gmail, active }.
 */
function readStaffList() {

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

  return rows
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
        'REGISTERED',
        'ACTIVE (YES/NO)',
        'NOTE'
      ]])
      .setFontWeight('bold');

    sheet.setFrozenRows(1);

    try {

      restrictProtectionToOwner(
        sheet.protect().setDescription('Registered staff phones — owner only')
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
/**
 * WHO-SCANNED RULE for one tab, set by the owner in the destination spreadsheet's
 * BOXES tab (the logbook):
 *   column H  SCANNER NAME   = REQUIRED / NOT ALLOWED / STAFF CHOOSES
 *   column I  SCANNER NAME COLUMN = a column letter (optional, e.g. E)
 * A tab with no rule: REQUIRED in its "BY (NAME, GMAIL)" column when it has one,
 * otherwise STAFF CHOOSES. The phone cannot change a REQUIRED / NOT ALLOWED rule.
 *
 * Returns { rule, locked, column, byColumn, fromOwner }:
 *   column   = where the staff NAME goes (0 = nowhere)
 *   byColumn = the BY column that always gets "Name, gmail" (0 when NOT ALLOWED)
 */
function scannerNamePlan(spreadsheet, sheet, phoneNameColumn) {

  const byColumn = findByColumn(sheet);
  let rule = '', ruleColumn = 0, fromOwner = false;

  const boxes = spreadsheet.getSheetByName('BOXES');

  if (boxes && boxes.getLastRow() >= 2 && boxes.getLastColumn() >= 8 &&
      String(boxes.getRange(1, 8).getDisplayValues()[0][0]).trim().toUpperCase().indexOf('SCANNER NAME') === 0) {

    const name = String(sheet.getName()).trim().toUpperCase();
    const rows = boxes.getRange(2, 1, boxes.getLastRow() - 1, 9).getDisplayValues();

    for (let i = 0; i < rows.length; i++) {
      if (String(rows[i][0]).trim().toUpperCase() !== name) continue;
      rule = String(rows[i][7] || '').trim().toUpperCase();
      ruleColumn = columnLetterToNumber(rows[i][8]);
      fromOwner = rule !== '';
      break;
    }

  }

  if (['REQUIRED', 'NOT ALLOWED', 'STAFF CHOOSES'].indexOf(rule) < 0) {
    rule = byColumn ? 'REQUIRED' : 'STAFF CHOOSES';
    fromOwner = false;
  }

  const column =
    rule === 'REQUIRED' ? (ruleColumn || byColumn)
    : rule === 'STAFF CHOOSES' ? (Number(phoneNameColumn) || 0)
    : 0;

  return {
    rule: rule,
    locked: rule !== 'STAFF CHOOSES',
    column: column,
    byColumn: rule === 'NOT ALLOWED' ? 0 : byColumn,
    fromOwner: fromOwner
  };

}


/** The rule as the setup page shows it. */
function scannerNameInfo(plan) {
  return {
    rule: plan.rule,
    locked: plan.locked,
    fromOwner: plan.fromOwner,
    enabled: plan.rule === 'REQUIRED' || (plan.rule === 'STAFF CHOOSES' && plan.column > 0),
    columnNumber: plan.column || null,
    letter: plan.column ? columnNumberToLetter(plan.column) : '',
    byLetter: plan.byColumn ? columnNumberToLetter(plan.byColumn) : ''
  };
}


/** "E" -> 5. Anything else -> 0. */
function columnLetterToNumber(letter) {
  const t = String(letter || '').trim().toUpperCase();
  if (!/^[A-Z]{1,3}$/.test(t)) return 0;
  let n = 0;
  for (let i = 0; i < t.length; i++) n = n * 26 + (t.charCodeAt(i) - 64);
  return n;
}


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

/************************************************************
 * ==========================================================
 * LOGBOOK RESULTS (instant)
 * ==========================================================
 *
 * Rows written by this server never fire the logbook's
 * onEdit (Google does not run onEdit for script writes), so
 * the logbook would only see them on its next timed run.
 * This asks the logbook to check them NOW and returns its
 * RESULT for each row.
 *
 * Owner setup (Project Settings > Script properties):
 *   LOGBOOK_RESULTS_URL  the logbook's Web app URL
 *   LOGBOOK_RESULTS_KEY  the key the logbook menu shows
 * Not set → nothing happens; the logbook works as before.
 ************************************************************/

function fetchLogbookResults(
  spreadsheetUrl,
  sheetName,
  rows
) {

  const props =
    PropertiesService.getScriptProperties();

  const url =
    String(props.getProperty('LOGBOOK_RESULTS_URL') || '').trim();

  const key =
    String(props.getProperty('LOGBOOK_RESULTS_KEY') || '').trim();

  if (!url || !key) {
    return { success: true, configured: false, results: [] };
  }

  const response =
    UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({
        key: key,
        spreadsheetId: spreadsheetUrl ? extractSpreadsheetId(spreadsheetUrl) : '',
        sheet: String(sheetName || ''),
        rows: rows
      }),
      muteHttpExceptions: true,
      followRedirects: true
    });

  let body;

  try {
    body = JSON.parse(response.getContentText());
  }

  catch (parseError) {
    throw new Error(
      'Logbook did not answer (HTTP ' + response.getResponseCode() +
      '). Check LOGBOOK_RESULTS_URL and the logbook web app deployment.'
    );
  }

  if (!body || !body.ok) {
    throw new Error('Logbook: ' + (body && body.error ? body.error : 'no answer'));
  }

  return {
    success: true,
    configured: true,
    busy: !!body.busy,
    results: body.results || []
  };

}


/*
 * Owner: run once from the editor after setting the two
 * script properties (allows the connection, checks it).
 */
function testLogbookResults() {

  const result =
    fetchLogbookResults('', '__test__', []);

  console.log(JSON.stringify(result));

  return result;

}


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