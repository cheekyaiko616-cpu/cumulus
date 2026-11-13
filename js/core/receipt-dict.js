"use strict";
// ===== レシートの文字の補正（辞書との近似照合） =====
// 役割: 読み取った品名・店名を、(1) この端末に保存した過去の記録の品名・店名（履歴）と、(2) 内蔵の一般的な語・チェーン名・市区町村名の辞書に
//       近似照合して直す。似た字（ト/ヒ・ー/-・ロ/口・ご/こ・時/里 など）のずれを軽く数える編集距離＋文字2つ組の類似で探し、確信が高いときだけ直す
//       （確信が低ければ読んだまま。別の意味の語に変えないよう、字数に応じて許すずれを小さくし、2つ以上の候補が同じくらい近いときは直さない）。
//       履歴は読み取りの開始時に1回だけ作る（常駐・タイマーなし）。写真・文字は外へ送らず、保存もしない。新しい保存項目は増やさない
// 依存: なし
// 実行時: なし
// 公開: rcBuildDict, rcFixName, rcFixStore, rcFixDiscount, RC_BRAND_TEXT, RC_CITIES

// ---- 似た字：同じ組は読み違えやすい（ずれ 0）、ゆるい組は 0.5、ほかは 1 ----
const RC_SAME = ["ー-−‐―一ｰ", "ヘへ", "ロ口", "カ力", "トト卜", "ハ八", "ニ二", "エ工", "タ夕", "0O○", "1lI|", "5S", "8B"];
const RC_SOFT = ["ッツンソシ", "ポボパバ", "クケ", "ゴコ", "プブ", "ビピ", "ペベ", "里理時", "ワフ", "ゥウ", "ャヤ", "ュユ", "ョヨ", "トヒド", "ガカ", "ギキ", "ザサ", "ズス", "ゼセ", "ダタ", "デテ", "ごこ", "入人", "どと", "ばはぱ", "ぼほぽ", "ぶぷ", "やゃ", "ゆゅ", "よょ", "つっ", "ぞそ", "げけ", "ぎき", "ぐく", "だた", "でて", "づつ", "ざさ", "じし", "ずす", "ぜせ", "びひぴ", "ぷふ", "べへぺ"];
const RC_KANJI = ["鳥烏", "刈切汗苅鐘釘釧", "谷容", "橋矯", "東束", "浜演"];                        // 形がよく似て、どちらも実在の地名に使われにくい組だけ
const rcGroupOf = (gs) => { const m = {}; gs.forEach((g, i) => { for (const c of g) m[c] = i; }); return m; };
const RC_SOFT_OF = rcGroupOf(RC_SOFT.concat(RC_KANJI));
const RC_REP = (() => { const m = {}; for (const g of RC_SAME) for (const c of g) m[c] = g[0]; return m; })();
const RC_SREP = (() => { const m = {}; for (const g of RC_SAME.concat(RC_SOFT, RC_KANJI)) for (const c of g) m[c] = g[0]; return m; })();
// 比べるための形：空白・「・」を除き、大文字にし、同じ組の字を1字にそろえる
const rcCanon = (s) => Array.from(String(s).toUpperCase().replace(/[\s　・]/g, ""), (c) => RC_REP[c] || c).join("");
const rcGrams = (k) => { const g = new Set(), a = Array.from(k, (c) => RC_SREP[c] || c); for (let i = 0; i + 1 < a.length; i++) g.add(a[i] + a[i + 1]); return g; };
// 読み取りで行頭・行末に余分に付きやすい字（罫線・印・円記号の読み違い）：辞書の語の前後にあるだけなら、ずれに数えない
const RC_LEAD = new Set("ヒとト上人入ル");
const RC_TAIL = new Set("ギ半羊洋学者人\\¥");
// 似た字を軽く数える編集距離。戻り値は [ずれの大きさ（0.5刻み）, 似ていない字への取り違いの数, 似ていない字の抜け・余分の数]。a＝読んだ字、b＝辞書の語（ともに rcCanon 済み）
// 余分な字は、隣の字と似た字（「ごこ」「ポボ」のように1つの字が2つに割れた）か、行頭・行末の余分な字（ずれに数えない）のときだけ軽く扱う
function rcWDist(a, b, strict) {
  const A = Array.from(a), B = Array.from(b), n = A.length, m = B.length;
  let lead = 0, tail = 0;
  while (lead < n && RC_LEAD.has(A[lead]) && lead < 1) lead++;
  while (tail < n - lead && RC_TAIL.has(A[n - 1 - tail]) && tail < 2) tail++;
  const M = 1e6, K = 1e3, same = (x, y) => !!x && !!y && (x === y || (RC_SOFT_OF[x] !== undefined && RC_SOFT_OF[x] === RC_SOFT_OF[y]));
  const isKana = (x) => x >= "\u3040" && x <= "\u30ff", kana = (x, y) => isKana(x) && isKana(y);
  const sub = (x, y) => (x === y ? 0 : RC_SOFT_OF[x] !== undefined && RC_SOFT_OF[x] === RC_SOFT_OF[y] ? M : 2 * M + (kana(x, y) ? 1 : K));
  const del = (i) => (i <= lead || i > n - tail ? 0 : !strict && (same(A[i - 1], A[i - 2]) || same(A[i - 1], A[i])) ? M : 2 * M + K);   // 読んだ字の余分
  let p = Array.from({ length: m + 1 }, (_, j) => j * (2 * M + K));
  for (let i = 1; i <= n; i++) {
    const c = [p[0] + del(i)];
    for (let j = 1; j <= m; j++) c[j] = Math.min(p[j] + del(i), c[j - 1] + 2 * M + K, p[j - 1] + sub(A[i - 1], B[j - 1]));
    p = c;
  }
  const v = p[m];
  return [Math.floor(v / M) / 2, v % K, Math.floor((v % M) / K)];
}
const rcWD = (a, b) => rcWDist(rcCanon(a), rcCanon(b), true)[0];

// ---- 辞書（品名の語幹・一般語中心。実在の商品名の長い一覧は入れない） ----
const RC_WORD_TEXT = "クーポン値引 クーポン割引 ポイント値引 ポイント割引 会員割引 会員値引 店内値引 全品割引 割引券 値引券 レジ袋 買物袋 ポリ袋 消費税 軽減税率 お買上げ ポイント クーポン " +
  "牛乳 豆乳 豆腐 納豆 たまご 食パン ロールパン あんパン メロンパン クロワッサン 菓子パン ベーグル 食塩 砂糖 小麦粉 片栗粉 サラダ油 オリーブオイル ごま油 しょうゆ みりん 料理酒 味噌 マヨネーズ ケチャップ ドレッシング ポン酢 めんつゆ カレールー シチュー " +
  "白米 無洗米 パックご飯 玄米 そうめん うどん ラーメン 袋麺 カップ麺 カップラーメン カップヌードル 焼きそば パスタ スパゲッティ " +
  "鶏もも肉 鶏むね肉 ささみ 手羽先 手羽元 豚バラ肉 豚こま肉 豚ロース 豚ひき肉 牛こま肉 牛ひき肉 合挽き肉 ベーコン ウインナー ソーセージ サラダチキン ハンバーグ から揚げ 唐揚げ とんかつ コロッケ 餃子 焼売 ツナ缶 ちくわ かまぼこ 刺身 " +
  "キャベツ レタス きゅうり トマト ミニトマト ピーマン にんじん 玉ねぎ じゃがいも さつまいも 大根 白菜 ほうれん草 小松菜 長ねぎ もやし ブロッコリー かぼちゃ ごぼう れんこん しいたけ えのき しめじ バナナ りんご みかん いちご ぶどう レモン アボカド キウイ オレンジ " +
  "ヨーグルト チーズ バター マーガリン 生クリーム プリン ゼリー アイスクリーム " +
  "ポテトチップス ポテトチップ チョコレート クッキー ビスケット せんべい グミ キャンディ ラムネ たけのこの里 きのこの山 じゃがりこ キットカット ポッキー アルフォート ブラックサンダー ハイチュウ " +
  "お茶 緑茶 麦茶 ウーロン茶 紅茶 コーヒー 缶コーヒー ブラックコーヒー カフェオレ ミルクティー インスタントコーヒー 炭酸水 ミネラルウォーター 天然水 オレンジジュース りんごジュース 野菜ジュース スポーツドリンク コーラ サイダー ビール 発泡酒 チューハイ ハイボール ワイン 日本酒 焼酎 ウイスキー ペットボトル " +
  "おにぎり サンドイッチ お弁当 幕の内弁当 のり弁当 おでん 肉まん あんまん フライドチキン 食用油 味噌汁 炭酸 " +
  "ティッシュ ティッシュペーパー トイレットペーパー キッチンペーパー ペーパータオル ラップ アルミホイル ゴミ袋 食器用洗剤 洗濯洗剤 柔軟剤 漂白剤 ハンドソープ ボディソープ シャンプー コンディショナー リンス 歯みがき粉 歯ブラシ 洗顔料 洗顔フォーム 化粧水 乳液 日焼け止め 綿棒 コットン ナプキン おむつ " +
  "単3電池 単4電池 乾電池 ボールペン ノート 付箋 マスク 除菌シート ウェットティッシュ 絆創膏 目薬 風邪薬 かぜ薬 頭痛薬 胃腸薬 ビタミン サプリメント";
const RC_BRAND_TEXT = "ジョイフル ココス ロイヤルホスト スシロー くら寿司 はま寿司 丸亀製麺 ケンタッキー ミスタードーナツ サーティワン バーミヤン 大戸屋 やよい軒 松屋 なか卯 リンガーハット ポプラ ハックドラッグ トモズ カワチ薬品 ダイレックス ヨークベニマル サミット いなげや マルエツ 東急ストア アピタ ピアゴ ユニー フジ ベイシア ホームセンタームサシ ケーヨーデイツー ビバホーム コーナン ノジマ ジョーシン ブックオフ ゲオ ABCマート ワークマン 洋服の青山";
// 支店名の市区町村（主なもの）
const RC_CITIES = new Set("札幌 函館 旭川 青森 八戸 盛岡 仙台 秋田 山形 福島 郡山 水戸 つくば 宇都宮 前橋 高崎 さいたま 川越 川口 所沢 越谷 千葉 船橋 柏 松戸 市川 市原 浦安 八王子 町田 立川 府中 調布 三鷹 横浜 川崎 相模原 横須賀 藤沢 平塚 厚木 新潟 長岡 富山 金沢 福井 甲府 長野 松本 岐阜 大垣 静岡 浜松 沼津 豊橋 岡崎 名古屋 一宮 春日井 豊田 刈谷 安城 四日市 大津 草津 京都 宇治 大阪 堺 豊中 吹田 高槻 枚方 神戸 姫路 西宮 尼崎 明石 奈良 和歌山 鳥取 松江 岡山 倉敷 広島 福山 山口 下関 徳島 高松 松山 今治 高知 福岡 北九州 久留米 佐賀 長崎 佐世保 熊本 大分 別府 宮崎 鹿児島 那覇 沖縄 東京 品川 渋谷 新宿 池袋 上野 目黒 世田谷 練馬 板橋 足立 江戸川 葛飾 町田 日野 小平 青梅 茅ヶ崎 小田原 鎌倉 逗子 大和 海老名 伊勢崎 太田 足利 小山 土浦 取手 草加 春日部 上尾 熊谷 大宮 浦和 蕨 戸田 習志野 佐倉 成田 木更津 袖ヶ浦 磐田 掛川 藤枝 島田 焼津 三島 熱海 高山 多治見 各務原 可児 瀬戸 半田 碧南 知立 西尾 蒲郡 津島 稲沢 小牧 犬山 桑名 鈴鹿 松阪 伊勢 彦根 長浜 守山 栗東 亀岡 長岡京 八幡 茨木 守口 寝屋川 八尾 河内長野 泉大津 岸和田 加古川 宝塚 伊丹 川西 三田 天理 橿原 生駒 田辺 米子 出雲 浜田 津山 玉野 尾道 三原 東広島 周南 宇部 萩 鳴門 丸亀 坂出 新居浜 西条 宇和島 南国 北九州 飯塚 大牟田 唐津 諫早 大村 八代 玉名 日田 延岡 都城 霧島 薩摩川内 浦添 宜野湾 名護".split(" "));

// ---- 辞書の表（語・出てきた回数・新しさ・2つ組の索引） ----
function rcTable(items) {
  const list = [], by = new Map(), grams = new Map();
  for (const it of items) {
    const k = rcCanon(it.w);
    if (k.length < 2) continue;
    let e = by.get(k);
    if (!e) { e = { k, forms: new Map(), c: 0, t: 0, len: Array.from(k).length, w: it.w }; by.set(k, e); e.i = list.push(e) - 1; for (const g of rcGrams(k)) { if (!grams.has(g)) grams.set(g, []); grams.get(g).push(e.i); } }
    e.c += it.c || 0; e.t = Math.max(e.t, it.t || 0);
    const f = (e.forms.get(it.w) || 0) + (it.c || 1); e.forms.set(it.w, f);
    if (f > (e.forms.get(e.w) || 0)) e.w = it.w;                                                       // いちばんよく使われた書き方
  }
  return { list, by, grams };
}
let RC_BUILT = null;
const rcBuilt = () => RC_BUILT || (RC_BUILT = { words: rcTable(RC_WORD_TEXT.split(" ").map((w) => ({ w }))), brands: rcTable(RC_BRAND_TEXT.split(" ").map((w) => ({ w }))), cities: rcTable([...RC_CITIES].map((w) => ({ w: w + "店" }))) });
const rcPlain = (s) => /[\u3040-\u30ff\u3400-\u9fff]/.test(s) && !/[|『』「」<>_~^`\\{}\[\]"'!?;]/.test(s);
// 保存した記録（entries）から履歴の辞書を作る。読み取りの開始時に1回だけ呼ぶ（記録が5,000件でも、品名の種類ぶんの表を作るだけ）
function rcBuildDict(entries) {
  const names = [], full = [], stores = [], brands = [], branches = [];
  for (const e of entries || []) {
    const t = Number(String(e && e.date || "").replace(/\D/g, "")) || 0;
    const s = String(e && e.store || "").trim();
    if (s && s.length <= 30 && rcPlain(s)) {
      stores.push({ w: s, c: 1, t });
      const m = s.match(/^(.*?)\s+([^\s]+)$/);
      if (m) { brands.push({ w: m[1], c: 1, t }); if (/店$/.test(m[2])) branches.push({ w: m[2], c: 1, t }); }
      else if (/^[^\s]{2,6}店$/.test(s)) branches.push({ w: s, c: 1, t });
    }
    for (const it of (e && e.items) || []) {
      const n0 = String(it && it.n || "").trim(), p = rcPeel(n0);
      if (n0.length >= 4 && n0.length <= 40 && rcPlain(n0)) full.push({ w: n0, c: 1, t });
      if (p.core.length >= 2 && p.core.length <= 30 && rcPlain(p.core) && !/\d/.test(p.core) && !/^(?:消費税|値引|割引)/.test(p.core)) names.push({ w: p.core, c: 1, t });
    }
  }
  return { names: rcTable(names), full: rcTable(full), stores: rcTable(stores), brands: rcTable(brands), branches: rcTable(branches) };
}

// ---- 近い語を探す ----
// 許すずれ（語の字数 n）：3字は似た字の取り違い（0.4まで）、4〜5字は1、6〜8字は1.5、9字以上は2。履歴は0.5多く（自分で買ったものなので）。
// 似ていない字への取り違いは、かな同士だけ、4字以下では許さず、5〜8字で1つ、9字以上で2つまで。漢字・英数字への取り違い、字の抜け・余分は、履歴の9字以上の名前で1つだけ
const rcLim = (n, hist, branch) => (n <= 2 ? (branch ? 0.5 : 0) : n === 3 ? (hist ? 0.5 : 0.4) : (n <= 5 ? 1 : n <= 8 ? 1.5 : 2) + (hist ? 0.5 : 0));
const rcArbMax = (n) => (n <= 4 ? 0 : n <= 8 ? 1 : 2);
function rcNear(tab, key, hist, minLen, branch) {
  const out = [], q = Array.from(key), n = q.length;
  if (n < (minLen || 3)) return out;
  const qg = rcGrams(key), seen = new Map();
  for (const g of qg) for (const i of tab.grams.get(g) || []) seen.set(i, (seen.get(i) || 0) + 1);
  for (const [i, shared] of seen) {
    const e = tab.list[i];
    const en = e.len - (branch ? 1 : 0);                                                                     // 支店名は「店」を除いた字数で数える
    if (Math.abs(e.len - n) > 3 || e.len < (minLen || 3)) continue;
    if (shared < Math.max(1, Math.floor((Math.min(e.len, n) - 1) * 0.4))) continue;
    const [d, arb, ind] = rcWDist(key, e.k);
    if (d > rcLim(en, hist, branch) || arb > rcArbMax(en) || ind > (hist && e.len >= 9 ? 1 : 0)) continue;
    if (e.len >= 5 && (2 * shared) / (qg.size + rcGrams(e.k).size) < 0.5) continue;                       // 文字2つ組の類似が低いものは捨てる
    out.push({ e, d, arb, ind });
  }
  return out;
}
// 候補から1つ選ぶ：いちばん近いもの。ほかの語が同じくらい近いとき、履歴どうしなら回数の多いほう・新しいほう、内蔵の辞書が絡むときは直さない（null）
function rcPick(cands) {
  if (!cands.length) return null;
  const by = new Map();
  for (const x of cands) { const o = by.get(x.e.k); if (!o || (x.hist && !o.hist)) by.set(x.e.k, x); }       // 同じ語が履歴と内蔵の両方にあれば履歴を使う
  cands = [...by.values()];
  cands.sort((a, b) => a.d - b.d || a.arb - b.arb || (b.hist - a.hist) || b.e.c - a.e.c || b.e.t - a.e.t);
  const best = cands[0], near = cands.filter((x) => x !== best && x.d - best.d < 0.5);
  if (near.length && !(best.hist && near.every((x) => x.hist))) return null;
  return best;
}
// 品名の前後の飾りを分ける：先頭の英字（D クーポン）・数量や容量（×2・500ml・(小)）・円の注記（3円）・行末の余分な字
function rcPeel(n) {
  let s = n, stray = "", lead = "", drop = false;
  const m0 = s.match(/^([A-Za-z]{1,2}\s?)(?=[^\x00-\x7f])/);
  if (m0) { lead = m0[1]; s = s.slice(lead.length); }
  let tail = "";
  for (let k = 0; k < 4; k++) {
    const t = s.match(/^(.*?)(?:([\s"“”'\u0060]*(?:[×xX]\d{1,3}点?|[(（][^)）]{0,6}[)）]?|\d+(?:\.\d+)?\s?(?:ml|mL|ML|g|kg|L|個|本|枚|袋|点|cm|m)|\d{1,4}円|\d{1,2}))|([ギ半羊洋学者人\\¥]+))$/);
    if (!t) break;
    if (t[3]) { if (tail) break; stray = t[3] + stray; s = t[1]; continue; }
    if (!tail && /^[\s"“”'\u0060]*\d{1,4}円$/.test(t[2])) drop = true; else tail = t[2] + tail;           // 末尾の「3円」（単価の注記）は金額と重なるので落とす
    s = t[1];
  }
  if (!tail) { const u = s.match(/^(.+?[^\d\s])\s?\d{1,4}円\D{0,3}$/); if (u) { s = u[1]; drop = true; } }          // 「レジ袋 3円ドス」：単価の注記とその後ろの余分な字
  return { lead, core: s.trim(), tail, stray, drop };
}
// 品名を直す（確信が高いときだけ）。tabs＝[履歴の表, 内蔵の表]。直さないときは元の名前を返す
function rcFixName(n, dict) {
  if (!n) return n;
  const p = rcPeel(n);
  if (p.core.length < 2 || p.core.length > 30 || /^(?:消費税|値引|割引)/.test(p.core)) return n;
  const B = rcBuilt(), H = dict && dict.names;
  if (dict && dict.full && n.length >= 4) {                                                            // 数量・容量までそっくり同じ名前（似た字のずれだけ）
    const f = rcPick(rcNear(dict.full, rcCanon(n), true, 4).filter((x) => x.d <= 0.5 && x.arb === 0 && x.ind === 0).map((x) => Object.assign(x, { hist: 1 })));
    if (f) return f.e.w;
  }
  if (p.stray && ((H && H.by.has(rcCanon(p.core + p.stray))) || B.words.by.has(rcCanon(p.core + p.stray)))) { p.core += p.stray; p.stray = ""; }   // 「ネギ」のように、行末の字も語の一部のとき
  const rebuild = (w) => p.lead + w + p.tail;
  const key = rcCanon(p.core);
  let hit = (H && H.by.get(key)) || B.words.by.get(key);                                              // 辞書の語とぴったり（似た字のずれだけも含む）
  if (hit) { const w = (H && H.by.get(key) ? H.by.get(key) : hit).w; return rebuild(w) === n ? n : rebuild(w); }
  if (/\d/.test(p.core) || p.core.length < 3) return n;
  const cands = [];
  if (H) for (const x of rcNear(H, key, true)) cands.push(Object.assign(x, { hist: 1 }));
  for (const x of rcNear(B.words, key, false)) cands.push(Object.assign(x, { hist: 0 }));
  const best = rcPick(cands);
  return best ? rebuild(best.e.w) : n;
}
// 値引き系の名前（「…値引」「…割引」で終わる）：最後の2字が合っているときだけ、少し多めのずれを許して直す
const RC_DISC_WORDS = RC_WORD_TEXT.split(" ").filter((w) => w.endsWith("値引") || w.endsWith("割引"));
function rcFixDiscount(n) {
  const m = n.match(/^([A-Za-z]{1,2})?(.*)$/), lead = m[1] || "", s = m[2];
  if (s.length < 3 || !/(?:値引|割引)$/.test(s) || RC_DISC_WORDS.includes(s)) return n;
  let best = null, bd = 99, second = 99;
  for (const w of RC_DISC_WORDS) {
    if (Math.abs(w.length - s.length) > 2) continue;
    const d = rcWD(s, w);
    if (d < bd) { second = bd; bd = d; best = w; } else if (d < second) second = d;
  }
  return best && bd <= best.length * 0.34 && bd > 0 && second - bd >= 0.5 ? lead + best : n;
}
// 店名を直す：履歴の店名・店名の前半（チェーン名）・支店名と、内蔵のチェーン名・市区町村に近い読み違いを直す。支店名だけが読めて、その支店名の店が履歴に1種類だけあれば、その店名にする
function rcFixStore(s, dict, chains) {
  if (!s) return s;
  const B = rcBuilt(), H = dict;
  const fix = (word, tabs, minLen) => {
    const k = rcCanon(word);
    for (const t of tabs) if (t && t.by.has(k)) return t.by.get(k).w;                                // すでに辞書にある（正しい）
    const cands = [];
    tabs.forEach((t, i) => { if (t) for (const x of rcNear(t, k, i === 0 && t.hist, minLen)) cands.push(Object.assign(x, { hist: t.hist ? 1 : 0 })); });
    const b = rcPick(cands);
    return b ? b.e.w : word;
  };
  const histOf = (t) => t && Object.assign(t, { hist: true });
  const chainTab = rcTable((chains || []).map((w) => ({ w })).concat(RC_BRAND_TEXT.split(" ").map((w) => ({ w }))));
  if (H && H.stores.by.has(rcCanon(s))) return H.stores.by.get(rcCanon(s)).w;
  if (H) {                                                                                              // 店名ぜんたいが、履歴の店名と似た字のずれだけ
    const w = rcPick(rcNear(H.stores, rcCanon(s), true, 3).filter((x) => x.arb === 0 && x.ind === 0).map((x) => Object.assign(x, { hist: 1 })));
    if (w) return w.e.w;
  }
  const m = s.match(/^(.*?)(\s*)([^\s]{1,7}店)$/);
  if (!m) return H ? fix(s, [histOf(H.stores), chainTab], 3) : fix(s, [chainTab], 3);
  let brand = m[1].trim(), br = m[3];
  const stem = br.slice(0, -1);
  if (brand) brand = fix(brand, [histOf(H && H.brands), chainTab], 3);
  if (!RC_CITIES.has(stem) && !(H && H.branches.by.has(rcCanon(br)))) {                              // 読み違いの支店名：履歴の支店名・市区町村に近ければ直す
    const cands = [];
    for (const [t, hist] of [[H && H.branches, true], [B.cities, false]]) if (t) for (const x of rcNear(t, rcCanon(br), hist, 3, true)) cands.push(Object.assign(x, { hist: hist ? 1 : 0 }));
    const b = rcPick(cands.filter((x) => x.d <= 0.5 && x.arb === 0));
    if (b) br = b.e.w;
  }
  if (!brand && H) {                                                                                    // 支店名だけ：その支店名の店が履歴に1種類だけなら、その店名
    const full = H.stores.list.filter((e) => rcCanon(e.w).endsWith(rcCanon(br)) && e.w.length > br.length);
    if (full.length === 1) return full[0].w;
  }
  return brand === m[1].trim() ? s.slice(0, s.length - m[3].length) + br : (brand ? brand + (m[2] || " ") : "") + br;
}
