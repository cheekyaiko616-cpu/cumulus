"use strict";
// ===== レシートの文字の解析 =====
// 役割: 読み取った文字を整え（字の間の空白・数字の読み違い）、品目・金額・合計・日付・お店を取り出す。合計と日付は候補も返す（写真を読む部分は features/receipt.js）
// 依存: util.js, guard.js
// 実行時: なし
// 公開: parseReceipt, mergeReceipts

const RC_CJK = "\\u3040-\\u30ff\\u3400-\\u9fff";
const RC_Z2H = (s) => s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 65248)).replace(/[，]/g, ",").replace(/[．]/g, ".").replace(/[：]/g, ":").replace(/[／]/g, "/").replace(/[￥]/g, "¥").replace(/[＊]/g, "*").replace(/[（]/g, "(").replace(/[）]/g, ")").replace(/[＠]/g, "@").replace(/[ｘＸ×]/g, "x").replace(/[－―‐−]/g, "-");
// 1行を整える。日本語の文字どうしの間の空白を取り（読み取りは字の間に空白を入れやすい）、数字の中の O・l を数字に直す
function cleanLine(l) {
  l = RC_Z2H(l).replace(/[ \t\u3000]+/g, " ").trim();
  l = l.replace(new RegExp("([" + RC_CJK + "ー]) (?=[" + RC_CJK + "ー])", "g"), "$1");                // スー パー → スーパー
  l = l.replace(/(^| )[Y\\](?=\d)/g, "$1¥");                                                          // ¥ が Y や \ に読まれたとき
  l = l.split(" ").map((t) => {                                                                       // 数字ばかりの語の中の O・o・I・l・| を数字に直す（品名などは触らない）
    const body = t.replace(/^¥/, "");
    if (!/^[0-9OoIl|,.:\/\-]+$/.test(body)) return t;
    return /\d/.test(body) && !/^\d+[lI]$/.test(body) ? (t[0] === "¥" ? "¥" : "") + body.replace(/[Oo]/g, "0").replace(/[Il|]/g, "1") : t;
  }).join(" ");
  l = l.replace(/(\d)[Oo]/g, "$10").replace(/(\d)[Oo]/g, "$10").replace(/[Oo](\d)/g, "0$1").replace(/[Oo](\d)/g, "0$1");   // 数字にはさまれた・隣の O（2O26年・O8日）
  return l.replace(/(\d) ([年月日時分個点枚本円])/g, "$1$2").replace(/([年月日]) (\d)/g, "$1$2").replace(/\( /g, "(").replace(/ \)/g, ")").replace(/(\d) ?([:,.]) ?(\d)/g, "$1$2$3");
}
// 文字全体を行に分けて整える（空の行は捨てる）
function cleanReceiptText(text) { return String(text || "").split(/\r?\n/).map(cleanLine).filter(Boolean); }

// 1行から日付の候補を探す（年あり4桁・年あり2桁・令和・年なし＋時刻）。today は "YYYY-MM-DD"
function findDates(l, today) {
  const out = [], ty = Number(today.slice(0, 4));
  const add = (y, m, d) => { if (m >= 1 && m <= 12 && d >= 1 && d <= new Date(y, m, 0).getDate() && y >= 2000) out.push(y + "-" + pad(m) + "-" + pad(d)); };
  let m, re = /(?:^|\D)(20\d{2})\s*[年\/.\-]\s*(\d{1,2})\s*[月\/.\-]\s*(\d{1,2})(?!\d)/g;
  while ((m = re.exec(l))) add(+m[1], +m[2], +m[3]);
  if (out.length) return out;
  re = /(?:^|\D)(20\d{2}) +(\d{1,2}) +(\d{1,2})(?!\d)/g;                                              // 2026 11 10（区切りが読めなかったとき）
  while ((m = re.exec(l))) add(+m[1], +m[2], +m[3]);
  if (out.length) return out;
  re = /(?:^|\D)(\d{2})\s*[\/.\-]\s*(\d{1,2})\s*[\/.\-]\s*(\d{1,2})(?!\d)/g;                           // 26/11/08
  while ((m = re.exec(l))) if (+m[1] >= 20 && +m[1] <= ty - 2000 + 1) add(2000 + +m[1], +m[2], +m[3]);
  re = /令和\s*(\d{1,2}|元)\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})/g;
  while ((m = re.exec(l))) add(2018 + (m[1] === "元" ? 1 : +m[1]), +m[2], +m[3]);
  re = /(?:^|[^A-Za-z])R\s*(\d{1,2})[.\/\-](\d{1,2})[.\/\-](\d{1,2})(?!\d)/g;
  while ((m = re.exec(l))) add(2018 + +m[1], +m[2], +m[3]);
  if (out.length) return out;
  m = l.match(/(?:^|\D)(\d{1,2})\s*[\/月]\s*(\d{1,2})\s*日?\s*(?:\(.\))?\s+\d{1,2}:\d{2}/);              // 11/08 18:32（年なし。今年として読み、先の日付なら去年）
  if (m) { add(ty, +m[1], +m[2]); if (out.length && out[0] > today) { out.length = 0; add(ty - 1, +m[1], +m[2]); } }
  return out;
}

const RC_PRICE = /^(.*?)\s*[¥\\]?\s*(-?\d{1,3}(?:,\d{3})+|-?\d+)\s*円?\s*[※*軽内外非]*$/;
const RC_TOTAL = /[合台][\s]*[計訃討]|お?会計|総合計|請求(?:金)?額|支払金額|^[合台]\S?$|total/i;       // 合計の見出し（「合 放」のような読み違いも拾う）
const RC_TOTAL_WEAK = /\S計$/;                                                                           // 「大計」「人 計」など、見出しが読み違えられたもの（小計も含む）
const RC_SKIP = /小計|合計|台計|税|預|釣|現計|点数|ポイント|TEL|電話|No\.?|カード|残高|対象|領収|レジ|責|会員|支払|クレジット|現金|お買上|\d{4}[年\/]|担当|伝票|取引|端末|承認|ご利用|お客様|ありがとう|登録番号|インボイス|%/i;
const RC_STORE_BAD = /領収|レシート|明細|ご利用|ありがとう|いらっしゃい|毎度|TEL|電話|〒|https?:|www\.|登録番号|担当|レジ|インボイス|\d{3,}|\d:\d/i;
const RC_STORE_GOOD = /店|堂|屋|スーパー|マート|ストア|ドラッグ|薬局|コンビニ|カフェ|珈琲|食堂|商店|マーケット|ショップ|セブン|ローソン|ファミリー|ミニストップ|イオン/;
const RC_QTY = [
  /^(\d{1,3})\s*[個点コ本枚袋]?\s*x\s*@?¥?(\d[\d,]*)\s*¥?(\d[\d,]*)?\s*[※*軽]?$/,              // 2個 x 268 536
  /^@¥?(\d[\d,]*)\s*x\s*(\d{1,3})\s*[個点コ]?\s*¥?(\d[\d,]*)?\s*[※*軽]?$/,                        // @268 x2 536
  /^(\d{1,3})\s*[個点コ]\s*@¥?(\d[\d,]*)\s*¥?(\d[\d,]*)?\s*[※*軽]?$/,                              // 2点 @268 536
];
const rcNum = (s) => Number(String(s).replace(/,/g, ""));
// 数量の行を [数量, 単価, 小計] にする（数量の行でなければ null）
function qtyLine(l) {
  let m = l.match(RC_QTY[0]) || l.match(RC_QTY[2]);
  if (m) { const q = +m[1], u = rcNum(m[2]); return [q, u, m[3] ? rcNum(m[3]) : q * u]; }
  m = l.match(RC_QTY[1]);
  if (m) { const q = +m[2], u = rcNum(m[1]); return [q, u, m[3] ? rcNum(m[3]) : q * u]; }
  return null;
}
// お店の名前を選ぶ（先頭の数行から。「領収書」や住所・電話の行ではなく、店・屋・マートなど店名らしい行を優先する）。前後の読み違いの記号は落とす
function pickStore(lines) {
  let best = "", bs = 0, stop = lines.findIndex((l) => /TEL|電話/i.test(l) || findDates(l, "2099-12-31").length > 0);       // 店名は電話・日付の行より上にある
  stop = stop < 0 ? 10 : Math.min(10, Math.max(stop, 2));
  lines.slice(0, stop).forEach((l, i) => {
    const t = l.replace(/ /g, "");
    if (t.length < 2 || t.length > 28 || RC_STORE_BAD.test(l) || looksSensitive(l)) return;
    if (RC_PRICE.test(l) && /[¥,]|\d{3}$/.test(t)) return;
    if (!new RegExp("^[" + RC_CJK + "A-Za-z・ー&.\\-() ]+$").test(l) && (t.match(/\d/g) || []).length > 2) return;
    const letters = (t.match(/[\u3041-\u30fa\u30fc\u3400-\u9fffA-Za-z]/g) || []).length;
    if (letters < 2 || letters < t.length * 0.6) return;
    const s = 10 - i + (RC_STORE_GOOD.test(t) ? 12 : 0) - (/[都道府県市区町村郡].*\d|丁目|\d-\d/.test(t) ? 8 : 0);
    if (s > bs) { bs = s; best = l; }
  });
  best = best.replace(/^[^A-Za-z0-9\u3041-\u30fa\u30fd-\u30ff\u3400-\u9fff]+/, "").replace(/ー{2,}.*$/, "").replace(/[^A-Za-z0-9\u3040-\u30ff\u3400-\u9fff)]+$/, "");
  const e = best.lastIndexOf("店");
  if (e > 0 && best.length - e <= 5) best = best.slice(0, e + 1);                // 「…駅前店ーー時」→「…駅前店」
  return best;
}

function parseReceipt(text) {
  const today = todayStr(), lines = cleanReceiptText(text);
  const out = { store: "", date: "", total: 0, items: [], dates: [], totals: [] };
  const dates = [], strong = [], weak = [];
  let pendName = "", wantTotal = false, done = false, last = null;
  for (const l of lines) {
    if (!/TEL|電話/i.test(l)) for (const d of findDates(l, today)) if (!dates.includes(d)) dates.push(d);
    if (looksSensitive(l)) continue;                                  // カード番号・会員番号・電話番号などの行は読み捨てる
    const m = l.replace(/(\d) ?, ?(\d{3})/g, "$1,$2").match(RC_PRICE);
    const timeOnly = /\d{1,2}:\d{2}/.test(l) || findDates(l, today).length > 0;
    const q = !timeOnly && qtyLine(l.replace(/(\d) ?, ?(\d{3})/g, "$1,$2"));
    if (q && q[2] > 0 && q[2] < 1000000) {                            // 数量の行：品目にせず、直前の品名・品目に数量と小計を足す
      if (last && last.p === q[1] && q[0] > 1) { last.p = q[2]; last.n += "×" + q[0]; }
      else if (pendName) { out.items.push((last = { n: pendName + (q[0] > 1 ? "×" + q[0] : ""), p: q[2] })); pendName = ""; }
      wantTotal = false;
      continue;
    }
    if (!m || timeOnly) {
      if (wantTotal) wantTotal = false;
      if (RC_TOTAL.test(l) && !/小計/.test(l)) { wantTotal = true; continue; }                        // 「合計」だけの行：金額は次の行
      pendName = !timeOnly && !SKIPPED(l) && /[぀-ヿ㐀-鿿A-Za-z]{1}/.test(l) && l.length <= 30 ? l : "";
      continue;
    }
    const name = m[1].replace(/[¥\\*※ ]+$/g, "").trim(), price = rcNum(m[2]), head = name.replace(/[(]?税[込抜][)]?/g, "");        // 「合計(税込)」の税込は見出しの一部
    if (RC_TOTAL.test(head) && !/小計/.test(head) && !/税|預|釣/.test(head)) { strong.push(price); done = true; wantTotal = false; continue; }
    if (!head && wantTotal) { strong.push(price); done = true; wantTotal = false; continue; }          // 前の行が「合計」だけだった
    if (/小計/.test(name)) { weak.push(price); wantTotal = false; continue; }
    wantTotal = false;
    const nm = name || pendName; pendName = "";
    if (done || !nm || SKIPPED(nm) || price === 0 || Math.abs(price) > 999999) continue;
    if (price < 0 && !/値引|割引|引/.test(nm)) continue;
    if (!/[぀-ヿ㐀-鿿A-Za-z]/.test(nm) || nm.length > 40) continue;
    out.items.push((last = { n: nm.replace(/^[・*|\-.]+/, "").trim(), p: price, w: RC_TOTAL_WEAK.test(nm) }));
  }
  let run = 0;                                                        // 「大計」「人 計」のように見出しが読み違えられた行は、その前までの品目の合計と同じ額のときだけ合計として扱う（「体温計」などの品目は残す）
  out.items = out.items.filter((i) => { const isTotal = i.w && run > 0 && i.p === run; delete i.w; if (isTotal) weak.push(i.p); else run += i.p; return !isTotal; });
  const sum = out.items.reduce((a, i) => a + i.p, 0);
  const pool = strong.length ? strong : weak;
  const first = pool.includes(sum) ? sum : pool[0] || 0;
  out.total = first;
  out.totals = [...new Set([first].concat(strong, weak).filter(Boolean))].slice(0, 4);
  // 日付：先の日付（読み違い）は後ろに回し、年が違いすぎるときは今年にした日付も候補に足す
  const ok = (d) => d <= addDays(today, 1) && d >= addDays(today, -800);
  const good = dates.filter(ok), bad = dates.filter((d) => !ok(d));
  if (!good.length && bad.length) { const b = bad[0], y = Number(today.slice(0, 4)); for (const yy of [y, y - 1]) { const c = yy + b.slice(4); if (ok(c) && !good.includes(c)) good.push(c); } }
  out.dates = good.concat(bad).slice(0, 4);
  out.date = good[0] || "";
  out.store = pickStore(lines);
  return out;
}
function SKIPPED(s) { return RC_SKIP.test(s); }
// 2回読んだ結果をまとめる：点数の高いほうを軸にして、読めなかった項目（お店・日付・合計）はもう一方から補い、日付・合計の候補は両方から集める
function rcScore(r) { return (r.total ? 2 : 0) + (r.date ? 1 : 0) + Math.min(r.items.length, 3) + (r.store ? 1 : 0); }
function mergeReceipts(a, b) {
  const [x, y] = rcScore(b) > rcScore(a) ? [b, a] : [a, b];
  const sum = x.items.reduce((t, i) => t + i.p, 0), uniq = (l) => [...new Set(l)].slice(0, 4);
  const out = { store: x.store || y.store, date: x.date || y.date, total: x.total || y.total, items: x.items, dates: uniq(x.dates.concat(y.dates)), totals: uniq(x.totals.concat(y.totals)) };
  if (x.total && y.total && x.total !== y.total && y.total === sum) out.total = y.total;            // 品目の合計と合うほうの合計を使う
  out.totals = uniq([out.total].concat(out.totals).filter(Boolean));
  return out;
}
