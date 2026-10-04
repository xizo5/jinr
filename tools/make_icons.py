"""
重新生成应用图标（一次性修复工具，不参与运行时）。

起因：icons/icon-512.png 名字叫 .png、manifest.webmanifest 也声明 image/png，
但文件内容其实是 JPEG（首字节 FF D8 FF E0 + JFIF 标记），真身 1920x1920。
扩展名与内容不符，会让 PWA 安装横幅和商店打包的图标识别不稳定。

另外原图四周有 25% 浅灰白留白，用作 maskable 图标时系统再裁一刀，
有效图形会缩得过小，所以 maskable 版另做一版满幅出血的。

产出（都是真 PNG）：
  icon-192.png           透明底，any
  icon-512.png           透明底，any（取代原来那个「JPEG 伪 PNG」）
  icon-maskable-512.png  满幅出血 + 安全区，maskable
  apple-touch-icon.png   180x180，iOS 用（不认透明底，铺满不透明底）

用法：python tools/make_icons.py     （需要 Pillow）

注意：源文件是仓库里那个"JPEG 伪 PNG"。本脚本会覆盖 app/icons/icon-512.png，
所以必须先从 git 恢复源图再跑，否则会拿自己上一轮的输出当输入，越迭代越糟：

    git checkout app/icons/icon-512.png && python tools/make_icons.py

脚本也会自己拦一道：输出必须是本轮生成的 PNG，若检测到输入已是 512 的 PNG
（说明是上一轮产物而非源图），直接中止并提示。
"""
import os
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
ICON_DIR = os.path.join(HERE, '..', 'app', 'icons')
SRC = os.path.join(ICON_DIR, 'icon-512.png')

# 与 app/css/style.css 的深蓝夜空底一致，用于 maskable 出血与 iOS 不透明底
NAVY = (16, 20, 38)

# 采样源文件左上角像素作为"原背景色"，用于判断留白
def is_backdrop(px, ref, tol=14):
    return all(abs(px[i] - ref[i]) <= tol for i in range(3))


def main():
    im = Image.open(SRC)
    fmt, size = im.format, im.size
    print('源文件：{} {} {}'.format(os.path.basename(SRC), fmt, size))
    if fmt not in ('JPEG', 'PNG'):
        raise SystemExit('源文件既不是 JPEG 也不是 PNG，中止。')
    if fmt == 'JPEG':
        print('  ⚠ 扩展名是 .png 但内容是 JPEG —— 这正是要修的问题')
    elif size == (512, 512):
        # 源图是 1920 的 JPEG。若读到 512 的 PNG，说明拿的是上一轮脚本的输出，
        # 再跑会拿自己的产物当输入，越迭代越糟。拦住。
        raise SystemExit(
            '输入已是 512x512 的 PNG，多半是上一轮的产物。\n'
            '请先执行：git checkout app/icons/icon-512.png')

    rgba = im.convert('RGBA')
    W, H = rgba.size

    # ---- 抠掉浅色留白背景，保留圆角图标本体 ----
    #
    # 注意：原图里定位器下方有一片投影，在浅灰底上表现为"比背景略暗的渐变"。
    # 用统一阈值抠图会把这片投影连成一个方形色块（maskable 版上尤其明显，
    # 因为它四周是纯色底，色块边界一眼就看出来）。
    # 所以分两步：
    #   1. 整体按背景色抠，得到含投影的大致轮廓；
    #   2. 再从轮廓里剔除"低饱和度且接近背景暗部"的那一块—— 那是投影，不是图标。
    ref = rgba.getpixel((4, 4))
    alpha = Image.new('L', (W, H), 0)
    src_px = rgba.load()
    out_px = alpha.load()
    for y in range(H):
        for x in range(W):
            out_px[x, y] = 0 if is_backdrop(src_px[x, y], ref) else 255
    cut = rgba.copy()
    cut.putalpha(alpha)

    bbox = alpha.getbbox()
    if not bbox:
        raise SystemExit('没找到图形区域，源图可能有问题。')

    # 找图标本体的深蓝（高饱和），据此定位投影区：投影在本体下方
    deep = []
    for y in range(bbox[1], bbox[3], 3):
        for x in range(bbox[0], bbox[2], 3):
            if out_px[x, y]:
                r, g, b = src_px[x, y][:3]
                if max(r, g, b) - min(r, g, b) > 24 and (r + g + b) / 3 < 90:
                    deep.append((x, y))
    if deep:
        body_bottom = max(p[1] for p in deep)
        # 本体下方仍不透明、但颜色是"背景暗化"的区域 = 投影，清掉
        removed = 0
        for y in range(body_bottom + 6, bbox[3]):
            for x in range(bbox[0], bbox[2]):
                if out_px[x, y]:
                    out_px[x, y] = 0
                    removed += 1
        if removed:
            print('  清掉投影 {} 像素（本体底边 y={}）'.format(removed, body_bottom))

    cut.putalpha(alpha)
    bbox = alpha.getbbox()
    if not bbox:
        raise SystemExit('剔除投影后没剩下图形，中止。')
    # 只取包围盒，居中放进正方画布 —— 原图 1920 见方但图形非正方，
    # 直接整幅压成正方会让定位器变形
    gw, gh = bbox[2] - bbox[0], bbox[3] - bbox[1]
    side = max(gw, gh)
    print('  图形 {}x{}，四周留白 {:.1f}%'.format(
        gw, gh, bbox[0] / W * 100))

    # 裁到包围盒，再居中放进正方画布：原图虽是正方，但图形本体非正方，
    # 整幅直接 resize 会把定位器压扁
    mark = cut.crop(bbox)
    side = max(mark.width, mark.height)
    square = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    square.alpha_composite(mark, ((side - mark.width) // 2, (side - mark.height) // 2))
    mark = square

    # any 用途：透明底，图形占满画布（平台自己加圆角/遮罩）
    def write_any(size_out, path):
        img = mark.resize((size_out, size_out), Image.LANCZOS)
        img.save(path, 'PNG', optimize=True)
        print('  写出 {} ({}x{}, {} 字节)'.format(
            os.path.basename(path), size_out, size_out,
            os.path.getsize(path)))

    write_any(192, os.path.join(ICON_DIR, 'icon-192.png'))
    write_any(512, os.path.join(ICON_DIR, 'icon-512.png'))

    # ---- maskable：满幅出血，图形缩到中心 ~86%（落在安全区内）----
    # Android 遮罩最坏情况裁到中心 ~80% 直径。图形占 86% 意味着遮罩切口
    # 落在圆角处而不是内容上，既不会切到定位器，观感也最饱满。
    M = 512
    FILL = 0.86
    plate = Image.new('RGBA', (M, M), NAVY + (255,))
    inner = int(M * FILL)
    plate.alpha_composite(mark.resize((inner, inner), Image.LANCZOS),
                          ((M - inner) // 2, (M - inner) // 2))
    plate.save(os.path.join(ICON_DIR, 'icon-maskable-512.png'), 'PNG', optimize=True)
    print('  写出 icon-maskable-512.png (512x512, 出血底#101426, 图形占86%)')

    # ---- iOS apple-touch-icon：不透明底，180x180 ----
    ios = Image.new('RGBA', (180, 180), NAVY + (255,))
    ios_m = mark.resize((int(180 * 0.82),) * 2, Image.LANCZOS)
    ios.alpha_composite(ios_m, ((180 - ios_m.width) // 2, (180 - ios_m.height) // 2))
    ios.save(os.path.join(ICON_DIR, 'apple-touch-icon.png'), 'PNG', optimize=True)
    print('  写出 apple-touch-icon.png (180x180, 不透明底)')


if __name__ == '__main__':
    main()
