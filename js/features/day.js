"use strict";
// ===== 日ごとの画面 =====
// 役割: カレンダーの日を押したときの画面（その日の買い物・引き落とし・使わなかった日のお知らせ）。前の日・次の日へ動ける
// 依存: util.js, model.js, stats.js, billing.js, dom.js, overlay.js, rows.js
// 実行時: edit.js
// 公開: dayKey, renderDay, openDay

let dayKey = "";
// その日に引き落とされるカード代
function payNotes(k) {
  const past = k < todayStr();
  return (paysByDate[k] || []).map((p) => '<div class="note paynote"><svg class="card-ic" aria-hidden="true" focusable="false"><use href="#i-card"/></svg><span><b>' + esc(p.card) + "</b> が <b>" + yen(p.amount) + "</b> " + (past ? "引き落とされました" : "引き落とされます") +
    "<small>" + mdShort(p.from) + "〜" + mdShort(p.to) + "のご利用</small></span></div>").join("");
}
function renderDay() {
  const d = parseKey(dayKey), list = byDate[dayKey] || [];
  $("dayTitle").textContent = (d.getMonth() + 1) + "月" + d.getDate() + "日（" + WD[d.getDay()] + "）";
  let html = "";
  if (list.length) html = list.map((e) => entryHtml(e)).join("") + '<div class="total" style="margin-top:6px"><span>この日の合計</span><span class="num">' + yen(spentOn(dayKey)) + "</span></div>";
  else if (isSavedDay(dayKey)) html = '<div class="note"><svg class="saved-ic" aria-hidden="true" focusable="false"><use href="#i-saved"/></svg><span>使わなかった日　投資資金 <b>+' + yen(state.daily) + "</b></span></div>";
  else if (dayKey === todayStr()) html = '<div class="note"><span>今日はまだ記録なし　このまま終えると <b>+' + yen(state.daily) + "</b></span></div>";
  else html = emptyHtml(dayKey < state.start ? "数え始める日より前です" : "まだ来ていません");
  $("dayBody").innerHTML = payNotes(dayKey) + html;
}
function openDay(k) { dayKey = k; renderDay(); openOv("dayOverlay"); }
$("dayPrev").onclick = () => { dayKey = addDays(dayKey, -1); renderDay(); };
$("dayNext").onclick = () => { dayKey = addDays(dayKey, 1); renderDay(); };
$("dayAdd").onclick = () => openEdit(null, dayKey);
