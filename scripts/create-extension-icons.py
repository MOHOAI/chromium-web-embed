"""Create legible Chrome extension icons from the user-provided Moho artwork.

The source image contains generous white margins and a secondary Chrome mark.  The crop
keeps the primary Moho ribbon, then fits it into a blue rounded-square canvas so the mark
stays recognizable at Chrome's smallest 16 px toolbar size.
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

SOURCE = Path("/home/ubuntu/webdev-static-assets/moho-extension-mark.png")
OUTPUT = Path(__file__).resolve().parents[1] / "extension" / "icons"
SIZES = (16, 32, 48, 128)


def rounded_mask(size: int, radius: int) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=255)
    return mask


def make_icon(size: int) -> Image.Image:
    source = Image.open(SOURCE).convert("RGBA")
    # Remove the generated green backdrop while retaining cyan/blue/violet parts of the Moho mark.
    pixels = source.load()
    for y in range(source.height):
        for x in range(source.width):
            red, green, blue, alpha = pixels[x, y]
            is_green_backdrop = green > red * 1.22 and green > blue * 1.28
            is_dark_green_backdrop = green > red * 1.12 and green > blue * 1.12 and green < 105
            if is_green_backdrop or is_dark_green_backdrop:
                pixels[x, y] = (red, green, blue, 0)
    ribbon = source.crop((205, 410, 1715, 1505))
    ribbon.thumbnail((int(size * 0.9), int(size * 0.76)), Image.Resampling.LANCZOS)

    canvas = Image.new("RGBA", (size, size), (19, 35, 91, 255))
    glow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    glow_draw = ImageDraw.Draw(glow)
    glow_draw.ellipse((int(size * 0.08), int(size * 0.12), int(size * 0.92), int(size * 0.9)), fill=(83, 221, 255, 68))
    canvas = Image.alpha_composite(canvas, glow.filter(ImageFilter.GaussianBlur(max(1, size // 14))))

    x = (size - ribbon.width) // 2
    y = (size - ribbon.height) // 2
    canvas.alpha_composite(ribbon, (x, y))
    canvas.putalpha(rounded_mask(size, max(3, size // 5)))
    return canvas


def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    for size in SIZES:
        make_icon(size).save(OUTPUT / f"icon-{size}.png", format="PNG", optimize=True)


if __name__ == "__main__":
    main()
