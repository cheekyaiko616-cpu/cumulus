/**
 * Cumulus：カードの利用通知メールを読み取る小さなプログラム
 *
 * ・あなたのGoogleアカウントの中だけで動きます
 * ・読み取るのは、下の ISSUERS に書いた送信元（三井住友カード・JCB）の「ご利用のお知らせ」メールだけです
 * ・アプリに返すのは、日付・時刻・金額・利用先だけです（メールの本文は返しません）
 * ・TOKEN（合言葉）が一致しない呼び出しには、何も返しません
 */
const TOKEN = "__TOKEN__";   // アプリが作った合言葉。アプリの「スクリプトをコピー」で自動で入ります
const DEFAULT_DAYS = 45;     // 何日前までのメールを見るか
const MAX_THREADS = 100;     // 一度に見るメールの上限

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
