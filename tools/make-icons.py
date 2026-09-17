"""Иконки приложения без внешних ресурсов: янтарный градиент + тёмная гантель.

Запуск:  python tools/make-icons.py
Кладёт рядом с index.html: icon-192.png, icon-512.png, apple-touch-icon.png.
Масштаб рисуется в 4× и уменьшается — края получаются гладкими.
"""
from PIL import Image, ImageDraw

TOP = (255, 194, 75)      # --accent start (#ffc24b)
BOTTOM = (255, 95, 31)    # --accent end   (#ff5f1f)
INK = (27, 14, 2)         # --accent-ink
SS = 4                    # супер-сэмплинг


def gradient(size: int) -> Image.Image:
    img = Image.new("RGB", (1, size))
    draw = ImageDraw.Draw(img)
    for y in range(size):
        t = y / max(size - 1, 1)
        draw.point((0, y), fill=tuple(round(TOP[i] + (BOTTOM[i] - TOP[i]) * t) for i in range(3)))
    return img.resize((size, size), Image.BILINEAR)


def plates(draw: ImageDraw.ImageDraw, size: int) -> None:
    """Гантель по центру: гриф + две пары блинов. Внутри safe zone maskable."""
    cx, cy = size / 2, size / 2
    bar_w, bar_h = size * 0.62, size * 0.075
    draw.rounded_rectangle(
        [cx - bar_w / 2, cy - bar_h / 2, cx + bar_w / 2, cy + bar_h / 2],
        radius=bar_h / 2,
        fill=INK,
    )
    outer_w, outer_h = size * 0.13, size * 0.36
    inner_w, inner_h = size * 0.09, size * 0.24
    for side in (-1, 1):
        x_out = cx + side * (bar_w / 2 - outer_w * 0.55)
        draw.rounded_rectangle(
            [x_out - outer_w / 2, cy - outer_h / 2, x_out + outer_w / 2, cy + outer_h / 2],
            radius=outer_w * 0.34,
            fill=INK,
        )
        x_in = cx + side * (bar_w / 2 - outer_w * 0.55 - inner_w * 1.25)
        draw.rounded_rectangle(
            [x_in - inner_w / 2, cy - inner_h / 2, x_in + inner_w / 2, cy + inner_h / 2],
            radius=inner_w * 0.34,
            fill=INK,
        )


def make_icon(size: int) -> Image.Image:
    big = size * SS
    img = gradient(big).convert("RGBA")
    plates(ImageDraw.Draw(img), big)
    return img.resize((size, size), Image.LANCZOS)


if __name__ == "__main__":
    import pathlib

    root = pathlib.Path(__file__).resolve().parent.parent
    for name, size in (("icon-192.png", 192), ("icon-512.png", 512), ("apple-touch-icon.png", 180)):
        path = root / name
        make_icon(size).save(path, optimize=True)
        print(f"{path.name}: {size}×{size}, {path.stat().st_size} байт")
