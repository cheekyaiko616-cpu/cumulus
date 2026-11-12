"use strict";
// ===== 買い物の入力画面 =====
// 役割: 買い物の記録の入力・直す・消す。クレジットのときの引き落とし日のお知らせ（カードは任意で、未選択でも保存できる）と、メールで取り込み済みの同じ買い物との結び付け（レシートの二重登録を防ぐ）
// 依存: util.js, guard.js, model.js, sample.js, billing.js, mail-plan.js, storage.js, dom.js, overlay.js
// 実行時: day.js
// 公開: editing, editPay, matchMode, rowHtml, readRows, updateTotal, setPay, updateCardHint, findMailMatch, updateMatch, openEdit

// ---- 折り返して高さが伸びる入力欄（textarea.ag）：全文を見せる。改行は入れさせない ----
function autoGrow(el) {
  if (!el.offsetWidth) return;                       // 隠れている間は測れない（開いたときに ResizeObserver が呼ぶ）
  el.style.height = "auto"; el.style.height = el.scrollHeight + 2 + "px";   // 枠線の分
}
function growAll(root) { root.querySelectorAll("textarea.ag").forEach(autoGrow); }
// 入力中の欄がキーボードや下のボタンに隠れないよう、見える範囲に収める（イベントのときだけ動く）
function reveal(el) {
  const sheet = el.closest(".sheet"); if (!sheet) return;
  const foot = sheet.querySelector(".sheet-foot"), vv = window.visualViewport;
  const sr = sheet.getBoundingClientRect(), r = el.getBoundingClientRect();
  let bottom = Math.min(sr.bottom, vv ? vv.offsetTop + vv.height : innerHeight);
  if (foot && foot.getBoundingClientRect().top < bottom) bottom = foot.getBoundingClientRect().top;
  if (r.bottom > bottom - 8) sheet.scrollTop += r.bottom - bottom + 8;
  else if (r.top < sr.top + 8) sheet.scrollTop -= sr.top + 8 - r.top;
}
document.addEventListener("input", (e) => {
  const el = e.target; if (!el.matches || !el.matches("textarea.ag")) return;
  if (el.value.includes("\n")) el.value = el.value.replace(/\s*[\r\n]+\s*/g, " ");   // 貼り付けの改行は空白にする
  autoGrow(el); reveal(el);
});
document.addEventListener("focusin", (e) => { const el = e.target; if (el.matches && el.matches("textarea.ag, input, select")) reveal(el); });
document.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.matches && e.target.matches("textarea.ag") && !e.defaultPrevented) { e.preventDefault(); e.target.blur(); } });
if (window.visualViewport) visualViewport.addEventListener("resize", () => { const a = document.activeElement; if (a && a.closest && a.closest(".sheet")) reveal(a); });
if (window.ResizeObserver) {                          // 画面を開いたとき（幅0から実寸になる）・向きや幅が変わったときだけ高さを合わせる。開く処理のフックは増やさない
  const widths = new WeakMap();
  const ro = new ResizeObserver((list) => list.forEach((x) => { const w = Math.round(x.contentRect.width); if (!w) widths.delete(x.target); else if (widths.get(x.target) !== w) { widths.set(x.target, w); growAll(x.target); } }));
  document.querySelectorAll(".sheet").forEach((s) => ro.observe(s));
}
new MutationObserver((list) => list.forEach((m) => m.addedNodes.forEach((n) => { if (n.nodeType === 1) growAll(n); }))).observe($("itemRows"), { childList: true });

let editing = null, editPay = "cash", matchMode = "same";
function rowHtml(n, p) {
  return '<div class="row"><textarea class="n ag" rows="1" placeholder="品目" aria-label="品目" autocomplete="off" enterkeyhint="next">' + esc(n || "") + '</textarea>' +
    '<span class="pw"><input type="text" class="p" inputmode="numeric" placeholder="金額" aria-label="金額（円）" autocomplete="off" enterkeyhint="next" value="' + (p === 0 || p ? p : "") + '"></span>' +
    '<button type="button" class="del" aria-label="この品目を消す">✕</button></div>';
}
function readRows() {
  return [...$("itemRows").children].map((r) => ({ n: r.querySelector(".n").value.trim(), p: Math.max(-MAX_PRICE, Math.min(MAX_PRICE, toInt(r.querySelector(".p").value))) })).filter((i) => i.n || i.p);
}
function updateTotal() { autoGrow($("eStore")); $("eTotal").textContent = yen(readRows().reduce((a, i) => a + i.p, 0)); updateMatch(); }
function setPay(p) {
  editPay = p;
  setSeg($("paySeg"), (b) => b.dataset.pay === p);
  $("cardWrap").hidden = p !== "credit";
  updateCardHint();
}
// 選んだカードと日付から、この買い物がいつ引き落とされるかを見せる
function updateCardHint() {
  const h = $("cardHint"), date = $("eDate").value, name = $("eCard").value;
  if (editPay !== "credit" || !isKey(date) || !name) { h.textContent = ""; return; }
  const c = cardOf(name);
  h.textContent = mdLabel(payDateOf(cycleEnd(date, c.close), c)) + " に引き落とされます（" + cardRuleText(c) + "）";
}
$("eCard").onchange = () => { updateCardHint(); updateMatch(); };
$("eDate").onchange = () => { updateCardHint(); updateMatch(); };

// ---- メールで取り込み済みの記録と同じ買い物か（レシートの二重登録を防ぐ） ----
// 入力中の内容と同じ買い物の、メールの記録を探す（探し方は core/mail-plan.js の matchMailEntry）
function findMailMatch() {
  if (editing || editPay !== "credit") return null;
  return matchMailEntry($("eDate").value, readRows().reduce((a, i) => a + i.p, 0), $("eCard").value);
}
function updateMatch() {
  const hit = findMailMatch(), box = $("matchBox");
  box.hidden = !hit;
  if (!hit) return;
  $("matchText").textContent = "メール取込済み：" + mdLabel(hit.date) + " " + (hit.store || "ご利用") + " " + yen(hit.total);
  setSeg($("matchSeg"), (b) => (b.dataset.k === "same") === (matchMode === "same"));
}
$("matchSeg").onclick = (e) => { const b = e.target.closest("[data-k]"); if (b) { matchMode = b.dataset.k; updateMatch(); } };
function fillCards(sel) {
  const list = state.cards.map((c) => c.name); if (sel && !list.includes(sel)) list.push(sel);
  $("eCard").innerHTML = '<option value=""' + (sel ? "" : " selected") + ">カード未選択</option>" + list.map((c) => "<option" + (c === sel ? " selected" : "") + ">" + esc(c) + "</option>").join("");   // カードは任意（未選択のまま保存できる。あとでメールの取り込みが埋める）
}
function openEdit(entry, date) {
  editing = entry || null; matchMode = "same";
  $("editTitle").textContent = entry ? "記録を直す" : "買い物を記録";
  $("eDate").value = entry ? entry.date : (date || todayStr());
  $("eStore").value = entry ? entry.store : "";
  fillCards(entry ? entry.card : "");
  setPay(entry ? entry.pay : "cash");
  $("itemRows").innerHTML = entry ? entry.items.map((i) => rowHtml(i.n, i.p)).join("") : rowHtml("", "");
  $("deleteBtn").hidden = !entry; $("deleteBtn").textContent = "この記録を消す"; delete $("deleteBtn").dataset.armed;
  $("ocrStatus").textContent = "";
  $("ocrPick").hidden = true; $("ocrPick").innerHTML = "";
  updateTotal();
  openOv("editOverlay");
  $("editSheet").scrollTop = 0;
}
$("addBtn").onclick = () => openEdit(null, todayStr());
$("paySeg").onclick = (e) => { const b = e.target.closest("[data-pay]"); if (b) setPay(b.dataset.pay); };
$("addRow").onclick = () => { $("itemRows").insertAdjacentHTML("beforeend", rowHtml("", "")); $("itemRows").lastElementChild.querySelector(".n").focus(); };
$("itemRows").addEventListener("input", updateTotal);
$("itemRows").addEventListener("click", (e) => {
  if (!e.target.classList.contains("del")) return;
  e.target.closest(".row").remove();
  if (!$("itemRows").children.length) $("itemRows").innerHTML = rowHtml("", "");   // 入力行がなくならないようにする
  updateTotal();
});
// Enterで「品目 → 金額 → 次の行」へ進む
$("itemRows").addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  const row = e.target.closest(".row"); if (!row) return;
  e.preventDefault();
  if (e.target.classList.contains("n")) row.querySelector(".p").focus();
  else if (row.nextElementSibling) row.nextElementSibling.querySelector(".n").focus();
  else $("addRow").click();
});
$("saveBtn").onclick = () => {
  const items = readRows(), total = items.reduce((a, i) => a + i.p, 0), date = $("eDate").value;
  if (!isKey(date) || date < MIN_DATE) return toast("日付を入れてください");
  if (looksSensitive($("eStore").value) || items.some((i) => looksSensitive(i.n))) return toast(SENSITIVE_MSG);
  if (!items.length || total <= 0) return toast("品目と金額を1つ以上入れてください");
  const data = { date, store: $("eStore").value.trim(), pay: editPay, card: editPay === "credit" ? $("eCard").value : "", items, total };
  if (state.sample) leaveSample([data.card]);
  if (editing && !state.entries.includes(editing)) editing = null;   // 見本を消したあとは、新しい記録として保存する
  const hit = matchMode === "same" ? findMailMatch() : null;
  if (hit) {                                                          // メールで取り込み済みの同じ買い物：新しく作らず、その記録に品目などを反映する（重複させない）
    hit.items = items; hit.rc = true;
    if (data.store) hit.store = data.store;
    if (!hit.card && data.card) hit.card = data.card;
    closeOv("editOverlay"); save(); toast("メールの記録に反映しました（重複なし）");
    if (!$("dayOverlay").hidden) { dayKey = hit.date; renderDay(); }
    return;
  }
  if (editing) Object.assign(editing, data); else state.entries.push(Object.assign({ id: "e" + Date.now() + Math.random().toString(36).slice(2, 6) }, data));
  closeOv("editOverlay");
  save(); toast("保存しました");
  if (!$("dayOverlay").hidden) { dayKey = date; renderDay(); }
};
$("deleteBtn").onclick = () => {
  if (!armed($("deleteBtn"), "もう一度押すと消します")) return;
  state.entries = state.entries.filter((x) => x !== editing);
  closeOv("editOverlay"); save(); toast("消しました");
  if (!$("dayOverlay").hidden) renderDay();
};
