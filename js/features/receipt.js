"use strict";
// ===== レシートの写真の読み取り =====
// 役割: 写真を開き（向きを直し）、暗い背景の上なら紙の所だけにして、影に強い白黒で文字に読み取り（足りなければ写真のままでもう一度）、入力画面の品目・お店・日付・支払い方法に入れる。合計と日付に候補があるときは選べるようにする。写真は保存せず、外にも送らず、終わったらすぐ捨てる（文字の解析は core/receipt-parse.js、画素の計算は core/receipt-image.js）
// 依存: util.js, model.js, receipt-parse.js, receipt-image.js, dom.js
// 実行時: edit.js
// 公開: なし

const OCR_JS = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
const OCR_SIZES = [[3000, 7e6], [1800, 3.2e6]];                       // [長辺, 画素数の上限]。大きい方で失敗したら小さい方でやり直す（iPhoneのメモリ対策）
const OCR_TEXT_MAX = 48, OCR_TEXT_FIT = 40;                            // 文字の高さがこれより大きいときは、この高さになるよう縮める（画素）
const OCR_MSG = {
  open: "この写真は開けませんでした。別の写真で試すか、手で入力してください。",
  data: "読み取り用のデータを取得できませんでした。通信を確かめて、もう一度お試しください。",
  timeout: "読み取りに時間がかかったので止めました。手で入力してください。",
  blank: "文字を読み取れませんでした。レシートを大きく写して、もう一度お試しください。",
  noitem: "品目を読み取れませんでした。手で入力してください。",
  engine: "この画面ではレシートを読み取れませんでした。手で入力してください。",
};
const ocrErr = (k) => Object.assign(new Error(k), { ocr: k });
let ocrLoading = null, ocrBusy = false, adjRow = null;

// 時間切れつきで待つ（時間切れのときは k のエラー）。タイマーは待っている間だけ動かし、終わったら必ず止める
function within(p, ms, k) {
  let t = 0;
  return Promise.race([p, new Promise((_, ng) => { t = setTimeout(() => ng(ocrErr(k)), ms); })]).finally(() => clearTimeout(t));
}
// 読み取りの部品（Tesseract.js）を読み込む。失敗したら1回やり直す
function loadOcr() {
  if (window.Tesseract) return Promise.resolve();
  if (!ocrLoading) {
    const once = () => new Promise((ok, ng) => {
      const s = document.createElement("script"); s.src = OCR_JS;
      s.onload = ok; s.onerror = () => { s.remove(); ng(ocrErr("data")); }; document.head.appendChild(s);
    });
    ocrLoading = within(once(), 25000, "data").catch(() => within(once(), 25000, "data")).catch((e) => { ocrLoading = null; throw ocrErr("data"); });
  }
  return ocrLoading;
}
// 読み取りの作業部品（日本語のデータ付き）を用意する。取得に失敗・時間切れなら1回やり直す
async function makeWorker(onStatus) {
  let lastPct = -10, lastKind = "";
  const logger = (m) => {                                             // 画面の書き換えは5%ごと（細かく書き換えない）
    const kind = m.status === "recognizing text" ? "読み取り中… " : /^loading (language|tesseract)/.test(m.status) ? "読み取り用のデータを取得中… " : "";
    if (!kind) return;
    if (kind !== lastKind) { lastKind = kind; lastPct = -10; }
    const pct = Math.round((m.progress || 0) * 100);
    if (pct - lastPct >= 5 || pct === 100) { lastPct = pct; onStatus(kind + pct + "%"); }
  };
  for (let i = 0; i < 2; i++) {
    let late = false;
    const p = Tesseract.createWorker("jpn", 1, { logger }).then((w) => { if (late) w.terminate(); return w; });   // 時間切れのあとで出来上がったものは捨てる
    try { return await within(p, 90000, "data"); } catch (e) { late = true; if (i) throw ocrErr("data"); await new Promise((r) => setTimeout(r, 1000)); }
  }
}

// 写真を開く。createImageBitmap（向きの補正つき）→ 補正なし → <img> の順に試す。向きが直っていなければ（EXIFの向きが5〜8で、縦横が保存のままのとき）こちらで直す
async function openPhoto(file) {
  let head = null;
  try { head = new Uint8Array(await file.slice(0, 262144).arrayBuffer()); } catch (e) {}
  const ori = exifOrientation(head), raw = jpegSize(head);
  let src = null;
  if (window.createImageBitmap) {
    try { src = await createImageBitmap(file, { imageOrientation: "from-image" }); } catch (e) {}
    if (!src) try { src = await createImageBitmap(file); } catch (e) {}
  }
  if (!src) {
    const url = URL.createObjectURL(file);
    try {
      src = await new Promise((ok, ng) => { const im = new Image(); im.onload = () => ok(im); im.onerror = () => ng(ocrErr("open")); im.src = url; });
    } finally { URL.revokeObjectURL(url); }
  }
  const sw = src.naturalWidth || src.width, sh = src.naturalHeight || src.height;
  if (!sw || !sh) throw ocrErr("open");
  const fix = ori >= 5 && raw && raw.w !== raw.h && sw === raw.w && sh === raw.h ? ori : 1;      // 向きが5〜8なのに縦横が保存のままなら、補正されていない
  return { src, sw, sh, ori: fix, close() { if (src.close) src.close(); } };
}
// 写真の範囲 box（向きを直した後の座標。なければ全体）を、長辺 side・画素数 pix に収まる大きさ（k 倍まで）の canvas に描く
function drawPhoto(ph, side, pix, box, k0) {
  const o = orientMatrix(ph.ori, ph.sw, ph.sh), b = box || { x: 0, y: 0, w: o.w, h: o.h };
  const sz = fitSize(b.w * (k0 || 1), b.h * (k0 || 1), side, pix), k = sz.w / b.w;
  const c = document.createElement("canvas"); c.width = sz.w; c.height = sz.h;
  const g = c.getContext("2d"); if (!g) throw ocrErr("open");
  g.imageSmoothingQuality = "high"; g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
  g.setTransform(o.m[0] * k, o.m[1] * k, o.m[2] * k, o.m[3] * k, (o.m[4] - b.x) * k, (o.m[5] - b.y) * k); g.drawImage(ph.src, 0, 0);
  return c;
}
// 暗い机・布の上で撮ったときの、紙の範囲（向きを直した後の座標）。小さく縮めた写真で調べる。見つからなければ null（写真全体を使う）
function findPaper(ph) {
  try {
    const c = drawPhoto(ph, 320, 1e9), w = c.width, h = c.height, o = orientMatrix(ph.ori, ph.sw, ph.sh);
    const b = paperBox(toGray(c.getContext("2d").getImageData(0, 0, w, h).data, w * h), w, h);
    c.width = c.height = 0;
    if (!b) return null;
    const kx = o.w / w, ky = o.h / h, x = Math.floor(b.x * kx), y = Math.floor(b.y * ky);
    return { x, y, w: Math.min(o.w - x, Math.ceil(b.w * kx)), h: Math.min(o.h - y, Math.ceil(b.h * ky)) };
  } catch (e) { return null; }
}
// 写真を読み取り用の大きさの canvas にする（紙の範囲だけ）。メモリが足りなくて失敗したら、小さい大きさでやり直す。k は縮める倍率（文字が大きすぎるとき）
function prepare(ph, box, k) {
  let last = null;
  for (const [side, pix] of OCR_SIZES) {
    try { return drawPhoto(ph, side, pix, box, k); } catch (e) { last = e; }
  }
  throw last && last.ocr ? last : ocrErr("open");
}
// 影に強い白黒の canvas と、文字の高さ（画素）を作る。真っ白・真っ黒になったときは canvas を null にする（読めるはずの写真を潰さない）
function binaryCanvas(c) {
  const w = c.width, h = c.height, g = c.getContext("2d");
  let gray = toGray(g.getImageData(0, 0, w, h).data, w * h);
  binarize(gray, w, h);
  despeckle(gray, w, h, 6, Math.round(0.05 * Math.max(w, h)));
  let black = 0; for (let i = 0; i < gray.length; i += 7) if (gray[i] === 0) black++;
  const ratio = black / Math.ceil(gray.length / 7);
  if (ratio < 0.002 || ratio > 0.45) return { canvas: null, th: 0 };
  const th = textHeight(gray, w, h);
  const c2 = document.createElement("canvas"); c2.width = w; c2.height = h;
  const id = c2.getContext("2d").createImageData(w, h), d = id.data;
  for (let i = 0, j = 0; i < gray.length; i++, j += 4) { d[j] = d[j + 1] = d[j + 2] = gray[i]; d[j + 3] = 255; }
  c2.getContext("2d").putImageData(id, 0, 0);
  gray = null;
  return { canvas: c2, th };
}
// 向きを変えた canvas（deg は時計回り 90・180・270。EXIFのない横向き・上下逆の写真用）
function turned(c, deg) {
  const w = c.width, h = c.height, o = document.createElement("canvas");
  o.width = deg === 180 ? w : h; o.height = deg === 180 ? h : w;
  const g = o.getContext("2d"); if (!g) throw ocrErr("open");
  g.fillStyle = "#fff"; g.fillRect(0, 0, o.width, o.height);
  const m = deg === 90 ? [0, 1, -1, 0, h, 0] : deg === 180 ? [-1, 0, 0, -1, w, h] : [0, -1, 1, 0, 0, w];
  g.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]); g.drawImage(c, 0, 0);
  return o;
}
const rcGood = (r) => !!(r.total && r.date && !r.guess && r.items.length && r.store && r.total === r.items.reduce((a, i) => a + i.p, 0));

// ---- 合計・日付の候補（複数あるときだけ出す。選ぶと入力欄に入る） ----
function clearPick() { adjRow = null; $("ocrPick").hidden = true; $("ocrPick").innerHTML = ""; }
function pickHtml(label, kind, list, label2, cur) {
  return '<div class="chips"><span class="pk">' + label + "</span>" + list.map((v) => '<button type="button" data-k="' + kind + '" data-v="' + esc(v) + '" aria-pressed="' + (v === cur) + '">' + esc(label2(v)) + "</button>").join("") + "</div>";
}
function showPick(r, sum) {
  const box = $("ocrPick"), showTotal = r.totals.length > 1 || (r.totals.length === 1 && r.totals[0] !== sum), showDate = r.dates.length > 1;
  box.innerHTML = (showDate ? pickHtml("日付", "date", r.dates, ymdLabel, r.date) : "") + (showTotal ? pickHtml("合計", "total", r.totals.map(String), (v) => yen(Number(v)), r.totals[0] === sum ? String(sum) : "") : "");
  box.hidden = !box.innerHTML;
}
// 合計を選んだとき：品目の合計と違えば「差額」の行で合わせる（読み取れなかった品目の分）
function applyTotal(v) {
  const rows = $("itemRows");
  if (adjRow && !adjRow.isConnected) adjRow = null;
  if (adjRow) { adjRow.remove(); adjRow = null; }
  const d = v - readRows().reduce((a, i) => a + i.p, 0);
  if (d) { rows.insertAdjacentHTML("beforeend", rowHtml("差額", d)); adjRow = rows.lastElementChild; }
  else if (!rows.children.length) rows.innerHTML = rowHtml("", "");
  updateTotal();
}
$("ocrPick").onclick = (e) => {
  const b = e.target.closest("button[data-k]"); if (!b) return;
  if (b.dataset.k === "date") { $("eDate").value = b.dataset.v; $("eDate").dispatchEvent(new Event("change")); }
  else applyTotal(Number(b.dataset.v));
  b.parentNode.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", x === b));
};

$("receiptBtn").onclick = () => { if (!ocrBusy) $("receiptFile").click(); };
$("receiptFile").onchange = async (e) => {
  let file = e.target.files[0]; e.target.value = "";
  if (!file || ocrBusy) return;
  const st = $("ocrStatus"), btn = $("receiptBtn");
  ocrBusy = true; btn.disabled = true; clearPick(); st.textContent = "読み取りの準備をしています…";
  let ph = null, c1 = null, c2 = null, worker = null;
  const say = (t) => { if (st.textContent !== t) st.textContent = t; };
  try {
    ph = await openPhoto(file);
    file = null;
    const box = findPaper(ph);                                        // 暗い背景の上のレシートは、紙の所だけにする（文字が大きく写る）
    c1 = prepare(ph, box);
    let b = binaryCanvas(c1);
    if (b.th > OCR_TEXT_MAX) {                                        // 文字が大きすぎる（読み取りが崩れやすく、時間もかかる）：縮めて作り直す
      const k = (OCR_TEXT_FIT / b.th) * c1.width / (box ? box.w : orientMatrix(ph.ori, ph.sw, ph.sh).w);   // 元の写真に対する倍率
      if (b.canvas) b.canvas.width = b.canvas.height = 0;
      c1.width = c1.height = 0; c1 = prepare(ph, box, k);
      b = binaryCanvas(c1);
    }
    c2 = b.canvas; b = null;
    ph.close(); ph = null;
    await loadOcr();
    worker = await makeWorker(say);
    await worker.setParameters({ tessedit_pageseg_mode: "6", preserve_interword_spaces: "1" });        // 6＝ひとかたまりの文字として読む（金額が品名と同じ行に残る）
    const run = async (canvas, ms) => parseReceipt((await within(worker.recognize(canvas), ms, "timeout")).data.text);
    say("読み取り中…");
    const [p1, p2] = c2 ? [c2, c1] : [c1, null];                      // 先に影に強い白黒で読む（白黒にできなかったときは写真のまま）
    let r = await run(p1, 100000);
    if ($("editOverlay").hidden) return;                              // 読み取り中に入力画面を閉じたときは何も書き込まない
    if (!rcGood(r) && p2) {                                           // 店名・日付・合計・品目のどれかが読めなかったか、品目の合計が合わないときだけ、写真のままでもう一度読み、よいほうを使う
      say("もう一度読み取っています…"); r = mergeReceipts(r, await run(p2, 80000));
    }
    if ($("editOverlay").hidden) return;
    if (!r.total && !r.date) {                                        // 合計も日付も読めない：向きが違う写真（EXIFのない横向き・上下逆）かもしれない。90・180・270度回して読み、いちばんよいものを使う（同点なら元のまま）
      for (const deg of [90, 180, 270]) {
        say("向きを変えて読み取っています…");
        let t = null;
        try { t = turned(p1, deg); const r2 = await run(t, 60000); if (rcScore(r2) > rcScore(r)) r = r2; } catch (e) { break; } finally { if (t) t.width = t.height = 0; }
        if ($("editOverlay").hidden) return;
        if (r.total && r.date) break;
      }
    }
    if (!r.items.length && !r.total && !r.date && !r.store) { say(OCR_MSG.blank); return; }
    const cur = readRows();                                           // 入力済みの品目は消さず、後ろに足す
    if (r.items.length) $("itemRows").innerHTML = cur.concat(r.items).map((i) => rowHtml(i.n, i.p)).join("");
    if (r.store && !$("eStore").value.trim()) $("eStore").value = r.store;
    if (r.date) { $("eDate").value = r.date; $("eDate").dispatchEvent(new Event("change")); }
    if (r.pay) {                                                      // 支払い方法（クレジットなら、カードの会社名が登録済みのカードの名前と合えば、そのカード）
      setPay(r.pay);
      const card = r.pay === "credit" && (receiptCard(r.brand, state.cards.map((c) => c.name)) || (r.brand === "JCB" && state.mail.cards.jcb) || "");
      if (card && state.cards.some((c) => c.name === card)) { $("eCard").value = card; updateCardHint(); }
    }
    updateTotal();
    const sum = readRows().reduce((a, i) => a + i.p, 0);
    showPick(r, sum);
    say(!r.items.length ? OCR_MSG.noitem : r.items.length + "品目を読み取りました。" + (r.total && r.total !== sum ? "レシートの合計（" + yen(r.total) + "）と合いません。確かめてください。" : ""));
    $("editSheet").scrollTop = 0;                                     // 結果の案内・合計の候補が見えるよう、入力画面を先頭に戻す（読み取り中に動かしていても）
  } catch (err) {
    say(OCR_MSG[err && err.ocr] || OCR_MSG.engine);
  } finally {
    if (worker) { try { await worker.terminate(); } catch (x) {} }
    if (ph) ph.close();
    for (const c of [c1, c2]) if (c) c.width = c.height = 0;
    file = ph = c1 = c2 = null;                                       // 写真への参照を捨てる（成功・失敗どちらでも）
    ocrBusy = false; btn.disabled = false;
  }
};
