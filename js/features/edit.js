"use strict";
// ===== 買い物の入力画面 =====
// 役割: 買い物の記録の入力・直す・消す。クレジットのときの引き落とし日のお知らせと、メールで取り込み済みの同じ買い物との結び付け（レシートの二重登録を防ぐ）
// 依存: util.js, guard.js, model.js, sample.js, billing.js, mail-plan.js, storage.js, dom.js, overlay.js
// 実行時: day.js
// 公開: editing, editPay, matchMode, rowHtml, readRows, updateTotal, setPay, updateCardHint, findMailMatch, updateMatch, openEdit

let editing = null, editPay = "cash", matchMode = "same";
function rowHtml(n, p) {
  return '<div class="row"><input type="text" class="n" placeholder="品目" aria-label="品目" autocomplete="off" enterkeyhint="next" value="' + esc(n || "") + '">' +
    '<input type="text" class="p" inputmode="numeric" placeholder="金額" aria-label="金額（円）" autocomplete="off" enterkeyhint="next" value="' + (p === 0 || p ? p : "") + '">' +
    '<button type="button" class="del" aria-label="この品目を消す">✕</button></div>';
}
function readRows() {
  return [...$("itemRows").children].map((r) => ({ n: r.querySelector(".n").value.trim(), p: Math.max(-MAX_PRICE, Math.min(MAX_PRICE, toInt(r.querySelector(".p").value))) })).filter((i) => i.n || i.p);
}
function updateTotal() { $("eTotal").textContent = yen(readRows().reduce((a, i) => a + i.p, 0)); updateMatch(); }
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
  h.textContent = "この買い物は " + mdLabel(payDateOf(cycleEnd(date, c.close), c)) + " に引き落とされます（" + cardRuleText(c) + "）";
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
  $("matchText").textContent = "メールで取り込み済み：" + mdLabel(hit.date) + " " + (hit.store || "ご利用") + " " + yen(hit.total) + "。同じ買い物なら、この記録に反映します。";
  setSeg($("matchSeg"), (b) => (b.dataset.k === "same") === (matchMode === "same"));
}
$("matchSeg").onclick = (e) => { const b = e.target.closest("[data-k]"); if (b) { matchMode = b.dataset.k; updateMatch(); } };
function fillCards(sel) {
  const list = state.cards.map((c) => c.name); if (sel && !list.includes(sel)) list.push(sel);
  $("eCard").innerHTML = list.length ? list.map((c) => "<option" + (c === sel ? " selected" : "") + ">" + esc(c) + "</option>").join("") : '<option value="">（設定でカードを追加できます）</option>';
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
