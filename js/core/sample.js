"use strict";
// ===== 見本のデータ =====
// 役割: 初めて開いたときに見せる見本データを作る。最初の記録を保存したら、見本は消す
// 依存: util.js, model.js
// 実行時: なし
// 公開: sampleState, leaveSample

function sampleState() {
  const today = todayStr(), t = parseKey(today);
  const startD = new Date(t.getFullYear(), t.getMonth() - 1, 1);          // 先月の1日から（先月分の記録も見せるため）
  const start = dkey(startD);
  const tpl = [
    ["スーパー", "cash", "", [["牛乳", 238], ["食パン", 168], ["卵 10個", 278], ["鶏むね肉", 412]]],
    ["コンビニ", "code", "", [["おにぎり", 160], ["お茶", 151]]],
    ["ドラッグストア", "credit", "楽天カード", [["洗剤", 398], ["ティッシュ 5箱", 328], ["歯みがき粉", 258]]],
    ["カフェ", "code", "", [["カフェラテ", 480]]],
    ["書店", "credit", "三井住友カード", [["文庫本", 880]]],
    ["スーパー", "cash", "", [["豚こま肉", 356], ["キャベツ", 198], ["豆腐", 88], ["納豆", 108], ["バナナ", 158]]],
  ];
  const entries = [];
  let i = 0;
  for (let k = start; k < today; k = addDays(k, 1), i++) {
    if (i % 5 === 1 || i % 7 === 3) continue;                 // 使わなかった日
    const p = tpl[i % tpl.length];
    entries.push({ id: "s" + i, date: k, store: p[0], pay: p[1], card: p[2], items: p[3].map((x) => ({ n: x[0], p: x[1] })), total: p[3].reduce((a, x) => a + x[1], 0) });
  }
  return { v: STATE_VERSION, daily: DEFAULT_DAILY, start, cards: [makeCard("楽天カード"), Object.assign(makeCard("三井住友カード"), { close: 15, pay: 10 })], entries, invests: [{ id: "si1", date: dkey(new Date(t.getFullYear(), t.getMonth() - 1, 25)), amount: 5000, memo: "つみたて（見本）" }], mail: normMail(), sample: true };
}
// 見本を使っている間に最初の記録を保存したら、見本は消して本物の記録だけにする
function leaveSample(keep) {
  if (!state.sample) return;
  state.entries = []; state.invests = []; state.cards = state.cards.filter((c) => keep.includes(c.name)); state.start = todayStr(); state.sample = false;
}
