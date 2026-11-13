"use strict";
// ===== 設定画面 =====
// 役割: 設定画面（項目の一覧：一般・カード・メール連携・データ）。投資資金のルール（1日あたりの金額・数え始める日）の入力画面と、データを消す操作、見本を消す操作（カードは cards.js、メールは mail.js、バックアップは backup.js）
// 依存: util.js, model.js, storage.js, dom.js, overlay.js
// 実行時: なし
// 公開: renderSettings

function renderSettings() {
  $("ruleSummary").textContent = yen(state.daily) + "／日";
  if (document.activeElement !== $("setDaily")) $("setDaily").value = state.daily;
  $("setStart").value = state.start;
  $("setStart").max = todayStr();
}
$("openRule").onclick = () => { renderSettings(); openOv("ruleOverlay"); };
$("setDaily").onchange = () => { state.daily = Math.min(MAX_DAILY, Math.max(0, toInt($("setDaily").value))); save(); toast("1日 " + yen(state.daily) + " にしました"); };
$("setStart").onchange = () => {
  let v = $("setStart").value;
  if (!isKey(v)) { renderSettings(); return; }                  // 空にされたら元に戻す
  if (v < MIN_DATE) v = MIN_DATE;
  if (v > todayStr()) v = todayStr();
  state.start = v; save(); toast("数え始める日を変えました");
};
$("wipeBtn").onclick = () => { if (!armed($("wipeBtn"), "もう一度押すと、すべて消します")) return; dropKey(KEY_PREV); state = freshState(true); save(); toast("記録をすべて消しました"); };
$("sampleClear").onclick = () => { state = freshState(false); save(); toast("今日から記録を始めます"); };
