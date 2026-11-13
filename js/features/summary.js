"use strict";
// ===== まとめ画面 =====
// 役割: 週・月・年・期間指定（標準は月）の、使った金額・投資資金・支払い方法ごとの内訳（現金・バーコード決済・クレジットはカードごと。押すとその明細）・クレジットの引き落とし・買い物の一覧。上の期間の切り替えと2つの数字は、スクロールしても動かない（css/components.css の .pin）
// 依存: util.js, model.js, stats.js, billing.js, period.js, dom.js, overlay.js, rows.js, range-input.js
// 実行時: なし
// 公開: period, sumAnchor, customFrom, customTo, renderSummary

let period = "month", sumAnchor = todayStr();
let [customFrom, customTo] = presetRange("month");

function periodRange() {
  if (period === "custom") return { from: customFrom, to: customTo, label: "期間を指定" };
  return unitRange(period, sumAnchor);
}
let payRows = [], payRange = ["", ""];
const pctText = (x) => (x > 0 && x < 0.005 ? "1%未満" : Math.round(x * 100) + "%");
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
  // 支払い方法ごと：金額・件数・全体に対する割合。押すと、その明細
  const bd = payBreakdown(r.from, r.to); payRows = bd.rows; payRange = [r.from, r.to];
  $("payBars").innerHTML = bd.rows.length ? bd.rows.map((g, i) => {
    const share = bd.total > 0 ? Math.min(1, Math.max(0, g.sum / bd.total)) : 0;
    return '<button type="button" class="bar-row pay-row" data-pi="' + i + '"><span class="nm">' + esc(g.name) + "<small>" + g.n + "件" + (bd.total > 0 ? "・" + pctText(share) : "") + '</small></span><span class="bar"><i style="width:' + (share * 100).toFixed(1) + "%;background:var(--" + g.pay + ')"></i></span><b class="num">' + yen(g.sum) + '</b><span class="chev" aria-hidden="true">›</span></button>';
  }).join("") : emptyHtml("この期間の買い物はありません");
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

// 支払い方法の明細（日付・お店・金額）
function openPay(i) {
  const g = payRows[i]; if (!g) return;
  const list = payEntries(payRange[0], payRange[1], g.key), total = payRows.reduce((a, x) => a + x.sum, 0);
  $("payTitle").textContent = g.name;
  $("paySum").innerHTML = "<span>" + g.n + "件" + (total > 0 ? "・" + pctText(g.sum / total) : "") + '</span><b class="num">' + yen(g.sum) + "</b>";
  $("payBody").innerHTML = list.map((e) => '<div class="item"><span class="l"><span class="num">' + mdShort(e.date) + "</span>　" + esc(e.store || "お店の名前なし") + '</span><span class="r">' + yen(e.total) + "</span></div>").join("");
  openOv("payOverlay"); $("payOverlay").firstElementChild.scrollTop = 0;
}
$("payBars").onclick = (e) => { const b = e.target.closest("[data-pi]"); if (b) openPay(Number(b.dataset.pi)); };
