"use strict";
// ===== レシートの読み取り =====
// 読み取った文字から、品目・金額・合計・日付・お店を取り出す
function parseReceipt(text) {
  const z2h = (s) => s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 65248)).replace(/[，]/g, ",").replace(/[￥]/g, "¥");
  const lines = z2h(text).split(/\r?\n/).map((l) => l.replace(/[ \t　]+/g, " ").trim()).filter(Boolean);
  const SKIP = /小計|合計|税|預|釣|現計|点数|ポイント|TEL|電話|No\.?|カード|残高|対象|領収|レジ|責|会員|支払|クレジット|現金|お買上|\d{4}[年\/]/i;
  const out = { store: "", date: "", total: 0, items: [] };
  for (const l of lines) {
    const dm = l.match(/(20\d{2})\s*[年\/.\-]\s*(\d{1,2})\s*[月\/.\-]\s*(\d{1,2})/);
    if (dm && !out.date) out.date = dm[1] + "-" + pad(dm[2]) + "-" + pad(dm[3]);
    if (looksSensitive(l)) continue;                          // カード番号・会員番号・電話番号などの行は読み捨てる
    const m = l.replace(/(\d)\s*,\s*(\d{3})/g, "$1,$2").match(/^(.*?)\s*[¥\\]?\s*(-?\d{1,3}(?:,\d{3})+|-?\d+)\s*円?\s*[※*軽内外非]*$/);
    if (!m) { if (!out.store && !/\d{2,}/.test(l)) out.store = l; continue; }
    const name = m[1].replace(/[¥\\*※]+$/g, "").trim(), price = Number(m[2].replace(/,/g, ""));
    if (/合計/.test(name) && !/小計/.test(name)) { out.total = Math.max(out.total, price); continue; }
    if (!name || SKIP.test(name) || price === 0 || Math.abs(price) > 999999) continue;
    if (price < 0 && !/値引|割引|引/.test(name)) continue;
    out.items.push({ n: name, p: price });
  }
  return out;
}
let ocrLoading = null, ocrBusy = false;
function loadOcr() {
  if (window.Tesseract) return Promise.resolve();
  if (!ocrLoading) ocrLoading = new Promise((ok, ng) => {
    const s = document.createElement("script"); s.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
    s.onload = ok; s.onerror = () => { ocrLoading = null; ng(new Error("load")); }; document.head.appendChild(s);
  });
  return ocrLoading;
}
// 写真は小さくしてから読む（速く、メモリも使いすぎない。作り直した画像なので、写真に付く位置情報も引き継がない）
async function toCanvas(file, maxSide) {
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    const k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(bmp.width * k)); c.height = Math.max(1, Math.round(bmp.height * k));
    const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close();
    return c;
  } catch (e) { return null; }
}
$("receiptBtn").onclick = () => { if (!ocrBusy) $("receiptFile").click(); };
$("receiptFile").onchange = async (e) => {
  let file = e.target.files[0]; e.target.value = "";
  if (!file || ocrBusy) return;
  const st = $("ocrStatus"), btn = $("receiptBtn");
  ocrBusy = true; btn.disabled = true; st.textContent = "読み取りの準備をしています…";
  let canvas = null, worker = null, timer = 0, lastPct = -10;       // 画面の書き換えは5%ごと（細かく書き換えない）
  try {
    canvas = await toCanvas(file, 1600);
    if (!canvas) throw new Error("image");
    await loadOcr();
    worker = await Tesseract.createWorker("jpn", 1, { logger: (m) => { if (m.status !== "recognizing text") return; const pct = Math.round(m.progress * 100); if (pct - lastPct >= 5 || pct === 100) { lastPct = pct; st.textContent = "読み取り中… " + pct + "%"; } } });
    const timeout = new Promise((_, ng) => { timer = setTimeout(() => ng(new Error("timeout")), 120000); });
    const res = await Promise.race([worker.recognize(canvas), timeout]);
    if ($("editOverlay").hidden) return;                        // 読み取り中に入力画面を閉じたときは何も書き込まない
    const r = parseReceipt(res.data.text);
    if (!r.items.length) { st.textContent = "品目を読み取れませんでした。手で入力してください。"; return; }
    const cur = readRows();                                      // 入力済みの品目は消さず、後ろに足す
    $("itemRows").innerHTML = cur.concat(r.items).map((i) => rowHtml(i.n, i.p)).join("");
    if (r.store && !$("eStore").value.trim()) $("eStore").value = r.store;
    if (r.date) $("eDate").value = r.date;
    updateTotal();
    const sum = r.items.reduce((a, i) => a + i.p, 0);
    st.textContent = r.items.length + "品目を読み取りました。" + (r.total && r.total !== sum ? "レシートの合計（" + yen(r.total) + "）と合いません。品目を確かめてください。" : "内容を確かめてから保存してください。");
  } catch (err) {
    st.textContent = err && err.message === "timeout" ? "読み取りに時間がかかったので止めました。明るい場所で撮り直すか、手で入力してください。"
      : err && err.message === "image" ? "この写真は開けませんでした。手で入力してください。" : "この画面ではレシートを読み取れませんでした。手で入力してください。";
  } finally {
    clearTimeout(timer);
    if (worker) { try { await worker.terminate(); } catch (x) {} }
    if (canvas) { canvas.width = canvas.height = 0; }
    file = null; canvas = null;                                  // 写真への参照を捨てる（成功・失敗どちらでも）
    st.textContent += " 写真はアプリから破棄しました。";
    ocrBusy = false; btn.disabled = false;
  }
};
