"use strict";
// ===== レシートの写真を読みやすくする計算 =====
// 役割: 写真の向き（EXIF）・縮小の大きさ・白黒化（影に強い局所しきい値）の計算。画素の配列だけを扱う（canvas・写真の読み込みは features/receipt.js）
// 依存: なし
// 実行時: なし
// 公開: exifOrientation, jpegSize, orientMatrix, fitSize, toGray, binarize, despeckle

// JPEGの先頭部分（バイト列）から、EXIFの向き（1〜8）を読む。なければ1（そのまま）
function exifOrientation(u) {
  if (!u || u.length < 12 || u[0] !== 0xff || u[1] !== 0xd8) return 1;
  let p = 2;
  while (p + 4 < u.length) {
    if (u[p] !== 0xff) { p++; continue; }
    const m = u[p + 1];
    if (m === 0xff) { p++; continue; }
    if (m === 0xda || m === 0xd9) return 1;
    const len = (u[p + 2] << 8) | u[p + 3];
    if (m === 0xe1 && u[p + 4] === 0x45 && u[p + 5] === 0x78 && u[p + 6] === 0x69 && u[p + 7] === 0x66) {       // "Exif"
      const t = p + 10, le = u[t] === 0x49;
      const r16 = (o) => (le ? u[o] | (u[o + 1] << 8) : (u[o] << 8) | u[o + 1]);
      const r32 = (o) => (le ? u[o] + u[o + 1] * 256 + u[o + 2] * 65536 + u[o + 3] * 16777216 : u[o] * 16777216 + u[o + 1] * 65536 + u[o + 2] * 256 + u[o + 3]);
      const ifd = t + r32(t + 4);
      if (ifd + 2 > u.length) return 1;
      const n = r16(ifd);
      for (let i = 0; i < n; i++) {
        const e = ifd + 2 + i * 12;
        if (e + 12 > u.length) break;
        if (r16(e) === 0x0112) { const v = r16(e + 8); return v >= 1 && v <= 8 ? v : 1; }
      }
      return 1;
    }
    p += 2 + len;
  }
  return 1;
}
// JPEGの先頭部分から、保存されている画素の幅・高さを読む（向きの補正が済んでいるかの確かめ用）。読めなければ null
function jpegSize(u) {
  if (!u || u.length < 12 || u[0] !== 0xff || u[1] !== 0xd8) return null;
  let p = 2;
  while (p + 9 < u.length) {
    if (u[p] !== 0xff) { p++; continue; }
    const m = u[p + 1];
    if (m === 0xff) { p++; continue; }
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { w: (u[p + 7] << 8) | u[p + 8], h: (u[p + 5] << 8) | u[p + 6] };
    if (m === 0xda || m === 0xd9) return null;
    p += 2 + ((u[p + 2] << 8) | u[p + 3]);
  }
  return null;
}
// 向きoのとき、保存されている画素（w×h）を正しい向きに描く変換 [a,b,c,d,e,f]（ctx.setTransform用）と、直した後の幅・高さ
function orientMatrix(o, w, h) {
  const M = { 2: [-1, 0, 0, 1, w, 0], 3: [-1, 0, 0, -1, w, h], 4: [1, 0, 0, -1, 0, h], 5: [0, 1, 1, 0, 0, 0], 6: [0, 1, -1, 0, h, 0], 7: [0, -1, -1, 0, h, w], 8: [0, -1, 1, 0, 0, w] };
  return { m: M[o] || [1, 0, 0, 1, 0, 0], w: o >= 5 ? h : w, h: o >= 5 ? w : h };
}
// 長辺 maxSide・画素数 maxPix に収まる大きさ（拡大はしない）
function fitSize(w, h, maxSide, maxPix) {
  const k = Math.min(1, maxSide / Math.max(w, h), Math.sqrt(maxPix / (w * h)));
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}
// RGBA → 明るさ（0〜255）
function toGray(rgba, n) {
  const g = new Uint8Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) g[i] = (rgba[j] * 77 + rgba[j + 1] * 150 + rgba[j + 2] * 29) >> 8;
  return g;
}
// 影・照明のムラに強い白黒化：まわりの紙の明るさ（近くの一番明るい所をなめらかにしたもの）の t 倍より暗い画素を黒にする。
// 紙の明るさは B×B画素の区画に縮めた表で求めるので、元の大きさの積分画像を持たず、メモリも少ない。影の縁でも、近くの紙の明るさに合わせて決まる
// gray を白(255)と黒(0)に書き換える
function binarize(gray, w, h, opt) {
  const o = Object.assign({ B: 4, r: 0, t: 0.85 }, opt), B = o.B;
  const gw = Math.ceil(w / B), gh = Math.ceil(h / B), m = new Float32Array(gw * gh);
  for (let by = 0; by < gh; by++) for (let bx = 0; bx < gw; bx++) {
    let s = 0, c = 0;
    const y1 = Math.min(h, (by + 1) * B), x1 = Math.min(w, (bx + 1) * B);
    for (let y = by * B; y < y1; y++) for (let x = bx * B, i = y * w + x; x < x1; x++, i++) { s += gray[i]; c++; }
    m[by * gw + bx] = s / c;
  }
  const r = o.r || Math.max(3, Math.round(0.014 * Math.max(w, h) / B)), q = Math.max(1, r >> 1);   // 最大をとる半径・ぼかす半径（区画の数）
  const tmp = new Float32Array(gw * gh), M = new Float32Array(gw * gh);
  const pass = (src, dst, horizontal, rad, isMax) => {                                              // 横または縦に、最大またはぼかし
    const n1 = horizontal ? gw : gh, n2 = horizontal ? gh : gw;
    for (let a = 0; a < n2; a++) for (let b = 0; b < n1; b++) {
      let v = 0, c = 0;
      for (let k = Math.max(0, b - rad), e = Math.min(n1 - 1, b + rad); k <= e; k++) { const x = src[horizontal ? a * gw + k : k * gw + a]; if (isMax) { if (x > v) v = x; } else { v += x; c++; } }
      dst[horizontal ? a * gw + b : b * gw + a] = isMax ? v : v / c;
    }
  };
  pass(m, tmp, true, r, true); pass(tmp, M, false, r, true); pass(M, tmp, true, q, false); pass(tmp, M, false, q, false);
  // 画素ごとの紙の明るさは、区画の中心の値を縦横に補間して使う（区画の境目に段差が出ない）
  for (let y = 0; y < h; y++) {
    const fy = Math.min(gh - 1, Math.max(0, (y + 0.5) / B - 0.5)), y0 = Math.floor(fy), y1 = Math.min(gh - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(gw - 1, Math.max(0, (x + 0.5) / B - 0.5)), x0 = Math.floor(fx), x1 = Math.min(gw - 1, x0 + 1), tx = fx - x0;
      const bg = (M[y0 * gw + x0] * (1 - tx) + M[y0 * gw + x1] * tx) * (1 - ty) + (M[y1 * gw + x0] * (1 - tx) + M[y1 * gw + x1] * tx) * ty;
      gray[y * w + x] = gray[y * w + x] < bg * o.t ? 0 : 255;
    }
  }
  return gray;
}
// 白黒にした画像から、文字ではない黒を消す：小さすぎる点（机の模様・ノイズ）と、大きすぎるかたまり（紙の縁に沿った黒い縁取り・罫線）。黒い連結部分を行ごとの連なりで数えるので、メモリは少ない
function despeckle(g, w, h, minArea, maxDim) {
  let cap = 1 << 15, rs = new Int32Array(cap), re = new Int32Array(cap), n = 0;
  const rowAt = new Int32Array(h + 1);
  for (let y = 0; y < h; y++) {
    rowAt[y] = n;
    for (let x = 0, o = y * w; x < w;) {
      if (g[o + x] !== 0) { x++; continue; }
      const s = x; while (x < w && g[o + x] === 0) x++;
      if (n === cap) { cap *= 2; const a = new Int32Array(cap), b = new Int32Array(cap); a.set(rs); b.set(re); rs = a; re = b; }
      rs[n] = s; re[n] = x - 1; n++;
    }
  }
  rowAt[h] = n;
  const par = new Int32Array(n); for (let i = 0; i < n; i++) par[i] = i;
  const find = (i) => { while (par[i] !== i) { par[i] = par[par[i]]; i = par[i]; } return i; };
  for (let y = 1; y < h; y++) {
    let i = rowAt[y - 1];
    const ie = rowAt[y];
    for (let j = ie; j < rowAt[y + 1]; j++) {
      while (i < ie && re[i] < rs[j] - 1) i++;
      for (let k = i; k < ie && rs[k] <= re[j] + 1; k++) { const a = find(k), b = find(j); if (a !== b) par[a < b ? b : a] = a < b ? a : b; }
    }
  }
  const area = new Int32Array(n), x0 = new Int32Array(n).fill(1 << 30), x1 = new Int32Array(n), y0 = new Int32Array(n).fill(1 << 30), y1 = new Int32Array(n);
  for (let y = 0; y < h; y++) for (let i = rowAt[y]; i < rowAt[y + 1]; i++) {
    const r = find(i); area[r] += re[i] - rs[i] + 1;
    if (rs[i] < x0[r]) x0[r] = rs[i]; if (re[i] > x1[r]) x1[r] = re[i]; if (y < y0[r]) y0[r] = y; if (y > y1[r]) y1[r] = y;
  }
  for (let y = 0; y < h; y++) for (let i = rowAt[y]; i < rowAt[y + 1]; i++) {
    const r = find(i);
    if (area[r] < minArea || x1[r] - x0[r] + 1 > maxDim || y1[r] - y0[r] + 1 > maxDim) g.fill(255, y * w + rs[i], y * w + re[i] + 1);
  }
  return g;
}
