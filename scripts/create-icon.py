"""Create the multi-resolution Windows UEM application icon."""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "desktop" / "uem-icon.ico"
ADEPT_OUTPUT = ROOT / "desktop" / "adept-insignia.png"
FONT_CANDIDATES = [
    Path(r"C:\Windows\Fonts\seguisb.ttf"),
    Path(r"C:\Windows\Fonts\arialbd.ttf"),
]


def draw_icon(size: int) -> Image.Image:
    scale = 4
    canvas = size * scale
    image = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    factor = canvas / 256
    px = lambda value: round(value * factor)

    draw.rounded_rectangle((px(7), px(7), px(249), px(249)), radius=px(52), fill=(11, 18, 32, 255), outline=(64, 205, 232, 255), width=max(1, px(14)))
    draw.line((px(35), px(58), px(35), px(198)), fill=(66, 221, 232, 255), width=max(1, px(9)))
    draw.line((px(58), px(218), px(198), px(218)), fill=(118, 88, 244, 255), width=max(1, px(9)))
    font_path = next((candidate for candidate in FONT_CANDIDATES if candidate.exists()), None)
    font = ImageFont.truetype(str(font_path), px(67)) if font_path else ImageFont.load_default()
    text = "UEM"
    bounds = draw.textbbox((0, 0), text, font=font)
    text_width = bounds[2] - bounds[0]
    text_height = bounds[3] - bounds[1]
    draw.text(((canvas - text_width) / 2, px(129) - text_height / 2 - bounds[1]), text, font=font, fill=(248, 250, 252, 255))
    draw.ellipse((px(208), px(29), px(228), px(49)), fill=(85, 230, 240, 255))
    return image.resize((size, size), Image.Resampling.LANCZOS)


OUTPUT.parent.mkdir(parents=True, exist_ok=True)
largest = draw_icon(256)
largest.save(OUTPUT, format="ICO", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
print(f"Created {OUTPUT}")

adept_source = ROOT / "public" / "adept-icon-white.webp"
with Image.open(adept_source) as adept_image:
    adept_image.convert("RGBA").save(ADEPT_OUTPUT, format="PNG", optimize=True)
print(f"Created {ADEPT_OUTPUT}")
