"use strict";
// ===== まとめ（週・月・年・期間指定。標準は「月」） =====
let period = "month", sumAnchor = todayStr();
// 期間指定の初期値と、早押しボタンの範囲
function presetRange(name) {
  const t = todayStr(), d = parseKey(t), y = d.getFullYear(), m = d.getMonth();
  if (name === "last") { const p = new Date(y, m - 1, 1); return [ymd(p.getFullYear(), p.getMonth(), 1), lastKey(p.getFullYear(), p.getMonth())]; }
  if (name === "d30") return [addDays(t, -29), t];
  if (name === "year") return [ymd(y, 0, 1), ymd(y, 11, 31)];
  if (name === "all") return [state ? state.start : t, t];
  return [ymd(y, m, 1), lastKey(y, m)];                          // 今月
}
let [customFrom, customTo] = presetRange("month");

function periodRange() {
  if (period === "custom") return { from: customFrom, to: customTo, label: "期間を指定" };
  const d = parseKey(sumAnchor), y = d.getFullYear(), m = d.getMonth();
  if (period === "week") { const from = addDays(sumAnchor, -d.getDay()), to = addDays(from, 6); return { from, to, label: mdLabel(from) + " 〜 " + mdLabel(to) }; }
  if (period === "year") return { from: ymd(y, 0, 1), to: ymd(y, 11, 31), label: y + "年" };
  return { from: ymd(y, m, 1), to: lastKey(y, m), label: y + "年" + (m + 1) + "月" };
}
function movePeriod(delta) {
  const d = parseKey(sumAnchor);
  if (period === "week") d.setDate(d.getDate() + 7 * delta); else if (period === "year") d.setFullYear(d.getFullYear() + delta, d.getMonth(), 1); else d.setMonth(d.getMonth() + delta, 1);
  sumAnchor = dkey(d); renderSummary();
}
function renderSummary() {
  $("periodSeg").querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.p === period));
  $("navRow").hidden = period === "custom"; $("customBox").hidden = period !== "custom";
  if (period === "custom") { $("cFrom").value = customFrom; $("cTo").value = customTo; }
  const r = periodRange(), st = rangeStats(r.from, r.to), span = daysBetween(r.from, r.to) + 1;
  const elapsed = Math.max(0, Math.min(span, daysBetween(r.from, todayStr()) + 1));      // 今日までの日数（1日平均の割り算に使う）
  $("periodLabel").textContent = r.label;
  $("periodSpan").textContent = ymdLabel(r.from) + " 〜 " + ymdLabel(r.to) + "（" + span + "日間）";
  $("pSpent").textContent = yen(st.spent);
  $("pSpentSub").textContent = st.count + "件" + (elapsed ? " ・1日平均 " + yen(st.spent / elapsed) : "");
  $("pInvest").textContent = yen(st.invest); $("pInvestSub").textContent = "使わなかった日 " + st.savedDays + "日";
  const list = state.entries.filter((e) => e.date >= r.from && e.date <= r.to).sort((a, b) => a.date < b.date ? 1 : -1);
  const groups = {};
  list.forEach((e) => { const k = payLabel(e); (groups[k] = groups[k] || { sum: 0, color: payColor(e) }).sum += e.total; });
  const rows = Object.entries(groups).sort((a, b) => b[1].sum - a[1].sum), max = rows.length ? rows[0][1].sum : 0;
  $("payBars").innerHTML = rows.length ? rows.map(([k, g]) => '<div class="bar-row"><span class="nm">' + esc(k) + '</span><span class="bar"><i style="width:' + (g.sum / max * 100).toFixed(1) + "%;background:" + g.color + '"></i></span><b class="num">' + yen(g.sum) + "</b></div>").join("") : '<div class="empty">この期間の買い物はありません</div>';
  // この期間に引き落とし日が来るカード代（支払い方法の下に小さく添える）
  const pl = paysIn(r.from, r.to);
  $("payDeb").innerHTML = pl.length ? '<div class="subhead">クレジットの引き落とし</div>' + pl.map((p) => '<div class="deb"><span>' + mdLabel(p.date) + " " + esc(p.card) + '</span><b class="num">' + yen(p.amount) + "</b></div>").join("") : "";
  $("periodList").innerHTML = list.length ? list.map((e) => entryHtml(e, true)).join("") : '<div class="empty">この期間の買い物はありません</div>';
}
$("periodSeg").onclick = (e) => { const b = e.target.closest("[data-p]"); if (b) { period = b.dataset.p; renderSummary(); } };
$("prevP").onclick = () => movePeriod(-1);
$("nextP").onclick = () => movePeriod(1);
// 期間指定：開始日が終了日より後になったら終了日を合わせる（逆も同じ）
$("cFrom").onchange = () => { const v = $("cFrom").value; if (!isKey(v)) return renderSummary(); customFrom = v < MIN_DATE ? MIN_DATE : v; if (customTo < customFrom) customTo = customFrom; renderSummary(); };
$("cTo").onchange = () => { const v = $("cTo").value; if (!isKey(v)) return renderSummary(); customTo = v < MIN_DATE ? MIN_DATE : v; if (customFrom > customTo) customFrom = customTo; renderSummary(); };
$("presetChips").onclick = (e) => { const b = e.target.closest("[data-preset]"); if (b) { [customFrom, customTo] = presetRange(b.dataset.preset); renderSummary(); } };
