/************************************************************
 * ==========================================================
 * QR CODE SCANNER — GOOGLE APPS SCRIPT BACKEND V2
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
          'Scanner Backend V1 is online.',

        timestamp:
          new Date().toISOString()

      };


      return responseForRequest(
        result,
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
        params.timestampColumn

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
            timestampColumn: params.timestampColumn
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

    saved: savedCount,

    total: results.length,

    sheetName: sheet.getName(),

    results: results

  };

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