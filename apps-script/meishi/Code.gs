/**
 * 名刺管理 — Apps Script 版（Googleログインした本人だけが使えるウェブアプリ）
 *
 * ・アプリ画面は GitHub Pages の index.html を取得してそのまま配信する（コードの二重管理をしない）。
 * ・データはこのスクリプトの持ち主の Google ドライブに保存する:
 *     スプレッドシート「名刺管理データ」… 名刺1枚＝1行
 *     フォルダ「名刺管理_画像」          … 名刺画像
 * ・デプロイ時に「アクセスできるユーザー: 自分のみ」にすると、URLを知られても他人は開けない。
 *
 * 設置手順は同じフォルダの README.md を参照。
 */

// 画面の取得元。テスト中はブランチのプレビューURLなどに差し替えられる
// （プロジェクトの設定 → スクリプト プロパティ に PAGE_URL を追加すると、そちらが優先される）。
const DEFAULT_PAGE_URL = 'https://h0921562.github.io/my-tools/meishi/index.html';

const SHEET_FILE_NAME = '名刺管理データ';
const SHEET_TAB_NAME = '名刺';
const IMAGE_FOLDER_NAME = '名刺管理_画像';

// 列の並び（見出し行の名前で列を探すので、後から列を足しても壊れない）
const COLS = ['id', 'name', 'kana', 'company', 'companyKana', 'title', 'phone', 'email', 'address',
  'website', 'metAt', 'metPlace', 'tags', 'memo', 'imageFileId', 'createdAt', 'updatedAt'];
const NUMBER_COLS = { createdAt: true, updatedAt: true };

/* ================= 画面の配信 ================= */

function doGet() {
  const html = HtmlService.createHtmlOutput(getPageHtml_())
    .setTitle('名刺管理')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0, viewport-fit=cover');
  return html;
}

function pageUrl_() {
  return PropertiesService.getScriptProperties().getProperty('PAGE_URL') || DEFAULT_PAGE_URL;
}

// GitHub Pages から画面を取ってくる。毎回取りに行くと遅いので10分キャッシュする。
// CacheService は1件100KBまでなので分割して保存する。
function getPageHtml_() {
  const cache = CacheService.getScriptCache();
  const url = pageUrl_();
  const key = 'page:' + Utilities.base64EncodeWebSafe(url).slice(0, 200);
  const meta = cache.get(key + ':n');
  if (meta) {
    const keys = [];
    for (let i = 0; i < Number(meta); i++) keys.push(key + ':' + i);
    const parts = cache.getAll(keys);
    if (keys.every(function (k) { return parts[k] != null; })) {
      return keys.map(function (k) { return parts[k]; }).join('');
    }
  }
  const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
  if (res.getResponseCode() !== 200) {
    throw new Error('画面を取得できませんでした（' + res.getResponseCode() + '）: ' + url);
  }
  const text = res.getContentText('UTF-8');
  const size = 90000;
  const chunks = {};
  let n = 0;
  for (let i = 0; i < text.length; i += size) chunks[key + ':' + (n++)] = text.slice(i, i + size);
  try {
    cache.putAll(chunks, 600);
    cache.put(key + ':n', String(n), 600);
  } catch (e) { /* キャッシュに入らなくても表示はできる */ }
  return text;
}

// 画面を更新した直後にすぐ反映させたいときは、エディタからこれを実行する
function clearPageCache() {
  const cache = CacheService.getScriptCache();
  const key = 'page:' + Utilities.base64EncodeWebSafe(pageUrl_()).slice(0, 200);
  cache.remove(key + ':n');
}

/* ================= 画面から呼ばれる窓口 ================= */

// 画面側の google.script.run.api(payload) から呼ばれる。返り値は { ok, ... }。
function api(payload) {
  try {
    payload = payload || {};
    switch (payload.action) {
      case 'ping': sheet_(); folder_(); return { ok: true, sheetUrl: spreadsheet_().getUrl() };
      case 'list': return { ok: true, cards: listCards_() };
      case 'upsert': return withLock_(function () { return upsertCard_(payload.card, payload.image); });
      case 'delete': return withLock_(function () { return deleteCard_(payload.id); });
      case 'image': return { ok: true, dataUrl: imageDataUrl_(payload.fileId) };
      case 'ocr': return { ok: true, text: ocr_(payload.image) };
      default: return { ok: false, error: '不明な操作です: ' + payload.action };
    }
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}

/* ================= 保存先 ================= */

function spreadsheet_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('SHEET_ID');
  if (id) {
    try { return SpreadsheetApp.openById(id); } catch (e) { /* 消された等 → 作り直す */ }
  }
  const ss = SpreadsheetApp.create(SHEET_FILE_NAME);
  props.setProperty('SHEET_ID', ss.getId());
  return ss;
}

function sheet_() {
  const ss = spreadsheet_();
  let sh = ss.getSheetByName(SHEET_TAB_NAME);
  if (!sh) {
    sh = ss.getSheets().length === 1 && ss.getSheets()[0].getLastRow() === 0
      ? ss.getSheets()[0].setName(SHEET_TAB_NAME)
      : ss.insertSheet(SHEET_TAB_NAME);
  }
  // 見出し行を揃える（足りない列は右に足す）
  const lastCol = Math.max(sh.getLastColumn(), 1);
  const head = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(String);
  const missing = COLS.filter(function (c) { return head.indexOf(c) < 0; });
  if (missing.length) {
    const start = head.filter(String).length === 0 ? 1 : lastCol + 1;
    sh.getRange(1, start, 1, missing.length).setValues([missing]);
    sh.setFrozenRows(1);
    // 電話番号の先頭の0や日付が自動変換されないよう、全体を書式なしテキストにする
    sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()).setNumberFormat('@');
  }
  return sh;
}

function colIndex_(sh) {
  const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  const idx = {};
  COLS.forEach(function (c) { idx[c] = head.indexOf(c); });
  return { idx: idx, width: head.length };
}

function folder_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('FOLDER_ID');
  if (id) {
    try {
      const f = DriveApp.getFolderById(id);
      if (!f.isTrashed()) return f;
    } catch (e) { /* 作り直す */ }
  }
  const f = DriveApp.createFolder(IMAGE_FOLDER_NAME);
  props.setProperty('FOLDER_ID', f.getId());
  return f;
}

/* ================= 名刺の読み書き ================= */

function rowToCard_(row, idx) {
  const c = {};
  COLS.forEach(function (k) {
    const v = idx[k] >= 0 ? row[idx[k]] : '';
    if (k === 'tags') c.tags = String(v || '').split(/\s*,\s*/).filter(String);
    else if (NUMBER_COLS[k]) c[k] = Number(v) || 0;
    else if (v instanceof Date) c[k] = Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    else c[k] = String(v == null ? '' : v);
  });
  return c;
}

function listCards_() {
  const sh = sheet_();
  const n = sh.getLastRow() - 1;
  if (n <= 0) return [];
  const ci = colIndex_(sh);
  return sh.getRange(2, 1, n, ci.width).getValues()
    .filter(function (r) { return ci.idx.id >= 0 && r[ci.idx.id]; })
    .map(function (r) { return rowToCard_(r, ci.idx); });
}

function findRow_(sh, idCol, id) {
  const n = sh.getLastRow() - 1;
  if (n <= 0) return -1;
  const ids = sh.getRange(2, idCol + 1, n, 1).getValues();
  for (let i = 0; i < ids.length; i++) if (String(ids[i][0]) === String(id)) return i + 2;
  return -1;
}

// image: undefined=画像はそのまま / null=画像を外す / 'data:image/...'=差し替え
function upsertCard_(card, image) {
  if (!card || !card.id || !card.name) throw new Error('名刺のデータが不正です');
  const sh = sheet_();
  const ci = colIndex_(sh);
  const rowNo = findRow_(sh, ci.idx.id, card.id);
  const row = rowNo > 0
    ? sh.getRange(rowNo, 1, 1, ci.width).getValues()[0]
    : new Array(ci.width).fill('');

  // 古い端末から古いデータで上書きされないよう、新しい方だけを採用する
  const curUpdated = rowNo > 0 && ci.idx.updatedAt >= 0 ? Number(row[ci.idx.updatedAt]) || 0 : 0;
  if (rowNo > 0 && (Number(card.updatedAt) || 0) < curUpdated) {
    return { ok: true, skipped: 'newer-on-server' };
  }

  let imageFileId = ci.idx.imageFileId >= 0 ? String(row[ci.idx.imageFileId] || '') : '';
  if (image === null) {
    trashFile_(imageFileId);
    imageFileId = '';
  } else if (typeof image === 'string' && image.indexOf('data:') === 0) {
    const newId = saveImage_(card.id, image);
    trashFile_(imageFileId);
    imageFileId = newId;
  }

  COLS.forEach(function (k) {
    const i = ci.idx[k];
    if (i < 0) return;
    if (k === 'imageFileId') row[i] = imageFileId;
    else if (k === 'tags') row[i] = (card.tags || []).map(String).join(', ');
    else if (card[k] !== undefined) row[i] = card[k] == null ? '' : String(card[k]);
  });

  const target = rowNo > 0 ? sh.getRange(rowNo, 1, 1, ci.width) : sh.getRange(sh.getLastRow() + 1, 1, 1, ci.width);
  target.setNumberFormat('@').setValues([row]);
  return { ok: true, imageFileId: imageFileId };
}

function deleteCard_(id) {
  const sh = sheet_();
  const ci = colIndex_(sh);
  const rowNo = findRow_(sh, ci.idx.id, id);
  if (rowNo > 0) {
    if (ci.idx.imageFileId >= 0) trashFile_(String(sh.getRange(rowNo, ci.idx.imageFileId + 1).getValue() || ''));
    sh.deleteRow(rowNo);
  }
  return { ok: true };
}

/* ================= 画像 ================= */

function saveImage_(cardId, dataUrl) {
  const m = String(dataUrl).match(/^data:([^;,]+);base64,(.*)$/);
  if (!m) throw new Error('画像の形式が不正です');
  const blob = Utilities.newBlob(Utilities.base64Decode(m[2]), m[1], cardId + '.jpg');
  return folder_().createFile(blob).getId();
}

function trashFile_(fileId) {
  if (!fileId) return;
  try { DriveApp.getFileById(fileId).setTrashed(true); } catch (e) { /* 既に無い */ }
}

function imageDataUrl_(fileId) {
  if (!fileId) throw new Error('画像がありません');
  const file = DriveApp.getFileById(fileId);
  // このアプリの画像フォルダ内のファイルだけを返す
  const parents = file.getParents();
  const folderId = folder_().getId();
  let ok = false;
  while (parents.hasNext()) if (parents.next().getId() === folderId) { ok = true; break; }
  if (!ok) throw new Error('このアプリの画像ではありません');
  const blob = file.getBlob();
  return 'data:' + blob.getContentType() + ';base64,' + Utilities.base64Encode(blob.getBytes());
}

/* ================= OCR（Googleドライブの文字認識） ================= */
// 「サービス」から Drive API（v3）を追加しておく必要がある（README 参照）。
function ocr_(dataUrl) {
  const m = String(dataUrl || '').match(/^data:([^;,]+);base64,(.*)$/);
  if (!m) throw new Error('画像の形式が不正です');
  const blob = Utilities.newBlob(Utilities.base64Decode(m[2]), m[1], 'ocr.jpg');
  let docId = null;
  try {
    const file = Drive.Files.create(
      { name: '名刺OCR_一時ファイル', mimeType: 'application/vnd.google-apps.document' },
      blob,
      { ocrLanguage: 'ja', fields: 'id' }
    );
    docId = file.id;
    return DocumentApp.openById(docId).getBody().getText();
  } finally {
    if (docId) trashFile_(docId);
  }
}

/* ================= 初回の権限付与用 ================= */
// エディタでこれを1回実行すると、必要な権限の許可画面が出て、保存先が作られる。
function setup() {
  const r = api({ action: 'ping' });
  if (!r.ok) throw new Error(r.error);
  Logger.log('準備できました。データの保存先: ' + r.sheetUrl);
}
