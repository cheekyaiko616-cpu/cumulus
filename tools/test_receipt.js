#!/usr/bin/env node
// レシートの文字の解析（js/core/receipt-parse.js）と、写真の計算（js/core/receipt-image.js）の単体試験。外部の部品は使わない
//   node tools/test_receipt.js
// 試験の文字は、すべて架空のお店・品目（読み取りの誤りも、実際に起きた形を真似て入れてある）
"use strict";
const fs = require("fs"), vm = require("vm"), path = require("path");
const root = path.resolve(__dirname, "..");
for (const f of ["util", "guard", "receipt-image", "receipt-parse"]) vm.runInThisContext(fs.readFileSync(path.join(root, "js/core", f + ".js"), "utf8"), { filename: f + ".js" });

let ok = 0, ng = 0;
const eq = (name, got, want) => {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a === b) ok++; else { ng++; console.log("  不合格: " + name + "\n    期待 " + b + "\n    実際 " + a); }
};
const names = (r) => r.items.map((i) => i.n + ":" + i.p);
const thisYear = todayStr().slice(0, 4);

// ---- 基本 ----
{
  const r = parseReceipt("スーパーまるや\n2026年11月 8日 18:32\nカード 4980 1234 5678 9012\n牛乳 ¥238\n食パン 168※\nたまご１０個 ２７８\n値引 -50\n小計 ¥634\n合計 ¥634\n会員番号 1234567890123");
  eq("基本：お店", r.store, "スーパーまるや"); eq("基本：日付", r.date, "2026-11-08"); eq("基本：合計", r.total, 634);
  eq("基本：品目（番号の行は捨てる）", names(r), ["牛乳:238", "食パン:168", "たまご10個:278", "値引:-50"]);
}
// ---- 合計の見出しの揺れ・合計が次の行 ----
for (const [label, text] of [["合計", "合計 ¥1,234"], ["台計", "台計 ¥1,234"], ["合 計", "合 計 ¥1,234"], ["合計(税込)", "合計(税込) ¥1,234"], ["点数つき", "合計 3点 ¥1,234"], ["お会計", "お会計 ¥1,234"], ["円つき", "合計 1,234円"]]) {
  const r = parseReceipt("あおぞら商店\n2026/11/05\nコーヒー ¥634\nパン ¥600\n" + text);
  eq("合計の見出し：" + label, r.total, 1234); eq("合計の見出し：" + label + " 品目", r.items.length, 2);
}
{
  const r = parseReceipt("あおぞら商店\n2026/11/05\nコーヒー ¥634\nパン ¥600\n小計 ¥1,234\n合計\n¥1,234\nお預り ¥2,000\nお釣り ¥766");
  eq("合計が次の行", r.total, 1234); eq("合計が次の行：品目に入れない", names(r), ["コーヒー:634", "パン:600"]);
}
{
  const r = parseReceipt("あおぞら商店\nコーヒー ¥634\nパン ¥600\n人 計 ¥1,234\n合 放\n¥1,234");
  eq("見出しの読み違い（人計・合放）でも合計", r.total, 1234); eq("読み違いの見出しは品目にしない", r.items.length, 2);
}
{
  const r = parseReceipt("あおぞら商店\n牛乳 ¥238\n体温計 ¥498\n合計 ¥736");
  eq("「計」で終わる品目（体温計）は品目のまま", names(r), ["牛乳:238", "体温計:498"]);
}
{
  const r = parseReceipt("あおぞら商店\nパン ¥300\n合計 ¥300\n合計 ¥330\n小計 ¥300");
  eq("合計の候補：品目の合計と同じものを優先", [r.total, r.totals], [300, [300, 330]]);
}
// ---- 日付 ----
for (const [name, line, want] of [
  ["2桁の年", "26/11/03 09:15", "2026-11-03"], ["年月日", "2026年11月08日(日) 18:32", "2026-11-08"], ["ドット", "2026.11.8", "2026-11-08"], ["区切りが空白", "2026 11 10 12:05", "2026-11-10"],
  ["令和", "令和8年11月3日", "2026-11-03"], ["R表記", "R8.11.3", "2026-11-03"], ["年なし＋時刻", "11/08 18:32", thisYear + "-11-08"],
  ["O を0に", "2O26年11月O8日", "2026-11-08"], ["全角", "２０２６年１１月０８日", "2026-11-08"], ["字の間の空白", "2026 年 11 月 08 日 (日 ) 18:32", "2026-11-08"]]) {
  if (name === "年なし＋時刻" && thisYear + "-11-08" > addDays(todayStr(), 1)) continue;               // 今年の11/8がまだ先なら、去年として読む仕様
  eq("日付：" + name, parseReceipt("あおぞら商店\n" + line + "\nパン ¥300").date, want);
}
{
  const r = parseReceipt("あおぞら商店\nTEL 000-00-00\n電話 26-11-03\nパン ¥300");
  eq("電話番号は日付にしない", r.date, "");
}
{
  const r = parseReceipt("あおぞら商店\n2026/11/03 10:00\n2026/11/05 12:00\nパン ¥300");
  eq("日付の候補が複数", [r.date, r.dates], ["2026-11-03", ["2026-11-03", "2026-11-05"]]);
}
{
  const y = Number(thisYear), r = parseReceipt("あおぞら商店\n" + (y + 2) + "/11/03\nパン ¥300");
  eq("先すぎる日付は後ろへ回し、今年・去年の同じ月日を候補にする", [r.date !== "", r.dates.length >= 2, r.dates[r.dates.length - 1]], [true, true, (y + 2) + "-11-03"]);
}
// ---- 数量の行・時刻・品目にしない行 ----
{
  const r = parseReceipt("あおぞら商店\n2026/11/03 09:15\nティッシュ 5箱\n2個 x 268 ¥536\n洗剤 ¥398\n小計 ¥934\n合計 ¥934");
  eq("数量の行：品名の行に小計をつける", names(r), ["ティッシュ 5箱×2:536", "洗剤:398"]);
}
{
  const r = parseReceipt("あおぞら商店\nティッシュ ¥268\n2個 × 268 ¥536\n合計 ¥536");
  eq("数量の行：品名の行に単価があるときは置き換える", names(r), ["ティッシュ×2:536"]);
}
{
  const r = parseReceipt("あおぞら商店\nお茶\n@120 x3 ¥360\n合計 ¥360");
  eq("数量の行：@単価 x 数量", names(r), ["お茶×3:360"]);
}
{
  const r = parseReceipt("あおぞら商店\n18:32\n12:05 レジ03\nレジ 03 担当 12\n登録番号 T1234567890123\nパン ¥300");
  eq("時刻・レジ・登録番号は品目にしない", names(r), ["パン:300"]);
}
// ---- お店の名前 ----
for (const [name, text, want] of [
  ["領収書のあと", "領収書\nドラッグひまわり 中央店\nTEL 000-0000-0000\n26/11/03\nパン ¥300", "ドラッグひまわり中央店"],
  ["住所より店名", "東京都架空区1-2-3\nカフェ・ルナ\n2026/11/10\nパン ¥300", "カフェ・ルナ"],
  ["読み違いの行が前にあるとき", ". 公回問\nスーパーみどり堂 駅前店\nTEL 000-0000-0000\n2026年11月08日\nパン ¥300", "スーパーみどり堂駅前店"],
  ["前後の記号", "・* スーパーみどり堂 駅前店ーー時\n2026年11月08日\nパン ¥300", "スーパーみどり堂駅前店"],
  ["先頭の行", "まるや\n2026/11/10\nパン ¥300", "まるや"]]) eq("お店：" + name, parseReceipt(text).store, want);
// ---- 読み取りの整え方 ----
eq("字の間の空白を取る", cleanReceiptText("スー パー みどり 堂 駅 前 店"), ["スーパーみどり堂駅前店"]);
eq("数字の中の O と l", cleanReceiptText("l,2O0 円"), ["1,200円"]);
eq("品名の中の O・I は触らない", cleanReceiptText("OIL 牛乳 B100"), ["OIL 牛乳 B100"]);
eq("円記号が Y・\\ に読まれたとき", cleanReceiptText("牛乳 \\238\nパン Y168"), ["牛乳 ¥238", "パン ¥168"]);
{
  const r = parseReceipt("あおぞら商店\n牛乳 \\238\nパン  Y168\nバナナ \\ 198\n合計 \\604");
  eq("円記号が読み違えられても金額を読む", [names(r), r.total], [["牛乳:238", "パン:168", "バナナ:198"], 604]);
}
{
  const r = parseReceipt("あおぞら商店\nカード番号 4980-1234-5678-9012\n会員 1234 5678 9012 3456\nパン ¥300");
  eq("カード番号らしい行は捨てる", [names(r), JSON.stringify(r).includes("4980"), JSON.stringify(r).includes("1234")], [["パン:300"], false, false]);
}
eq("空・無意味な文字", [parseReceipt("").items.length, parseReceipt(" \n. ー ・\n").store, parseReceipt(null).total], [0, "", 0]);

// ---- 写真の計算（receipt-image.js） ----
// EXIFの向きを入れた最小のJPEGの先頭
const exif = (o, le) => {
  const w16 = (v) => (le ? [v & 255, v >> 8] : [v >> 8, v & 255]), w32 = (v) => (le ? [v & 255, (v >> 8) & 255, 0, 0] : [0, 0, v >> 8, v & 255]);
  const tiff = [].concat(le ? [0x49, 0x49] : [0x4d, 0x4d], w16(42), w32(8), w16(1), w16(0x0112), w16(3), w32(1), w16(o), [0, 0], w32(0));
  const body = [0x45, 0x78, 0x69, 0x66, 0, 0].concat(tiff), len = body.length + 2;
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe1, len >> 8, len & 255].concat(body, [0xff, 0xc0, 0, 11, 8, 0x0b, 0xd0, 0x0f, 0xc0, 3, 1, 0x22, 0, 0xff, 0xd9]));
};
for (const o of [1, 3, 6, 8]) for (const le of [false, true]) eq("EXIFの向き " + o + (le ? "（リトルエンディアン）" : ""), exifOrientation(exif(o, le)), o);
eq("EXIFなし・JPEGでない", [exifOrientation(new Uint8Array([0xff, 0xd8, 0xff, 0xd9, 0, 0, 0, 0, 0, 0, 0, 0])), exifOrientation(new Uint8Array([1, 2, 3])), exifOrientation(null)], [1, 1, 1]);
eq("範囲外の向きは1", exifOrientation(exif(9, false)), 1);
eq("JPEGの保存サイズ（3024x4032）", jpegSize(exif(6, false)), { w: 0x0fc0, h: 0x0bd0 });
// 向きの変換：2×3画素の目印の画像を変換して、期待どおりに並ぶか
{
  const w = 3, h = 2, src = [1, 2, 3, 4, 5, 6];                       // 1 2 3 / 4 5 6
  const apply = (o) => {
    const t = orientMatrix(o, w, h), out = new Array(t.w * t.h).fill(0);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const [a, b, c, d, e, f] = t.m, X = a * x + c * y + e, Y = b * x + d * y + f;                    // 画素の左上を移す
      const cx = a * (x + 0.5) + c * (y + 0.5) + e, cy = b * (x + 0.5) + d * (y + 0.5) + f;
      out[Math.floor(cy) * t.w + Math.floor(cx)] = src[y * w + x]; void X; void Y;
    }
    return { w: t.w, h: t.h, px: out };
  };
  eq("向き1（そのまま）", apply(1).px, [1, 2, 3, 4, 5, 6]);
  eq("向き3（180度）", apply(3).px, [6, 5, 4, 3, 2, 1]);
  eq("向き6（右に90度）", [apply(6).w, apply(6).h, apply(6).px], [2, 3, [4, 1, 5, 2, 6, 3]]);
  eq("向き8（左に90度）", apply(8).px, [3, 6, 2, 5, 1, 4]);
  eq("向き2（左右反転）", apply(2).px, [3, 2, 1, 6, 5, 4]);
  eq("向き5（転置）", apply(5).px, [1, 4, 2, 5, 3, 6]);
}
eq("縮小の大きさ", [fitSize(4032, 3024, 3000, 7e6), fitSize(3024, 4032, 3000, 7e6), fitSize(800, 600, 3000, 7e6), fitSize(4032, 3024, 1800, 3.2e6)], [{ w: 3000, h: 2250 }, { w: 2250, h: 3000 }, { w: 800, h: 600 }, { w: 1800, h: 1350 }]);
// 影：右半分が暗い紙に線を引き、白黒にした後も線は黒・紙は白になる
{
  const w = 400, h = 200, g = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) g[y * w + x] = x < 200 ? 230 : 90;                // 明るい紙と影の紙
  for (const x0 of [60, 300]) for (let y = 40; y < 160; y++) for (let x = x0; x < x0 + 5; x++) g[y * w + x] = x0 < 200 ? 90 : 20;   // 線
  binarize(g, w, h);
  const at = (x, y) => g[y * w + x];
  eq("影の中でも紙は白・線は黒", [at(20, 20) > 230, at(150, 20) > 230, at(250, 20) > 230, at(350, 20) > 230, at(62, 100) < 80, at(302, 100) < 80], [true, true, true, true, true, true]);
}
// 小さな点と大きなかたまりを消し、文字の大きさのものは残す
{
  const w = 300, h = 300, g = new Uint8Array(w * h).fill(255);
  g[10 * w + 10] = 0;                                                  // 1画素の点
  for (let y = 100; y < 130; y++) for (let x = 100; x < 110; x++) g[y * w + x] = 0;   // 文字の大きさ
  for (let y = 200; y < 290; y++) for (let x = 20; x < 280; x++) g[y * w + x] = 0;    // 大きなかたまり
  despeckle(g, w, h, 6, 60);
  eq("点と大きなかたまりは消え、文字は残る", [g[10 * w + 10], g[110 * w + 105], g[250 * w + 100]], [255, 0, 255]);
}

console.log("レシートの単体試験: " + ok + "/" + (ok + ng) + " 件 合格" + (ng ? "、" + ng + " 件 不合格" : ""));
process.exit(ng ? 1 : 0);
