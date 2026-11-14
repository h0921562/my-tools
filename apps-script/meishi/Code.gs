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
  'website', 'industry', 'metAt', 'metPlace', 'folder', 'tags', 'memo', 'imageFileId', 'createdAt', 'updatedAt', 'sdStatus',
  'backFileId']; // backFileId: 名刺の裏面の画像
const NUMBER_COLS = { createdAt: true, updatedAt: true };
// sdStatus はサーバーだけが書く（アプリからの保存では上書きしない）
const SERVER_ONLY_COLS = { sdStatus: true };

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
    // 名刺が使われるたびに、送りそびれた名刺を Sales Desk へ（45秒に1回まで）。ふだんは sdPush ですぐ送られる
    if (payload.action !== 'ocrJob' && payload.action !== 'sdPush') maybePushSalesDesk_();
    switch (payload.action) {
      case 'ping': sheet_(); folder_(); return { ok: true, sheetUrl: spreadsheet_().getUrl() };
      case 'list': return { ok: true, cards: listCards_() };
      case 'upsert': return withLock_(function () { return upsertCard_(payload.card, payload.image, payload.back); });
      case 'delete': return withLock_(function () { return deleteCard_(payload.id); });
      case 'image': return { ok: true, dataUrl: imageDataUrl_(payload.fileId) };
      case 'ocr': return { ok: true, text: ocr_(payload.image) };
      // 資料（名刺・会社にひもづけるファイル）と会社メモ
      case 'docList': return { ok: true, docs: tableList_(DOC_TABLE) };
      case 'docUpsert': return withLock_(function () { return docUpsert_(payload.doc, payload.file); });
      case 'docDelete': return withLock_(function () { return docDelete_(payload.id); });
      case 'docFile': return { ok: true, dataUrl: docFile_(payload.fileId) };
      case 'docText': return { ok: true, text: docText_(payload.fileId) };       // 資料の文字（会社の自動判定用）
      case 'docOpusStart': return opusStartFile_(payload.fileId, payload.hint); // 資料を Opus に読ませる（hint: 利用者からの補足・指示）
      case 'coList': return { ok: true, companies: tableList_(CO_TABLE) };
      case 'coUpsert': return withLock_(function () { return { ok: true, row: tableUpsert_(CO_TABLE, payload.company) }; });
      // Opus（Claude CLI on GitHub Actions）による精読
      // 読み取りが終わった／保存した名刺を、待たずに Sales Desk へ送る（アプリが名刺ごとに呼ぶ）
      // force: 登録済みの名刺も送り直す（Sales Desk 側の振り分けを直したときなど。Sales Desk は二重登録しない）
      case 'sdPush': return { ok: true, result: pushSalesDesk_((payload.ids || []).slice(0, 50).map(String), !!payload.force) };
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
// image / back: 省略=変更なし、null=外す、dataURL=差し替え（back は裏面）
function upsertCard_(card, image, back) {
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
  let backFileId = ci.idx.backFileId >= 0 ? String(row[ci.idx.backFileId] || '') : '';
  if (back === null) {
    trashFile_(backFileId);
    backFileId = '';
  } else if (typeof back === 'string' && back.indexOf('data:') === 0) {
    const newBack = saveImage_(card.id + '_back', back);
    trashFile_(backFileId);
    backFileId = newBack;
  }

  COLS.forEach(function (k) {
    const i = ci.idx[k];
    if (i < 0) return;
    if (SERVER_ONLY_COLS[k]) return;
    if (k === 'imageFileId') row[i] = imageFileId;
    else if (k === 'backFileId') row[i] = backFileId;
    else if (k === 'tags') row[i] = (card.tags || []).map(String).join(', ');
    else if (card[k] !== undefined) row[i] = card[k] == null ? '' : String(card[k]);
  });

  const target = rowNo > 0 ? sh.getRange(rowNo, 1, 1, ci.width) : sh.getRange(sh.getLastRow() + 1, 1, 1, ci.width);
  target.setNumberFormat('@').setValues([row]);
  return { ok: true, imageFileId: imageFileId, backFileId: backFileId };
}

function deleteCard_(id) {
  const sh = sheet_();
  const ci = colIndex_(sh);
  const rowNo = findRow_(sh, ci.idx.id, id);
  if (rowNo > 0) {
    if (ci.idx.imageFileId >= 0) trashFile_(String(sh.getRange(rowNo, ci.idx.imageFileId + 1).getValue() || ''));
    if (ci.idx.backFileId >= 0) trashFile_(String(sh.getRange(rowNo, ci.idx.backFileId + 1).getValue() || ''));
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
  return ocrBlob_(Utilities.newBlob(Utilities.base64Decode(m[2]), m[1], 'ocr.jpg'));
}
// 画像・PDF の文字を Google ドライブの文字認識で読む
function ocrBlob_(blob) {
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
  return { ok: true, kind: job.kind || 'card', hint: job.hint || '', dataUrl: 'data:' + blob.getContentType() + ';base64,' + Utilities.base64Encode(blob.getBytes()) };
}

function opusResult_(id, fields, error) {
  const job = getJob_(id);
  if (!job) return { ok: true }; // 期限切れ
  if (!job.keep) trashFile_(job.fileId); // 名刺の一時画像はもう要らない（資料ファイルは残す）
  const clean = {};
  const keys = job.kind === 'doc'
    ? ['company', 'title', 'summary', 'person', 'kind', 'detail']
    : ['name', 'kana', 'company', 'companyKana', 'title', 'phone', 'email', 'address', 'website', 'industry', 'corners', 'text', 'cards', 'side'];
  if (fields && typeof fields === 'object') {
    // detail（資料から抜き出した内容のまとめ）だけは長くてよい。ジョブの一時保存（9KBまで）に収まる長さにする
    keys.forEach(function (k) { if (fields[k]) clean[k] = String(fields[k]).slice(0, k === 'detail' ? 2500 : k === 'text' ? 1200 : k === 'cards' ? 1500 : 300); });
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

/* ================= 資料・会社（スプレッドシートの別タブ） =================
 * 資料: 1ファイル＝1行。ファイル本体は Drive のフォルダ「名刺管理_資料」。
 *       companyKey（会社名を正規化したもの）で会社に、cardId で名刺（人）にひもづく。
 * 会社: 会社ごとのメモ。key は companyKey。
 */
const DOC_TABLE = { tab: '資料', key: 'id', cols: ['id', 'companyKey', 'company', 'cardId', 'title', 'fileId', 'mime', 'size', 'note', 'createdAt', 'updatedAt', 'kind', 'detail', 'hint', 'memo'], nums: { size: true, createdAt: true, updatedAt: true } };
const CO_TABLE = { tab: '会社', key: 'key', cols: ['key', 'name', 'memo', 'updatedAt'], nums: { updatedAt: true } };
const DOC_FOLDER_NAME = '名刺管理_資料';
const DOC_MAX_BYTES = 25 * 1024 * 1024;

function table_(t) {
  const ss = spreadsheet_();
  let sh = ss.getSheetByName(t.tab);
  if (!sh) {
    sh = ss.insertSheet(t.tab);
    sh.getRange(1, 1, 1, t.cols.length).setValues([t.cols]);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()).setNumberFormat('@');
  }
  const head = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0].map(String);
  const missing = t.cols.filter(function (c) { return head.indexOf(c) < 0; });
  if (missing.length) {
    sh.getRange(1, head.filter(String).length + 1, 1, missing.length).setValues([missing]);
    head.push.apply(head, missing);
  }
  const idx = {};
  t.cols.forEach(function (c) { idx[c] = head.indexOf(c); });
  return { sh: sh, idx: idx, width: head.length };
}

function tableList_(t) {
  const tb = table_(t);
  const n = tb.sh.getLastRow() - 1;
  if (n <= 0) return [];
  return tb.sh.getRange(2, 1, n, tb.width).getValues()
    .filter(function (r) { return r[tb.idx[t.key]]; })
    .map(function (r) {
      const o = {};
      t.cols.forEach(function (c) { const v = r[tb.idx[c]]; o[c] = t.nums[c] ? (Number(v) || 0) : String(v == null ? '' : v); });
      return o;
    });
}

function tableFindRow_(tb, keyCol, key) {
  const n = tb.sh.getLastRow() - 1;
  if (n <= 0) return -1;
  const vals = tb.sh.getRange(2, tb.idx[keyCol] + 1, n, 1).getValues();
  for (let i = 0; i < vals.length; i++) if (String(vals[i][0]) === String(key)) return i + 2;
  return -1;
}

function tableUpsert_(t, obj) {
  if (!obj || !obj[t.key]) throw new Error('データが不正です');
  const tb = table_(t);
  const rowNo = tableFindRow_(tb, t.key, obj[t.key]);
  const row = rowNo > 0 ? tb.sh.getRange(rowNo, 1, 1, tb.width).getValues()[0] : new Array(tb.width).fill('');
  t.cols.forEach(function (c) { if (obj[c] !== undefined) row[tb.idx[c]] = obj[c] == null ? '' : String(obj[c]); });
  const target = rowNo > 0 ? tb.sh.getRange(rowNo, 1, 1, tb.width) : tb.sh.getRange(tb.sh.getLastRow() + 1, 1, 1, tb.width);
  target.setNumberFormat('@').setValues([row]);
  return obj;
}

function docFolder_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('DOC_FOLDER_ID');
  if (id) {
    try { return DriveApp.getFolderById(id); }
    catch (e) { throw new Error('資料のフォルダを開けません'); }
  }
  const f = DriveApp.createFolder(DOC_FOLDER_NAME);
  props.setProperty('DOC_FOLDER_ID', f.getId());
  return f;
}

// file: 'data:...;base64,...'（新規・差し替え時のみ）
function docUpsert_(doc, file) {
  if (!doc || !doc.id) throw new Error('資料のデータが不正です');
  if (typeof file === 'string' && file.indexOf('data:') === 0) {
    const m = file.match(/^data:([^;,]+);base64,(.*)$/);
    if (!m) throw new Error('ファイルの形式が不正です');
    if (!/^(image\/(jpeg|png|webp|heic|heif|gif)|application\/pdf)$/.test(m[1])) throw new Error('写真かPDFだけ追加できます');
    const bytes = Utilities.base64Decode(m[2]);
    if (bytes.length > DOC_MAX_BYTES) throw new Error('ファイルが大きすぎます（25MBまで）');
    const name = String(doc.title || 'document').replace(/[\\/:*?"<>|]/g, '_').slice(0, 80);
    const created = docFolder_().createFile(Utilities.newBlob(bytes, m[1], name));
    const tb = table_(DOC_TABLE);
    const rowNo = tableFindRow_(tb, 'id', doc.id);
    if (rowNo > 0) trashFile_(String(tb.sh.getRange(rowNo, tb.idx.fileId + 1).getValue() || ''));
    doc.fileId = created.getId();
    doc.mime = m[1];
    doc.size = bytes.length;
  }
  tableUpsert_(DOC_TABLE, doc);
  return { ok: true, doc: doc };
}

function docDelete_(id) {
  const tb = table_(DOC_TABLE);
  const rowNo = tableFindRow_(tb, 'id', id);
  if (rowNo > 0) {
    trashFile_(String(tb.sh.getRange(rowNo, tb.idx.fileId + 1).getValue() || ''));
    tb.sh.deleteRow(rowNo);
  }
  return { ok: true };
}

function docFile_(fileId) {
  if (!fileId) throw new Error('ファイルがありません');
  const file = DriveApp.getFileById(fileId);
  const parents = file.getParents();
  const folderId = docFolder_().getId();
  let ok = false;
  while (parents.hasNext()) if (parents.next().getId() === folderId) { ok = true; break; }
  if (!ok) throw new Error('このアプリの資料ではありません');
  const blob = file.getBlob();
  return 'data:' + blob.getContentType() + ';base64,' + Utilities.base64Encode(blob.getBytes());
}

// 資料の文字を読む（PDF・画像）。長い資料は先頭だけで十分
function docText_(fileId) {
  docFile_(fileId); // このアプリの資料か確認
  const text = ocrBlob_(DriveApp.getFileById(fileId).getBlob());
  return String(text || '').slice(0, 20000);
}

// 資料ファイルを Opus に読ませるジョブ（ファイルは消さない）
function opusStartFile_(fileId, hint) {
  const gh = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
  if (!gh) return { ok: false, error: 'opus-not-configured' };
  docFile_(fileId); // このアプリの資料か確認
  cleanupJobs_();
  const id = Utilities.getUuid();
  setJob_(id, { status: 'queued', fileId: fileId, kind: 'doc', keep: true, hint: String(hint || '').slice(0, 500), at: Date.now() });
  const res = UrlFetchApp.fetch('https://api.github.com/repos/' + GH_REPO + '/actions/workflows/' + GH_WORKFLOW + '/dispatches', {
    method: 'post', contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + gh, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    payload: JSON.stringify({ ref: 'main', inputs: { job: id } }), muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 204) { deleteJob_(id); return { ok: false, error: 'Actions を起動できませんでした（' + res.getResponseCode() + '）' }; }
  return { ok: true, id: id };
}

/* ================= Sales Desk の共通マスターへ自動登録 =================
 * 会社名のある名刺を、Sales Desk に自動で送る（全件マスターへ、業態に合う事業へ。抹茶なら抹茶の営業リスト）。
 * ふだんは、アプリが「読み取りが終わった・保存した」時点で sdPush を呼び、その名刺をすぐ送る。
 * それとは別に、送りそびれた名刺（途中でアプリを閉じた など）を拾うため、アプリが使われるたびに
 * 45秒に1回まで、最後の更新から90秒たった名刺をまとめて送る。
 * 認証: Config.gs の SD_PRIVATE_KEY（秘密鍵）で送る内容に署名する。Sales Desk は公開鍵で確かめる。
 *   代わりにスクリプト プロパティ SALES_DESK_TOKEN（合言葉）でもよい。どちらもなければ何もしない。送った結果はシートの sdStatus 列に残す（ok / conflict:… / error:…）。
 */
const SALES_DESK_URL_DEFAULT = 'https://sales-desk.yamauchi-39d.workers.dev';
const SD_SETTLE_MS = 90 * 1000;

function maybePushSalesDesk_() {
  try {
    if (!sdAuthReady_()) return;
    const cache = CacheService.getScriptCache();
    if (cache.get('sdPushLock')) return;
    cache.put('sdPushLock', '1', 45);
    pushSalesDesk_();
  } catch (e) { /* 名刺の操作は止めない */ }
}

// エディタから手動で実行してもよい（結果はログに出る）
function pushSalesDesk() { Logger.log(JSON.stringify(pushSalesDesk_())); }

function sdPrivateKey_() {
  return (typeof SD_PRIVATE_KEY === 'string' && SD_PRIVATE_KEY.indexOf('PRIVATE KEY') >= 0) ? SD_PRIVATE_KEY : '';
}
function sdAuthReady_() {
  return !!(sdPrivateKey_() || PropertiesService.getScriptProperties().getProperty('SALES_DESK_TOKEN'));
}
// 署名つきの送信ヘッダー（時刻.本文のSHA-256 を RSA-SHA256 で署名）。鍵がなければ合言葉。
function sdHeaders_(body) {
  const key = sdPrivateKey_();
  if (!key) return { 'X-Meishi-Token': PropertiesService.getScriptProperties().getProperty('SALES_DESK_TOKEN') };
  const time = String(Date.now());
  const hash = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, body, Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + (b & 255).toString(16)).slice(-2); }).join('');
  const sig = Utilities.computeRsaSha256Signature(time + '.' + hash, key);
  return { 'X-Meishi-Time': time, 'X-Meishi-Signature': Utilities.base64Encode(sig) };
}

// ids を渡すと、その名刺だけを待ち時間なしで送る。返り値の statuses は 名刺ID → 結果（ok / conflict:… / error:…）
function pushSalesDesk_(ids, force) {
  const only = ids && ids.length ? {} : null;
  if (only) ids.forEach(function (id) { only[id] = true; });
  const statuses = {};
  const props = PropertiesService.getScriptProperties();
  if (!sdAuthReady_()) return { skipped: 'Sales Desk への認証（SD_PRIVATE_KEY か SALES_DESK_TOKEN）が未設定です' };
  const base = (props.getProperty('SALES_DESK_URL') || SALES_DESK_URL_DEFAULT).replace(/\/+$/, '');
  const sh = sheet_(), ci = colIndex_(sh);
  const n = sh.getLastRow() - 1;
  if (n <= 0) return { sent: 0 };
  const rows = sh.getRange(2, 1, n, ci.width).getValues();
  const now = Date.now();
  const pending = [];
  rows.forEach(function (r, i) {
    const c = rowToCard_(r, ci.idx);
    const status = String(r[ci.idx.sdStatus] || '');
    if (!(force && only) && (status === 'ok' || status.indexOf('conflict') === 0)) return;
    if (!c.company || !c.name || c.name === '（読み取り中）') return;
    if (only) { if (!only[c.id]) return; }
    else if (now - (c.updatedAt || 0) < SD_SETTLE_MS) return; // 読み取りの途中かもしれないので少し待つ
    pending.push({ row: i + 2, card: c });
  });
  if (!pending.length) return { sent: 0 };
  const batch = pending.slice(0, 50);
  const items = batch.map(function (p) {
    const c = p.card;
    return {
      card_id: c.id, company: c.company, name: c.name === '（氏名を確認）' ? '' : c.name, title: c.title,
      email: /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c.email) ? c.email : '', phone: c.phone, website: c.website,
      address: String(c.address || '').slice(0, 300), met: [c.metAt, c.metPlace].filter(String).join(' ').slice(0, 300),
      memo: String(c.memo || '').slice(0, 1500), card_url: c.imageFileId ? 'https://drive.google.com/file/d/' + c.imageFileId + '/view' : '',
      industry: String(c.industry || '').slice(0, 80), project: c.folder || '',
    };
  });
  const send = function (list) {
    const body = JSON.stringify({ items: list });
    return UrlFetchApp.fetch(base + '/api/meishi-intake/auto', {
      method: 'post', contentType: 'application/json; charset=utf-8', headers: sdHeaders_(body),
      payload: Utilities.newBlob(body).getBytes(), muteHttpExceptions: true,
    });
  };
  const mark = function (row, v, id) {
    const text = String(v).slice(0, 300);
    sh.getRange(row, ci.idx.sdStatus + 1).setNumberFormat('@').setValue(text);
    if (id) statuses[id] = text;
  };
  const apply = function (results) {
    const byId = {};
    (results || []).forEach(function (x) { byId[x.card_id] = x; });
    batch.forEach(function (p) {
      const x = byId[p.card.id];
      if (x) mark(p.row, x.status === 'conflict' ? 'conflict:' + (x.candidates || []).join('、') : 'ok', p.card.id);
    });
  };
  const res = send(items);
  const code = res.getResponseCode();
  if (code === 200) {
    const out = JSON.parse(res.getContentText());
    apply(out.results);
    return { sent: batch.length, message: out.message || '', statuses: statuses };
  }
  if (code === 400) {
    // 1枚の内容が原因で全体が断られたときは、1枚ずつ送り直して、だめな名刺だけ印を付ける（他を止めない）
    const results = [];
    items.forEach(function (it, i) {
      const r = send([it]);
      if (r.getResponseCode() === 200) results.push.apply(results, JSON.parse(r.getContentText()).results || []);
      else if (r.getResponseCode() === 400) mark(batch[i].row, 'error:' + r.getContentText().slice(0, 200), batch[i].card.id);
    });
    apply(results);
    return { sent: results.length, retried: true, statuses: statuses };
  }
  // 鍵の違い・未設定・一時的な障害などは、名刺ごとの印は付けず次の機会にもう一度送る
  return { error: code, body: res.getContentText().slice(0, 200) };
}
