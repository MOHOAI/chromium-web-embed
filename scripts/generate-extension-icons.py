from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

SOURCE = Path("/home/ubuntu/upload/Gemini_Generated_Image_osa8nxosa8nxosa8.jpg")
DESTINATION = Path("/home/ubuntu/chromium-web-embed/extension/icons")
SIZES = (16, 32, 48, 128)


def make_icon(size: int) -> Image.Image:
    # This crop preserves the blue-violet ribbon and Chrome mark while removing excess whitespace.
    source = Image.open(SOURCE).convert("RGB")
    artwork = source.crop((125, 155, 905, 885)).resize((size, size), Image.Resampling.LANCZOS)
    artwork = artwork.filter(ImageFilter.UnsharpMask(radius=max(0.5, size / 64), percent=115, threshold=2))

    canvas = Image.new("RGBA", (size, size), (12, 22, 58, 255))
    mask = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(mask)
    radius = max(2, round(size * 0.20))
    draw.rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=255)

    framed = Image.new("RGBA", (size, size), (255, 255, 255, 255))
    framed.alpha_composite(artwork.convert("RGBA"))
    canvas.alpha_composite(framed)
    canvas.putalpha(mask)
    return canvas


def main() -> None:
    if not SOURCE.exists():
        raise FileNotFoundError(f"Missing supplied icon image: {SOURCE}")
    DESTINATION.mkdir(parents=True, exist_ok=True)
    for size in SIZES:
        make_icon(size).save(DESTINATION / f"icon-{size}.png", "PNG", optimize=True)
    print("Generated Chrome extension icons:", ", ".join(str(DESTINATION / f"icon-{size}.png") for size in SIZES))


if __name__ == "__main__":
    main()
