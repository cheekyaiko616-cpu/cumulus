"use strict";
// ===== 保存（この端末の中） =====
// 役割: ブラウザの保存領域への読み書き。保存したあとの画面の更新は、onSaved に入れた処理（main.js が設定）に任せる
// 依存: model.js, sample.js, stats.js
// 実行時: なし
// 公開: KEY, storageOk, onSaved, load, persist, save

const KEY = "tameru-calendar-v1";   // アプリ名を変えても、この名前は変えない（保存済みの記録を引き続き読むため）
let storageOk = true;
let onSaved = () => {};              // 保存したあとに呼ぶ処理（画面の描き直し）。main.js が入れる
function load() {
  let raw = null;
  try { raw = localStorage.getItem(KEY); } catch (e) { storageOk = false; }
  if (raw) { try { const s = JSON.parse(raw); if (s && typeof s === "object") return normalize(s); } catch (e) {} }
  else if (storageOk) { try { localStorage.setItem(KEY + "-t", "1"); localStorage.removeItem(KEY + "-t"); } catch (e) { storageOk = false; } }   // 初回だけ、保存できる環境かを確かめる
  return sampleState();
}
// 書くだけ（画面は描き直さない）。記録が変わっていない更新に使う
function persist() { try { localStorage.setItem(KEY, JSON.stringify(state)); storageOk = true; } catch (e) { storageOk = false; } }
function save() { persist(); reindex(); onSaved(); }
