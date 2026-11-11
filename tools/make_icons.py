#!/usr/bin/env python3
"""アプリのアイコンを、手描きのスケッチ（tools/icon-source/original.jpg）から作る。

  pip install pillow numpy scipy scikit-image
  python3 tools/make_icons.py            # icons/ に書き出す
  python3 tools/make_icons.py OUT_DIR    # 別の場所に書き出す

やっていること
  1. 鉛筆の濃い線だけを取り出す（淡いハッチングと汚れは捨てる）。線をなめらかにして、同じ太さにそろえる
  2. 線で囲まれた面を調べ、面ごとに平らな1色で塗る（グラデーションなし）。背景は透明
  3. 大きく描いてから縮めて、縁をなめらかにする（透明部分に色のにじみが出ないよう、縮めるときは「不透明度を掛けた色」で計算する）
色は5色：線と矢印の緑 / 雲のうすいミント / ブタのピンク / コインの金 / （背景は透明）
"""
import sys, pathlib
import numpy as np
from PIL import Image
from scipy import ndimage as ndi
from skimage.morphology import disk, remove_small_objects

ROOT = pathlib.Path(__file__).resolve().parent
SRC = ROOT / "icon-source" / "original.jpg"
OUT = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT.parent / "icons"
S = 2                                   # 作業は2倍の大きさ（2048px）で行う

LINE = (23, 79, 66)                     # #174f42 線
ARROW = (29, 99, 82)                    # #1d6352 矢印
CLOUD = (248, 251, 250)                 # #f8fbfa 雲
PIG = (243, 170, 163)                   # #f3aaa3 ブタ
COIN = (217, 165, 32)                   # #d9a520 コイン
BG = (220, 235, 229)                    # #dcebe5 不透明のアイコンの背景（ホーム画面用・maskable用）

# 面の見分けに使う位置（元画像 1024px 上の座標）
SEEDS = {"coin": [(487, 204)], "pig": [(514, 308), (624, 223), (644, 311)], "cloud": [(412, 526), (635, 669), (600, 387)]}


def build():
    g = Image.open(SRC).convert("L").resize((1024 * S, 1024 * S), Image.LANCZOS)
    a = np.array(g).astype(float)
    line = a < 155                                             # 濃い線
    line = remove_small_objects(line, max_size=80 * S * S)     # 汚れ・細かいハッチングを除く
    line = ndi.binary_closing(line, structure=disk(2 * S))
    f = ndi.gaussian_filter(line.astype(float), 1.6 * S) > 0.42                # なめらかに
    f = ndi.binary_dilation(f, structure=disk(int(2.6 * S)))                   # 小さくても見える太さにそろえる
    f = ndi.gaussian_filter(f.astype(float), 1.2 * S) > 0.5
    # 小さな点（雲の縁のハッチングの名残）を除く。ブタの目・鼻の穴（絵の上のほう）は残す
    lab, n = ndi.label(f, structure=np.ones((3, 3)))
    for i, s in enumerate(ndi.find_objects(lab), 1):
        area = (lab[s] == i).sum() / (S * S)
        if area < 1000 and s[0].start / S > 340:
            f[lab == i] = False
    # 矢印のしっぽの口を線でふさぐ（面として塗れるように）
    ys, xs = np.nonzero(f[770 * S:, :260 * S]); ys = ys + 770 * S
    p1 = (xs[np.argmin(xs)], ys[np.argmin(xs)]); p2 = (xs[np.argmax(ys)], ys[np.argmax(ys)])
    cap = Image.new("L", f.shape[::-1], 0)
    from PIL import ImageDraw
    ImageDraw.Draw(cap).line([p1, p2], fill=255, width=int(2 * 2.6 * S + 2))
    f |= np.array(cap) > 0
    # 面ごとに塗る
    reg, m = ndi.label(~f)                                     # 4連結
    out_id = reg[0, 0]
    rgb = np.zeros(f.shape + (3,), np.uint8); alpha = np.zeros(f.shape, bool)
    alpha[:] = True; alpha[reg == out_id] = False              # 外側は透明
    _, (iy, ix) = ndi.distance_transform_edt(f, return_indices=True)           # 線の上に当たった位置は、いちばん近い面に寄せる
    def where(pt): return reg[iy[pt[1] * S, pt[0] * S], ix[pt[1] * S, pt[0] * S]]
    ids = {k: {where(p) for p in v} for k, v in SEEDS.items()}
    for r in range(1, m + 1):
        if r == out_id: continue
        col = ARROW                                            # どれにも当てはまらない面＝矢印の中
        for k, c in (("coin", COIN), ("pig", PIG), ("cloud", CLOUD)):
            if r in ids[k]: col = c
        rgb[reg == r] = col
    rgb[f] = LINE
    alpha |= f                                                 # 線は不透明
    # 線の外側（背景に接する側）も、線の色で終わる：外側の面を透明にしただけなので、縁は線の色になる
    return rgb, alpha


def to_rgba_premul(rgb, alpha):
    a = alpha.astype(np.float32)[..., None]
    return np.concatenate([rgb.astype(np.float32) * a, a], axis=2)   # 色×不透明度


def resize_premul(pm, size):
    chans = [np.array(Image.fromarray(pm[..., c]).resize(size, Image.LANCZOS)) for c in range(4)]
    out = np.stack(chans, axis=2)
    al = np.clip(out[..., 3], 0, 1)
    rgb = np.where(al[..., None] > 1e-4, out[..., :3] / np.maximum(al[..., None], 1e-4), 0)
    return np.clip(rgb, 0, 255), al


def compose(pm, size, fit, bg=None, circle=None):
    """絵を size×size の中央に置く。fit＝絵の長辺が占める割合。circle＝絵が収まるべき円の半径の割合（maskable用）"""
    ys, xs = np.nonzero(pm[..., 3] > 0.01)
    x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    art = pm[y0:y1, x0:x1]
    h, w = art.shape[:2]
    scale = size * fit / max(w, h)
    if circle:                                                 # 絵のどの点も、円の内側に入るように縮める
        cy, cx = (y0 + y1) / 2, (x0 + x1) / 2
        r = np.hypot(ys - cy, xs - cx).max()
        scale = min(scale, size * circle / r)
    nw, nh = max(1, round(w * scale)), max(1, round(h * scale))
    rgb, al = resize_premul(art, (nw, nh))
    canvas_rgb = np.zeros((size, size, 3), np.float32); canvas_a = np.zeros((size, size), np.float32)
    ox, oy = (size - nw) // 2, (size - nh) // 2
    canvas_rgb[oy:oy + nh, ox:ox + nw] = rgb; canvas_a[oy:oy + nh, ox:ox + nw] = al
    if bg is not None:                                         # 不透明にする（背景色に重ねる）
        res = canvas_rgb * canvas_a[..., None] + np.array(bg, np.float32) * (1 - canvas_a[..., None])
        return Image.fromarray(np.clip(res + 0.5, 0, 255).astype(np.uint8), "RGB")
    res = np.dstack([canvas_rgb, canvas_a * 255])
    return Image.fromarray(np.clip(res + 0.5, 0, 255).astype(np.uint8), "RGBA")


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    rgb, alpha = build()
    pm = to_rgba_premul(rgb, alpha)
    jobs = [
        ("icon-1024.png", compose(pm, 1024, 0.86)),                  # 透明の元データ
        ("icon-512.png", compose(pm, 512, 0.86)),                    # 透明（any）
        ("icon-192.png", compose(pm, 192, 0.86)),                    # 透明（any）
        ("icon-maskable-512.png", compose(pm, 512, 0.80, bg=BG, circle=0.40)),   # 不透明・安全領域（中央の円）に収める
        ("apple-touch-icon.png", compose(pm, 180, 0.74, bg=BG)),     # iPhoneのホーム画面用：不透明（透明だと黒になる）
        ("favicon-32.png", compose(pm, 32, 0.96)),                   # タブ用
    ]
    for name, im in jobs:
        # 色数の少ない平らな絵なので、大きい画像はパレット形式（128色）にして軽くする（見た目の差は0.3/255以下）。小さい画像（192px以下）はそのまま
        if im.size[0] >= 256:
            im = im.quantize(colors=128, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE)
        im.save(OUT / name, optimize=True)
        print("書き出し:", OUT / name, im.size, im.mode, (OUT / name).stat().st_size, "bytes")


if __name__ == "__main__":
    main()
