"use strict";
// ===== 重ねて開く画面・メッセージ =====
// 役割: 下からせり上がる画面の開閉（重なった順にEscapeで閉じる）、2回押しで確定するボタン、画面下のメッセージ
// 依存: dom.js
// 実行時: なし
// 公開: openStack, overlayOpenHooks, openOv, closeOv, armed, toast

// 重ねて開く画面：開いた順に積み、いちばん上だけをEscapeで閉じる。開いている間は後ろをスクロールさせない
const openStack = [];
const overlayOpenHooks = [];                  // 画面を開くときに呼ぶ処理（選択欄の表示合わせなど。picker.js が足す）
function openOv(id) {
  $(id).hidden = false;
  overlayOpenHooks.forEach((f) => f());
  if (!openStack.includes(id)) openStack.push(id);
  document.body.style.overflow = "hidden";
}
function closeOv(id) {
  $(id).hidden = true;
  const i = openStack.indexOf(id);
  if (i >= 0) openStack.splice(i, 1);
  if (!openStack.length) document.body.style.overflow = "";
}
// 消す操作は2回押しで確定（4秒たつと元に戻る）
function armed(btn, label) {
  if (btn.dataset.armed) { delete btn.dataset.armed; btn.textContent = btn.dataset.orig; return true; }
  btn.dataset.armed = "1"; btn.dataset.orig = btn.textContent; btn.textContent = label;
  setTimeout(() => { if (btn.dataset.armed) { delete btn.dataset.armed; btn.textContent = btn.dataset.orig; } }, 4000);
  return false;
}
let toastT = 0;
function toast(msg) {
  const t = $("toastEl"); t.textContent = msg; t.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 2400);
}
// data-close="画面のid" のボタンで閉じる／外側を押して閉じてよい画面（data-backdrop）は、外側でも閉じる。入力画面は入力が消えてしまうので閉じない
document.addEventListener("click", (e) => {
  const c = e.target.closest("[data-close]"); if (c) { closeOv(c.dataset.close); return; }
  if (e.target.dataset && e.target.dataset.backdrop !== undefined) closeOv(e.target.id);
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && openStack.length) closeOv(openStack[openStack.length - 1]); });
