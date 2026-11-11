"use strict";
// ===== カレンダー =====
let viewYear, viewMonth;
// マスは幅が狭いので、10万円以上は「12.3万」と短くする
const amtText = (n) => n >= 100000 ? (n / 10000).toFixed(n >= 1000000 ? 0 : 1).replace(/\.0$/, "") + "万" : comma(n);
function cellHtml(y, m, d, today, other) {
  const key = ymd(y, m, d), wd = new Date(y, m, d).getDay();
  const cls = ["cell"]; if (other) cls.push("other"); if (key === today) cls.push("today"); if (wd === 0) cls.push("sun"); if (wd === 6) cls.push("sat");
  const spent = spentOn(key), saved = isSavedDay(key);
  if (saved) cls.push("saved");
  const pp = paysByDate[key], payAmt = pp ? pp.reduce((a, p) => a + p.amount, 0) : 0;   // この日に引き落とされるカード代
  const mark = byDate[key] ? '<span class="amt">' + amtText(spent) + '</span>' : saved ? '<span class="bag" aria-hidden="true">💰</span>' : "";
  const label = (m + 1) + "月" + d + "日（" + WD[wd] + "）" + (key === today ? "、今日" : "") + (byDate[key] ? "、" + comma(spent) + "円 使った" : saved ? "、使わなかった日" : "") + (pp ? "、クレジット引き落とし " + comma(payAmt) + "円" : "");
  return '<button type="button" class="' + cls.join(" ") + '" data-date="' + key + '"' + (other ? ' data-other="1"' : "") + ' aria-label="' + label + '"><span class="d">' + d + "</span>" + mark + (pp ? '<span class="pay-mark" aria-hidden="true">💳</span>' : "") + "</button>";
}
function renderCalendar() {
  $("monthLabel").innerHTML = viewYear + "年" + (viewMonth + 1) + "月" + '<span class="caret" aria-hidden="true">▼</span>';
  const first = new Date(viewYear, viewMonth, 1).getDay(), days = new Date(viewYear, viewMonth + 1, 0).getDate(), today = todayStr();
  let html = "";
  const prev = new Date(viewYear, viewMonth, 0);
  for (let i = first - 1; i >= 0; i--) html += cellHtml(prev.getFullYear(), prev.getMonth(), prev.getDate() - i, today, true);
  for (let d = 1; d <= days; d++) html += cellHtml(viewYear, viewMonth, d, today, false);
  const rest = (7 - ((first + days) % 7)) % 7, next = new Date(viewYear, viewMonth + 1, 1);
  for (let d = 1; d <= rest; d++) html += cellHtml(next.getFullYear(), next.getMonth(), d, today, true);
  $("calGrid").innerHTML = html;
  const st = rangeStats(ymd(viewYear, viewMonth, 1), ymd(viewYear, viewMonth, days));
  $("mSpent").textContent = yen(st.spent);
  $("mSpentLab").textContent = (viewMonth + 1) + "月 使った金額";
  $("mSpentSub").textContent = st.count + "件の買い物";
  $("mInvestLab").textContent = (viewMonth + 1) + "月の投資資金";
  $("mInvest").textContent = yen(st.invest);
  $("mInvestSub").textContent = "使わなかった日 " + st.savedDays + "日";
}
function moveMonth(delta) {
  const d = new Date(viewYear, viewMonth + delta, 1); viewYear = d.getFullYear(); viewMonth = d.getMonth(); renderCalendar();
  const g = $("calGrid"); g.classList.remove("from-r", "from-l"); void g.offsetWidth; g.classList.add(delta > 0 ? "from-r" : "from-l");
}
$("prevM").onclick = () => moveMonth(-1);
$("nextM").onclick = () => moveMonth(1);
$("todayBtn").onclick = () => { const n = new Date(); viewYear = n.getFullYear(); viewMonth = n.getMonth(); sumAnchor = todayStr(); invAnchor = todayStr(); renderAll(); };
$("calGrid").onclick = (e) => {
  const c = e.target.closest("[data-date]"); if (!c) return;
  if (c.dataset.other) { const [y, m] = c.dataset.date.split("-").map(Number); moveMonth((y - viewYear) * 12 + (m - 1 - viewMonth)); return; }
  openDay(c.dataset.date);
};
// 左右スワイプで月を移動
(function () {
  const el = $("calWrap"); let sx = 0, sy = 0, st = 0, on = false;
  el.addEventListener("touchstart", (e) => { on = e.touches.length === 1; if (on) { sx = e.touches[0].clientX; sy = e.touches[0].clientY; st = Date.now(); } }, { passive: true });
  el.addEventListener("touchend", (e) => {
    if (!on) return; on = false;
    const t = e.changedTouches[0], dx = t.clientX - sx, dy = t.clientY - sy;
    if (Math.abs(dx) > 60 && Math.abs(dy) < Math.abs(dx) * 0.6 && Date.now() - st < 700) moveMonth(dx < 0 ? 1 : -1);
  }, { passive: true });
})();

// ---- 年月を選ぶ（スマホでは選択欄が回転式の選び方で開く） ----
(function () {
  const y = $("pickY"), m = $("pickM");
  for (let v = 2000; v <= 2099; v++) y.insertAdjacentHTML("beforeend", "<option>" + v + "</option>");
  for (let v = 1; v <= 12; v++) m.insertAdjacentHTML("beforeend", "<option>" + v + "</option>");
  $("monthLabel").onclick = () => { y.value = viewYear; m.value = viewMonth + 1; openOv("monthOverlay"); };
  $("pickOk").onclick = () => { viewYear = Number(y.value); viewMonth = Number(m.value) - 1; closeOv("monthOverlay"); renderCalendar(); };
})();

