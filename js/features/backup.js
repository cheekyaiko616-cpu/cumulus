"use strict";
// ===== バックアップ（保存・復元・元に戻す） =====
// 役割: 設定画面の「データ」の操作。全データをファイルに書き出す（共有シートが使えるときは共有、だめならダウンロード）、ファイルから復元する（点検は core/backup.js。通らなければ何も変えない）、復元の直前の状態に戻す（1回分）。通信はしない
// 依存: util.js, model.js, backup-file.js, storage.js, stats.js, dom.js, overlay.js
// 実行時: なし
// 公開: renderBackup

const say = (t) => { $("bkMsg").textContent = t || ""; if (t) toast(t); };
// 「11/13 10:30」の形（今年でなければ年から）
function stamp(ms) {
  const d = new Date(ms), hm = pad(d.getHours()) + ":" + pad(d.getMinutes());
  return d.getFullYear() === new Date().getFullYear() ? (d.getMonth() + 1) + "/" + d.getDate() + " " + hm : ymdLabel(dkey(d));
}
function renderBackup() {
  const at = Number(readKey(KEY_BK));
  $("bkLast").textContent = at > 0 ? stamp(at) : "";
  $("bkUndo").hidden = readKey(KEY_PREV) === null;
}

// ---- 保存 ----
// スマホの共有シートが使えるか（ファイルを渡せるか）を確かめる。パソコンはダウンロードのほうが自然なので、指で操作する端末だけ
const canShareFile = (file) => !!(navigator.share && navigator.canShare && window.matchMedia && matchMedia("(pointer: coarse)").matches && navigator.canShare({ files: [file] }));
function download(text, name) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" })), a = document.createElement("a");
  a.href = url; a.download = name; a.hidden = true; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
async function saveBackup() {
  const now = new Date(), text = makeBackup(state, now), name = backupName(now);
  let shared = false;
  try {
    const file = new File([text], name, { type: "application/json" });
    if (canShareFile(file)) { await navigator.share({ files: [file], title: name }); shared = true; }
  } catch (e) {
    if (e && e.name === "AbortError") return;                      // 共有シートを閉じただけ
  }
  if (!shared) download(text, name);                               // 共有できなければ、ダウンロードで保存
  tryWrite(KEY_BK, String(now.getTime()));
  renderBackup(); say("バックアップを書き出しました");
}
$("bkSave").onclick = () => { saveBackup(); };

// ---- 復元 ----
function applyRestore(ns) {
  const old = readKey(KEY_PREV);
  if (!tryWrite(KEY_PREV, JSON.stringify(state))) return say("端末の保存容量が足りず、復元できません。何も変わっていません");   // 元に戻せる状態にできなければ、始めない
  if (!tryWrite(KEY, JSON.stringify(ns))) {
    if (old === null) dropKey(KEY_PREV); else tryWrite(KEY_PREV, old);
    return say("端末の保存容量が足りず、復元できません。何も変わっていません");
  }
  state = ns; reindex(); onSaved();                                // 見えている画面を描き直す（ほかの画面は開くときに描く）
  say("復元しました（記録" + ns.entries.length + "件）");
}
$("bkLoad").onclick = () => {
  if (!armed($("bkLoad"), "いまのデータは置き換えられます。もう一度押す")) return;
  $("bkFile").value = ""; $("bkFile").click();
};
$("bkFile").onchange = async () => {
  const f = $("bkFile").files[0]; $("bkFile").value = "";
  if (!f) return;
  if (f.size > MAX_BACKUP_BYTES) return say("ファイルが大きすぎます。何も変わっていません");
  let text;
  try { text = await f.text(); } catch (e) { return say("ファイルを読めませんでした。何も変わっていません"); }
  const r = parseBackup(text, state.mail);
  if (!r.ok) return say(r.why + "。何も変わっていません");
  applyRestore(r.state);
};

// ---- 元に戻す（復元の直前の状態。1回分） ----
$("bkUndo").onclick = () => {
  if (!armed($("bkUndo"), "もう一度押すと、復元の前に戻します（その後の記録は消えます）")) return;
  let ns = null;
  try { ns = normalize(JSON.parse(readKey(KEY_PREV))); } catch (e) {}
  if (!ns) { dropKey(KEY_PREV); renderBackup(); return say("元に戻すデータが読めませんでした"); }
  if (!tryWrite(KEY, JSON.stringify(ns))) return say("端末の保存容量が足りず、戻せません。何も変わっていません");
  dropKey(KEY_PREV);
  state = ns; reindex(); onSaved();
  say("復元の前の状態に戻しました");
};
