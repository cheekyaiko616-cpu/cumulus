"use strict";
// ===== まとめ画面 =====
// 役割: 週・月・年・期間指定（標準は月）の、使った金額・投資資金・支払い方法ごとの内訳（現金・バーコード決済・クレジットはカードごと。押すとその明細）と、お店ごとの内訳（全体またはカードごと。上位8店＋その他。横棒は1位を100%）・クレジットの引き落とし・買い物の一覧。上の期間の切り替えと2つの数字は、スクロールしても動かない（css/base.css の .pin）。年・複数月の期間指定では、買い物の一覧と明細を月ごとの帯に分け、帯は数字のすぐ下に重なって止まる（css/components.css の .mband。高さは --pin-h）
// 依存: util.js, model.js, stats.js, billing.js, period.js, dom.js, overlay.js, picker.js, rows.js, range-input.js
// 実行時: なし
// 公開: period, sumAnchor, customFrom, customTo, renderSummary

let period = "month", sumAnchor = todayStr();
let [customFrom, customTo] = presetRange("month");

function periodRange() {
  if (period === "custom") return { from: customFrom, to: customTo, label: "期間を指定" };
  return unitRange(period, sumAnchor);
}
let payRows = [], payRange = ["", ""];
let sumView = "pay", shopScope = "", shopData = null;   // 内訳の見せ方（支払い方法別／お店別）と、お店別の対象（空＝全体、または支払い方法の区分）。保存しない
// 月の帯：年・期間指定で、期間が複数の月にまたがるときだけ（週・月・1か月の指定は出さない）
const useBands = (from, to) => (period === "year" || period === "custom") && from.slice(0, 7) !== to.slice(0, 7);
function groupedHtml(list, rowFn, bands) {
  if (!bands) return list.map(rowFn).join("");
  return groupByMonth(list).map((g) => '<section class="mg"><h3 class="mband"><span>' + g.y + "年" + g.m + '月</span><span class="num">' + yen(g.sum) + "・" + g.n + "件</span></h3>" + g.rows.map(rowFn).join("") + "</section>").join("");
}
// 帯が止まる高さ（上に固定した部分の高さ）を、大きさが変わったときだけ --pin-h に入れる（スクロールでは動かさない）
{
  const view = $("view-summary"), pin = view.querySelector(".pin"), fig = view.querySelector(".pin-fig");
  const sync = () => { const el = getComputedStyle(pin).display === "contents" ? fig : pin; view.style.setProperty("--pin-h", el.offsetHeight + "px"); };
  if (window.ResizeObserver) { const ro = new ResizeObserver(sync); ro.observe(pin); ro.observe(fig); }
  window.addEventListener("resize", sync);
}
const pctText = (x) => (x > 0 && x < 0.005 ? "1%未満" : Math.round(x * 100) + "%");
function renderSummary() {
  setSeg($("periodSeg"), (b) => b.dataset.p === period);
  $("navRow").hidden = period === "custom"; $("customBox").hidden = period !== "custom";
  if (period === "custom") { $("cFrom").value = customFrom; $("cTo").value = customTo; }
  const r = periodRange(), st = rangeStats(r.from, r.to), span = daysBetween(r.from, r.to) + 1;
  $("periodLabel").textContent = r.label;
  $("periodSpan").textContent = ymdLabel(r.from) + " 〜 " + ymdLabel(r.to) + "（" + span + "日間）";
  [["pSpent", st.spent], ["pInvest", st.invest]].forEach(([id, v]) => { const el = $(id); el.textContent = yen(v); el.classList.toggle("long", el.textContent.length >= 9); el.classList.toggle("long2", el.textContent.length >= 11); });
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
  setSeg($("viewSeg"), (b) => b.dataset.v === sumView);
  $("payBox").hidden = sumView !== "pay"; $("shopBox").hidden = sumView !== "shop";
  if (sumView === "shop") renderShop(r, bd);
  $("periodList").innerHTML = list.length ? groupedHtml(list, (e) => entryHtml(e, true), useBands(r.from, r.to)) : emptyHtml("この期間の買い物はありません");
}
// お店ごと：名寄せして金額の大きい順に上位8店＋その他。棒は1位を100%にした長さ（割合は数字で添える）
function renderShop(r, bd) {
  if (shopScope && !bd.rows.some((g) => g.key === shopScope)) shopScope = "";
  const sel = $("shopScope");
  sel.innerHTML = '<option value="">全体</option>' + bd.rows.map((g) => '<option value="' + esc(g.key) + '">' + esc(g.name) + "</option>").join("");
  sel.value = shopScope; syncPickers();
  const sb = shopBreakdown(r.from, r.to, shopScope), top = sb.rows.length ? sb.rows[0].sum : 0, pg = bd.rows.find((g) => g.key === shopScope);
  shopData = { rows: sb.rows, total: sb.total, range: [r.from, r.to] };
  $("shopSum").innerHTML = "<span>" + sb.count + "件・" + sb.shops + "店</span><b class=\"num\">" + yen(sb.total) + "</b>";
  const color = "var(--" + (pg ? pg.pay : "accent") + ")";
  const row = (g, i) => {
    const w = top > 0 ? Math.min(100, Math.max(0, g.sum / top * 100)) : 0, pc = sb.total > 0 ? "・" + pctText(g.sum / sb.total) : "";
    return "<" + (i >= 0 ? 'button type="button" data-si="' + i + '"' : "div") + ' class="bar-row shop-row"><span class="nm">' + esc(g.name) + "<small>" + g.n + "件" + pc + '</small></span><b class="num">' + yen(g.sum) + '</b><span class="chev" aria-hidden="true">' + (i >= 0 ? "›" : "") + '</span><span class="bar"><i style="width:' + w.toFixed(1) + "%;background:" + (i >= 0 ? color : "var(--muted)") + '"></i></span></' + (i >= 0 ? "button" : "div") + ">";
  };
  $("shopBars").innerHTML = sb.rows.length ? sb.rows.map(row).join("") + (sb.other ? row({ name: "その他（" + sb.other.shops + "店）", sum: sb.other.sum, n: sb.other.n }, -1) : "") : emptyHtml("この期間の買い物はありません");
}
$("viewSeg").onclick = (e) => { const b = e.target.closest("[data-v]"); if (b) { sumView = b.dataset.v; renderSummary(); } };
$("shopScope").onchange = () => { shopScope = $("shopScope").value; renderSummary(); };
$("shopBars").onclick = (e) => {
  const b = e.target.closest("[data-si]"); if (!b || !shopData) return;
  const g = shopData.rows[Number(b.dataset.si)]; if (!g) return;
  const [from, to] = shopData.range, list = shopEntries(from, to, shopScope, g.key);
  showDetail(g.name, g.n, g.sum, shopData.total, list, (e) => '<div class="item"><span class="l"><span class="num">' + mdShort(e.date) + "</span>　" + esc(payLabel(e)) + '</span><span class="r">' + yen(e.total) + "</span></div>", from, to);
};
$("periodSeg").onclick = (e) => { const b = e.target.closest("[data-p]"); if (b) { period = b.dataset.p; renderSummary(); } };
const movePeriod = (delta) => { sumAnchor = shiftAnchor(period, sumAnchor, delta); renderSummary(); };
$("prevP").onclick = () => movePeriod(-1);
$("nextP").onclick = () => movePeriod(1);
bindCustomRange("cFrom", "cTo", () => [customFrom, customTo], (f, t) => { customFrom = f; customTo = t; }, renderSummary);
$("presetChips").onclick = (e) => { const b = e.target.closest("[data-preset]"); if (b) { [customFrom, customTo] = presetRange(b.dataset.preset, state.start); renderSummary(); } };

// 明細の画面（見出しと合計は動かず、明細だけが動く。年・複数月は月の帯つき）
function showDetail(title, n, sum, total, list, rowFn, from, to) {
  $("payTitle").textContent = title;
  $("paySum").innerHTML = "<span>" + n + "件" + (total > 0 ? "・" + pctText(sum / total) : "") + '</span><b class="num">' + yen(sum) + "</b>";
  $("payBody").innerHTML = groupedHtml(list, rowFn, useBands(from, to));
  openOv("payOverlay"); $("payOverlay").firstElementChild.scrollTop = 0; $("payBody").scrollTop = 0;
}
// 支払い方法の明細（日付・お店・金額）
function openPay(i) {
  const g = payRows[i]; if (!g) return;
  const total = payRows.reduce((a, x) => a + x.sum, 0);
  showDetail(g.name, g.n, g.sum, total, payEntries(payRange[0], payRange[1], g.key), (e) => '<div class="item"><span class="l"><span class="num">' + mdShort(e.date) + "</span>　" + esc(e.store || "お店の名前なし") + '</span><span class="r">' + yen(e.total) + "</span></div>", payRange[0], payRange[1]);
}
$("payBars").onclick = (e) => { const b = e.target.closest("[data-pi]"); if (b) openPay(Number(b.dataset.pi)); };
