"use strict";
// ===== 画面の部品の基本の道具 =====
// 役割: 要素の取得・選択欄の中身・切り替えボタン（.seg）の「選択中」表示
// 依存: なし
// 実行時: なし
// 公開: $, fillOptions, setSeg

const $ = (id) => document.getElementById(id);
// <select> の中身を作る。list は [値, 表示] の並び
const fillOptions = (id, list) => { $(id).innerHTML = list.map(([v, t]) => '<option value="' + v + '">' + t + "</option>").join(""); };
// 切り替えボタンの「選択中」を合わせる。isOn(ボタン) が真のものを選択中にする
const setSeg = (box, isOn) => box.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", isOn(b)));
