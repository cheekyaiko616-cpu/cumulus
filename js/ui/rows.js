"use strict";
// ===== 一覧の行の部品 =====
// 役割: 複数の画面で使う、一覧の行の見た目（買い物の行・金額つきの行・「ありません」の表示）
// 依存: util.js, model.js
// 実行時: なし
// 公開: payColor, emptyHtml, debRow, entryHtml

const payColor = (e) => "var(--" + e.pay + ")";                    // 支払い方法ごとの色（css/base.css の --cash・--code・--credit）
const emptyHtml = (text) => '<div class="empty">' + text + "</div>";
// 「ラベル　¥金額」の1行。label は、すでに esc を通した文字
const debRow = (label, amount) => '<div class="deb"><span>' + label + '</span><b class="num">' + yen(amount) + "</b></div>";
// 買い物1件の行（押すと data-entry で直せる）。withDate は、日付も出すか
function entryHtml(e, withDate) {
  const d = parseKey(e.date);
  const items = e.items.map((i) => esc(i.n) + " " + comma(i.p)).join("、");
  return '<button type="button" class="item" data-entry="' + esc(e.id) + '"><span class="l">' + (withDate ? '<span class="num">' + (d.getMonth() + 1) + "/" + d.getDate() + "</span>　" : "") + esc(e.store || "お店の名前なし") +
    '<span class="chip" style="color:' + payColor(e) + '">' + esc(payLabel(e)) + "</span>" + (e.src === "mail" ? '<span class="chip">' + (e.rc ? "メール・レシート" : "メール") + "</span>" : "") + "<small>" + items + '</small></span><span class="r">' + yen(e.total) + "</span></button>";
}
