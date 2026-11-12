/**
 * 名刺管理 — クラウド保存先（Apps Script）
 *
 * ・画面は GitHub Pages のアプリ（docs/meishi/index.html）。このスクリプトはデータの保存先だけを担う。
 * ・データはこのスクリプトの持ち主の Google ドライブに保存する:
 *     スプレッドシート「名刺管理データ」… 名刺1枚＝1行
 *     フォルダ「名刺管理_画像」          … 名刺画像
 * ・持ち主として実行し、Googleログインは使わない（スマホで複数アカウントにログインしていると
 *   Apps Script のログイン方式は開けなくなる既知の問題があるため）。
 *   代わりに Config.gs の API_TOKEN（長いランダムな合鍵）を知っている端末だけが読み書きできる。
 *   Config.gs は合鍵を公開しないため Git に入れず、Apps Script 側にだけ置く。
 * ・端末への配り方: アプリの URL に #cfg=<このウェブアプリのURL>&tok=<合鍵> を付けたリンクを一度開く。
 *
 * 設置手順は同じフォルダの README.md を参照。
 */

const SHEET_FILE_NAME = '名刺管理データ';
const SHEET_TAB_NAME = '名刺';
const IMAGE_FOLDER_NAME = '名刺管理_画像';

// 列の並び（見出し行の名前で列を探すので、後から列を足しても壊れない）
const COLS = ['id', 'name', 'kana', 'company', 'companyKana', 'title', 'phone', 'email', 'address',
  'website', 'metAt', 'metPlace', 'tags', 'memo', 'imageFileId', 'createdAt', 'updatedAt'];
const NUMBER_COLS = { createdAt: true, updatedAt: true };

/* ================= 合鍵の確認 ================= */

// Config.gs で定義（例: const API_TOKEN = '長いランダムな文字列';）
function checkToken_(token) {
  const expected = typeof API_TOKEN !== 'undefined' ? String(API_TOKEN) : '';
  if (expected.length < 20) throw new Error('サーバー側の合鍵が未設定です（Config.gs）');
  const got = String(token || '');
  // 長さが違っても比較を最後までやる（一致した文字数から合鍵を推測されないように）
  let diff = got.length ^ expected.length;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ (got.charCodeAt(i) || 0);
  if (diff !== 0) throw new Error('合鍵が違います');
}

/* ================= 窓口 ================= */

// アプリからの読み書き（fetch POST、本文は JSON）
function doPost(e) {
  let payload = {};
  try { payload = JSON.parse((e && e.postData && e.postData.contents) || '{}'); }
  catch (err) { return json_({ ok: false, error: '要求の形式が不正です' }); }
  return json_(api(payload));
}

// ブラウザで直接開かれたとき（データは出さない）
function doGet() {
  return HtmlService.createHtmlOutput(
    '<div style="font-family:sans-serif;padding:40px 20px;text-align:center;line-height:1.8">' +
    '<h2>名刺管理の保存先</h2><p>ここはデータの保存先です。名刺管理アプリは<br>' +
    '<a href="https://h0921562.github.io/my-tools/meishi/" target="_top">こちら</a>から開いてください。</p></div>')
    .setTitle('名刺管理の保存先')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0');
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function api(payload) {
  try {
    payload = payload || {};
    checkToken_(payload.token);
    switch (payload.action) {
      case 'ping': sheet_(); folder_(); return { ok: true, sheetUrl: spreadsheet_().getUrl() };
      case 'list': return { ok: true, cards: listCards_() };
      case 'upsert': return withLock_(function () { return upsertCard_(payload.card, payload.image); });
      case 'delete': return withLock_(function () { return deleteCard_(payload.id); });
      case 'image': return { ok: true, dataUrl: imageDataUrl_(payload.fileId) };
      case 'ocr': return { ok: true, text: ocr_(payload.image) };
      // Opus（Claude CLI on GitHub Actions）による精読
      case 'ocrStart': return opusStart_(payload.image);
      case 'ocrPoll': return opusPoll_(payload.id);
      case 'ocrJob': return opusJob_(payload.id);       // Actions のワーカーが画像を取りに来る
      case 'ocrResult': return opusResult_(payload.id, payload.fields, payload.error); // ワーカーが結果を返す
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
    // ⚠ 開けなくても作り直さない（共有前のアカウントが別のシートを作ると、一覧が2つに割れるため）
    try { return SpreadsheetApp.openById(id); }
    catch (e) { throw new Error('名刺データのスプレッドシートを開けません。共有されているか確認してください'); }
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
    try { return DriveApp.getFolderById(id); }
    catch (e) { throw new Error('名刺画像のフォルダを開けません。共有されているか確認してください'); }
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
  const r = api({ action: 'ping', token: typeof API_TOKEN !== 'undefined' ? API_TOKEN : '' });
  if (!r.ok) throw new Error(r.error);
  Logger.log('準備できました。データの保存先: ' + r.sheetUrl);
}

/* ================= Opus による精読（Claude CLI を GitHub Actions で実行） =================
 * 流れ: アプリ → ocrStart（画像を一時保存して Actions を起動）→ Actions のワーカーが ocrJob で画像を取得し
 *       Claude CLI（Opus, Max プラン）で読み取り → ocrResult で結果を返す → アプリが ocrPoll で受け取る。
 * 必要な設定（スクリプト プロパティ）: GITHUB_TOKEN … my-tools の Actions を起動できるトークン。
 * 未設定ならアプリは Google の読み取りだけで動く（エラーにはしない）。
 */
const GH_REPO = 'h0921562/my-tools';
const GH_WORKFLOW = 'meishi-ocr.yml';
const JOB_PREFIX = 'ocrjob:';
const JOB_TTL_MS = 60 * 60 * 1000; // 1時間で捨てる

function opusStart_(dataUrl) {
  const gh = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
  if (!gh) return { ok: false, error: 'opus-not-configured' };
  const m = String(dataUrl || '').match(/^data:(image\/[a-z]+);base64,(.*)$/);
  if (!m) throw new Error('画像の形式が不正です');
  cleanupJobs_();
  const id = Utilities.getUuid();
  const blob = Utilities.newBlob(Utilities.base64Decode(m[2]), m[1], 'ocr-' + id + '.jpg');
  const fileId = folder_().createFile(blob).getId();
  setJob_(id, { status: 'queued', fileId: fileId, at: Date.now() });
  const res = UrlFetchApp.fetch('https://api.github.com/repos/' + GH_REPO + '/actions/workflows/' + GH_WORKFLOW + '/dispatches', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + gh, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    payload: JSON.stringify({ ref: 'main', inputs: { job: id } }),
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 204) {
    trashFile_(fileId);
    deleteJob_(id);
    return { ok: false, error: 'Actions を起動できませんでした（' + res.getResponseCode() + '）' };
  }
  return { ok: true, id: id };
}

function opusJob_(id) {
  const job = getJob_(id);
  if (!job || !job.fileId) throw new Error('ジョブが見つかりません');
  const blob = DriveApp.getFileById(job.fileId).getBlob();
  job.status = 'running';
  setJob_(id, job);
  return { ok: true, dataUrl: 'data:' + blob.getContentType() + ';base64,' + Utilities.base64Encode(blob.getBytes()) };
}

function opusResult_(id, fields, error) {
  const job = getJob_(id);
  if (!job) return { ok: true }; // 期限切れ
  trashFile_(job.fileId); // 画像はもう要らない
  const clean = {};
  const keys = ['name', 'kana', 'company', 'companyKana', 'title', 'phone', 'email', 'address', 'website'];
  if (fields && typeof fields === 'object') {
    keys.forEach(function (k) { if (fields[k]) clean[k] = String(fields[k]).slice(0, 300); });
  }
  setJob_(id, { status: error ? 'error' : 'done', fields: clean, error: error ? String(error).slice(0, 200) : '', at: job.at });
  return { ok: true };
}

function opusPoll_(id) {
  const job = getJob_(id);
  if (!job) return { ok: true, status: 'gone' };
  if (job.status === 'done' || job.status === 'error') deleteJob_(id);
  return { ok: true, status: job.status, fields: job.fields || {}, error: job.error || '' };
}

function getJob_(id) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id || ''))) return null;
  const v = PropertiesService.getScriptProperties().getProperty(JOB_PREFIX + id);
  return v ? JSON.parse(v) : null;
}
function setJob_(id, job) { PropertiesService.getScriptProperties().setProperty(JOB_PREFIX + id, JSON.stringify(job)); }
function deleteJob_(id) { PropertiesService.getScriptProperties().deleteProperty(JOB_PREFIX + id); }
function cleanupJobs_() {
  const props = PropertiesService.getScriptProperties();
  const all = props.getProperties();
  Object.keys(all).forEach(function (k) {
    if (k.indexOf(JOB_PREFIX) !== 0) return;
    try {
      const j = JSON.parse(all[k]);
      if (Date.now() - (j.at || 0) > JOB_TTL_MS) { trashFile_(j.fileId); props.deleteProperty(k); }
    } catch (e) { props.deleteProperty(k); }
  });
}
