"use strict";
// ===== 選択欄（ふつうのプルダウンの代わり） =====
// 押すと選択肢が下から出て、選んだ瞬間に閉じる。画面が固まったり、前の選択が残ったりしない。
// 中身は <select data-pick="見出し"> をそのまま使う（値の読み書きは今までどおり）
const pickBtn = (sel) => document.querySelector('.selbtn[data-for="' + sel.id + '"]');
function syncPickers() {
  document.querySelectorAll("select[data-pick]").forEach((sel) => {
    const b = pickBtn(sel), o = sel.options[sel.selectedIndex];
    if (b) b.firstElementChild.textContent = o ? o.text : "";
  });
}
let pickTarget = null, pickFrom = null;
function openPicker(sel, trigger) {
  pickTarget = sel; pickFrom = trigger;
  $("selTitle").textContent = sel.dataset.pick;
  $("selList").innerHTML = [...sel.options].map((o, i) => {
    const on = i === sel.selectedIndex;
    return '<button type="button" class="opt' + (on ? " on" : "") + '" data-i="' + i + '" role="option" aria-selected="' + on + '"><span>' + esc(o.text) + "</span>" + (on ? '<span aria-hidden="true">✓</span>' : "") + "</button>";
  }).join("");
  openOv("selOverlay");
  const list = $("selList"), on = list.querySelector(".on");
  list.scrollTop = on ? Math.max(0, on.offsetTop - list.clientHeight / 2 + on.offsetHeight / 2) : 0;   // 今の選択が真ん中に見えるように
}
$("selList").onclick = (e) => {
  const b = e.target.closest("[data-i]"); if (!b || !pickTarget) return;
  const sel = pickTarget, from = pickFrom, old = sel.value;
  pickTarget = null; pickFrom = null;
  closeOv("selOverlay");                                          // 先に閉じる（待たせない）
  sel.selectedIndex = Number(b.dataset.i);
  syncPickers();
  if (from && from.blur) from.blur();                             // 押した欄に「選択中」の枠が残らないようにする
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  if (sel.value !== old) sel.dispatchEvent(new Event("change", { bubbles: true }));
};
document.querySelectorAll("select[data-pick]").forEach((sel) => {
  sel.insertAdjacentHTML("afterend", '<button type="button" class="selbtn" data-for="' + sel.id + '" aria-haspopup="listbox"><span></span><i aria-hidden="true">▼</i></button>');
  pickBtn(sel).onclick = (e) => openPicker(sel, e.currentTarget);
});
syncPickers();
