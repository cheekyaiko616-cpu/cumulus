#!/usr/bin/env python3
"""使わなかった日の貯金箱（index.html のスプライト #i-saved）を、アプリアイコンの豚から作る。

  pip install pillow numpy scipy scikit-image opencv-python-headless
  python3 tools/make_saved_pig.py            # tools/icon-source/saved-pig.svg を書き出す（毎回同じ結果）
  python3 tools/make_saved_pig.py --png OUT  # 確認用に、塗りを実色にした PNG(512px幅) も OUT に書き出す

やっていること
  1. tools/make_icons.py の build()（アイコンと同じ平らな塗り分け）を呼び、豚とコインの面・線を取り出す
  2. 雲と矢印は捨てる（豚の足元の雲の線は、豚の面から一定の距離より外を切る）
  3. 縁線は元の線をなぞらず、豚とコインの面を一定の幅（LINE_W）だけ外へ広げた形から面を引いて作る
     （縁線が面にぴったり沿い、太さが一定。面との隙間・島・足元の浮いた線ができない）。しっぽだけは面がないので元の線を足す
  4. 面は線の下へ少し（FILL_UNDER）もぐらせ、線を最上段に重ねる（面と線の境目に背景が透けない）
  5. 「線」「豚」「コイン」の3つの形（穴つき）を輪郭追跡して、直線近似→なめらかな曲線にする
  6. 色は CSS の変数（--ill-line / --ill-pig / --ill-coin）。ライト・ダークの値は css/base.css にある
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
LINE_W = 2.6                                 # 縁線の太さ（viewBox の単位。高さ64）
TAIL_JOIN = 4.0                              # しっぽを胴の縁線につなぐ隙間埋めの半径（viewBox の単位）
FILL_UNDER = 1.0                             # 面を線の下へもぐらせる量（viewBox の単位）
PAD = 14                                     # まわりの余白（1024px基準）
TAIL_BOX = (290, 225, 380, 310)              # しっぽ（x0,y0,x1,y1; 1024px基準）。面に囲まれない線なので範囲で拾う
EPS = 2.0                                    # 直線近似の許容（作業px）


def masks():
    rgb, alpha = mi.build()
    pig = (rgb == mi.PIG).all(2)
    coin = (rgb == mi.COIN).all(2)
    line = (rgb == mi.LINE).all(2)
    x0, y0, x1, y1 = [v * S for v in TAIL_BOX]
    box = np.zeros_like(line); box[y0:y1, x0:x1] = True
    # 雲・矢印の線は豚から離れている。しっぽ（箱の中）以外は、面から遠い線を捨てる
    near = ndi.distance_transform_edt(~(pig | coin)) <= 40 * S
    old = line & (near | box)
    return pig, coin, line & box, old


def contours(mask):
    m = mask
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
    pig, coin, tail, old = masks()
    ys, xs = np.nonzero(old | pig | coin)
    x0, x1, y0, y1 = xs.min() - PAD * S, xs.max() + 1 + PAD * S, ys.min() - PAD * S, ys.max() + 1 + PAD * S
    k = H / (y1 - y0)
    W = (x1 - x0) * k
    px = lambda vu: vu / k                                    # viewBox 単位 → 作業px
    face = pig | coin
    # 縁線の外形＝面を LINE_W だけ広げた形（＋しっぽ）。目・鼻・耳の線・コインの口など面の間の細い隙間は、広げて埋まって線になる
    dface = ndi.distance_transform_edt(~face)
    outer = (dface <= px(LINE_W)) | tail
    # しっぽと胴の縁線の間（少し離れている）を、細かい隙間埋め（クロージング）でつなぐ。しっぽのまわりだけ
    bx0, by0, bx1, by1 = [v * S for v in TAIL_BOX]
    zone = np.zeros_like(outer); zone[by0 - 30 * S:by1 + 30 * S, bx0 - 30 * S:bx1 + 60 * S] = True
    r = int(px(TAIL_JOIN))
    yy, xx = np.ogrid[-r:r + 1, -r:r + 1]
    outer |= ndi.binary_closing(np.pad(outer, r), structure=(xx * xx + yy * yy <= r * r))[r:-r, r:-r] & zone
    outer = ndi.binary_fill_holes(outer)
    line = outer & ~face
    # 面は線の下へ少しもぐらせる（線が最上段で重なるので、境目に隙間ができない）
    fills = {"pig": (ndi.distance_transform_edt(~pig) <= px(FILL_UNDER)) & outer,
             "coin": (ndi.distance_transform_edt(~coin) <= px(FILL_UNDER)) & outer}
    out = []
    for role, m, minarea in (("pig", fills["pig"], 40), ("coin", fills["coin"], 20), ("line", line, 4)):
        ds = []
        for c in contours(m):
            d = smooth_path(c, k, x0, y0, minarea)
            if d:
                ds.append(d)
        out.append((role, "".join(ds)))
    fill = {"pig": "var(--ill-pig)", "coin": "var(--ill-coin)", "line": "var(--ill-line)"}
    body = "".join('<path fill="%s"%s d="%s"/>' % (fill[r], ' fill-rule="evenodd"', d) for r, d in out)
    build_svg.box = (x0, y0, x1, y1, pig, coin, line, old, outer)          # 確認用（compare スクリプトが使う）
    return '<symbol id="i-saved" viewBox="0 0 %.1f %.1f">%s</symbol>' % (W, H, body), W


if __name__ == "__main__":
    svg, W = build_svg()
    (ROOT / "icon-source" / "saved-pig.svg").write_text(svg + "\n", encoding="utf-8")
    print("viewBox %.1f x %.1f, %d bytes" % (W, H, len(svg.encode())))
