"use strict";
// ===== 月次レポート用のデータ =====
// 役割: 指定した月の全件（取引・品目）と集計・投資の記録を、Claudeに渡す・Googleスプレッドシートへ送る形（JSON）にまとめ、貼り付け用の文章（依頼文＋表）と送信の本文を作る。送らないもの（支店名・メモ・番号・写真・URL・合言葉）は、ここで取り除く。集計は rangeStats・payBreakdown を使う。通信と画面は features/report.js
// 依存: util.js, model.js, billing.js, stats.js
// 実行時: receipt-dict.js
// 公開: REPORT_MAX_TX, REPORT_MAX_ITEMS, normReport, reportPrevMonth, reportMonths, reportMonthSpan, reportClean, reportStore, reportBuild, reportOver, reportText, reportPlan, reportBody, reportDue, reportSamples

const REPORT_MAX_TX = 5000, REPORT_MAX_ITEMS = 20000;   // 1か月の取引・品目の上限（Code.gs と同じ）
const REPORT_PART_TX = 1500, REPORT_PART_ITEMS = 4000;   // 1回の送信の取引・品目の上限（超える月は、取引を区切りに分けて送る。ふつうの月は1回）
const REPORT_NAME = 60;                                 // 店名・品名の長さの上限
const REPORT_REG = { hand: "手入力・レシート", mail: "メール", both: "メール・レシート" };   // 登録方法（まとめの札と同じ呼び方）

// ---- 月の計算（"2026-10" の形。月は1始まり） ----
const reportPrevMonth = (mk) => { const y = Number(mk.slice(0, 4)), m = Number(mk.slice(5, 7)); return m === 1 ? (y - 1) + "-12" : y + "-" + pad(m - 1); };
const reportMonthSpan = (mk) => { const y = Number(mk.slice(0, 4)), m = Number(mk.slice(5, 7)) - 1; return [ymd(y, m, 1), lastKey(y, m)]; };
// 選べる月：先月から12か月前まで（新しい順）
function reportMonths(today) {
  const out = []; let k = reportPrevMonth(today.slice(0, 7));
  for (let i = 0; i < 12; i++) { out.push(k); k = reportPrevMonth(k); }
  return out;
}

// ---- 設定（別の保存キー KEY_RP）：on=月次の自動送信、anon=店名を置き換える、last=送信済みの最も新しい月、dm・n・at・unc=直近の送信の結果 ----
function normReport(raw) {
  let r = raw;
  if (typeof r === "string") { try { r = JSON.parse(r); } catch (e) { r = null; } }
  r = r && typeof r === "object" ? r : {};
  const mk = (v) => typeof v === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(v) ? v : "";
  return { on: r.on === true, anon: r.anon === true, last: mk(r.last), dm: mk(r.dm), n: Number.isInteger(r.n) && r.n >= 0 ? r.n : 0, at: Number.isFinite(r.at) ? r.at : 0, unc: r.unc === true };
}
// 自動で送る月：オンで、先月より前の月までしか送っていないとき、先月。それ以外は ""
const reportDue = (rp, today) => { const m = reportPrevMonth(today.slice(0, 7)); return rp.on && rp.last < m ? m : ""; };

// ---- 取り除く ----
// 文字を整え、8桁以上の連続した数字（JANコード等）と、区切りつきの12桁以上の数字（カード番号の形）を除く
const reportClean = (s, max) => String(s || "").normalize("NFKC").replace(/\d(?:[ -]?\d){11,}/g, " ").replace(/\d{8,}/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
// 地名らしい語か：市区町村の辞書にある、または2字以上で地名によくある字で終わる
const reportPlace = (x) => RC_CITIES.has(x) || (x.length >= 2 && /(駅前|駅|町|区|市|村|台|丘|口|通り|橋|浜|原|野|崎|川|島|谷|沢|山)$/.test(x));
// 店名：辞書のチェーンはチェーン名に（支店名がどんな名前でも「◯◯店」で終わるなら除く）。そうでなければ、末尾の「地名＋店」だけを除く（書店・商店・山田食堂は残す。空にはしない）
const REPORT_KANJI_BRANCH = /^(.{2,}?)[\u4e00-\u9fff]{1,4}(?:駅前|駅|町|区|市|村|台|丘)(?:支店|店)$/;
function reportStore(raw) {
  const t0 = reportClean(raw, 200);
  if (!t0) return "";
  const k = shopKey(t0);
  if (k.key[0] === "c") return k.name;
  const n = shopNorm(t0);
  for (const c of shopChains()) if (n.startsWith(c.k) && /^.{0,10}?(?:支店|店)$/.test(n.slice(c.k.length))) return c.name;
  let t = t0.replace(/\s*\([^()]*店\)$/, "").trim() || t0, m;
  if ((m = t.match(/^(.+?)\s+(\S{1,8}?)(?:支店|店)$/)) && reportPlace(m[2])) t = m[1];
  else {
    let best = "";
    RC_CITIES.forEach((c) => { if (c.length > best.length && t.length > c.length + 2 && (t.endsWith(c + "店") || t.endsWith(c + "支店"))) best = c; });
    if (best) t = t.slice(0, t.lastIndexOf(best)).trim() || t;
    else if ((m = t.match(REPORT_KANJI_BRANCH))) t = m[1].trim() || t;
  }
  return t.slice(0, REPORT_NAME) || t0.slice(0, REPORT_NAME);
}
const reportLetters = (n) => { let s = ""; n++; while (n > 0) { n--; s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26); } return s; };

// ---- 月のデータ ----
// month："2026-10"、anon：店名を「店A・店B…」に置き換える（金額の多い順。同じ店は同じ記号）。画面を触らない（byDate は stats.js が作ったもの）
function reportBuild(month, anon) {
  const [from, to] = reportMonthSpan(month), [pf, pt] = reportMonthSpan(reportPrevMonth(month));
  const st = rangeStats(from, to), pv = rangeStats(pf, pt);
  const list = state.entries.filter((e) => e.date >= from && e.date <= to).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const memo = new Map();
  const nameOf = (raw) => { let v = memo.get(raw); if (v === undefined) { v = reportStore(raw); memo.set(raw, v); } return v; };
  let itemCount = 0;
  const tx = list.map((e, i) => {
    const reg = e.src === "mail" ? (e.rc ? REPORT_REG.both : REPORT_REG.mail) : REPORT_REG.hand;
    const items = e.items.map((it) => ({ n: reportClean(it.n, REPORT_NAME), p: it.p }));
    itemCount += items.length;
    return { id: i + 1, d: e.date, s: nameOf(e.store), t: e.total, pay: PAY[e.pay], card: e.pay === "credit" ? reportClean(e.card, 40) : "", reg, items };
  });
  if (anon) {
    const sum = new Map();
    tx.forEach((x) => { if (x.s) { const k = shopNorm(x.s); sum.set(k, (sum.get(k) || 0) + x.t); } });
    const id = new Map([...sum.keys()].sort((a, b) => sum.get(b) - sum.get(a) || (a < b ? -1 : 1)).map((k, i) => [k, "店" + reportLetters(i)]));
    tx.forEach((x) => { if (x.s) x.s = id.get(shopNorm(x.s)); });
  }
  const pay = payBreakdown(from, to).rows.map((r) => ({ name: r.pay === "credit" ? reportClean(r.name, 40) || NO_CARD : r.name, sum: r.sum, n: r.n }));
  const invests = state.invests.filter((v) => v.date >= from && v.date <= to).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)).map((v) => ({ d: v.date, a: v.amount }));
  return { v: 1, month, anon: !!anon, summary: { total: st.spent, prevTotal: pv.spent, count: tx.length, itemCount, savedDays: st.savedDays, invest: st.invest, invested: st.invested }, pay, tx, invests };
}
const reportOver = (d) => d.tx.length > REPORT_MAX_TX || d.summary.itemCount > REPORT_MAX_ITEMS;
// 送り方の計画：取引（と、その品目）を、順番どおり REPORT_PART_TX 件・品目 REPORT_PART_ITEMS 件までずつの分けにする（ふつうの月は1つ）。txAt・itemAt は、その分より前の取引・品目の数（スプレッドシートの書き込み位置）
function reportPlan(d) {
  const out = []; let cur = [], items = 0, txAt = 0, itemAt = 0;
  d.tx.forEach((x) => {
    if (cur.length && (cur.length >= REPORT_PART_TX || items + x.items.length > REPORT_PART_ITEMS)) { out.push({ tx: cur, txAt, itemAt }); txAt += cur.length; itemAt += items; cur = []; items = 0; }
    cur.push(x); items += x.items.length;
  });
  out.push({ tx: cur, txAt, itemAt });
  return out;
}
// 送信の本文（合言葉は本文に入れる。URLには付けない）。支払い方法別（pay）・店名の置き換えの印は送らない（シート側で使わない）。集計と投資の記録は最後の分だけに入れる。sid は、この送信を見分ける印（保存できたかの確認に使う）
function reportBody(d, token, sid, plan, i) {
  if (!sid) return JSON.stringify({ token, v: 1, month: d.month, summary: d.summary, tx: d.tx, invests: d.invests });
  const p = plan[i], last = i === plan.length - 1, o = { token, v: 1, month: d.month, sid, seq: i, last, txAt: p.txAt, itemAt: p.itemAt, tx: p.tx };
  if (last) { o.summary = d.summary; o.invests = d.invests; }
  return JSON.stringify(o);
}
// 確認用：金額の多い店の例（空の店名は除く）
function reportSamples(d, n) {
  const g = new Map();
  d.tx.forEach((x) => { if (x.s) g.set(x.s, (g.get(x.s) || 0) + x.t); });
  return [...g.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, n).map(([s, t]) => ({ s, t }));
}

// ---- Claudeに貼る文章 ----
const reportCell = (v) => { const s = String(v); return (/[",\r\n]/.test(s)) ? '"' + s.replace(/"/g, '""') + '"' : s; };
const reportRow = (a) => a.map(reportCell).join(",");
function reportText(d) {
  const y = Number(d.month.slice(0, 4)), m = Number(d.month.slice(5, 7)), s = d.summary, diff = s.total - s.prevTotal;
  const L = [
    "以下は私の" + y + "年" + m + "月の家計簿データです。月次レポートと、減らせる支出のアドバイスを作ってください。",
    "・支出の振り返り：合計、前月との比較、支払い方法別、金額や回数の多い支出",
    "・減らせそうな支出と、その具体的な方法（効果の大きい順）",
    "・来月の目安",
    "金額の単位は円。店名は" + (d.anon ? "「店A」などの記号に置き換えてあります（同じ記号は同じ店）。" : "チェーン名に整理し、支店名は除いてあります。") + "品目は品名と金額です。",
    "",
    "# 集計", "項目,値",
    reportRow(["月", d.month]), reportRow(["合計", s.total]), reportRow(["前月合計", s.prevTotal]), reportRow(["前月との差", (diff > 0 ? "+" : "") + diff]),
    reportRow(["取引数", s.count]), reportRow(["品目数", s.itemCount]), reportRow(["使わなかった日数", s.savedDays]), reportRow(["貯まった投資額", s.invest]), reportRow(["投資した金額", s.invested]),
    "", "# 支払い方法別", "支払い,金額,件数"].concat(d.pay.map((r) => reportRow([r.name, r.sum, r.n])));
  L.push("", "# 取引", "取引ID,日付,店名,金額,支払い,カード,登録方法");
  d.tx.forEach((x) => L.push(reportRow([x.id, x.d, x.s, x.t, x.pay, x.card, x.reg])));
  L.push("", "# 品目", "取引ID,品名,金額");
  d.tx.forEach((x) => x.items.forEach((i) => L.push(reportRow([x.id, i.n, i.p]))));
  if (d.invests.length) { L.push("", "# 投資の記録", "日付,金額"); d.invests.forEach((v) => L.push(reportRow([v.d, v.a]))); }
  return L.join("\n");
}
