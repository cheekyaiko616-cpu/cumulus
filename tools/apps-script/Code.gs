/**
 * Cumulus：カードの利用通知メールを読み取る小さなプログラム
 *
 * ・あなたのGoogleアカウントの中だけで動きます
 * ・読み取るのは、下の ISSUERS に書いた送信元の「ご利用のお知らせ」メールだけです
 * ・アプリに返すのは、日付・時刻・金額・利用先だけです（メールの本文は返しません）
 * ・TOKEN（合言葉）が一致しない呼び出しには、何も返しません
 */
const TOKEN = "__TOKEN__";   // アプリが作った合言葉。アプリの「スクリプトをコピー」で自動で入ります
const DEFAULT_DAYS = 45;     // 何日前までのメールを見るか
const MAX_THREADS = 100;     // 一度に見るメールの上限

const ISSUERS = [
  { id: "smbc", sender: "@vpass.ne.jp", query: 'from:statement@vpass.ne.jp subject:"ご利用のお知らせ"', parse: parseSmbc },
  // JCB：メールの書式を確認でき次第、ここに追加します
];

function doGet(e) {
  const p = (e && e.parameter) || {};
  if (TOKEN === "__TOKEN__" || !p.token || p.token !== TOKEN) return reply({ ok: false, error: "token" });
  const days = Math.max(1, Math.min(120, Number(p.days) || DEFAULT_DAYS));
  const since = Date.now() - days * 86400000;
  const items = [];
  let unreadable = 0;
  ISSUERS.forEach(function (is) {
    GmailApp.search(is.query + " newer_than:" + days + "d", 0, MAX_THREADS).forEach(function (th) {
      th.getMessages().forEach(function (m) {
        if (String(m.getFrom()).toLowerCase().indexOf(is.sender) < 0) return;   // 送信元が違うものは読まない
        if (m.getDate().getTime() < since) return;
        const got = is.parse(m.getSubject(), m.getPlainBody());
        if (!got.length) { unreadable++; return; }
                got.forEach(function (g, i) { items.push(Object.assign({ id: m.getId() + (i ? "-" + i : ""), issuer: is.id }, g)); });
      });
    });
  });
  return reply({ ok: true, items: items, unreadable: unreadable, at: new Date().toISOString() });
}

function reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ---- 三井住友カード「ご利用のお知らせ」 ----
// 例：ご利用日時：2026/11/08 17:53 ／ 利用先（買物） ／ 341円
function parseSmbc(subject, body) {
  const t = String(body || "").normalize("NFKC").replace(/\r/g, "");
  const re = /ご利用日時\s*[:：]\s*(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})/g;
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
    let store = seg.slice(0, a.index).replace(/\s+/g, " ").trim();
    if (!store) store = (seg.slice(a.index + a[0].length).split("\n").map(function (x) { return x.replace(/\s+/g, " ").trim(); }).filter(Boolean)[0] || "");
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
