"use strict";
// ===== 保存（この端末の中） =====
// 役割: ブラウザの保存領域への読み書き。保存したあとの画面の更新は、onSaved に入れた処理（main.js が設定）に任せる
// 依存: model.js, sample.js, stats.js
// 実行時: なし
// 公開: KEY, KEY_PREV, KEY_BK, storageOk, onSaved, load, persist, save, tryWrite, readKey, dropKey

const KEY = "tameru-calendar-v1";   // アプリ名を変えても、この名前は変えない（保存済みの記録を引き続き読むため）
const KEY_PREV = KEY + "-prev";      // 復元の直前のデータ（1回分。「元に戻す」用）
const KEY_BK = KEY + "-bk";          // バックアップを最後に保存した日時（ミリ秒）。記録のデータには入れない
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
// 容量超過などで書けなかったことを、呼んだ側が知るための読み書き（書けなかったときは、元の値のまま）
function tryWrite(key, text) { try { localStorage.setItem(key, text); storageOk = true; return true; } catch (e) { return false; } }
function readKey(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
function dropKey(key) { try { localStorage.removeItem(key); } catch (e) {} }
