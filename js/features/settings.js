"use strict";
// ===== 設定 =====
function renderSettings() {
  if (document.activeElement !== $("setDaily")) $("setDaily").value = state.daily;
  $("setStart").value = state.start;
  $("setStart").max = todayStr();
  $("cardsSummary").textContent = state.cards.length ? state.cards.length + "枚" : "未登録";
  renderCardList(); renderNextPay();
}
$("setDaily").onchange = () => { state.daily = Math.min(1000000, Math.max(0, toInt($("setDaily").value))); save(); toast("1日 " + yen(state.daily) + " にしました"); };
$("setStart").onchange = () => {
  let v = $("setStart").value;
  if (!isKey(v)) { renderSettings(); return; }                  // 空にされたら元に戻す
  if (v < MIN_DATE) v = MIN_DATE;
  if (v > todayStr()) v = todayStr();
  state.start = v; save(); toast("数え始める日を変えました");
};

// ---- クレジットカード：一覧の画面 → タップでカードの設定画面 ----
const dayOptions = [[0, "月末"]].concat(Array.from({ length: 28 }, (_, k) => [k + 1, (k + 1) + "日"]));
const fillOptions = (id, list) => { $(id).innerHTML = list.map(([v, t]) => '<option value="' + v + '">' + t + "</option>").join(""); };
fillOptions("cClose", dayOptions); fillOptions("cPay", dayOptions); fillOptions("cMonths", [[1, "翌月"], [2, "翌々月"]]);

function renderCardList() {
  $("cardList").innerHTML = state.cards.length
    ? state.cards.map((c, i) => '<button type="button" class="item" data-cardi="' + i + '"><span class="l">' + esc(c.name) + "<small>" + cardRuleText(c) + '</small></span><span class="r" aria-hidden="true">›</span></button>').join("")
    : '<div class="empty">まだカードがありません。下の「カードを追加」から登録できます。</div>';
}
// 次の引き落とし（今日以降の3件まで）
function renderNextPay() {
  const t = todayStr(), list = pays.filter((p) => p.date >= t).slice(0, 3), box = $("nextPay");
  box.hidden = !list.length;
  box.innerHTML = list.length ? '<div class="np-title">💳 次の引き落とし</div>' +
    list.map((p) => '<div class="np-row"><span>' + mdLabel(p.date) + " " + esc(p.card) + '</span><b class="num">' + yen(p.amount) + "</b></div>").join("") : "";
}
$("openCards").onclick = () => { renderCardList(); renderNextPay(); openOv("cardsOverlay"); };
$("cardList").onclick = (e) => { const b = e.target.closest("[data-cardi]"); if (b && state.cards[Number(b.dataset.cardi)]) openCard(state.cards[Number(b.dataset.cardi)]); };
$("addCardBtn").onclick = () => openCard(null);

let editingCard = null;
const cardForm = () => ({ close: Number($("cClose").value), months: Number($("cMonths").value), pay: Number($("cPay").value) });
function updateRule() { $("cRule").textContent = "引き落とし：" + cardRuleText(cardForm()); }
function openCard(card) {
  editingCard = card || null;
  const c = card || makeCard("");
  $("cardTitle").textContent = card ? "カードの設定" : "カードを追加";
  $("cName").value = card ? card.name : "";
  $("cClose").value = c.close; $("cMonths").value = c.months; $("cPay").value = c.pay;
  $("cDelete").hidden = !card; $("cDelete").textContent = "このカードを消す"; delete $("cDelete").dataset.armed;
  updateRule();
  openOv("cardOverlay");
  $("cardSheet").scrollTop = 0;
}
["cClose", "cMonths", "cPay"].forEach((id) => { $(id).onchange = updateRule; });
$("cSave").onclick = () => {
  const name = $("cName").value.trim();
  if (!name) return toast("カードの名前を入れてください");
  if (looksSensitive(name)) return toast(SENSITIVE_MSG);
  if (state.cards.some((c) => c !== editingCard && c.name === name)) return toast("同じ名前のカードがあります");
  if (!editingCard && state.cards.length >= 30) return toast("カードは30件までです");
  const data = Object.assign({ name }, cardForm());
  if (editingCard) {
    const old = editingCard.name;
    Object.assign(editingCard, data);
    if (old !== name) state.entries.forEach((e) => { if (e.card === old) e.card = name; });   // 名前を変えたら、過去の記録も同じカードのままにする
  } else state.cards.push(data);
  closeOv("cardOverlay"); save(); toast("カードを保存しました");
};
$("cName").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); $("cName").blur(); } });
$("cDelete").onclick = () => {
  if (!armed($("cDelete"), "もう一度押すと消します")) return;
  state.cards = state.cards.filter((c) => c !== editingCard);
  closeOv("cardOverlay"); save(); toast("カードを消しました。記録は残ります");
};

// ---- データ ----
$("wipeBtn").onclick = () => { if (!armed($("wipeBtn"), "もう一度押すと、すべて消します")) return; state = freshState(true); save(); toast("記録をすべて消しました"); };
$("sampleClear").onclick = () => { state = freshState(false); save(); toast("今日から記録を始めます"); };
