"use strict";
// ===== 大事な番号の混入を防ぐ =====
// 役割: カード番号・口座番号のような長い数字を含む文字を、見つける（登録・取り込みの前に使う）
// 依存: なし
// 実行時: なし
// 公開: looksSensitive, SENSITIVE_MSG

// 13〜19桁の数字（カード番号の長さ）や、長い数字の並びを含む文字は登録しない
const looksSensitive = (s) => /\d{13,19}/.test(String(s).replace(/[\s\-－ー]/g, "")) || /\d[\d -]{11,}\d/.test(String(s));
const SENSITIVE_MSG = "カード番号のような長い数字が含まれています。登録できません";
