from __future__ import annotations

import hashlib
import json
from pathlib import Path

from PIL import Image, ImageDraw


FIXTURE_DIR = Path(__file__).resolve().parent


def save(image: Image.Image, name: str) -> dict[str, object]:
    path = FIXTURE_DIR / name
    image.save(path, "PNG", optimize=True)
    return {
        "file": name,
        "mode": image.mode,
        "size": list(image.size),
        "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
    }


def avatar_reference() -> Image.Image:
    image = Image.new("RGB", (256, 256), "#C7D8D5")
    draw = ImageDraw.Draw(image)
    draw.ellipse((28, 18, 228, 226), fill="#5D4643")
    draw.ellipse((53, 45, 203, 217), fill="#E9B59E")
    draw.polygon([(38, 88), (72, 30), (108, 70), (146, 24), (218, 101)], fill="#6B4B45")
    draw.ellipse((83, 111, 104, 132), fill="#FFFFFF")
    draw.ellipse((152, 111, 173, 132), fill="#FFFFFF")
    draw.ellipse((90, 116, 100, 130), fill="#4E4A48")
    draw.ellipse((159, 116, 169, 130), fill="#4E4A48")
    draw.arc((107, 133, 150, 170), start=15, end=165, fill="#A83C36", width=5)
    draw.rectangle((78, 190, 178, 229), fill="#F2B8B0")
    draw.rectangle((87, 181, 169, 198), fill="#F8D0C0")
    draw.ellipse((120, 168, 139, 190), fill="#D42F37")
    draw.line((129, 169, 129, 156), fill="#7B7A48", width=4)
    return image


def transparent_subject() -> Image.Image:
    image = Image.new("RGBA", (192, 192), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.ellipse((18, 18, 174, 174), fill=(60, 130, 150, 110))
    draw.rectangle((54, 48, 138, 150), fill=(229, 150, 141, 220))
    draw.polygon([(96, 25), (150, 105), (42, 105)], fill=(214, 47, 55, 255))
    draw.ellipse((73, 92, 86, 105), fill=(34, 34, 34, 255))
    draw.ellipse((106, 92, 119, 105), fill=(34, 34, 34, 255))
    return image


def landscape_scene() -> Image.Image:
    image = Image.new("RGB", (360, 180), "#7CB8C8")
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 100, 360, 180), fill="#607C4E")
    draw.ellipse((260, 20, 320, 80), fill="#E9C85A")
    draw.polygon([(0, 130), (95, 45), (175, 130)], fill="#526B6E")
    draw.polygon([(100, 130), (225, 32), (360, 130)], fill="#77736F")
    draw.rectangle((150, 105, 205, 160), fill="#A96759")
    draw.polygon([(140, 108), (178, 75), (215, 108)], fill="#9D0A00")
    return image


def portrait_scene() -> Image.Image:
    image = Image.new("RGB", (180, 360), "#EAE6DE")
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 245, 180, 360), fill="#4F825F")
    draw.rectangle((75, 88, 105, 310), fill="#7D4A43")
    for center, radius, color in [
        ((55, 80), 45, "#D42F37"),
        ((122, 95), 52, "#E5968D"),
        ((82, 145), 56, "#8BA35A"),
    ]:
        x, y = center
        draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=color)
    return image


def large_pattern() -> Image.Image:
    width, height = 4096, 3072
    image = Image.new("RGB", (width, height), "#EAE6DE")
    draw = ImageDraw.Draw(image)
    block = 256
    colors = ["#222222", "#D42F37", "#E9C85A", "#4F825F", "#438A9A", "#675A8E"]
    for y in range(0, height, block):
        for x in range(0, width, block):
            color = colors[((x // block) + (y // block)) % len(colors)]
            draw.rectangle((x, y, x + block - 1, y + block - 1), fill=color)
    draw.ellipse((1100, 600, 3000, 2500), outline="#FFFFFF", width=180)
    return image


def main() -> None:
    fixtures = [
        save(avatar_reference(), "avatar-reference-synthetic.png"),
        save(transparent_subject(), "transparent-subject.png"),
        save(landscape_scene(), "landscape-scene.png"),
        save(portrait_scene(), "portrait-scene.png"),
        save(large_pattern(), "large-pattern.png"),
    ]
    manifest = {
        "version": 1,
        "generator": "tests/fixtures/generate_visual_fixtures.py",
        "avatarNotice": (
            "The original project avatar was not present in the repository. "
            "avatar-reference-synthetic.png is a deterministic stand-in and "
            "must not be represented as the original user image."
        ),
        "fixtures": fixtures,
    }
    (FIXTURE_DIR / "manifest.json").write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
