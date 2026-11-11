"use strict";
// ===== 開始日・終了日の入力 =====
// 役割: 「期間指定」の開始日・終了日の入力欄を、整えながら（逆転・範囲外）反映する。まとめと投資の画面で共通
// 依存: dom.js, period.js
// 実行時: なし
// 公開: bindCustomRange

// get() は [開始, 終了] を返し、set(開始, 終了) で保存し、render() で描き直す
function bindCustomRange(fromId, toId, get, set, render) {
  const onChange = (which, id) => () => {
    const [from, to] = get(), r = adjustRange(which, $(id).value, from, to);
    if (r) set(r[0], r[1]);
    render();                                                   // 日付でない入力は、元の値に戻すために描き直すだけ
  };
  $(fromId).onchange = onChange("from", fromId);
  $(toId).onchange = onChange("to", toId);
}
