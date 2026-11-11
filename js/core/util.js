"use strict";
// ===== 基本の道具 =====
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const comma = (n) => Math.round(n).toLocaleString("ja-JP");
const yen = (n) => "¥" + comma(n);
const pad = (n) => String(n).padStart(2, "0");
const ymd = (y, m, d) => y + "-" + pad(m + 1) + "-" + pad(d);
const dkey = (dt) => ymd(dt.getFullYear(), dt.getMonth(), dt.getDate());
const parseKey = (k) => { const [a, b, c] = k.split("-").map(Number); return new Date(a, b - 1, c); };
const addDays = (k, n) => { const d = parseKey(k); d.setDate(d.getDate() + n); return dkey(d); };
const todayStr = () => dkey(new Date());
const WD = ["日", "月", "火", "水", "木", "金", "土"];
const PAY = { cash: "現金", code: "バーコード決済", credit: "クレジット" };
const payLabel = (e) => e.pay === "credit" ? (e.card || "クレジット") : PAY[e.pay];
const payColor = (e) => "var(--" + e.pay + ")";

// 全角の数字や、カンマ・円記号を取り除いて整数にする（金額の入力欄用）
const toInt = (s) => {
  const t = String(s).replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 65248)).replace(/[−ー－]/g, "-").replace(/[^\d-]/g, "");
  const n = parseInt(t, 10);
  return Number.isFinite(n) ? n : 0;
};
const MAX_PRICE = 9999999;
const MIN_DATE = "2000-01-01";
const isKey = (k) => typeof k === "string" && /^\d{4}-\d{2}-\d{2}$/.test(k);
const dayNo = (k) => { const [y, m, d] = k.split("-").map(Number); return Date.UTC(y, m - 1, d) / 864e5; };
const daysBetween = (a, b) => dayNo(b) - dayNo(a);
const lastKey = (y, m) => ymd(y, m, new Date(y, m + 1, 0).getDate());   // その月の最後の日

// 重ねて開く画面：開いた順に積み、いちばん上だけをEscapeで閉じる。開いている間は後ろをスクロールさせない
const openStack = [];
function openOv(id) {
  $(id).hidden = false;
  if (typeof syncPickers === "function") syncPickers();
  if (!openStack.includes(id)) openStack.push(id);
  document.body.style.overflow = "hidden";
}
function closeOv(id) {
  $(id).hidden = true;
  const i = openStack.indexOf(id);
  if (i >= 0) openStack.splice(i, 1);
  if (!openStack.length) document.body.style.overflow = "";
}
// 消す操作は2回押しで確定（4秒たつと元に戻る）
function armed(btn, label) {
  if (btn.dataset.armed) { delete btn.dataset.armed; btn.textContent = btn.dataset.orig; return true; }
  btn.dataset.armed = "1"; btn.dataset.orig = btn.textContent; btn.textContent = label;
  setTimeout(() => { if (btn.dataset.armed) { delete btn.dataset.armed; btn.textContent = btn.dataset.orig; } }, 4000);
  return false;
}
const mdShort = (k) => { const d = parseKey(k); return (d.getMonth() + 1) + "/" + d.getDate(); };
const mdLabel = (k) => { const d = parseKey(k); return (d.getMonth() + 1) + "/" + d.getDate() + "（" + WD[d.getDay()] + "）"; };
const ymdLabel = (k) => { const [y, m, d] = k.split("-").map(Number); return y + "/" + m + "/" + d; };
const yenS = (n) => (n < 0 ? "−" : "") + yen(Math.abs(n));          // マイナスも読める金額表示
