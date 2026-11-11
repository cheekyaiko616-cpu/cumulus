"use strict";
// ===== 日付・金額・文字の道具 =====
// 役割: 日付（"2026-11-10" の形の文字列）・金額・文字列を扱う、画面に依存しない小さな関数
// 依存: なし
// 実行時: なし
// 公開: esc, comma, yen, yenS, pad, ymd, dkey, parseKey, addDays, todayStr, WD, isKey, dayNo, daysBetween, lastKey, mdShort, mdLabel, ymdLabel, toInt

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ---- 金額 ----
const comma = (n) => Math.round(n).toLocaleString("ja-JP");
const yen = (n) => "¥" + comma(n);
const yenS = (n) => (n < 0 ? "−" : "") + yen(Math.abs(n));          // マイナスも読める金額表示
// 全角の数字や、カンマ・円記号を取り除いて整数にする（金額の入力欄用）
const toInt = (s) => {
  const t = String(s).replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 65248)).replace(/[−ー－]/g, "-").replace(/[^\d-]/g, "");
  const n = parseInt(t, 10);
  return Number.isFinite(n) ? n : 0;
};

// ---- 日付（"YYYY-MM-DD" の文字列。月は0始まりの数で受け渡す） ----
const WD = ["日", "月", "火", "水", "木", "金", "土"];
const pad = (n) => String(n).padStart(2, "0");
const ymd = (y, m, d) => y + "-" + pad(m + 1) + "-" + pad(d);
const dkey = (dt) => ymd(dt.getFullYear(), dt.getMonth(), dt.getDate());
const parseKey = (k) => { const [a, b, c] = k.split("-").map(Number); return new Date(a, b - 1, c); };
const addDays = (k, n) => { const d = parseKey(k); d.setDate(d.getDate() + n); return dkey(d); };
const todayStr = () => dkey(new Date());
const isKey = (k) => typeof k === "string" && /^\d{4}-\d{2}-\d{2}$/.test(k);
const dayNo = (k) => { const [y, m, d] = k.split("-").map(Number); return Date.UTC(y, m - 1, d) / 864e5; };
const daysBetween = (a, b) => dayNo(b) - dayNo(a);
const lastKey = (y, m) => ymd(y, m, new Date(y, m + 1, 0).getDate());   // その月の最後の日
const mdShort = (k) => { const d = parseKey(k); return (d.getMonth() + 1) + "/" + d.getDate(); };
const mdLabel = (k) => { const d = parseKey(k); return (d.getMonth() + 1) + "/" + d.getDate() + "（" + WD[d.getDay()] + "）"; };
const ymdLabel = (k) => { const [y, m, d] = k.split("-").map(Number); return y + "/" + m + "/" + d; };
