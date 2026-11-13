"use strict";
// ===== 一覧の行の部品 =====
// 役割: 複数の画面で使う、一覧の行の見た目（日ごとの画面の買い物の行・まとめの記録の行・金額つきの行・「ありません」の表示）
// 依存: util.js, model.js, billing.js
// 実行時: なし
// 公開: emptyHtml, debRow, entryHtml, sumRowHtml

const payColor = (e) => "var(--" + e.pay + ")";                    // 支払い方法ごとの色（css/base.css の --cash・--code・--credit）
// 札（.chip）：支払い方法は色つき・カード名の文字つき。noCard があれば、カード未選択のクレジットをその文字にする（日ごとの画面は「クレジット」のまま）
const payChip = (e, noCard) => '<span class="chip" style="color:' + payColor(e) + '">' + esc(e.pay === "credit" && noCard && !e.card ? noCard : payLabel(e)) + "</span>";
// 登録方法：メール取り込み（src）・メール+レシートの突き合わせ済み（rc）は保存データで区別できる。レシートの読み取りと手入力は区別して保存していないので、1つにまとめる
const regLabel = (e) => e.src === "mail" ? (e.rc ? "メール・レシート" : "メール") : "手入力・レシート";
const regChip = (e) => '<span class="chip">' + regLabel(e) + "</span>";
const emptyHtml = (text) => '<div class="empty">' + text + "</div>";
// 「ラベル　¥金額」の1行。label は、すでに esc を通した文字
const debRow = (label, amount) => '<div class="deb"><span>' + label + '</span><b class="num">' + yen(amount) + "</b></div>";
// 日ごとの画面の買い物1件の行（押すと data-entry で直せる。品目・メモ以外の詳細もここで見られる）
function entryHtml(e) {
  const items = e.items.map((i) => esc(i.n) + " " + comma(i.p)).join("、");
  return '<button type="button" class="item" data-entry="' + esc(e.id) + '"><span class="l">' + esc(e.store || "お店の名前なし") +
    payChip(e) + (e.src === "mail" ? regChip(e) : "") + "<small>" + items + '</small></span><span class="r">' + yen(e.total) + "</span></button>";
}
// まとめの記録・明細の行：1行目に店名と支払額、2行目に月日と、支払い方法・登録方法の札（日ごとの画面と同じ部品）だけ。tap=true なら押して直せる。year=true は月日の前に年を付ける（期間が年をまたぐとき）
function sumRowHtml(e, tap, year) {
  const body = '<span class="l"><span class="nm">' + esc(e.store || "店名なし") + '</span><small class="meta"><span>' + (year ? e.date.slice(0, 4) + "/" : "") + mdShort(e.date) + "</span>" + payChip(e, NO_CARD) + regChip(e) + '</small></span><span class="r">' + yen(e.total) + "</span>";
  return tap ? '<button type="button" class="item" data-entry="' + esc(e.id) + '">' + body + "</button>" : '<div class="item">' + body + "</div>";
}
