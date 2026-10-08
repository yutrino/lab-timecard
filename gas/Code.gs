// 研究タイムカードの同期先。スプレッドシートの「拡張機能 → Apps Script」に貼り、
// ウェブアプリ（実行: 自分 / アクセス: 全員）としてデプロイする。手順は README を参照。

const SHEET_NAME = '記録';
const HEADER = ['ID', '開始', '終了', '区分', '更新'];
const CAT_LABEL = { research: '研究', discussion: 'ディスカッション', presentation: '発表会・練習' };

function doGet() {
  return json_({ ok: true, message: 'タイムカードの同期先として動いています。' });
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const body = JSON.parse((e.postData && e.postData.contents) || '{}');
    const sheet = getSheet_();
    const incoming = Array.isArray(body.records) ? body.records : [];
    if (incoming.length) apply_(sheet, incoming);
    return json_({ ok: true, records: read_(sheet) });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function json_(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

function getSheet_() {
  const book = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = book.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = book.insertSheet(SHEET_NAME);
    sheet.appendRow(HEADER);
    sheet.setFrozenRows(1);
    sheet.getRange('B:C').setNumberFormat('yyyy/mm/dd hh:mm');
    sheet.getRange('E:E').setNumberFormat('0');
  }
  return sheet;
}

function toRow_(r) {
  return [
    String(r.id),
    new Date(Number(r.start)),
    r.end == null ? '' : new Date(Number(r.end)),
    CAT_LABEL[r.cat] || CAT_LABEL.research,
    Number(r.updated) || Date.now(),
  ];
}

// 届いた記録を書き込む。同じ ID があれば新しいほうを残し、削除の印があれば行を消す。
function apply_(sheet, incoming) {
  const last = sheet.getLastRow();
  const existing = last > 1 ? sheet.getRange(2, 1, last - 1, HEADER.length).getValues() : [];
  const rowOf = {};
  existing.forEach(function (row, i) { if (row[0]) rowOf[row[0]] = i + 2; });

  const toDelete = [];
  incoming.forEach(function (r) {
    if (!r || !r.id) return;
    const rowNumber = rowOf[r.id];
    if (r.deleted) {
      if (rowNumber) toDelete.push(rowNumber);
    } else if (rowNumber) {
      const current = Number(existing[rowNumber - 2][4]) || 0;
      if (Number(r.updated) >= current) {
        sheet.getRange(rowNumber, 1, 1, HEADER.length).setValues([toRow_(r)]);
      }
    } else {
      sheet.appendRow(toRow_(r));
      rowOf[r.id] = sheet.getLastRow();
    }
  });
  toDelete.sort(function (a, b) { return b - a; }).forEach(function (n) { sheet.deleteRow(n); });
}

function toMs_(value) {
  if (value instanceof Date) return value.getTime();
  if (value === '' || value == null) return null;
  const n = Number(value);
  return isFinite(n) ? n : null;
}

// シートを手で直した内容もそのまま返す。手で足した行（ID が空）には ID を振る。
function read_(sheet) {
  const last = sheet.getLastRow();
  if (last < 2) return [];
  const labelToCat = {};
  Object.keys(CAT_LABEL).forEach(function (key) { labelToCat[CAT_LABEL[key]] = key; });

  const range = sheet.getRange(2, 1, last - 1, HEADER.length);
  const records = [];
  range.getValues().forEach(function (row, i) {
    const start = toMs_(row[1]);
    if (start == null) return;
    if (!row[0]) {
      row[0] = Utilities.getUuid();
      row[4] = Date.now();
      sheet.getRange(i + 2, 1).setValue(row[0]);
      sheet.getRange(i + 2, 5).setValue(row[4]);
    }
    records.push({
      id: String(row[0]),
      start: start,
      end: toMs_(row[2]),
      cat: labelToCat[row[3]] || 'research',
      updated: Number(row[4]) || 0,
    });
  });
  return records;
}
