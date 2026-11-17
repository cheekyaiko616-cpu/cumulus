/**
 * Cumulus：カードの利用通知メールを読み取る小さなプログラム
 *
 * ・あなたのGoogleアカウントの中だけで動きます
 * ・読み取るのは、下の ISSUERS に書いた送信元（三井住友カード・JCB）の「ご利用のお知らせ」メールだけです
 * ・アプリに返すのは、日付・時刻・金額・利用先だけです（メールの本文は返しません）
 * ・TOKEN（合言葉）が一致しない呼び出しには、何も返しません
 * ・月次レポート（doPost）：アプリが月が替わると送る「先月の取引の全件」を、あなたのGoogleドライブのスプレッドシート「Cumulus 月次」に保存します（月ごとのシート「YYYY-MM」と「概要」。同じ月は上書き。月のシートは、取引 A〜I・品目 K〜M・投資 O〜P。取引には曜日と区分（積立・投資／日常）の列があります）。スプレッドシートの権限が必要です（更新後の初回に許可を求められます）
 * ・書き込みは、件数に関わらず一定回数（範囲ごとに1回の setValues・最後に flush 1回）。数千件を送るときは、アプリが数回に分けて送ります（最初の分で全消去、続きは決まった行へ書く）。実行時間の上限は6分。目安は、通常の月（数百件）で数秒、初回（スプレッドシートの作成を含む）で10秒前後、5,000件で1回の分けあたり数秒
 * ・保存できたかは、doGet の action=status で確かめられます（版・月・件数・時刻だけを返し、記録の中身は返しません）
 * ・貼り替えたあとは、エディタ上部の関数名の欄で authorizeReport を選んで「実行」し、許可を与えてから、新バージョンでデプロイしてください（ウェブアプリは、許可が済むまで止まることがあります）
 */
const TOKEN = "__TOKEN__";   // アプリが作った合言葉。アプリの「スクリプトをコピー」で自動で入ります
const DEFAULT_DAYS = 45;     // 何日前までのメールを見るか
const MAX_THREADS = 100;     // 一度に見るメールの上限

// ---- 月次レポート（doPost）の決まり ----
const BOOK_NAME = "Cumulus 月次";   // 保存先のスプレッドシート名（初回に作り、IDをスクリプトの保存領域に覚える）
const BOOK_PROP = "REPORT_BOOK_ID";
const MAX_BODY = 3000000;            // 受け取る本文の上限（文字数。分けて送るときは1回ぶん）
const CUR_PROP = "REPORT_CUR", DONE_PROP = "REPORT_DONE";   // 送信の途中経過（分けて送るとき）・最後に保存できた月（状態の確認用）
const LOCK_MS = 10000;               // 同時に動いている書き込みを待つ時間。取れなければ busy を返す
const MAX_PARTS = 40;
const VERSION = "3";                  // スクリプトの版＝データ版（3＝取引に曜日・区分の列、概要の新しい列。アプリは、3未満だと送らずに貼り替えを案内する）
const MAX_TX = 5000, MAX_ITEMS = 20000, MAX_INVESTS = 500, MAX_ITEMS_PER_TX = 200;
const PAY_NAMES = ["現金", "バーコード決済", "クレジット"];
const REG_NAMES = ["手入力・レシート", "メール", "メール・レシート"];
const WEEK_NAMES = ["月", "火", "水", "木", "金", "土", "日"], KIND_NAMES = ["積立・投資", "日常"];

const ISSUERS = [
  { id: "smbc", sender: "@vpass.ne.jp", query: 'from:statement@vpass.ne.jp subject:"ご利用のお知らせ"', parse: parseSmbc },
  { id: "jcb", sender: "@qa.jcb.co.jp", query: 'from:mail@qa.jcb.co.jp subject:"ご利用のお知らせ"', parse: parseJcb },
];

function doGet(e) {
  const p = (e && e.parameter) || {};
  if (TOKEN === "__TOKEN__" || !p.token || p.token !== TOKEN) return reply({ ok: false, error: "token" });
  if (p.action === "status") return reportStatus(p);
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
// 本文：{token, month, sid, seq, last, txAt, itemAt, tx, summary, invests}。分けない送信は seq 省略（=0・last=true）。分けるときは seq=0 で全消去、続きの seq は txAt・itemAt の行から書く（同じ seq を送り直しても重複しない）。summary・invests は last のときだけ
// 返すのは {ok, month, rows, items, seq, last}。エラーは {ok:false, error:"token"|"json"|"size"|"data"|"busy"|"order"|"server"} だけ。取引の中身はログに出さない
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
    if (!lock.tryLock(LOCK_MS)) { lock = null; return reply({ ok: false, error: "busy" }); }   // ほかの書き込み中。待ち続けずに返す（アプリは後で試し直す）
    const seq = d.seq || 0, last = d.last !== false, props = PropertiesService.getScriptProperties();
    if (seq > 0) {                                                                           // 続きの分け：直前までの分と同じ送信（sid）・月のときだけ書く
      const cur = readProp(props, CUR_PROP);
      if (!cur || cur.sid !== d.sid || cur.month !== d.month || (seq !== cur.seq && seq !== cur.seq + 1)) return reply({ ok: false, error: "order" });
    }
    const ss = openBook(props);
    const w = writeMonth(ss, d, seq);
    if (!w) return reply({ ok: false, error: "order" });
    if (last) writeOverview(ss, d);
    SpreadsheetApp.flush();                                                                  // 最後に1回だけ
    const sid = typeof d.sid === "string" ? d.sid : "";
    if (last) { props.setProperty(DONE_PROP, JSON.stringify({ sid: sid, month: d.month, rows: w.rows, items: w.items, at: new Date().toISOString() })); props.deleteProperty(CUR_PROP); }
    else props.setProperty(CUR_PROP, JSON.stringify({ sid: sid, month: d.month, seq: seq }));
    return reply({ ok: true, month: d.month, rows: w.rows, items: w.items, seq: seq, last: last });
  } catch (err) {
    return reply({ ok: false, error: "server" });
  } finally {
    if (lock) { try { lock.releaseLock(); } catch (err2) {} }
  }
}
// 許可を与えるためだけの関数。エディタで1回実行する（データは作らない・書かない。スプレッドシートとドライブに触れる許可の画面を出すだけ）
function authorizeReport() {
  SpreadsheetApp.getActiveSpreadsheet();
  DriveApp.getRootFolder().getName();
  PropertiesService.getScriptProperties().getProperty(BOOK_PROP);
}
function readProp(props, k) { try { return JSON.parse(props.getProperty(k) || "null"); } catch (err) { return null; } }

// ---- 保存の確認（GET ?action=status&month=YYYY-MM&sid=…&token=…）。月・件数・時刻と、その送信（sid）が最後まで保存されたかだけを返す。記録の中身は返さない ----
function reportStatus(p) {
  const props = PropertiesService.getScriptProperties();
  const done = readProp(props, DONE_PROP), cur = readProp(props, CUR_PROP);
  const sid = typeof p.sid === "string" ? p.sid : "";
  const mine = !!done && !!sid && done.sid === sid;
  return reply({ ok: true, version: VERSION, hasSheet: !!props.getProperty(BOOK_PROP), lastMonth: done ? done.month : "", rows: done ? done.rows : 0, saved: mine, partial: !mine && !!cur && !!sid && cur.sid === sid, at: done ? done.at : "" });
}

const isInt = function (v, lo, hi) { return typeof v === "number" && isFinite(v) && Math.floor(v) === v && v >= lo && v <= hi; };
const isStr = function (v, max) { return typeof v === "string" && v.length <= max; };
const isDay = function (v) { return typeof v === "string" && /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(v); };

// 形・型・長さの点検。問題があれば理由の文字（中身は含めない）、なければ ""
function checkReport(d) {
  if (typeof d.month !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(d.month)) return "month";
  const part = d.seq !== undefined || d.last !== undefined || d.txAt !== undefined || d.itemAt !== undefined || d.sid !== undefined;
  if (part && !(isInt(d.seq, 0, MAX_PARTS) && typeof d.last === "boolean" && isInt(d.txAt, 0, MAX_TX) && isInt(d.itemAt, 0, MAX_ITEMS) && isStr(d.sid, 64) && d.sid && (d.seq > 0 || (d.txAt === 0 && d.itemAt === 0)))) return "part";
  const last = d.last !== false;
  if (last) {
    const s = d.summary;
    if (!s || typeof s !== "object") return "summary";
    const keys = ["total", "dailyTotal", "saveTotal", "prevTotal", "count", "itemCount", "savedDays", "invest", "invested"];
    for (let i = 0; i < keys.length; i++) if (!isInt(s[keys[i]], -1e12, 1e12)) return "summary";
    if (!(s.uncalc === "" || isDay(s.uncalc)) || !(s.partial === "" || isDay(s.partial))) return "summary";
  }
  if (!Array.isArray(d.tx) || d.tx.length > MAX_TX || (d.txAt || 0) + d.tx.length > MAX_TX) return "tx";
  let items = 0;
  for (let i = 0; i < d.tx.length; i++) {
    const x = d.tx[i];
    if (!x || typeof x !== "object" || !isInt(x.id, 1, 1e6) || !isDay(x.d) || x.d.slice(0, 7) !== d.month || !isStr(x.s, 200) || !isInt(x.t, -1e12, 1e12)) return "tx";
    if (WEEK_NAMES.indexOf(x.w) < 0 || KIND_NAMES.indexOf(x.k) < 0 || PAY_NAMES.indexOf(x.pay) < 0 || !isStr(x.card, 100) || REG_NAMES.indexOf(x.reg) < 0 || !Array.isArray(x.items) || x.items.length > MAX_ITEMS_PER_TX) return "tx";
    items += x.items.length;
    if (items > MAX_ITEMS || (d.itemAt || 0) + items > MAX_ITEMS) return "items";
    for (let j = 0; j < x.items.length; j++) {
      const it = x.items[j];
      if (!it || typeof it !== "object" || !isStr(it.n, 200) || !isInt(it.p, -1e12, 1e12)) return "items";
    }
  }
  if (!last) return "";
  if (!Array.isArray(d.invests) || d.invests.length > MAX_INVESTS) return "invests";
  for (let i = 0; i < d.invests.length; i++) { const v = d.invests[i]; if (!v || !isDay(v.d) || !isInt(v.a, 0, 1e12)) return "invests"; }
  return "";
}

// 保存先のスプレッドシート。初回に作り、IDを覚える（消された・開けないときは作り直す）。保存領域の読み書きは、通常1回の読み取りだけ
function openBook(props) {
  const id = props.getProperty(BOOK_PROP);
  if (id) { try { return SpreadsheetApp.openById(id); } catch (err) {} }
  const ss = SpreadsheetApp.create(BOOK_NAME);
  props.setProperty(BOOK_PROP, ss.getId());
  const first = ss.getSheets()[0];
  if (first) first.setName("概要");
  return ss;
}
// 範囲への書き込みは、2次元配列を1回の setValues で（行・セルごとには書かない）。足りない行・列は、必要なときだけ1回で足す
function put(sh, row, col, rows) {
  if (!rows.length) return;
  const w = rows[0].length, need = row + rows.length - 1;
  if (sh.getMaxRows() < need) sh.insertRowsAfter(sh.getMaxRows(), need - sh.getMaxRows());
  if (sh.getMaxColumns() < col + w - 1) sh.insertColumnsAfter(sh.getMaxColumns(), col + w - 1 - sh.getMaxColumns());
  sh.getRange(row, col, rows.length, w).setValues(rows);
}
// 月ごとのシート「YYYY-MM」（列見出しは1行目）：取引（A〜I：取引ID・日付・曜日・店名・金額・支払い・カード・登録方法・区分）・品目（K〜M：取引ID・品名・金額）・投資（O〜P：日付・金額）。J・N は空。同じ月は、最初の分（seq=0）で全部消して書き直す（重複しない）。続きの分は、txAt・itemAt の行へ書く
// 先頭が = + - @ の文字が数式にならないよう、文字の列は「書式なしテキスト」にしてから書く（列ごとに、最初の分で1回の呼び出し）
function writeMonth(ss, d, seq) {
  let sh = ss.getSheetByName(d.month);
  if (!sh) { if (seq > 0) return null; sh = ss.insertSheet(d.month); }   // 続きの分なのにシートがない（消された）ときは、書かない
  const first = seq === 0, txAt = d.txAt || 0, itemAt = d.itemAt || 0;
  const tx = [], items = [];
  d.tx.forEach(function (x) {
    tx.push([x.id, x.d, x.w, x.s, x.t, x.pay, x.card, x.reg, x.k]);
    x.items.forEach(function (it) { items.push([x.id, it.n, it.p]); });
  });
  if (first) {
    sh.clear();
    sh.getRangeList(["B:D", "F:I", "L:L", "O:O"]).setNumberFormat("@");
    put(sh, 1, 1, [["取引ID", "日付", "曜日", "店名", "金額", "支払い", "カード", "登録方法", "区分"]]);
    put(sh, 1, 11, [["取引ID", "品名", "金額"]]);
    put(sh, 1, 15, [["日付", "金額"]]);
  }
  put(sh, 2 + txAt, 1, tx);
  put(sh, 2 + itemAt, 11, items);
  if (d.last !== false) put(sh, 2, 15, (d.invests || []).map(function (v) { return [v.d, v.a]; }));
  return { rows: txAt + tx.length, items: itemAt + items.length };
}
// 「概要」シート：月ごとに1行（同じ月は更新）。最初の1回の読み取りで、見出しと月の列を調べ、書き込みは1回。見出しが違う（古い版の概要）ときは、古い方の名前を変えて残し、新しく作る
const OVERVIEW_HEAD = ["月", "合計", "日常支出", "積立・投資額", "前月合計", "前月比(%)", "取引件数", "使わなかった日数", "貯まった投資額", "投資した金額", "更新日時(JST)", "データ版"];
// 使わなかった日数・貯まった投資額の表記（アプリのコピー文と同じ）：月が数え始める日より前なら「未計算(開始日 …)」、月の途中からなら「n(開始日 …以降のみ)」
function calcText(s, v) { return s.uncalc ? "未計算(開始日 " + s.uncalc + ")" : s.partial ? v + "(開始日 " + s.partial + "以降のみ)" : v; }
function jstNow() { return new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 16).replace("T", " "); }
function writeOverview(ss, d) {
  let sh = ss.getSheetByName("概要") || ss.insertSheet("概要", 0);
  const head = OVERVIEW_HEAD, last = sh.getLastRow();
  const s = d.summary;
  const row = [d.month, s.total, s.dailyTotal, s.saveTotal, s.prevTotal, s.prevTotal > 0 ? Math.round(s.total / s.prevTotal * 1000) / 10 : "該当なし", s.count, calcText(s, s.savedDays), calcText(s, s.invest), s.invested, jstNow(), Number(VERSION)];
  const all = last >= 1 ? sh.getRange(1, 1, last, head.length).getValues() : [];
  let rows = last, at = 0;
  if (last >= 1 && all[0].join("|") !== head.join("|")) {
    sh.setName("概要(旧 " + jstNow().replace(/[- :]/g, "") + ")");
    sh = ss.insertSheet("概要", 0);
    rows = 0;
  } else {
    for (let i = 1; i < all.length; i++) if (String(all[i][0]) === d.month) { at = i + 1; break; }
  }
  if (!at) at = Math.max(rows, 1) + 1;
  if (rows < 1) sh.getRange(1, 1, 1, head.length).setValues([head]);
  sh.getRange(at, 1).setNumberFormat("@");
  sh.getRange(at, 11).setNumberFormat("@");
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
