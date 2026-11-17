/**
 * Cumulus：カードの利用通知メールを読み取る小さなプログラム
 *
 * ・あなたのGoogleアカウントの中だけで動きます
 * ・読み取るのは、下の ISSUERS に書いた送信元（三井住友カード・JCB）の「ご利用のお知らせ」メールだけです
 * ・アプリに返すのは、日付・時刻・金額・利用先だけです（メールの本文は返しません）
 * ・TOKEN（合言葉）が一致しない呼び出しには、何も返しません
 * ・月次レポート（doPost）：アプリが月が替わると送る「先月の取引の全件」を、あなたのGoogleドライブのスプレッドシート「Cumulus 月次」に保存します（月ごとのシート「YYYY-MM」と「概要」。同じ月は上書き）。スプレッドシートの権限が必要です（更新後の初回に許可を求められます）
 */
const TOKEN = "__TOKEN__";   // アプリが作った合言葉。アプリの「スクリプトをコピー」で自動で入ります
const DEFAULT_DAYS = 45;     // 何日前までのメールを見るか
const MAX_THREADS = 100;     // 一度に見るメールの上限

// ---- 月次レポート（doPost）の決まり ----
const BOOK_NAME = "Cumulus 月次";   // 保存先のスプレッドシート名（初回に作り、IDをスクリプトの保存領域に覚える）
const BOOK_PROP = "REPORT_BOOK_ID";
const MAX_BODY = 3000000;            // 受け取る本文の上限（文字数）
const MAX_TX = 5000, MAX_ITEMS = 20000, MAX_INVESTS = 500, MAX_ITEMS_PER_TX = 200;
const PAY_NAMES = ["現金", "バーコード決済", "クレジット"];
const REG_NAMES = ["手入力・レシート", "メール", "メール・レシート"];

const ISSUERS = [
  { id: "smbc", sender: "@vpass.ne.jp", query: 'from:statement@vpass.ne.jp subject:"ご利用のお知らせ"', parse: parseSmbc },
  { id: "jcb", sender: "@qa.jcb.co.jp", query: 'from:mail@qa.jcb.co.jp subject:"ご利用のお知らせ"', parse: parseJcb },
];

function doGet(e) {
  const p = (e && e.parameter) || {};
  if (TOKEN === "__TOKEN__" || !p.token || p.token !== TOKEN) return reply({ ok: false, error: "token" });
  const days = Math.max(1, Math.min(120, Number(p.days) || DEFAULT_DAYS));
  const since = Date.now() - days * 86400000;
  const items = [];
  let unreadable = 0, found = 0, excluded = 0, checked = 0;   // found=検索に合ったメール通数／excluded=送信元・期間で除いた通数／checked=読もうとした通数
  ISSUERS.forEach(function (is) {
    GmailApp.search(is.query + " newer_than:" + days + "d", 0, MAX_THREADS).forEach(function (th) {
      th.getMessages().forEach(function (m) {
        found++;
        if (String(m.getFrom()).toLowerCase().indexOf(is.sender) < 0) { excluded++; return; }   // 送信元が違うものは読まない
        if (m.getDate().getTime() < since) { excluded++; return; }
        checked++;
        const got = readMessage(is, m);
        if (!got.length || got.skipped) unreadable++;            // 読めなかったもの（一部だけの場合も）は、通数で数える
        if (!got.length) return;
        got.forEach(function (g, i) { items.push(Object.assign({ id: m.getId() + (i ? "-" + i : ""), issuer: is.id }, g)); });
      });
    });
  });
  return reply({ ok: true, items: items, unreadable: unreadable, found: found, excluded: excluded, checked: checked, at: new Date().toISOString() });
}

// ---- 月次レポートの保存（POST）。本文は text/plain の JSON。合言葉は本文の token ----
// 返すのは {ok, month, rows, items}。エラーは {ok:false, error:"token"|"json"|"size"|"data"|"server"} だけ。取引の中身はログに出さない
function doPost(e) {
  let lock = null;
  try {
    const raw = e && e.postData && e.postData.contents;
    if (typeof raw !== "string" || raw.length > MAX_BODY) return reply({ ok: false, error: "size" });
    let d = null;
    try { d = JSON.parse(raw); } catch (err) { return reply({ ok: false, error: "json" }); }
    if (!d || typeof d !== "object" || Array.isArray(d)) return reply({ ok: false, error: "json" });
    if (TOKEN === "__TOKEN__" || typeof d.token !== "string" || d.token !== TOKEN) return reply({ ok: false, error: "token" });
    const bad = checkReport(d);
    if (bad) return reply({ ok: false, error: "data" });
    lock = LockService.getScriptLock();
    lock.waitLock(20000);
    const ss = openBook();
    const rows = writeMonth(ss, d);
    writeOverview(ss, d);
    return reply({ ok: true, month: d.month, rows: rows.tx, items: rows.items });
  } catch (err) {
    return reply({ ok: false, error: "server" });
  } finally {
    if (lock) { try { lock.releaseLock(); } catch (err2) {} }
  }
}

const isInt = function (v, lo, hi) { return typeof v === "number" && isFinite(v) && Math.floor(v) === v && v >= lo && v <= hi; };
const isStr = function (v, max) { return typeof v === "string" && v.length <= max; };
const isDay = function (v) { return typeof v === "string" && /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(v); };

// 形・型・長さの点検。問題があれば理由の文字（中身は含めない）、なければ ""
function checkReport(d) {
  if (typeof d.month !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(d.month)) return "month";
  const s = d.summary;
  if (!s || typeof s !== "object") return "summary";
  const keys = ["total", "prevTotal", "count", "itemCount", "savedDays", "invest", "invested"];
  for (let i = 0; i < keys.length; i++) if (!isInt(s[keys[i]], -1e12, 1e12)) return "summary";
  if (!Array.isArray(d.tx) || d.tx.length > MAX_TX) return "tx";
  let items = 0;
  for (let i = 0; i < d.tx.length; i++) {
    const x = d.tx[i];
    if (!x || typeof x !== "object" || !isInt(x.id, 1, 1e6) || !isDay(x.d) || x.d.slice(0, 7) !== d.month || !isStr(x.s, 200) || !isInt(x.t, -1e12, 1e12)) return "tx";
    if (PAY_NAMES.indexOf(x.pay) < 0 || !isStr(x.card, 100) || REG_NAMES.indexOf(x.reg) < 0 || !Array.isArray(x.items) || x.items.length > MAX_ITEMS_PER_TX) return "tx";
    items += x.items.length;
    if (items > MAX_ITEMS) return "items";
    for (let j = 0; j < x.items.length; j++) {
      const it = x.items[j];
      if (!it || typeof it !== "object" || !isStr(it.n, 200) || !isInt(it.p, -1e12, 1e12)) return "items";
    }
  }
  if (!Array.isArray(d.invests) || d.invests.length > MAX_INVESTS) return "invests";
  for (let i = 0; i < d.invests.length; i++) { const v = d.invests[i]; if (!v || !isDay(v.d) || !isInt(v.a, 0, 1e12)) return "invests"; }
  return "";
}

// 保存先のスプレッドシート。初回に作り、IDを覚える（消された・開けないときは作り直す）
function openBook() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty(BOOK_PROP);
  if (id) { try { return SpreadsheetApp.openById(id); } catch (err) {} }
  const ss = SpreadsheetApp.create(BOOK_NAME);
  props.setProperty(BOOK_PROP, ss.getId());
  const first = ss.getSheets()[0];
  if (first) first.setName("概要");
  return ss;
}
// 先頭が = + - @ の文字が数式にならないよう、文字の列は「書式なしテキスト」にしてから書く
function putTable(sh, row, col, head, body, textCols) {
  const n = body.length + 1, w = head.length;
  if (sh.getMaxRows() < row + n - 1) sh.insertRowsAfter(sh.getMaxRows(), row + n - 1 - sh.getMaxRows());
  if (sh.getMaxColumns() < col + w - 1) sh.insertColumnsAfter(sh.getMaxColumns(), col + w - 1 - sh.getMaxColumns());
  textCols.forEach(function (c) { sh.getRange(row, col + c, n, 1).setNumberFormat("@"); });
  sh.getRange(row, col, 1, w).setValues([head]);
  if (body.length) sh.getRange(row + 1, col, body.length, w).setValues(body);
}
// 月ごとのシート「YYYY-MM」：取引（A〜G）・品目（I〜K）・投資（M〜N）。同じ月は全部消して書き直す（重複しない）
function writeMonth(ss, d) {
  const sh = ss.getSheetByName(d.month) || ss.insertSheet(d.month);
  sh.clear();
  const tx = [], items = [];
  d.tx.forEach(function (x) {
    tx.push([x.id, x.d, x.s, x.t, x.pay, x.card, x.reg]);
    x.items.forEach(function (it) { items.push([x.id, it.n, it.p]); });
  });
  putTable(sh, 1, 1, ["取引ID", "日付", "店名", "金額", "支払い", "カード", "登録方法"], tx, [1, 2, 4, 5, 6]);
  putTable(sh, 1, 9, ["取引ID", "品名", "金額"], items, [1]);
  putTable(sh, 1, 13, ["投資の日付", "投資の金額"], d.invests.map(function (v) { return [v.d, v.a]; }), [0]);
  return { tx: tx.length, items: items.length };
}
// 「概要」シート：月ごとに1行（同じ月は更新）
function writeOverview(ss, d) {
  const sh = ss.getSheetByName("概要") || ss.insertSheet("概要", 0);
  const head = ["月", "合計", "前月合計", "前月との差", "前月比(%)", "取引数", "品目数", "使わなかった日数", "貯まった投資額", "投資した金額", "更新"];
  if (sh.getLastRow() < 1) sh.getRange(1, 1, 1, head.length).setValues([head]);
  const s = d.summary;
  const row = [d.month, s.total, s.prevTotal, s.total - s.prevTotal, s.prevTotal > 0 ? Math.round(s.total / s.prevTotal * 1000) / 10 : "", s.count, s.itemCount, s.savedDays, s.invest, s.invested, new Date().toISOString()];
  const last = sh.getLastRow();
  let at = 0;
  if (last >= 2) {
    const months = sh.getRange(2, 1, last - 1, 1).getValues();
    for (let i = 0; i < months.length; i++) if (String(months[i][0]) === d.month) { at = i + 2; break; }
  }
  if (!at) at = Math.max(last, 1) + 1;
  sh.getRange(at, 1, 1, 1).setNumberFormat("@");
  sh.getRange(at, 1, 1, row.length).setValues([row]);
}

// 本文を読む。まずプレーンテキスト。読めなければ、HTML版からタグを除いた文字列で読み直す（HTMLだけ・表組みのメール用）
function readMessage(is, m) {
  const subject = m.getSubject();
  const got = is.parse(subject, m.getPlainBody());
  if (got.length) return got;
  let html = "";
  try { html = m.getBody(); } catch (err) { html = ""; }
  if (!html) return got;
  const alt = is.parse(subject, htmlToText(html));
  if (alt.length) return alt;
  return alt.skipped && !got.skipped ? alt : got;
}

// HTML → 文字列。表のセル・行・段落・改行の境目は改行にし、実体参照は元の文字に戻す
function htmlToText(html) {
  const ent = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", yen: "¥" };
  return String(html || "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|head)[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<br\s*\/?>|<\/(td|th|tr|p|div|li|ul|ol|table|h[1-6])\s*>|<(tr|p|div|li|table|h[1-6])[\s>\/]/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&#x([0-9a-f]+);/gi, function (_, h) { return String.fromCharCode(parseInt(h, 16)); })
    .replace(/&#(\d+);/g, function (_, d) { return String.fromCharCode(Number(d)); })
    .replace(/&([a-z]+);/gi, function (all, n) { return Object.prototype.hasOwnProperty.call(ent, n.toLowerCase()) ? ent[n.toLowerCase()] : all; })
    .replace(/[\u200b-\u200d\ufeff]/g, "")
    .replace(/[ \t\u3000\u00a0]+/g, " ")
    .replace(/ *\n[ \n]*/g, "\n")
    .trim();
}

function reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ---- 三井住友カード「ご利用のお知らせ」 ----
// 例：ご利用日時：2026/11/08 17:53 ／ 利用先（買物） ／ 341円
// HTMLメール（表組み・全角英数・折り返し）は、htmlToText で文字列にしてから、同じ関数で読む
function parseSmbc(subject, body) {
  const t = String(body || "").normalize("NFKC").replace(/\r/g, "").replace(/[\u200b-\u200d\ufeff]/g, "");
  const re = /ご利用日時\s*[:：]\s*(\d{4})\/(\d{1,2})\/(\d{1,2})\s*(\d{1,2}):(\d{2})/g;
  const marks = [];
  let m;
  while ((m = re.exec(t))) marks.push({ at: m.index, end: re.lastIndex, m: m });
  const out = [];
  marks.forEach(function (k, i) {
    let stop = i + 1 < marks.length ? marks[i + 1].at : t.length;
    const foot = t.indexOf("本メールは", k.end);          // 注意書き以降は読まない
    if (foot >= 0 && foot < stop) stop = foot;
    const seg = t.slice(k.end, stop);
    const a = seg.match(/(\d[\d,]*)\s*円/);
    if (!a) return;
    const fold = function (x) { return x.replace(/\s+/g, " ").trim().replace(/\(([^()]*)\)/g, function (_, k) { return "(" + k.replace(/\s+/g, "") + ")"; }); };   // 「（買\n物）」のように途中で折り返されても「（買物）」にする
    let store = fold(seg.slice(0, a.index));
    if (!store) store = (seg.slice(a.index + a[0].length).split("\n").map(fold).filter(Boolean)[0] || "");
    let kind = "";
    const km = store.match(/\(([^()]*)\)\s*$/);
    if (km) { kind = km[1]; store = store.slice(0, km.index).trim(); }
    const pad = function (n) { return ("0" + n).slice(-2); };
    out.push({
      date: k.m[1] + "-" + pad(k.m[2]) + "-" + pad(k.m[3]),
      time: pad(k.m[4]) + ":" + k.m[5],
      store: store.slice(0, 60),
      kind: kind,
      amount: Number(a[1].replace(/,/g, "")),
      cancel: /取消|取り消し|キャンセル|返品/.test(String(subject || "").normalize("NFKC") + seg)
    });
  });
  return out;
}

// ---- JCBカード「ご利用のお知らせ」 ----
// 例：【ご利用日時(日本時間)】 2026/11/11 15:16 ／ 【ご利用金額】 180円 ／ 【ご利用先】 アツプルドツトコム
// 「▼」から後ろは注意書きなので読まない。金額が日本円の整数でないもの（外貨など）は、誤って読まないよう読み飛ばす
function parseJcb(subject, body) {
  const t = String(body || "").normalize("NFKC").replace(/\r/g, "");
  const subj = String(subject || "").normalize("NFKC");
  const re = /【ご利用日時[^】]*】/g;
  const marks = [];
  let m;
  while ((m = re.exec(t))) marks.push(m.index);
  const kind = /キャッシング/.test(subj) ? "キャッシング" : /ショッピング/.test(subj) ? "買物" : "その他";   // 買物でなければ、アプリは自動では記録しない（要確認）
  const pad = function (n) { return ("0" + n).slice(-2); };
  const out = [];
  out.skipped = 0;
  marks.forEach(function (at, i) {
    let stop = i + 1 < marks.length ? marks[i + 1] : t.length;
    const note = t.indexOf("▼", at);                          // 注意書き以降は読まない
    if (note >= 0 && note < stop) stop = note;
    const seg = t.slice(at, stop);
    const d = seg.match(/【ご利用日時[^】]*】\s*(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})/);
    const a = seg.match(/【ご利用金額】\s*(\d[\d,]*)\s*円/);
    const amount = a ? Number(a[1].replace(/,/g, "")) : 0;
    if (!d || !a || !(amount > 0)) { out.skipped++; return; }
    const s = seg.match(/【ご利用先】\s*([^\n【]*)/);
    out.push({
      date: d[1] + "-" + pad(d[2]) + "-" + pad(d[3]),
      time: pad(d[4]) + ":" + d[5],
      store: (s ? s[1].replace(/\s+/g, " ").trim() : "").slice(0, 60),
      kind: kind,
      amount: amount,
      cancel: /取消|取り消し|キャンセル|返品/.test(subj + seg)
    });
  });
  return out;
}
