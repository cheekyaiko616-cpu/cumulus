"use strict";
// ===== 大事な番号の混入を防ぐ =====
// 13〜19桁の数字（カード番号の長さ）や、長い数字の並びを含む文字は登録しない
const looksSensitive = (s) => /\d{13,19}/.test(String(s).replace(/[\s\-－ー]/g, "")) || /\d[\d -]{11,}\d/.test(String(s));
const SENSITIVE_MSG = "カード番号のような長い数字が含まれています。登録できません";
