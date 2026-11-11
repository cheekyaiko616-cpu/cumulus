#!/usr/bin/env python3
"""使わなかった日の貯金箱（index.html のスプライト #i-saved）を、アプリアイコンの豚から作る。

  pip install pillow numpy scipy scikit-image opencv-python-headless
  python3 tools/make_saved_pig.py            # tools/icon-source/saved-pig.svg を書き出す（毎回同じ結果）
  python3 tools/make_saved_pig.py --png OUT  # 確認用に、塗りを実色にした PNG(512px幅) も OUT に書き出す

やっていること
  1. tools/make_icons.py の build()（アイコンと同じ平らな塗り分け）を呼び、豚とコインの面・線を取り出す
  2. 雲と矢印は捨てる（豚の足元の雲の線は、豚の面から一定の距離より外を切る）
  3. 「線」「豚」「コイン」の3つの形（穴つき）を輪郭追跡して、直線近似→なめらかな曲線にする
  4. 小さい表示でも読めるよう、線をほんの少し太らせる（OUTLINE_GROW）
  5. 色は CSS の変数（--ill-line / --ill-pig / --ill-coin）。ライト・ダークの値は css/base.css にある
できた <symbol> を index.html のスプライトの id="i-saved" と差し替える
"""
import sys, pathlib
import numpy as np
import cv2
from scipy import ndimage as ndi

ROOT = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
import make_icons as mi                      # noqa: E402  (アイコン作りの塗り分けをそのまま使う)

S = mi.S                                     # 作業の倍率（2048px）
H = 64.0                                     # viewBox の高さ
OUTLINE_GROW = 0.8                           # 線を太らせる量（1024px基準のpx）
PAD = 14                                     # まわりの余白（1024px基準）
FOOT_LINE = 8                                # 足の面の下に残す線の太さ（1024px基準）。それより下は雲の線なので切る
KEEP_NEAR = 22                               # 豚・コインの面からこの距離（1024px基準）までの線だけ残す
TAIL_BOX = (290, 225, 380, 310)              # しっぽ（x0,y0,x1,y1; 1024px基準）。面に囲まれない線なので範囲で拾う
EPS = 2.0                                    # 直線近似の許容（作業px）


def masks():
    rgb, alpha = mi.build()
    pig = (rgb == mi.PIG).all(2)
    coin = (rgb == mi.COIN).all(2)
    line = (rgb == mi.LINE).all(2)
    near = ndi.distance_transform_edt(~(pig | coin)) <= KEEP_NEAR * S
    x0, y0, x1, y1 = [v * S for v in TAIL_BOX]
    box = np.zeros_like(line); box[y0:y1, x0:x1] = True
    # 足の下：豚の面の最下端（左右20px以内の最大）より FOOT_LINE 下を切る
    low = np.where(pig.any(0), pig.shape[0] - 1 - np.argmax(pig[::-1], axis=0), -1)
    low = ndi.maximum_filter1d(low, size=2 * 20 * S + 1)
    below = np.arange(pig.shape[0])[:, None] > (low + FOOT_LINE * S)[None, :]
    line = line & (near | box) & (~below | box)
    # 豚の面の下（足・雲の線）：雲の線が足にくっついた部分を、足の高さで切る
    return pig, coin, line


def contours(mask, grow=0.0):
    m = mask
    if grow:
        m = ndi.distance_transform_edt(~m) <= grow * S
    m = ndi.gaussian_filter(m.astype(float), 1.5 * S) > 0.5       # 輪郭のギザギザをならす
    cs, hier = cv2.findContours(m.astype(np.uint8), cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
    return cs


def smooth_path(c, k, ox, oy, min_area):
    """輪郭点列 → 直線近似 → 辺の中点をつなぐ2次ベジェにした閉じたパス文字列"""
    area = abs(cv2.contourArea(c)) / (S * S)
    if area < min_area:
        return ""
    a = cv2.approxPolyDP(c, EPS, True).reshape(-1, 2).astype(float)
    if len(a) < 3:
        return ""
    p = (a - [ox, oy]) * k
    n = len(p)
    f = lambda v: ("%.1f" % v).rstrip("0").rstrip(".") if "." in "%.1f" % v else "%.1f" % v
    mid = lambda i: (p[i % n] + p[(i + 1) % n]) / 2
    d = "M%s %s" % (f(mid(0)[0]), f(mid(0)[1]))
    for i in range(1, n + 1):                 # 頂点を制御点、辺の中点を通る2次ベジェ（はみ出さずなめらか）
        q = p[i % n]; e = mid(i)
        d += "Q%s %s %s %s" % tuple(f(v) for v in (*q, *e))
    return d + "Z"


def build_svg():
    pig, coin, line = masks()
    ink = line | pig | coin
    # コインの上端はキャップ状の線の上にあるので、線の外側（背景）に接する面は透明のまま
    ys, xs = np.nonzero(ink)
    x0, x1, y0, y1 = xs.min() - PAD * S, xs.max() + 1 + PAD * S, ys.min() - PAD * S, ys.max() + 1 + PAD * S
    k = H / (y1 - y0)
    W = (x1 - x0) * k
    pigm = ndi.binary_fill_holes(pig | coin | line) & ~line      # 線の内側（豚）
    # 太った線の下に隠れる分だけ、塗りは線の下まで広げる（線が上に重なる）
    fills = {"pig": pig | (ndi.binary_dilation(pig, iterations=2 * S) & line), "coin": coin | (ndi.binary_dilation(coin, iterations=2 * S) & line)}
    out = []
    for role, m, grow, minarea in (("pig", fills["pig"], 0, 40), ("coin", fills["coin"], 0, 20), ("line", line, OUTLINE_GROW, 4)):
        ds = []
        cs = contours(m, grow)
        hier = None
        # 穴つきにするため evenodd で1本のパスにまとめる
        for c in cs:
            d = smooth_path(c, k, x0, y0, minarea)
            if d:
                ds.append(d)
        out.append((role, "".join(ds)))
    fill = {"pig": "var(--ill-pig)", "coin": "var(--ill-coin)", "line": "var(--ill-line)"}
    body = "".join('<path fill="%s"%s d="%s"/>' % (fill[r], ' fill-rule="evenodd"', d) for r, d in out)
    build_svg.box = (x0, y0, x1, y1, pig, coin, line)          # 確認用（compare スクリプトが使う）
    return '<symbol id="i-saved" viewBox="0 0 %.1f %.1f">%s</symbol>' % (W, H, body), W


if __name__ == "__main__":
    svg, W = build_svg()
    (ROOT / "icon-source" / "saved-pig.svg").write_text(svg + "\n", encoding="utf-8")
    print("viewBox %.1f x %.1f, %d bytes" % (W, H, len(svg.encode())))
