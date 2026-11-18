"use strict";
// ===== 月次レポート：支払い行動の指標 =====
// 役割: 1か月の日常支出（積立・投資を除く）から、支払い行動を表す指標（金額帯・曜日・時期・支払い方法・お店・品目）を数え、今月と前月を並べた表にする。Claudeが行動のプロファイルと節約の目標を立てるための材料。画面を触らない・通信しない純関数
// 依存: model.js, stats.js
// 実行時: なし
// 公開: reportProfile

const PROF_SMALL = 500, PROF_BIG = 3000;   // 少額・高額の境目（円）。少額＝500円未満、高額＝3,000円以上
const PROF_NAME = 60;                      // 表に出す店名・品名の長さの上限

const profPct = (a, b) => b > 0 ? Math.round(a / b * 1000) / 10 : 0;           // 割合（%、小数1桁）。分母が0なら0
const profSum = (a, f) => a.reduce((s, x) => s + f(x), 0);
const profMedian = (a) => { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y), h = s.length >> 1; return s.length % 2 ? s[h] : Math.round((s[h - 1] + s[h]) / 2); };
// その月の各日の曜日番号（0＝日 … 6＝土）
function profWeekdays(month) {
  const y = Number(month.slice(0, 4)), m = Number(month.slice(5, 7)), n = new Date(Date.UTC(y, m, 0)).getUTCDate(), out = [];
  for (let d = 1; d <= n; d++) out.push(new Date(Date.UTC(y, m - 1, d)).getUTCDay());
  return out;
}
// 大きい順に並べた「名前ごとの合計・回数」（同じ並べ方で毎回同じ結果になるよう、同額は名前順）
function profGroup(rows) {
  const g = new Map();
  rows.forEach(([name, key, amount]) => { const v = g.get(key) || { name, sum: 0, n: 0 }; v.sum += amount; v.n++; g.set(key, v); });
  return [...g.values()].sort((a, b) => b.sum - a.sum || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}
// 数える（tx＝日常の取引：{d, t, pay, s, items}）。返すのは、指標の名前 → 数
function profCalc(tx, month) {
  const wd = profWeekdays(month), days = wd.length, o = {}, pos = tx.filter((x) => x.t > 0), amounts = pos.map((x) => x.t);
  const byDay = new Map();
  tx.forEach((x) => byDay.set(x.d, (byDay.get(x.d) || 0) + x.t));
  const active = [...byDay.values()].filter((v) => v > 0).length;
  o.total = profSum(tx, (x) => x.t); o.activeDays = active; o.freeDays = days - active;
  o.perDay = Math.round(o.total / days); o.perActive = active ? Math.round(o.total / active) : 0;
  o.count = pos.length; o.avg = pos.length ? Math.round(profSum(pos, (x) => x.t) / pos.length) : 0; o.median = profMedian(amounts); o.max = amounts.length ? Math.max(...amounts) : 0;
  const small = pos.filter((x) => x.t < PROF_SMALL), big = pos.filter((x) => x.t >= PROF_BIG), posSum = profSum(pos, (x) => x.t);
  o.smallN = small.length; o.smallSum = profSum(small, (x) => x.t); o.smallPct = profPct(small.length, pos.length);
  o.midN = pos.length - small.length - big.length;
  o.bigN = big.length; o.bigSum = profSum(big, (x) => x.t); o.bigPct = profPct(o.bigSum, posSum);
  o.top5Pct = profPct(amounts.slice().sort((a, b) => b - a).slice(0, 5).reduce((s, v) => s + v, 0), posSum);
  const wsum = [0, 0, 0, 0, 0, 0, 0], wk = [0, 0, 0, 0];
  tx.forEach((x) => { const d = Number(x.d.slice(8, 10)); wsum[wd[d - 1]] += x.t; wk[Math.min(3, Math.floor((d - 1) / 7))] += x.t; });
  wsum.forEach((v, i) => { o["w" + i] = v; });
  wk.forEach((v, i) => { o["wk" + i] = v; });
  const endDays = wd.filter((w) => w === 0 || w === 6).length, midDays = days - endDays, endSum = wsum[0] + wsum[6];
  o.weekdayPerDay = Math.round((o.total - endSum) / midDays); o.weekendPerDay = endDays ? Math.round(endSum / endDays) : 0; o.weekendPct = profPct(endSum, o.total);
  const pay = (name) => profSum(tx.filter((x) => x.pay === name), (x) => x.t);
  o.cashSum = pay(PAY.cash); o.codeSum = pay(PAY.code); o.creditSum = pay(PAY.credit);
  o.cashPct = profPct(o.cashSum, o.total); o.codePct = profPct(o.codeSum, o.total); o.creditPct = profPct(o.creditSum, o.total);
  const shops = profGroup(pos.filter((x) => x.s).map((x) => [x.s, shopNorm(x.s), x.t]));
  const repeat = shops.filter((v) => v.n >= 3);
  o.shopCount = shops.length; o.top3Pct = profPct(shops.slice(0, 3).reduce((s, v) => s + v.sum, 0), profSum(shops, (v) => v.sum));
  o.repeatShops = repeat.length; o.repeatSum = profSum(repeat, (v) => v.sum); o.repeatPct = profPct(o.repeatSum, profSum(shops, (v) => v.sum));
  o.shops = shops;
  return o;
}
const PROF_WEEK = "日月火水木金土";
// 表の並び：[区分, 項目, 名前, 説明]。名前は profCalc の返す名前
const PROF_SPEC = [
  ["基本", "日常支出(円)", "total", "積立・投資を除く支出の合計"],
  ["基本", "支出のあった日数(日)", "activeDays", "1円以上の支出があった日"],
  ["基本", "支出のなかった日数(日)", "freeDays", "月の日数から引いた日数。記録を付けていない日も含む"],
  ["基本", "1日あたりの日常支出(円)", "perDay", "日常支出÷月の日数"],
  ["基本", "支出日あたりの日常支出(円)", "perActive", "日常支出÷支出のあった日数"],
  ["基本", "取引件数(件)", "count", "返金を除く"],
  ["基本", "平均単価(円)", "avg", "1件あたりの平均"],
  ["基本", "中央値(円)", "median", "ふだんの1件の大きさ。平均より小さければ、大きな買い物が平均を押し上げている"],
  ["基本", "最大の1件(円)", "max", ""],
  ["金額帯", "少額(" + PROF_SMALL + "円未満)の件数(件)", "smallN", "少額の買い物の多さ。ついで買い・習慣買いの目安"],
  ["金額帯", "少額の金額(円)", "smallSum", ""],
  ["金額帯", "少額の件数割合(%)", "smallPct", "全件に占める割合"],
  ["金額帯", "中額の件数(件)", "midN", PROF_SMALL + "円以上" + PROF_BIG + "円未満"],
  ["金額帯", "高額(" + PROF_BIG + "円以上)の件数(件)", "bigN", ""],
  ["金額帯", "高額の金額(円)", "bigSum", ""],
  ["金額帯", "高額の金額割合(%)", "bigPct", "日常支出に占める高額の割合。大きいほど、少数の買い物が支出を決めている"],
  ["金額帯", "金額上位5件の占有率(%)", "top5Pct", "上位5件が日常支出に占める割合"],
].concat([0, 1, 2, 3, 4, 5, 6].map((i) => ["曜日", PROF_WEEK[i] + "曜日の日常支出(円)", "w" + i, i === 0 ? "月内の同じ曜日の合計" : ""]),
  [["曜日", "平日1日あたり(円)", "weekdayPerDay", "月〜金の日常支出÷月〜金の日数"],
   ["曜日", "土日1日あたり(円)", "weekendPerDay", "土日の日常支出÷土日の日数"],
   ["曜日", "土日の割合(%)", "weekendPct", "日常支出に占める土日の割合"],
   ["時期", "1〜7日の日常支出(円)", "wk0", "月の初めの週。給料日後の使い方の目安"],
   ["時期", "8〜14日の日常支出(円)", "wk1", ""],
   ["時期", "15〜21日の日常支出(円)", "wk2", ""],
   ["時期", "22日〜月末の日常支出(円)", "wk3", "月末の週。日数が多い月は他より長い"],
   ["支払い方法", "現金の金額(円)", "cashSum", ""],
   ["支払い方法", "現金の割合(%)", "cashPct", ""],
   ["支払い方法", "バーコード決済の金額(円)", "codeSum", ""],
   ["支払い方法", "バーコード決済の割合(%)", "codePct", ""],
   ["支払い方法", "クレジットの金額(円)", "creditSum", "引き落としは翌月以降。使った感覚が薄れやすい"],
   ["支払い方法", "クレジットの割合(%)", "creditPct", ""],
   ["お店", "利用した店の数(店)", "shopCount", "店名が空の取引は除く"],
   ["お店", "上位3店の占有率(%)", "top3Pct", "店名のある支出に占める割合。大きいほど少数の店に集中"],
   ["お店", "3回以上利用した店の数(店)", "repeatShops", "よく行く店"],
   ["お店", "3回以上利用した店の金額(円)", "repeatSum", ""],
   ["お店", "3回以上利用した店の割合(%)", "repeatPct", "店名のある支出に占める割合。習慣になっている支出の目安"]]);
// 指標の表：[区分, 項目, 今月, 前月, 説明] の行。前月に取引がなければ前月は「該当なし」。prev は前月の日常の取引（品目は不要）
// extra：{save, total, prevSave, prevTotal}＝積立・投資額と、全体の合計（今月・前月）
function reportProfile(month, tx, prev, extra) {
  const cur = profCalc(tx, month), pm = month.slice(5, 7) === "01" ? (Number(month.slice(0, 4)) - 1) + "-12" : month.slice(0, 5) + String(Number(month.slice(5, 7)) - 1).padStart(2, "0");
  const old = prev.length ? profCalc(prev, pm) : null, none = "該当なし";
  const rows = PROF_SPEC.map(([g, label, key, note]) => [g, label, cur[key], old ? old[key] : none, note]);
  rows.push(["貯める", "積立・投資額(円)", extra.save, extra.prevTotal > 0 ? extra.prevSave : none, "店名のキーワードによる推定"]);
  rows.push(["貯める", "積立・投資の割合(%)", profPct(extra.save, extra.total), extra.prevTotal > 0 ? profPct(extra.prevSave, extra.prevTotal) : none, "全体の支出（日常＋積立・投資）に占める割合"]);
  cur.shops.slice(0, 5).forEach((v, i) => rows.push(["お店", "上位" + (i + 1) + "位の店の金額(円)", v.sum, "", (v.name + "・" + v.n + "回・平均" + Math.round(v.sum / v.n) + "円").slice(0, PROF_NAME + 20)]));
  const items = profGroup([].concat(...tx.map((x) => x.items.filter((it) => it.p > 0).map((it) => [it.n, shopNorm(it.n), it.p]))));
  items.slice(0, 5).forEach((v, i) => rows.push(["品目", "上位" + (i + 1) + "位の品目の金額(円)", v.sum, "", (v.name + "・" + v.n + "点").slice(0, PROF_NAME + 20)]));
  return rows;
}
