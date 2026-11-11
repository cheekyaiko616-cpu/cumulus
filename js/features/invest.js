"use strict";
// ===== 投資の画面 =====
// 役割: 実際に投資した金額の記録（入力・直す・消す）と、投資の画面（月・全期間・期間指定の累計、記録の一覧、月ごとの一覧）
// 依存: util.js, guard.js, model.js, sample.js, stats.js, period.js, storage.js, dom.js, overlay.js, rows.js, range-input.js
// 実行時: day.js
// 公開: invMode, invAnchor, invFrom, invTo, openInv, renderMonthList, renderInvest

let editingInv = null;
function invItemHtml(v) {
  return '<button type="button" class="item" data-inv="' + esc(v.id) + '"><span class="l">📈 ' + mdLabel(v.date) + " " + (v.memo ? esc(v.memo) : "投資") + '</span><span class="r">' + yen(v.amount) + "</span></button>";
}

// ---- 入力画面 ----
// 日付の月の「未投資の残り」を、金額の入力に使えるようにする
function updateSuggest() {
  const d = $("iDate").value, b = $("iSuggest");
  if (!isKey(d)) { b.hidden = true; return; }
  const t = parseKey(d), st = monthStats(t.getFullYear(), t.getMonth());
  const own = editingInv && editingInv.date.slice(0, 7) === d.slice(0, 7) ? editingInv.amount : 0;   // 直している記録の分は残りに戻して数える
  const left = st.left + own;
  b.hidden = left <= 0;
  b.textContent = (t.getMonth() + 1) + "月の未投資の残り " + yen(left) + " を入れる";
  b.dataset.v = left;
}
function openInv(inv, date) {
  editingInv = inv || null;
  $("invTitle").textContent = inv ? "投資の記録を直す" : "投資を記録";
  $("iDate").value = inv ? inv.date : (date || todayStr());
  $("iAmount").value = inv ? inv.amount : "";
  $("iMemo").value = inv ? inv.memo : "";
  $("iDelete").hidden = !inv; $("iDelete").textContent = "この記録を消す"; delete $("iDelete").dataset.armed;
  updateSuggest();
  openOv("invOverlay");
  $("invSheet").scrollTop = 0;
}
$("invAdd").onclick = () => openInv(null, todayStr());
$("iDate").onchange = updateSuggest;
$("iSuggest").onclick = () => { $("iAmount").value = $("iSuggest").dataset.v; };
$("iSave").onclick = () => {
  const date = $("iDate").value, amount = Math.min(MAX_INV, toInt($("iAmount").value)), memo = $("iMemo").value.trim().slice(0, MAX_MEMO);
  if (!isKey(date) || date < MIN_DATE) return toast("日付を入れてください");
  if (amount <= 0) return toast("投資した金額を入れてください");
  if (looksSensitive(memo)) return toast(SENSITIVE_MSG);
  if (state.sample) leaveSample(state.cards.map((c) => c.name));      // 見本は消して、本物の記録だけにする
  if (editingInv && !state.invests.includes(editingInv)) editingInv = null;
  if (editingInv) Object.assign(editingInv, { date, amount, memo });
  else state.invests.push({ id: "i" + Date.now() + Math.random().toString(36).slice(2, 6), date, amount, memo });
  closeOv("invOverlay"); save(); toast("投資を記録しました");
  if (!$("dayOverlay").hidden) { dayKey = date; renderDay(); }
};
$("iDelete").onclick = () => {
  if (!armed($("iDelete"), "もう一度押すと消します")) return;
  state.invests = state.invests.filter((x) => x !== editingInv);
  closeOv("invOverlay"); save(); toast("消しました");
  if (!$("dayOverlay").hidden) renderDay();
};
$("iAmount").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); $("iMemo").focus(); } });
$("iMemo").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); $("iSave").click(); } });

// ---- 月ごとの一覧（先月分以前も、ここに残る） ----
function renderMonthList() {
  const today = todayStr();
  let minKey = state.start, maxKey = today;
  state.invests.forEach((v) => { if (v.date < minKey) minKey = v.date; if (v.date > maxKey) maxKey = v.date; });
  const lo = parseKey(minKey), hi = parseKey(maxKey);
  let y = hi.getFullYear(), m = hi.getMonth(), rows = "", n = 0, sum = { invest: 0, invested: 0, left: 0 };
  while ((y > lo.getFullYear() || (y === lo.getFullYear() && m >= lo.getMonth())) && n < 60) {
    const st = monthStats(y, m);
    sum.invest += st.invest; sum.invested += st.invested; sum.left += st.left; n++;
    rows += '<div class="mrow"><b>' + y + "/" + pad(m + 1) + '</b><span class="num">' + yen(st.invest) + '</span><span class="num">' + yen(st.invested) + '</span><span class="num">' + yenS(st.left) + "</span></div>";
    m--; if (m < 0) { m = 11; y--; }
  }
  $("monthList").innerHTML = '<div class="mrow mhead"><span>月</span><span>貯まった</span><span>投資した</span><span>残り</span></div>' + rows +
    '<div class="mrow mtotal"><span>合計</span><span class="num">' + yen(sum.invest) + '</span><span class="num">' + yen(sum.invested) + '</span><span class="num">' + yenS(sum.left) + "</span></div>";
}

// ---- 投資の画面（月・全期間・期間指定） ----
let invMode = "month", invAnchor = todayStr();
let [invFrom, invTo] = monthRange(todayStr());
function invRange() {
  if (invMode === "all") {
    let lo = state.start, hi = todayStr();
    state.invests.forEach((v) => { if (v.date < lo) lo = v.date; if (v.date > hi) hi = v.date; });
    return { from: lo, to: hi, label: "全期間" };
  }
  if (invMode === "custom") return { from: invFrom, to: invTo, label: "期間を指定" };
  return unitRange("month", invAnchor);
}
function renderInvest() {
  setSeg($("invSeg"), (b) => b.dataset.m === invMode);
  $("invNav").hidden = invMode !== "month"; $("invCustom").hidden = invMode !== "custom";
  if (invMode === "custom") { $("ivFrom").value = invFrom; $("ivTo").value = invTo; }
  const r = invRange(), st = rangeStats(r.from, r.to), span = daysBetween(r.from, r.to) + 1;
  $("invLabel").textContent = r.label;
  $("invSpan").textContent = ymdLabel(r.from) + " 〜 " + ymdLabel(r.to) + "（" + span + "日間）";
  $("invHero").textContent = yen(st.invest);
  $("invDone").textContent = yen(st.invested) + "（" + st.investCount + "件）";
  $("invLeft").textContent = yenS(st.left);
  $("invSub").textContent = "使わなかった日 " + st.savedDays + "日 × " + yen(state.daily);
  const list = state.invests.filter((v) => v.date >= r.from && v.date <= r.to).sort((a, b) => a.date < b.date ? 1 : -1);
  $("invList").innerHTML = list.length ? list.map(invItemHtml).join("") : emptyHtml("この期間の投資の記録はありません");
  renderMonthList();
}
$("invSeg").onclick = (e) => { const b = e.target.closest("[data-m]"); if (b) { invMode = b.dataset.m; renderInvest(); } };
const moveInv = (delta) => { invAnchor = shiftAnchor("month", invAnchor, delta); renderInvest(); };
$("invPrev").onclick = () => moveInv(-1);
$("invNext").onclick = () => moveInv(1);
bindCustomRange("ivFrom", "ivTo", () => [invFrom, invTo], (f, t) => { invFrom = f; invTo = t; }, renderInvest);
