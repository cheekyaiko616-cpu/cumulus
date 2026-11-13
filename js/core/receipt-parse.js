"use strict";
// ===== レシートの文字の解析 =====
// 役割: 読み取った文字を整え（字の間の空白・数字の読み違い）、品目・金額・合計・日付・お店・支払い方法を取り出す。合計と日付は候補も返す（写真を読む部分は features/receipt.js）。
//       レシートの決まった形（店名・住所 → 品目 → 小計・税 → 合計 → 支払い → 控え）を手がかりにする。カード番号・承認番号などの数字は取り出さない。
//       読み取り後の補正（追加の読み取りなし）：品名・店名は receipt-dict.js の履歴＋内蔵辞書で近似補正（dict 引数）、日付は1桁の読み違い・曜日で、金額は検算・税率別の対象額と税額・合計と支払いの一致で直す。確信が低ければ読んだまま
// 依存: util.js, guard.js, receipt-dict.js
// 実行時: なし
// 公開: parseReceipt, mergeReceipts, receiptCard, rcScore, RC_CHAINS

const RC_CJK = "\\u3040-\\u30ff\\u3400-\\u9fff";
const RC_Z2H = (s) => s.replace(/[\u2460-\u2473]/g, (c) => String(c.charCodeAt(0) - 0x245f)).replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 65248)).replace(/[，]/g, ",").replace(/[．]/g, ".").replace(/[：]/g, ":").replace(/[／]/g, "/").replace(/[￥]/g, "¥").replace(/[＊]/g, "*").replace(/[（]/g, "(").replace(/[）]/g, ")").replace(/[＠]/g, "@").replace(/[ｘＸ×]/g, "x").replace(/[－―‐−]/g, "-");
// 1行を整える。日本語の文字どうしの間の空白を取り（読み取りは字の間に空白を入れやすい）、数字の中の O・l を数字に直す
function cleanLine(l) {
  l = RC_Z2H(l).replace(/[ \t\u3000]+/g, " ").trim().replace(/^(?:45|49)\d{11}(?!\d) ?(?=\S)(?!JAN)/i, "").replace(/ [やギ半羊洋キ](?=(?:\d{1,3}(?:[,.]\d{3})+|\d{2,})(?:円)?$)/, " ¥");   // 行末の金額の ¥ が「や」「半」などに読まれたとき
  l = l.replace(/(\D) \d(?=\\\d)/g, "$1 ");                                                          // 「3\99」：¥ の前に付いた1桁の読み違い（数字と \ がくっついた形は、ふつうの数量の書き方ではない）
  l = l.replace(/(\d) ?[一ー] ?(?=\d)/g, "$1-");
  l = l.replace(/(^|[ \-])[Y\\](?=\d)/g, "$1¥");                                                     // ¥ が Y や \ に読まれたとき
  l = l.replace(/[▲△▽]\s?(?=[¥\\]?\s?\d)/g, "-").replace(/-\s?([¥\\])\s?(?=\d)/g, "$1-");                          // ▲100・-¥238 → ¥-100（マイナスの金額）
  l = l.replace(/((?:値引|割引|クーポン|引)\S*\s?[¥\\]?\s?)(\d[\d,]*)\s?-$/, "$1-$2");                              // 値引 50-（末尾のマイナス）
  l = l.replace(new RegExp("([" + RC_CJK + "ー]) (?=[" + RC_CJK + "ー])", "g"), "$1");                // スー パー → スーパー
  for (let k = 0; k < 3; k++) l = l.replace(/ +(?:[^\p{L}\p{N}¥\\)）]|ー)+$/u, "").replace(/^[|.,_、。'"`~^!:;]+ +/, "");   // 行の前後に付いた読み違いの記号（罫線・汚れ）
  l = l.split(" ").map((t) => {                                                                       // 数字ばかりの語の中の O・o・I・l・| を数字に直す（品名などは触らない）
    const body = t.replace(/^¥/, "");
    if (!/^[0-9OoIl|,.:\/\-]+$/.test(body)) return t;
    return /\d/.test(body) && !/^\d+[lI]$/.test(body) ? (t[0] === "¥" ? "¥" : "") + body.replace(/[Oo]/g, "0").replace(/[Il|]/g, "1") : t;
  }).join(" ");
  l = l.replace(/([¥\\]\s?-?)(\d{1,3})[ .](\d{3})(?!\d)/g, "$1$2,$3").replace(/(\d{1,3})\.(\d{3})(?=円)/g, "$1,$2").replace(/(\S ¥?)([1-9]\d{0,2})\.(\d{3})$/, "$1$2,$3");          // ¥1 234・¥1.234（桁区切りが空白・ピリオドに読まれたとき）                                                         // 2-19ー10（住所の区切りが長音・漢数字に読まれたとき）
  l = l.replace(/([¥\\]\s?\d[\d,]*|\d[\d,]*\s?円)\s?(?:[-ー―]+|也|円也)$/, "$1");                                      // ¥1,234-・5,500円也（手書き風の領収書）
  l = l.replace(/([¥\\]\s?-?\d[\d,]*) [぀-ヿ㐀-鿿]{1,2}$/, (m, a, off, str) => (/^[軽内外非※]/.test(m.slice(a.length + 1)) ? m : a));   // 金額のあとに紙の縁などが1〜2文字写り込んだとき（軽・内・外などの印は残す）
  if (!/\(/.test(l)) l = l.replace(/([¥\\]\s?-?\d[\d,]*) ?\)$/, "$1");                                   // 金額のあとの閉じ括弧だけ
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
  re = /(?:^|\D)(\d{1,2})\/(\d{1,2})\/(20\d{2})(?!\d)/g;                                                  // 11/10/2026（月/日/年。日/月/年でも読めるときは両方を候補にする）
  while ((m = re.exec(l))) { add(+m[3], +m[1], +m[2]); if (+m[1] !== +m[2]) add(+m[3], +m[2], +m[1]); }
  if (out.length) return out;
  re = /令和\s*(\d{1,2}|元)\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})/g;
  while ((m = re.exec(l))) add(2018 + (m[1] === "元" ? 1 : +m[1]), +m[2], +m[3]);
  re = /(?:^|[^A-Za-z])R\s*(\d{1,2})[.\/\-](\d{1,2})[.\/\-](\d{1,2})(?!\d)/g;
  while ((m = re.exec(l))) add(2018 + +m[1], +m[2], +m[3]);
  if (out.length) return out;
  m = l.match(/(?:^|\D)(\d{1,2})\s*[\/月]\s*(\d{1,2})\s*日?\s*(?:\(.\))?\s*\d{1,2}:\d{2}/);              // 11/08 18:32（年なし。今年として読み、先の日付なら去年）
  if (m) { add(ty, +m[1], +m[2]); if (out.length && out[0] > today) { out.length = 0; add(ty - 1, +m[1], +m[2]); } }
  return out;
}

const RC_PRICE = /^(.*?)\s*[¥\\]?\s*(-?\d{1,3}(?:,\d{3})+|-?\d+)\s*円?\s*[※*軽内外非]*\)?$/;
const RC_TOTAL = /[合台含][\s]*[計訃討]|お?会計|総合計|請求(?:金)?額|支払金額|お?買い?上げ?計|現計|総計|ご?利用金額|領収(?:金)?額|^[合台]\S?$|total/i;     // 合計の見出し（「合 放」「含計」のような読み違いも拾う）
const RC_TOTAL_EXACT = /^(?:金額|御?代金|お?代)$/;                                                           // 手書き風の領収書の「金額 ¥1,234」
const RC_TOTAL_WEAK = /\S計$/;                                                                           // 「大計」「人 計」など、見出しが読み違えられたもの（小計も含む）
const RC_ADDR = /本社|本店所在|住所|〒|[都道府県][^ ]{0,8}[市区町村郡]|[市区町村].{0,8}\d+-\d+|丁目|番地/;     // 住所の行
const RC_SKIP = /小計|合計|台計|税|預|釣|現計|点数|ポイント|TEL|電話|FAX|No\.?|カード|残高|対象|領収|レジ(?!袋)|責|会員|支払|クレジット|現金|お買上|\d{4}[年\/]|担当|伝票|取引|端末|承認|ご利用|お客様|ありがとう|登録番号|インボイス|営業時間|%|[x*]{3,}|テーブル|人数|^卓\s?\d|ご来店|入庫|出庫|乗車|区間|注文番号|受付番号|整理番号|呼出|様$|御中$/i;
const RC_STOP = /お?買い?上げ?点数|売上票|お客様控|カード会社|承認番号|伝票番号|有効期限|会員番号|取引番号|端末番号|ご利用明細|返品の際/;  // ここから下は品目ではない（品目のあとにあるとき）
const RC_JAN = /^\d{8,14} ?JAN|^JAN ?\d{8,14}$|^\d{8,14}$/i;                                                  // 商品のバーコードの数字の行
const RC_TAX = /税額|消費税|内税|外税|税等/;
const RC_SVC = /サービス料|奉仕料|チャージ料?|席料/;                                                          // 品目にする（%が付いていても）
const RC_DISC = /値引|割引|引|クーポン|優待|ポイント(?:利用|使用|値引|割引|充当)?/;                                       // マイナスの金額なら値引きの品目
const RC_DISC_ALL = /全品|お?会計|レジ|合計|総額|ポイント(?:利用|使用|充当)|スタンプ|商品券|金券|優待|会員/;                                  // 全体にかかる値引き（直前の商品に結び付けない）
const RC_MEASURE = /^[\d.,]+\s*(?:円|点|個|本|枚|袋|kg|g|ml|L|l|cm|m)?(?:\s*[x×@]\s*[\d.,]+\S*)?$/;      // 「348g x 158円/100g」「110円 x 2」（品名のない数量の行）
const RC_FUEL = /^(\d+(?:\.\d+)?)\s*[Ll]\s*[x×@]?\s*[¥\\]?\s*(\d+(?:\.\d+)?)\s*(?:\/\s*[Ll])?\s*[¥\\]?\s*(\d[\d,]*)?$/;   // 32.45L x ¥165/L ¥5,354
const RC_PAYS = [                                                                                      // 支払い方法（強いものから）
  ["credit", /クレジ|売上票|カード会社|VISA|JCB|MASTER|AMEX|DINERS|ダイナース|アメックス|(?:^|[^A-Za-z])iD(?:[^A-Za-z]|$)|QUICPay|クイックペイ/i],
  ["code", /QR|PayPay|ペイペイ|d払い|楽天ペイ|au ?PAY|メルペイ|LINE ?Pay|バーコード決済|コード決済|Alipay|WeChat/i],
  ["cash", /現金|お?預り|お?預かり|お?釣り?|おつり/],
];
const RC_BRANDS = [["JCB", /JCB/i], ["VISA", /VISA|ビザ/i], ["Master", /MASTER|マスター/i], ["AMEX", /AMEX|AMERICAN ?EXPRESS|アメックス|アメリカン・?エキスプレス/i], ["Diners", /DINERS|ダイナース/i], ["UnionPay", /銀聯|UNION ?PAY/i]];
const RC_STORE_BAD = /領収|レシート|明細|ご利用|ありがとう|いらっしゃい|毎度|TEL|電話|〒|https?:|www\.|登録番号|担当|レジ|インボイス|本社|営業時間|\d{3,}|\d:\d|様$|御中$|小計|合計|台計|税|預|釣|お買上|クレジット|現金|ハイオク|レギュラー|軽油|灯油|ガソリン|洗車|モバイルオーダー|電子レシート/i;
const RC_STORE_LABEL = /^(?:発行者|発行元|ご?利用店舗|店舗名|店名|加盟店名?|取扱店)\s*[:：]?\s*(\S.{1,26})$/;     // 「ご利用店舗 〇〇」「発行者 〇〇」
const RC_STORE_GOOD = /店|堂|屋|スーパー|マート|ストア|ドラッグ|薬局|コンビニ|カフェ|珈琲|食堂|商店|マーケット|ショップ|セブン|ローソン|ファミリー|ミニストップ|イオン/;
const RC_GENERIC = ["領収書", "領収証", "レシート", "ディスカウントショップ", "いらっしゃいませ", "毎度ありがとうございます", "ありがとうございました", "お買上明細", "お客様控え", "クレジット売上票"];
// 有名なお店の名前（読み取りで崩れやすいので、近い並びでも見つける）。h は名前のほかの手がかり（本社の所在地の一部など）
const RC_CHAINS = [
  ["ドン・キホーテ", ["ドン・キホーテ", "ドンキホーテ", "MEGAドン・キホーテ", "DONQUIJOTE"], ["目黒区青葉台"]],
  ["セブン-イレブン", ["セブン-イレブン", "セブンイレブン", "7-ELEVEN", "SEVEN-ELEVEN"]], ["ローソン", ["ローソン", "LAWSON"]], ["ファミリーマート", ["ファミリーマート", "FamilyMart"]],
  ["ミニストップ", ["ミニストップ", "MINISTOP"]], ["デイリーヤマザキ", ["デイリーヤマザキ"]], ["セイコーマート", ["セイコーマート"]],
  ["イオン", ["イオンリテール", "イオンスタイル", "AEON"]], ["マックスバリュ", ["マックスバリュ", "MaxValu"]], ["イトーヨーカドー", ["イトーヨーカドー", "イトーヨーカ堂"]],
  ["西友", ["西友", "SEIYU"]], ["ライフ", ["ライフコーポレーション"]], ["業務スーパー", ["業務スーパー"]], ["成城石井", ["成城石井"]], ["まいばすけっと", ["まいばすけっと"]],
  ["ヤオコー", ["ヤオコー"]], ["ベルク", ["ベルク"]], ["カスミ", ["カスミ"]], ["バロー", ["バロー"]], ["トライアル", ["トライアル"]], ["コストコ", ["コストコ", "COSTCO"]],
  ["ロピア", ["ロピア"]], ["オーケー", ["オーケーストア", "OKストア"]],
  ["マツモトキヨシ", ["マツモトキヨシ", "マツキヨ"]], ["ウエルシア", ["ウエルシア", "ウェルシア"]], ["スギ薬局", ["スギ薬局"]], ["ツルハドラッグ", ["ツルハドラッグ", "ツルハ"]],
  ["サンドラッグ", ["サンドラッグ"]], ["ココカラファイン", ["ココカラファイン"]], ["ドラッグストアコスモス", ["ドラッグストアコスモス", "コスモス薬品"]], ["クリエイトSD", ["クリエイトSD", "クリエイトエス・ディー"]],
  ["ダイソー", ["ダイソー", "DAISO"]], ["セリア", ["セリア", "Seria"]], ["キャンドゥ", ["キャンドゥ"]], ["ユニクロ", ["ユニクロ", "UNIQLO"]], ["しまむら", ["しまむら"]],
  ["無印良品", ["無印良品", "MUJI"]], ["ニトリ", ["ニトリ", "NITORI"]], ["カインズ", ["カインズ", "CAINZ"]], ["コメリ", ["コメリ"]],
  ["ビックカメラ", ["ビックカメラ"]], ["ヨドバシカメラ", ["ヨドバシカメラ"]], ["ヤマダデンキ", ["ヤマダデンキ"]], ["ケーズデンキ", ["ケーズデンキ"]], ["エディオン", ["エディオン"]],
  ["スターバックス", ["スターバックス", "STARBUCKS"]], ["ドトール", ["ドトールコーヒー", "DOUTOR"]], ["タリーズ", ["タリーズ", "TULLY'S"]], ["マクドナルド", ["マクドナルド", "McDonald"]],
  ["モスバーガー", ["モスバーガー"]], ["すき家", ["すき家"]], ["吉野家", ["吉野家"]], ["サイゼリヤ", ["サイゼリヤ"]], ["ガスト", ["ガスト"]],
];
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
// 2つの文字の近さ（入れ替え・抜け・余分の数）
function rcDist(a, b) {
  let p = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const c = [i];
    for (let j = 1; j <= b.length; j++) c[j] = Math.min(p[j] + 1, c[j - 1] + 1, p[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    p = c;
  }
  return p[b.length];
}
// 行 t の中に、word とほぼ同じ並びがあるか（長い語ほど読み違いを多めに許す。短い語は完全に一致するときだけ）
function rcHas(t, word) {
  t = t.replace(/[ ・\-]/g, "").toUpperCase(); word = word.replace(/[ ・\-]/g, "").toUpperCase();
  if (t.includes(word)) return true;
  const n = word.length, k = Math.floor(n / 4);
  if (!k || t.length < n - k) return false;
  for (let i = 0; i + n - k <= t.length; i++) if (rcDist(t.slice(i, i + n), word) <= k) return true;
  return false;
}
// 意味のない並び（読み違い）らしい文字か：記号・同じ字の繰り返し・文字の種類がめまぐるしく変わる
function rcJunk(s) {
  const t = s.replace(/[ ・ー\-]/g, "");
  if (!t || /[|』『「」<>_~^`\\{}\[\]"'!?;]/.test(s) || /(.)\1\1/.test(t)) return true;
  const kind = (c) => /[\u3041-\u309f]/.test(c) ? 1 : /[\u30a0-\u30ff]/.test(c) ? 2 : /[\u3400-\u9fff]/.test(c) ? 3 : /[A-Za-z]/.test(c) ? 4 : /\d/.test(c) ? 5 : 6;
  let ch = 0; for (let i = 1; i < t.length; i++) if (kind(t[i]) !== kind(t[i - 1])) ch++;
  return (ch >= 3 && ch * 3 > t.length) || /[\u3041-\u309f][A-Za-z]|[A-Za-z][\u3041-\u309f]/.test(t);
}
const rcGeneric = (t) => RC_GENERIC.some((g) => rcDist(t, g) <= Math.floor(g.length / 5));
// お店の名前を選ぶ（先頭の数行から）。有名なお店（名前・本社の所在地の一部から分かるもの）は「お店の名前 支店名」にする。
// 「領収書」などの決まった言葉・住所・電話・読み違いらしい並びは使わない。分からなければ支店名だけ、それもなければ空
function pickStore0(lines) {
  for (const l of lines) {                                                                              // 「ご利用店舗 〇〇」「発行者 〇〇」のように、名前に見出しが付いているとき
    const lb = l.match(RC_STORE_LABEL);
    if (lb && !looksSensitive(lb[1]) && !RC_ADDR.test(lb[1]) && !/[|』『「」<>_~^`\\{}\[\]"'!?;]/.test(lb[1]) && /[\u3040-\u30ff\u3400-\u9fffA-Za-z]{2}/.test(lb[1])) return lb[1];
  }
  let best = "", bs = 0, stop = lines.findIndex((l) => /TEL|電話/i.test(l) || findDates(l, "2099-12-31").length > 0);       // 店名は電話・日付の行より上にある
  stop = stop < 0 ? 10 : Math.min(10, Math.max(stop, 2));
  const top = lines.slice(0, 14);
  let chain = "", branch = "";
  for (const [name, alias, hint] of RC_CHAINS) {
    if (top.some((l) => alias.some((a) => rcHas(l, a)) || (hint || []).some((a) => rcHas(l, a)))) { chain = name; break; }
  }
  for (const l of top) {                                                                               // 支店名：「◯◯店」で始まる行（電話番号が並んでいてもよい）
    const m = l.match(/^([\u3041-\u30ff\u3400-\u9fffA-Za-z0-9]{1,10}店)(?= |TEL|電話|$)/i);
    if (m && !/^(本店|当店|販売店|お店)$/.test(m[1]) && (!RC_ADDR.test(l) || (l === m[1] && !/[都道府県市区町村郡]/.test(l))) && !rcJunk(m[1])) { branch = m[1]; break; }   // 「架空三丁目店」は住所ではなく支店名
  }
  const usable = (l) => {                                                                              // お店の名前らしい行か
    const t = l.replace(/ /g, "");
    if (t.length < 2 || t.length > 28 || RC_STORE_BAD.test(l) || looksSensitive(l) || RC_ADDR.test(l) || rcGeneric(t)) return false;
    if (RC_PRICE.test(l) && /[¥,]|\d{3}$/.test(t)) return false;
    if (!new RegExp("^[" + RC_CJK + "A-Za-z・ー&.\\-() ]+$").test(l) && (t.match(/\d/g) || []).length > 2) return false;
    const letters = (t.match(/[\u3041-\u30fa\u30fc\u3400-\u9fffA-Za-z]/g) || []).length;
    if (letters < 2 || letters < t.length * 0.6) return false;
    const core = t.replace(/^[^A-Za-z0-9\u3041-\u30fa\u30fd-\u30ff\u3400-\u9fff]+/, "").replace(/ー{2,}.*$/, "");
    return !rcJunk(core);
  };
  lines.slice(0, stop).forEach((l, i) => {
    if (!usable(l)) return;
    const s = 10 - i + (RC_STORE_GOOD.test(l.replace(/ /g, "")) ? 12 : 0);
    if (s > bs) { bs = s; best = l; }
  });
  if (!best && !chain && !branch) {                                                                    // 手書き風の領収書：お店の名前は「上記正に領収いたしました」のあと（下）にある
    const k = lines.findIndex((l) => /領収いたし|受領|正に領収/.test(l));
    if (k >= 0) best = lines.slice(k + 1, k + 5).find((l) => !findDates(l, "2099-12-31").length && usable(l)) || "";
  }
  best = best.replace(/^[^A-Za-z0-9\u3041-\u30fa\u30fd-\u30ff\u3400-\u9fff]+/, "").replace(/ー{2,}.*$/, "").replace(/[^A-Za-z0-9\u3040-\u30ff\u3400-\u9fff)]+$/, "");
  best = best.replace(/^[A-Za-z0-9ぁ-んァ-ヶ] (?=\S{3,})/, "").replace(/^[ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮ]+(?=\S{3,})/, "").replace(/(?<=\S{3}) [A-Za-z0-9]$/, "");   // 紙の縁の写り込み（先頭・末尾の1文字）
  const e = best.lastIndexOf("店");
  if (e > 0 && best.length - e <= 5) best = best.slice(0, e + 1);                // 「…駅前店ーー時」→「…駅前店」
  if (chain) return best && rcHas(best, chain) && /店$/.test(best) ? best : branch && rcHas(branch, chain) ? branch : chain + (branch ? " " + branch : "");
  return branch && !RC_STORE_GOOD.test(best) ? branch : best || branch;
}
// 品名の先頭の印（*・A*・※ など、軽減税率や値引きの印）を落とす
const rcName = (n) => n.replace(/^["'`“”]+/, "").replace(/^(?:[A-Za-z]{0,2}[*※]+|[A-Za-z][xk](?= )|[xX](?= ))\s*(?=[^\x00-\x7f])/, "").replace(/^[・*|\-.]+/, "").trim();

// ---- 文字の後処理（確信が高いときだけ直す。確信が低ければ読んだまま） ----
// 文脈で直す（カタカナの中の漢字のような字・ひらがなの中のカタカナのような字・つなぎの記号・英字の中の数字）
function rcFixKana(n) {
  const kata = (c) => !!c && /[ァ-ー・]/.test(c), hira = (c) => !!c && /[ぁ-ゟ]/.test(c);
  const arr = [...n];
  for (let i = 0; i < arr.length; i++) {
    const c = arr[i], a = arr[i - 1], b = arr[i + 1];
    if ("口力卜二工八夕".includes(c) && ((kata(a) && (kata(b) || !b)) || (kata(b) && !a))) arr[i] = { 口: "ロ", 力: "カ", 卜: "ト", 二: "ニ", 工: "エ", 八: "ハ", 夕: "タ" }[c];
    else if (c === "へ" && kata(a) && kata(b)) arr[i] = "ヘ";
    else if (c === "ヘ" && hira(a) && hira(b)) arr[i] = "へ";
    else if (/[-−‐―一]/.test(c) && kata(a) && (kata(b) || !b) && c !== "ー") arr[i] = "ー";
    else if (c === "0" && /[A-Za-z]/.test(a || "") && /[A-Za-z]/.test(b || "")) arr[i] = "O";
  }
  return arr.join("");
}
// 品名の整え：文脈の補正 → 言葉の近似補正（確信が高いときだけ）
const rcPolish = (n) => rcFixDiscount(rcFixKana(n));
// 金額の読み違いの候補：先頭の「1」の読み落とし（99→199）と、似た数字の取り違え（1と7・0と8・5と6・3と8 など）を1か所だけ
const RC_DIGIT_ALT = { 0: "869", 1: "7", 2: "7", 3: "85", 4: "9", 5: "63", 6: "580", 7: "1", 8: "0369", 9: "480" };
function rcPriceAlts(p) {
  const s = String(Math.abs(p)), out = new Set(), sg = p < 0 ? -1 : 1;
  out.add("1" + s);
  for (let i = 0; i < s.length; i++) for (const d of RC_DIGIT_ALT[s[i]]) { if (i === 0 && d === "0") continue; out.add(s.slice(0, i) + d + s.slice(i + 1)); }
  out.delete(s);
  return [...out].map((v) => sg * Number(v));
}
// 直前の商品への値引き（クーポン・割引）は、その商品の価格から引いて1品目にまとめる（引いて0円以下になるときは別の行のまま）。もとの価格は o に残す
function rcMergeCoupons(items) {
  let base = null;                                                                                    // 値引きの付く商品（値引きが続くときは同じ商品）
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it.p > 0 && !it.d) { base = it; continue; }
    if (it.m && it.p < 0 && base && base.p + it.p > 0) { if (base.o === undefined) base.o = base.p; base.p += it.p; items.splice(i--, 1); } else base = null;
  }
  for (const i of items) { delete i.d; delete i.m; }
}
// 検算：品目の合計が合計・小計と合わないとき、1品目の金額だけを直して合うなら直す（直し方が1通りに決まるときだけ）。直した数を返す
function rcFixPrices(items, subs, total, taxes, alts) {
  const sum = items.reduce((a, i) => a + i.p, 0), ts = taxes || [], tsum = ts.reduce((a, t) => a + t, 0);
  if (!items.length || !total || subs.includes(sum)) return 0;
  const fits = (v) => v === total || ts.includes(total - v) || (ts.length > 1 && total - v === tsum) || (alts || []).includes(v);       // alts：税率ごとの対象額の合計（外税の小計）
  if (fits(sum)) return 0;
  const sols = [];
  items.forEach((it, i) => { for (const c of rcPriceAlts(it.p).concat(it.m && it.p > 0 ? [-it.p] : [])) if (fits(sum - it.p + c)) sols.push([i, c]); });   // 値引きの名前なのに金額が正：マイナスが読めなかったかもしれない
  if (sols.length !== 1) return 0;
  items[sols[0][0]].p = sols[0][1];
  return 1;
}
// 日付の1桁の読み違いの候補：今日の前後（今日から1年以内・翌日まで）で実在する日付のうち、曜日が読めていれば曜日が合うものを、今日に近い順に返す。元の日付が妥当（範囲内・曜日が合う）なら空
function rcDateAlts(d, wd, today, short) {
  const lo = addDays(today, -365), hi = addDays(today, 1), wdOK = (x) => !wd || "日月火水木金土"[new Date(+x.slice(0, 4), +x.slice(5, 7) - 1, +x.slice(8)).getDay()] === wd;
  const [y, m, dd] = d.split("-"), c = new Set(), add = (a, b, e) => { const s = a + "-" + b + "-" + e; if (+b >= 1 && +b <= 12 && +e >= 1 && +e <= new Date(+a, +b, 0).getDate() && s >= lo && s <= hi && wdOK(s)) c.add(s); };
  const near = (x) => Math.abs(daysBetween(x, today));
  if (d >= lo && d <= hi && wdOK(d)) {                                                                    // 範囲内で曜日も合う：「1月」「1日」と読めた（11の1つ読み落とし）ときだけ、今日にずっと近い11月・11日を候補にする
    if (!short) return [];
    if (short[0]) add(y, "11", dd);
    if (short[1]) add(y, m, "11");
    const r = [...c].filter((x) => near(x) + 60 < near(d));
    return r.length === 1 ? r : [];
  }
  const digits = y + m + dd;
  for (let i = 0; i < 8; i++) for (const x of RC_DIGIT_ALT[digits[i]]) { const v = digits.slice(0, i) + x + digits.slice(i + 1); add(v.slice(0, 4), v.slice(4, 6), v.slice(6)); }
  if (m[0] === "0") add(y, "1" + m[1], dd);                                                                // 先頭の「1」の読み落とし（1月→11月・1日→11日）
  if (dd[0] === "0") add(y, m, "1" + dd[1]);
  if (m === "01") for (const x of ["10", "12"]) add(y, x, dd);
  return [...c].sort((a, b) => Math.abs(daysBetween(a, today)) - Math.abs(daysBetween(b, today)) || (a < b ? 1 : -1)).slice(0, 4);
}
function parseReceipt(text, dict) {
  const today = todayStr(), lines = cleanReceiptText(text);
  const out = { store: "", date: "", total: 0, items: [], dates: [], totals: [], pay: "", brand: "", taxes: [], guess: false, fixed: 0 };
  const dates = [], strong = [], weak = [], paid = [], taxes = [], after = [], bare = [], seen = [], wdOf = {}, shortOf = {}, bases = {}, taxr = {};
  let pendName = "", wantTotal = false, done = false, last = null, sub = false, stop = false, cashIn = 0, cashOut = 0, refund = false;
  let li = -1, lastAt = -9;
  for (const l of lines) {
    li++;
    if (!/TEL|電話/i.test(l)) { const wd = (l.match(/[(（]\s?([日月火水木金土])\s?[)）]/) || [])[1]; const sm = l.match(/(?:^|\D)(20\d{2})\s*[年\/.\-]\s*(\d{1,2})\s*[月\/.\-]\s*(\d{1,2})(?!\d)/); for (const d of findDates(l, today)) { if (!dates.includes(d)) dates.push(d); if (wd) wdOf[d] = wd; if (sm && d === sm[1] + "-" + pad(+sm[2]) + "-" + pad(+sm[3])) shortOf[d] = [sm[2] === "1", sm[3] === "1"]; } }
    for (const [k, re] of RC_PAYS) if (re.test(l) && (!out.pay || RC_PAYS.findIndex((x) => x[0] === k) < RC_PAYS.findIndex((x) => x[0] === out.pay))) out.pay = k;
    for (const [b, re] of RC_BRANDS) if (!out.brand && re.test(l)) out.brand = b;
    if (looksSensitive(l) || RC_JAN.test(l.replace(/ /g, "")) || (/(?:^|\D)\d{4}[ -]\d{4}(?!\d)/.test(l) && !timeOnlyLine(l, today))) continue;   // 数字の一部が読めなくても、4桁ずつ区切られた番号（カード・会員）らしい行は捨てる                               // カード番号・会員番号・電話番号・バーコードの数字の行は読み捨てる
    if (RC_STOP.test(l) && (out.items.length || sub || done)) stop = true;                            // 「お買上点数」「売上票」から下は品目ではない
    const tc = l.match(/(\d{1,2})\D{0,2}[%％]+\s?対象\s*[¥\\]?\s?(\d[\d,]*)\s*税\s*[¥\\]?\s?(\d[\d,]*)/);          // 「(8%対象 ¥336 税 ¥26)」：税率ごとの対象額と税額が1行に並ぶ形
    if (tc) { bases[+tc[1]] = rcNum(tc[2]); taxr[+tc[1]] = rcNum(tc[3]); taxes.push(rcNum(tc[3])); continue; }
    if (l.length <= 14 && /^.{0,4}(?:返品|取消|キャンセル|返金)/.test(l) && !/の際|ください/.test(l)) refund = true;             // 返品・取消のレシートは、マイナスの金額も品目・合計にする
    const m = l.replace(/(\d) ?, ?(\d{3})/g, "$1,$2").match(RC_PRICE);
    const timeOnly = timeOnlyLine(l, today);
    const q = !timeOnly && qtyLine(l.replace(/(\d) ?, ?(\d{3})/g, "$1,$2"));
    const fuel = !timeOnly && l.match(RC_FUEL);
    if (fuel && pendName && fuel[3] && !done) {                      // ガソリンスタンド：品名（レギュラー）の次の「32.45L x ¥165/L ¥5,354」→ 品目 レギュラー 32.45L
      out.items.push((last = { n: pendName + " " + fuel[1] + "L", p: rcNum(fuel[3]) })); pendName = ""; lastAt = li; continue;
    }
    if (q && q[2] > 0 && q[2] < 1000000) {                            // 数量の行：品目にせず、直前の品名・品目に数量と小計を足す
      if (last && (last.p === q[1] || lastAt === li - 1) && q[0] > 1) { last.p = q[2]; last.n += "×" + q[0]; }   // 直前の行の品目（単価が読み違えられていても）
      else if (pendName) { out.items.push((last = { n: pendName + (q[0] > 1 ? "×" + q[0] : ""), p: q[2] })); pendName = ""; }
      wantTotal = false;
      continue;
    }
    if (!m || timeOnly) {
      if (wantTotal) wantTotal = false;
      if (RC_TOTAL.test(l) && !/小計|税/.test(l)) { wantTotal = true; continue; }                     // 「合計」だけの行：金額は次の行
      if (!timeOnly && RC_MEASURE.test(l.replace(/ /g, ""))) continue;                                 // 品名のない数量の行（348g x 158円/100g）：直前の品名を残す
      pendName = !timeOnly && !SKIPPED(l) && !RC_ADDR.test(l) && /[぀-ヿ㐀-鿿A-Za-z]{1}/.test(l) && l.length <= 30 ? l : "";
      continue;
    }
    if (!stop) seen.push(Math.abs(rcNum(m[2])));
    const name = m[1].replace(/[¥\\*※ ]+$/g, "").trim(), price = rcNum(m[2]), head = name.replace(/[(]?税[込抜][)]?/g, "");        // 「合計(税込)」の税込は見出しの一部
    if (sub || done) after.push(Math.abs(price));
    if ((RC_TOTAL.test(head) || RC_TOTAL_EXACT.test(head)) && !/小計/.test(head) && !/税|預|釣/.test(head) && (price > 0 || refund)) { if (!(stop && done)) strong.push(price); done = true; wantTotal = false; continue; }
    if (!head && wantTotal) { strong.push(price); done = true; wantTotal = false; continue; }          // 前の行が「合計」だけだった
    if (/小計/.test(name)) { weak.push(price); sub = true; wantTotal = false; continue; }
    wantTotal = false;
    const mb = name.match(/(\d{1,2})\D{0,2}[%％]+\s?対象/), mt = name.match(/(\d{1,2})\D{0,2}[%％]+\s?(?:消費)?税/);       // 「8%対象額」「8%税額」（税率ごとの対象額・税額）
    if (mb && price > 0) bases[+mb[1]] = price; else if (mt && price > 0) taxr[+mt[1]] = price;
    if ((RC_TAX.test(name) && !/対象/.test(name)) || /対象.*税$/.test(name)) { if (price > 0) taxes.push(price); continue; }      // 「(8%対象 ¥336 税 ¥26)」も税額
    const pk = RC_PAYS.find(([, re]) => re.test(name));
    if (pk) {                                                         // 支払いの行（クレジット ¥452・お預り・お釣り）
      if (stop || RC_STOP.test(name)) continue;                       // 控え（カード会社・承認番号など）の数字は使わない
      if (/預|現金/.test(name)) cashIn = cashIn || price; else if (/釣/.test(name)) cashOut = cashOut || price; else if (price > 0) paid.push(price);
      continue;
    }
    const unit = name && RC_MEASURE.test(name.replace(/ /g, ""));                                       // 品名のない数量の行（110円 x 2 ¥220）：直前の品名を使う
    if (!name && pendName && price > 0 && price < 10 && !/[¥\\円]/.test(l)) { pendName = ""; continue; }   // 品名の次の行の1桁の数字だけ（¥も円もない）は金額ではない（読み違いの文字の写り込み）
    const nm = (unit && pendName) || name || pendName; pendName = "";
    if (!nm && price > 0 && !sub && !done && !stop) bare.push(price);                                  // 品名も見出しもない金額（手書き風の領収書）
    const disc = price < 0 && RC_DISC.test(nm) && !/税|小計|合計|預|釣/.test(nm), svc = RC_SVC.test(nm) || /(?:入湯|宿泊|利用|引取)税/.test(nm);   // サービス料・入湯税は品目
    if ((!nm || /^[おぉ]{1,2} ?り?$/.test(nm) || !/[぀-ヿ㐀-鿿A-Za-z]/.test(nm)) && !done && !stop && !sub) {   // 見出しが崩れた行（「お」だけ・記号だけ・なし）：品目の合計と同じ額なら小計・合計の候補、そうでなければ読み捨てる
      if (out.items.length > 1 && price === out.items.reduce((a, i) => a + i.p, 0)) weak.push(price);
      if (nm) continue;
    }
    if (done || stop || !nm || (SKIPPED(nm) && !disc && !svc) || RC_ADDR.test(nm) || price === 0 || Math.abs(price) > 999999) continue;
    if (/\d ?-$/.test(m[1].replace(/[¥\\ ]+$/, ""))) continue;          // 1-2-10 のような番地の数字は金額ではない
    if (price < 0 && !disc && !refund) continue;
    if (sub && price > 0) continue;                                   // 小計より下で品目になるのは値引きだけ
    if (!/[぀-ヿ㐀-鿿A-Za-z]/.test(nm) || nm.length > 40) continue;
    const dn = RC_DISC.test(nm) && !/税|小計|合計|預|釣/.test(nm);                                          // 値引きらしい名前（金額のマイナスが読めなかったものも）
    const adj = dn && !sub && !RC_DISC_ALL.test(nm) && last && last === out.items[out.items.length - 1] && (!last.d || last.m)      // 直前の商品の値引きか：直前が品目で、間に別の品目・小計がない（バーコードの行・数量の行はよい）
      && lines.slice(lastAt + 1, li).every((x) => RC_JAN.test(x.replace(/ /g, "")) || qtyLine(x));
    out.items.push((last = { n: rcPolish(rcName(nm) || nm), p: price, w: RC_TOTAL_WEAK.test(nm), d: disc, m: adj })); lastAt = li;
  }
  if (cashIn > 0 && cashIn >= cashOut) paid.push(cashIn - cashOut);
  // 見出しが読み違えられた合計・小計（「大計」「人 計」や崩れた文字）：その前までの品目の合計と同じ額の行は、品目にしない（「体温計」などの品目は残す）
  let run = 0, cnt = 0;
  out.items = out.items.filter((i) => {
    const isTotal = run > 0 && i.p === run && (i.w || cnt >= 2);
    delete i.w; if (isTotal) { weak.push(i.p); return false; }
    run += i.p; cnt++; return true;
  });
  // 合計：「合計」の行 → 支払いの行（クレジット・お預り−お釣り） → 小計＋税額と同じ額の行 → 小計 の順に信じる
  const sum = out.items.reduce((a, i) => a + i.p, 0);
  const sub0 = weak[0] || 0;
  const outer = sub0 ? taxes.map((t) => sub0 + t).filter((v) => after.includes(v)).concat(sub0 > 0 ? seen.filter((v) => v > 0 && v < sub0 * 0.12 && seen.includes(sub0 + v)).map((v) => sub0 + v) : []) : [];   // 小計＋税額＝合計（見出しが読めなくても、小計のあとに「税額、小計＋税額」が並んでいれば）
  const floor = Math.max(sub0, paid[0] || 0) / 2;                     // 小計・支払いの半分より小さい「合計」は読み違い
  const st = strong.filter((v) => (sum && v === sum) || (Math.abs(v) >= floor && (v > 0 || refund) && (refund || !sum || v * 8 >= sum)));   // 品目の合計と同じ額はそのまま信じる   // 品目の合計の1/8にも満たない「合計」は、桁の読み落とし
  const bareTotal = !out.items.length && !weak.length && new Set(bare).size === 1 ? [bare[0]] : [];       // 品目も小計もなく、金額がひとつだけ書かれている（手書き風）
  const pool = st.length ? st : paid.length ? paid : outer.length ? outer : weak.length ? weak : bareTotal;
  let first = pool.includes(sum) ? sum : pool[0] || 0;
  if (!st.length && paid.length && outer.length && !paid.includes(first)) first = paid[0];
  // 税率ごとの対象額・税額の整合（8%・10%）と、合計・支払い・小計＋税額の一致で、合計の読み違いを直す：対象額の合計＝小計、税額＝対象額×税率（切り捨て）、小計＋税額＝合計。2つ以上の元が同じ額なのに、選んだ合計だけが違うときは、その額にする
  const bk = Object.keys(bases).map(Number), basesSum = bk.reduce((a, r) => a + bases[r], 0), taxSum = Object.keys(taxr).reduce((a, r) => a + taxr[r], 0);
  const taxOk = bk.length > 0 && bk.every((r) => taxr[r] === undefined || taxr[r] === Math.floor((bases[r] * r) / 100) || taxr[r] === Math.floor((bases[r] * r) / (100 + r)));
  const calc = taxOk && taxSum > 0 && basesSum > 0 ? basesSum + taxSum : 0, vote = {};
  const sub1 = sub0 ? taxes.map((x) => sub0 + x).concat(Object.keys(taxr).length > 1 ? [sub0 + taxSum] : []).find((v) => v === paid[0]) || 0 : 0;       // 支払い＝小計＋税額
  for (const v of [st[0], paid[0], calc, sub0 && taxSum ? sub0 + taxSum : 0, sub1]) if (v) vote[v] = (vote[v] || 0) + 1;
  const top = Object.keys(vote).map(Number).sort((a, b) => vote[b] - vote[a])[0];
  if (top && top !== first && vote[top] >= 2 && !(vote[first] >= 2)) first = top;
  rcDropTotal(out.items, first);
  out.fixed = rcFixPrices(out.items, weak, first, taxes, bk.length && taxOk ? [basesSum] : []);                                              // 検算で直した品目の数
  rcMergeCoupons(out.items);
  for (const i of out.items) i.n = rcFixName(i.n, dict);                                              // 履歴・内蔵の辞書で品名を直す（確信が高いときだけ）
  out.total = first; out.taxes = taxes;
  rcTax(out);
  const asum = out.items.filter((i) => i.n !== "消費税").reduce((a, i) => a + i.p, 0);
  out.totals = [...new Set([first].concat(st, paid, weak, first && asum > 0 && asum !== first && rcPriceAlts(first).includes(asum) ? [asum] : []).filter(Boolean))].slice(0, 4);   // 品目の合計が、合計の1桁の読み違いの候補なら、候補にも出す
  if (out.pay !== "credit") out.brand = "";
  // 日付：先の日付（読み違い）は後ろに回し、年が違いすぎるときは今年にした日付も候補に足す
  const ok = (d) => d <= addDays(today, 1) && d >= addDays(today, -800);
  let good = dates.filter(ok), bad = dates.filter((d) => !ok(d));
  // 日付の読み違いの補正：未来・1年以上前の日付、または読めた曜日と合わない日付は、1桁の読み違い（1と7・0と8 など）や月の先頭の「1」の読み落とし（11月→1月）の候補のうち、今日に近い妥当な日付にする（曜日が読めていれば曜日で検算。複数あれば、いちばん近いものを選び、ほかは候補に出す）
  const first0 = good[0] || bad[0];
  if (first0) {
    const wd = wdOf[first0], ty = Number(today.slice(0, 4));
    let cs = rcDateAlts(first0, wd, today, shortOf[first0]).filter((d) => d !== first0), yl = [];
    const inRange = first0 >= addDays(today, -365) && first0 <= addDays(today, 1);
    if (Number(first0.slice(0, 4)) === ty - 1 && inRange) {                                           // 年なしの日付が先の日付で、去年にされたもの：今年の同じ月日の1桁違い（今日に近いもの）を探す
      const d2 = ty + first0.slice(4);
      if (d2 > addDays(today, 1)) yl = rcDateAlts(d2, wd, today).filter((d) => d !== first0);
    }
    if (yl.length) { good = yl.concat(good.filter((d) => !yl.includes(d))); out.guess = true; }
    else
    if (cs.length && inRange && cs.length > 1 && !good.includes(cs[0])) good = [first0].concat(cs, good.filter((d) => d !== first0));      // 範囲内で候補が複数：元の日付を先頭に、候補を後ろに出す（曜日・月の読み違いかもしれない）
    else if (cs.length) { good = cs.concat(good.filter((d) => !cs.includes(d))); out.guess = true; }   // 候補が1つ、または元の日付が範囲外：今日にいちばん近い候補を先頭にする（元の日付は候補の後ろに残す）
  }
  if (!good.length && bad.length) { const b = bad[0], y = Number(today.slice(0, 4)); for (const yy of [y, y - 1]) { const c = yy + b.slice(4); if (ok(c) && !good.includes(c)) good.push(c); } out.guess = good.length > 0; }   // guess：年を推し量った日付（読み違いかもしれない）
  out.dates = good.concat(bad).slice(0, 4);
  out.date = good[0] || "";
  out.store = rcFixStore(pickStore0(lines), dict, RC_CHAINS.map((c) => c[0]));
  if (!out.total && !out.date && !RC_STORE_GOOD.test(out.store)) out.store = "";                       // 合計も日付も読めない（崩れた読み取り）ときは、お店の名前も信じない
  return out;
}
function timeOnlyLine(l, today) { return /\d{1,2}:\d{2}/.test(l) || findDates(l, today).length > 0; }
function SKIPPED(s) { return RC_SKIP.test(s); }
// 合計と同じ額の「品目」は、読み違えた合計・支払いの行（ほかに品目があり、品目の合計が合わないとき）。items を直接直す
function rcDropTotal(items, total) {
  const sum = items.reduce((a, i) => a + i.p, 0), i = items.findIndex((x) => x.p === total && sum - x.p > 0);
  if (total && items.length > 1 && sum !== total && i >= 0) items.splice(i, 1);
  return items;
}
// 外税：品目の合計と合計の差が、レシートの税額と同じなら「消費税」の行を足す（すでにあれば足さない）
function rcTax(r) {
  const sum = r.items.reduce((a, i) => a + i.p, 0), tax = r.total - sum, ts = r.taxes || [];
  if (r.items.length && tax > 0 && (ts.includes(tax) || (ts.length > 1 && ts.reduce((a, t) => a + t, 0) === tax))) r.items.push({ n: "消費税", p: tax });   // 税額が税率ごとに分かれているときは、その合計
  return r;
}
// 読み取ったカードの会社（JCB など）から、登録済みのカードを1枚選ぶ。名前にその会社名を含むカードがちょうど1枚のときだけ（分からなければ空）
function receiptCard(brand, names) {
  if (!brand) return "";
  const re = (RC_BRANDS.find((b) => b[0] === brand) || [])[1];
  const hit = re ? names.filter((n) => re.test(n)) : [];
  return hit.length === 1 ? hit[0] : "";
}
// 2回読んだ結果をまとめる：点数の高いほうを軸にして、読めなかった項目（お店・日付・合計・支払い方法）はもう一方から補い、日付・合計の候補は両方から集める
function rcScore(r) {
  const sum = r.items.reduce((t, i) => t + i.p, 0);
  return (r.total ? 2 : 0) + (r.total && r.total === sum ? 2 : 0) + (r.date ? 1 : 0) + Math.min(r.items.length, 3) + (r.store ? 1 : 0);
}
function mergeReceipts(a, b) {
  const [x, y] = rcScore(b) > rcScore(a) ? [b, a] : [a, b];
  const uniq = (l) => [...new Set(l)].slice(0, 4), noTax = (l) => l.filter((i) => i.n !== "消費税");
  const near = (r) => (r.date ? Math.abs(daysBetween(r.date, todayStr())) + (r.guess ? 400 : 0) : 1e9);   // 日付が食い違うときは、今日に近いほう（レシートは買ってすぐ読むことが多い。年を推し量った日付は後回し）
  const dy = near(y) < near(x) ? y : x;
  const out = { store: x.store && y.store && x.store !== y.store && y.store.length >= x.store.length + 2 && y.store.replace(/ /g, "").includes(x.store.replace(/ /g, "")) ? y.store : x.store || y.store, date: dy.date, guess: dy.guess, total: x.total || y.total, items: noTax(x.items), dates: uniq(x.dates.concat(y.dates)), totals: uniq(x.totals.concat(y.totals)),
    pay: x.pay || y.pay, brand: x.brand || y.brand, fixed: x.fixed || 0, taxes: uniq((x.taxes || []).concat(y.taxes || [])) };
  const sumOf = (l) => l.reduce((t, i) => t + i.p, 0), fits = (l, t) => t && (sumOf(l) === t || out.taxes.includes(t - sumOf(l)));
  if (x.total && y.total && x.total !== y.total && fits(out.items, y.total) && !fits(out.items, x.total)) out.total = y.total;   // 品目の合計と合うほうの合計を使う
  else if (x.total && y.total && y.total > x.total && x.total === sumOf(out.items) && (y.taxes || []).includes(y.total - x.total)) out.total = y.total;   // 片方の「合計」が小計と同じ額で、もう片方が「小計＋税額」の合計を税額の行とともに読めたときは、そちらを使う
  rcDropTotal(out.items, out.total);
  if (!fits(out.items, out.total)) {                                  // 合わないとき：もう一方だけが読めた品目（金額で照らし合わせる）を足すと合うなら足す。もう一方の品目がそのまま合うならそちらを使う
    const swap = out.items.map((i) => { const j = noTax(y.items).find((k) => k.o === i.p && k.p < i.p); return j ? Object.assign({}, i, { p: j.p, o: i.p }) : i; });   // 片方だけ値引きを商品にまとめて読めたとき：まとめたほうの金額を使って合うなら使う
    if (swap.some((i, k) => i !== out.items[k]) && fits(swap, out.total)) out.items = swap;
  }
  if (!fits(out.items, out.total)) {
    const left = out.items.map((i) => [i.p, i.o]), extra = noTax(y.items).filter((i) => { const k = left.findIndex((v) => v[0] === i.p || v[1] === i.p || (i.o !== undefined && v[0] === i.o)); if (k < 0) return true; left.splice(k, 1); return false; });
    const one = extra.find((i) => fits(out.items.concat([i]), out.total));
    if (extra.length && fits(out.items.concat(extra), out.total)) out.items = out.items.concat(extra);
    else if (one) out.items = out.items.concat([one]);
    else if (fits(noTax(y.items), out.total)) out.items = noTax(y.items);
  }
  rcTax(out);
  if (out.pay !== "credit") out.brand = "";
  out.totals = uniq([out.total].concat(out.totals).filter(Boolean));
  return out;
}
