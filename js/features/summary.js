"use strict";
// ===== まとめ画面 =====
// 役割: 週・月・年・期間指定（標準は月）の、使った金額・投資資金・支払い方法ごとの内訳・クレジットの引き落とし・買い物の一覧
// 依存: util.js, model.js, stats.js, billing.js, period.js, dom.js, rows.js, range-input.js
// 実行時: なし
// 公開: period, sumAnchor, customFrom, customTo, renderSummary

let period = "month", sumAnchor = todayStr();
let [customFrom, customTo] = presetRange("month");

function periodRange() {
  if (period === "custom") return { from: customFrom, to: customTo, label: "期間を指定" };
  return unitRange(period, sumAnchor);
}
function renderSummary() {
  setSeg($("periodSeg"), (b) => b.dataset.p === period);
  $("navRow").hidden = period === "custom"; $("customBox").hidden = period !== "custom";
  if (period === "custom") { $("cFrom").value = customFrom; $("cTo").value = customTo; }
  const r = periodRange(), st = rangeStats(r.from, r.to), span = daysBetween(r.from, r.to) + 1;
  $("periodLabel").textContent = r.label;
  $("periodSpan").textContent = ymdLabel(r.from) + " 〜 " + ymdLabel(r.to) + "（" + span + "日間）";
  $("pSpent").textContent = yen(st.spent);
  $("pInvest").textContent = yen(st.invest);
  const list = state.entries.filter((e) => e.date >= r.from && e.date <= r.to).sort((a, b) => a.date < b.date ? 1 : -1);
  const groups = {};
  list.forEach((e) => { const k = payLabel(e); (groups[k] = groups[k] || { sum: 0, color: payColor(e) }).sum += e.total; });
  const rows = Object.entries(groups).sort((a, b) => b[1].sum - a[1].sum), max = rows.length ? rows[0][1].sum : 0;
  $("payBars").innerHTML = rows.length ? rows.map(([k, g]) => '<div class="bar-row"><span class="nm">' + esc(k) + '</span><span class="bar"><i style="width:' + (g.sum / max * 100).toFixed(1) + "%;background:" + g.color + '"></i></span><b class="num">' + yen(g.sum) + "</b></div>").join("") : emptyHtml("この期間の買い物はありません");
  // この期間に引き落とし日が来るカード代（支払い方法の下に小さく添える）
  const pl = paysIn(r.from, r.to);
  $("payDeb").innerHTML = pl.length ? '<div class="subhead">クレジットの引き落とし</div>' + pl.map((p) => debRow(mdLabel(p.date) + " " + esc(p.card), p.amount)).join("") : "";
  $("periodList").innerHTML = list.length ? list.map((e) => entryHtml(e, true)).join("") : emptyHtml("この期間の買い物はありません");
}
$("periodSeg").onclick = (e) => { const b = e.target.closest("[data-p]"); if (b) { period = b.dataset.p; renderSummary(); } };
const movePeriod = (delta) => { sumAnchor = shiftAnchor(period, sumAnchor, delta); renderSummary(); };
$("prevP").onclick = () => movePeriod(-1);
$("nextP").onclick = () => movePeriod(1);
bindCustomRange("cFrom", "cTo", () => [customFrom, customTo], (f, t) => { customFrom = f; customTo = t; }, renderSummary);
$("presetChips").onclick = (e) => { const b = e.target.closest("[data-preset]"); if (b) { [customFrom, customTo] = presetRange(b.dataset.preset, state.start); renderSummary(); } };
