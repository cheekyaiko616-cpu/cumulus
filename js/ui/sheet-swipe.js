"use strict";
// ===== 下に向かってスワイプすると、重なった画面を閉じる =====
// 役割: 重なった画面を、下へ引っぱって閉じる。引っぱれる目印の線も付ける
// 依存: overlay.js
// 実行時: なし
// 公開: なし
// 画面の一番上にいるときだけ動く（中身をスクロールしているときは、ふつうのスクロール）
document.querySelectorAll(".overlay > .sheet").forEach((sheet) => {
  const id = sheet.parentElement.id;
  sheet.insertAdjacentHTML("afterbegin", '<div class="grab" aria-hidden="true"></div>');   // 「下へ引っぱれる」目印
  let sx = 0, sy = 0, st = 0, dy = 0, tracking = false, pulling = false;
  const reset = () => { sheet.style.transition = ""; sheet.style.transform = ""; };
  sheet.addEventListener("touchstart", (e) => {
    if (e.touches.length !== 1) { tracking = false; return; }
    tracking = sheet.scrollTop <= 0; pulling = false; dy = 0;
    for (let el = e.target; el && el !== sheet; el = el.parentElement) if (el.scrollTop > 0) { tracking = false; break; }   // 中の一覧が途中までスクロール済みなら、一覧を動かす
    sx = e.touches[0].clientX; sy = e.touches[0].clientY; st = Date.now();
  }, { passive: true });
  sheet.addEventListener("touchmove", (e) => {
    if (!tracking) return;
    const t = e.touches[0], dY = t.clientY - sy, dX = t.clientX - sx;
    if (!pulling) {
      if (dY > 10 && dY > Math.abs(dX) * 1.3 && sheet.scrollTop <= 0) { pulling = true; sheet.style.transition = "none"; }
      else { if (dY < -6 || Math.abs(dX) > 14) tracking = false; return; }   // 上へ・横へ動いたら、スワイプではない
    }
    dy = Math.max(0, dY);
    sheet.style.transform = "translateY(" + dy + "px)";
  }, { passive: true });          // スクロールを止めない設定。ブラウザは指の動きの処理を待たずにスクロールできる
  const end = () => {
    if (!pulling) { tracking = false; return; }
    const fast = dy > 50 && Date.now() - st < 250;            // 素早く払ったときも閉じる
    tracking = false; pulling = false;
    if (dy > 110 || fast) {
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
      sheet.style.transition = "transform .18s ease"; sheet.style.transform = "translateY(100%)";
      setTimeout(() => { closeOv(id); reset(); }, 180);
    } else { sheet.style.transition = "transform .18s ease"; sheet.style.transform = "translateY(0)"; setTimeout(reset, 190); }
  };
  sheet.addEventListener("touchend", end, { passive: true });
  sheet.addEventListener("touchcancel", end, { passive: true });
});
