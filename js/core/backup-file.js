"use strict";
// ===== バックアップの形と点検 =====
// 役割: バックアップ用ファイルの中身を作る（メール連携のURL・合言葉は入れない）と、読み込んだファイルを厳しく点検する（形・型・大きさ・カード番号らしい数字・危険なキー）。点検に通らなければ、理由を返すだけで何も変えない
// 依存: util.js, guard.js, model.js
// 実行時: なし
// 公開: MAX_BACKUP_BYTES, makeBackup, backupName, parseBackup

const BACKUP_APP = "cumulus";
const MAX_BACKUP_BYTES = 4 * 1024 * 1024;   // ファイルの大きさの上限
const MAX_ENTRIES = 30000, MAX_INVESTS = 10000, MAX_ITEMS = 200, MAX_TEXT = 2000;   // 件数・1つの文字の長さの上限
const BAD_KEYS = ["__proto__", "constructor", "prototype"];   // 入れてはいけないキー（プロトタイプ汚染）

// ---- 書き出し ----
// {app, v:データの版, at:書き出した日時, data:データ全体}。メール連携のURLと合言葉は含めない
function makeBackup(st, now) {
  const data = JSON.parse(JSON.stringify(st));
  delete data.mail.url; delete data.mail.token;
  return JSON.stringify({ app: BACKUP_APP, v: STATE_VERSION, at: now.toISOString(), data });
}
const backupName = (d) => "cumulus-backup-" + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + ".json";

// ---- 点検 ----
const isObj = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
const isNum = (x) => typeof x === "number" && Number.isFinite(x);
const isInt = (x, lo, hi) => Number.isInteger(x) && x >= lo && x <= hi;
// 全体を1回たどる：危険なキー・長すぎる文字・カード番号らしい文字・深すぎる入れ子・ありえない数。id と取り込み済みの目印（seen）は、アプリが作る文字なので番号らしさは見ない
function scan(v, depth, free, ctx) {
  if (++ctx.n > 500000) return "中身が多すぎます";
  if (depth > 8) return "入れ子が深すぎます";
  if (typeof v === "string") {
    if (v.length > MAX_TEXT) return "長すぎる文字があります";
    return !free && looksSensitive(v) ? SENSITIVE_MSG : "";
  }
  if (typeof v === "number") return Number.isFinite(v) ? "" : "数値が正しくありません";
  if (v === null || typeof v === "boolean") return "";
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) { const r = scan(v[i], depth + 1, free, ctx); if (r) return r; }
    return "";
  }
  if (typeof v !== "object") return "形が正しくありません";
  for (const k of Object.keys(v)) {
    if (BAD_KEYS.includes(k)) return "使えないキーが含まれています";
    const r = scan(v[k], depth + 1, free || k === "id" || k === "seen", ctx); if (r) return r;
  }
  return "";
}
// 各項目の型と範囲（normalize は直してしまうので、その前に、直さずに拒否するものを決める）
function checkShape(d) {
  if (!isObj(d)) return "データの形が正しくありません";
  if (!isNum(d.daily) || d.daily < 0 || d.daily > MAX_DAILY) return "1日あたりの金額が正しくありません";
  if (!isKey(d.start)) return "数え始める日が正しくありません";
  if (!Array.isArray(d.cards) || d.cards.length > MAX_CARDS) return "カードの数が正しくありません";
  for (const c of d.cards) {
    if (typeof c === "string") { if (!c) return "カードの形が正しくありません"; continue; }
    if (!isObj(c) || typeof c.name !== "string" || !c.name || !isInt(c.close, 0, 28) || !isInt(c.pay, 0, 28) || !isInt(c.months, 1, 2)) return "カードの形が正しくありません";
  }
  if (!Array.isArray(d.entries) || d.entries.length > MAX_ENTRIES) return "記録の数が正しくありません";
  for (const e of d.entries) {
    if (!isObj(e) || !isKey(e.date) || !Array.isArray(e.items) || e.items.length > MAX_ITEMS || !Object.keys(PAY).includes(e.pay)) return "記録の形が正しくありません";
    if (typeof e.store !== "string" || (e.card !== undefined && typeof e.card !== "string") || (e.id !== undefined && typeof e.id !== "string")) return "記録の形が正しくありません";
    for (const i of e.items) if (!isObj(i) || typeof i.n !== "string" || !isNum(i.p) || Math.abs(i.p) > MAX_PRICE * 10) return "品目の形が正しくありません";
  }
  if (!Array.isArray(d.invests) || d.invests.length > MAX_INVESTS) return "投資の記録の数が正しくありません";
  for (const v of d.invests) if (!isObj(v) || !isKey(v.date) || !isNum(v.amount) || v.amount <= 0 || (v.memo !== undefined && typeof v.memo !== "string")) return "投資の記録の形が正しくありません";
  const m = d.mail;
  if (m !== undefined) {
    if (!isObj(m) || (m.seen !== undefined && (!Array.isArray(m.seen) || m.seen.length > MAX_SEEN || m.seen.some((x) => typeof x !== "string")))) return "メール連携の設定の形が正しくありません";
    if ((m.last !== undefined && !isNum(m.last)) || (m.lastNote !== undefined && typeof m.lastNote !== "string") || (m.cards !== undefined && !isObj(m.cards))) return "メール連携の設定の形が正しくありません";
  }
  return "";
}
// 読み込んだ文字を点検して、使える状態にする。cur は、いま使っているメール連携の設定（URLと合言葉はバックアップに無いので、この端末の分を残す）
// 戻り値: {ok:true, state, at} か {ok:false, why}
function parseBackup(text, cur) {
  const no = (why) => ({ ok: false, why });
  if (typeof text !== "string" || text.length > MAX_BACKUP_BYTES) return no("ファイルが大きすぎます");
  let j;
  try { j = JSON.parse(text); } catch (e) { return no("バックアップのファイルではありません"); }
  if (!isObj(j) || j.app !== BACKUP_APP) return no("Cumulusのバックアップではありません");
  if (!Number.isInteger(j.v) || j.v < 1) return no("データの版が正しくありません");
  if (j.v > STATE_VERSION) return no("新しい版のバックアップです。アプリを新しくしてください");
  if (typeof j.at !== "string" || !Number.isFinite(Date.parse(j.at))) return no("書き出した日時が正しくありません");
  if (!isObj(j.data)) return no("データの形が正しくありません");
  const r = scan(j, 0, false, { n: 0 }) || checkShape(j.data);   // 全体（外側の項目も）をたどる
  if (r) return no(r);
  const d = j.data, st = normalize(d);
  if (st.entries.length !== d.entries.length || st.invests.length !== d.invests.length || st.cards.length !== d.cards.length) return no("読み取れない記録が含まれています");
  st.mail.url = cur && typeof cur.url === "string" ? cur.url : ""; st.mail.token = cur && typeof cur.token === "string" ? cur.token : "";   // URLと合言葉はバックアップに含まれない
  return { ok: true, state: st, at: j.at };
}
