"use strict";
// ===== 左右にスワイプして、となりの画面（タブ）へ移る =====
// 役割: 画面を左右へ払うと、下のタブの並びでとなりの画面へ移る。カレンダーは月の移動に同じ払いを使うので、月の欄（data-swipe-own）の外だけ。左端のカレンダーから右へは動かない
// 依存: overlay.js
// 実行時: なし
// 公開: initTabSwipe
// 月の欄の中の払いは、月の移動だけ（二重に動かない）。指の動きの途中は何もしない（touchmove を使わない）。離したときに1回だけ判定し、タブを押したときと同じ切り替えを呼ぶ
// タブバーの上でも払える。タブのボタンは離したとき（click）に動くので、払いと判定したあとに来る click は1回だけ止める（目印は次の touchstart で消す。タイマーなし）。タップは従来どおりボタンの動作
function initTabSwipe(order, getTab, go) {
  const MIN_X = 60, EDGE = 20;
  let sx = 0, sy = 0, ok = false, bar = false, mute = false;
  const hScroll = (el) => {                                       // 横にスクロールできる要素の上か
    for (; el && el !== document.body; el = el.parentElement) {
      if (el.scrollWidth > el.clientWidth + 1 && /(auto|scroll)/.test(getComputedStyle(el).overflowX)) return true;
    }
    return false;
  };
  const selecting = () => { const s = window.getSelection && window.getSelection(); return !!s && !s.isCollapsed && s.toString() !== ""; };
  document.addEventListener("click", (e) => {                     // タブバーでの払いのあとに来る click（払いの途中のボタン・「+」）を止める
    if (!mute) return;
    mute = false; e.preventDefault(); e.stopPropagation();
  }, { capture: true });
  document.addEventListener("touchstart", (e) => {
    ok = false; mute = false;
    if (e.touches.length !== 1 || openStack.length) return;
    const t = e.touches[0], el = e.target;
    if (t.clientX <= EDGE || t.clientX >= window.innerWidth - EDGE) return;    // 画面の端は、ブラウザの「戻る」と重なるので使わない
    if (el.closest && el.closest("input, textarea, select, [contenteditable], .overlay, [data-swipe-own]")) return;
    if (hScroll(el) || selecting()) return;
    sx = t.clientX; sy = t.clientY; ok = true; bar = !!(el.closest && el.closest("nav.tabs"));
  }, { passive: true });
  document.addEventListener("touchend", (e) => {
    if (!ok) return;
    ok = false;
    if (e.touches.length || openStack.length || selecting()) return;
    const t = e.changedTouches[0], dx = t.clientX - sx, dy = t.clientY - sy;
    if (Math.abs(dx) < MIN_X || Math.abs(dx) < 2 * Math.abs(dy)) return;       // 横に大きく動いたときだけ（縦・斜めは対象外）
    mute = bar;                                                               // タブバー上の払い：このあとの click は無かったことにする
    const i = order.indexOf(getTab()), n = order[i + (dx < 0 ? 1 : -1)];       // 左へ払う＝右どなり、右へ払う＝左どなり
    if (i >= 0 && n) go(n);
  }, { passive: true });
  document.addEventListener("touchcancel", () => { ok = false; }, { passive: true });
}
