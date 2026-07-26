from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageOps
from pyxelate import Pal, Pyx
from scipy.optimize import linear_sum_assignment
from skimage.color import deltaE_ciede2000, rgb2lab


# 24 colors marked True were sampled from the supplied palette screenshot.
# The remaining 40 colors extend the same warm, muted pixel-art style.
PALETTE = [
    # Neutral
    ("N01", "Black",           (34, 34, 34),    True),
    ("N02", "Charcoal",        (78, 74, 72),    False),
    ("N03", "Mid Gray",        (119, 115, 111), False),
    ("N04", "Soft Gray",       (180, 180, 180), True),
    ("N05", "Light Gray",      (208, 205, 200), False),
    ("N06", "Warm Gray",       (221, 210, 201), True),
    ("N07", "Ivory Gray",      (234, 230, 222), True),
    ("N08", "White",           (255, 255, 255), True),

    # Red / Pink
    ("R01", "Wine",            (107, 37, 48),   False),
    ("R02", "Deep Red",        (157, 10, 0),    True),
    ("R03", "Brick Red",       (168, 60, 54),   False),
    ("R04", "Natural Red",     (212, 47, 55),   True),
    ("R05", "Magenta Red",     (214, 10, 73),   True),
    ("R06", "Coral Red",       (228, 94, 104),  False),
    ("R07", "Salmon",          (229, 150, 141), True),
    ("R08", "Soft Red",        (242, 184, 176), False),

    # Skin / Peach
    ("S01", "Deep Skin",       (125, 74, 67),   False),
    ("S02", "Warm Skin",       (169, 103, 89),  False),
    ("S03", "Tan Skin",        (201, 133, 114), False),
    ("S04", "Peach Shadow",    (227, 160, 140), False),
    ("S05", "Coral Peach",     (255, 152, 116), True),
    ("S06", "Light Peach",     (243, 185, 165), False),
    ("S07", "Pale Pink",       (248, 208, 192), True),
    ("S08", "Blush White",     (252, 239, 232), True),

    # Orange / Yellow
    ("O01", "Dark Ochre",      (142, 74, 36),   False),
    ("O02", "Burnt Orange",    (212, 99, 34),   True),
    ("O03", "Earth Orange",    (213, 140, 65),  True),
    ("O04", "Amber",           (241, 153, 0),   True),
    ("O05", "Golden Yellow",   (249, 201, 50),  True),
    ("O06", "Pale Yellow",     (251, 229, 152), True),
    ("O07", "Cream Yellow",    (245, 234, 183), False),
    ("O08", "Cream White",     (251, 245, 231), True),

    # Green / Olive
    ("G01", "Deep Forest",     (57, 75, 50),    False),
    ("G02", "Forest Green",    (82, 110, 67),   False),
    ("G03", "Deep Olive",      (108, 109, 0),   True),
    ("G04", "Muted Green",     (115, 143, 80),  False),
    ("G05", "Natural Green",   (95, 158, 104),  False),
    ("G06", "Light Green",     (141, 187, 120), False),
    ("G07", "Sage Olive",      (179, 180, 123), True),
    ("G08", "Yellow Green",    (192, 218, 114), True),

    # Cyan / Blue
    ("C01", "Deep Teal",       (36, 76, 81),    False),
    ("C02", "Muted Teal",      (53, 110, 112),  False),
    ("C03", "Natural Cyan",    (76, 147, 145),  False),
    ("C04", "Soft Cyan",       (112, 179, 174), False),
    ("C05", "Mint",            (155, 207, 195), False),
    ("C06", "Steel Cyan",      (63, 127, 149),  False),
    ("C07", "Lake Blue",       (111, 175, 194), False),
    ("C08", "Pale Cyan",       (183, 221, 224), False),

    # Blue / Purple
    ("B01", "Blue Black",      (38, 51, 77),    False),
    ("B02", "Muted Navy",      (63, 95, 134),   False),
    ("B03", "Natural Blue",    (102, 141, 178), False),
    ("B04", "Pale Blue",       (169, 199, 218), False),
    ("V01", "Deep Mauve",      (77, 62, 92),    False),
    ("V02", "Muted Purple",    (115, 90, 130),  False),
    ("V03", "Soft Purple",     (154, 125, 168), False),
    ("V04", "Pale Lavender",   (198, 174, 201), False),

    # Brown / Earth
    ("BR01", "Dark Brown",     (62, 44, 39),    False),
    ("BR02", "Coffee",         (96, 70, 58),    False),
    ("BR03", "Natural Brown",  (128, 95, 74),   False),
    ("BR04", "Light Brown",    (155, 117, 92),  False),
    ("BR05", "Gray Brown",     (170, 143, 117), True),
    ("BR06", "Golden Brown",   (176, 145, 86),  True),
    ("BR07", "Sand",           (200, 173, 136), False),
    ("BR08", "Beige",          (225, 205, 171), True),
]


def palette_rgb() -> list[tuple[int, int, int]]:
    return [rgb for _color_id, _name, rgb, _confirmed in PALETTE]


def palette_hex() -> list[str]:
    return ["#{:02X}{:02X}{:02X}".format(*rgb) for rgb in palette_rgb()]


def center_crop_square(image: Image.Image) -> Image.Image:
    side = min(image.width, image.height)
    left = (image.width - side) // 2
    top = (image.height - side) // 2
    return image.crop((left, top, left + side, top + side))


def load_source(path: Path, fit: str) -> np.ndarray:
    with Image.open(path) as opened:
        image = ImageOps.exif_transpose(opened)
        has_alpha = image.mode in ("RGBA", "LA") or "transparency" in image.info
        image = image.convert("RGBA" if has_alpha else "RGB")

        if fit == "crop":
            image = center_crop_square(image)

        return np.asarray(image)


def validate_palette(result: np.ndarray) -> tuple[set[tuple[int, int, int]], set[tuple[int, int, int]]]:
    allowed = set(palette_rgb())
    rgb_pixels = result[..., :3].reshape(-1, 3)

    if result.shape[-1] == 4:
        opaque = result[..., 3].reshape(-1) > 0
        rgb_pixels = rgb_pixels[opaque]

    used = {tuple(map(int, pixel)) for pixel in rgb_pixels}
    unexpected = used - allowed
    return used, unexpected


def lab_colors(rgb: np.ndarray) -> np.ndarray:
    rgb = np.asarray(rgb, dtype=np.float64).reshape(1, -1, 3) / 255.0
    return rgb2lab(rgb).reshape(-1, 3)


def palette_distance_matrix() -> np.ndarray:
    lab = lab_colors(np.asarray(palette_rgb(), dtype=np.uint8))
    return deltaE_ciede2000(lab[:, None, :], lab[None, :, :])


def map_auto_colors_to_fixed_palette(
    auto_result: np.ndarray,
) -> tuple[np.ndarray, np.ndarray, int]:
    """
    Map Pyxelate's automatically learned colors to distinct colors in the fixed
    64-color palette.

    The Hungarian assignment is one-to-one, preventing several source shades
    from collapsing onto the same fixed color. Square-root frequency weighting
    favors important large regions without sacrificing small accent colors.
    """
    rgb = auto_result[..., :3]
    flat = rgb.reshape(-1, 3)
    unique_rgb, inverse, counts = np.unique(
        flat,
        axis=0,
        return_inverse=True,
        return_counts=True,
    )

    if len(unique_rgb) > len(PALETTE):
        raise RuntimeError(
            f"Automatic stage produced {len(unique_rgb)} colors, "
            f"but the fixed palette contains only {len(PALETTE)}."
        )

    source_lab = lab_colors(unique_rgb)
    target_rgb = np.asarray(palette_rgb(), dtype=np.uint8)
    target_lab = lab_colors(target_rgb)

    cost = deltaE_ciede2000(
        source_lab[:, None, :],
        target_lab[None, :, :],
    )

    weighted_cost = cost * np.sqrt(counts[:, None])
    source_rows, target_columns = linear_sum_assignment(weighted_cost)

    assignment = np.full(len(unique_rgb), -1, dtype=np.int16)
    assignment[source_rows] = target_columns
    if np.any(assignment < 0):
        raise RuntimeError("Hungarian palette assignment did not map every automatic color.")

    labels = assignment[inverse].reshape(rgb.shape[:2])
    mapped_rgb = target_rgb[labels]

    if auto_result.shape[-1] == 4:
        mapped = np.dstack((mapped_rgb, auto_result[..., 3]))
    else:
        mapped = mapped_rgb

    return mapped.astype(np.uint8), labels, len(unique_rgb)


def cleanup_isolated_pixels(
    mapped: np.ndarray,
    labels: np.ndarray,
    *,
    passes: int,
    max_palette_delta_e: float,
) -> tuple[np.ndarray, np.ndarray, int]:
    """
    Conservatively replace isolated pixels.

    A pixel changes only when at least three of its four orthogonal neighbors
    use the same palette color and the two palette colors are perceptually
    similar. High-contrast one-pixel details such as eyes remain protected.
    """
    if passes <= 0:
        return mapped, labels, 0

    distances = palette_distance_matrix()
    current = labels.copy()
    total_changes = 0
    height, width = current.shape

    for _ in range(passes):
        updated = current.copy()
        pass_changes = 0

        for y in range(height):
            for x in range(width):
                neighbors = []
                if y > 0:
                    neighbors.append(int(current[y - 1, x]))
                if y + 1 < height:
                    neighbors.append(int(current[y + 1, x]))
                if x > 0:
                    neighbors.append(int(current[y, x - 1]))
                if x + 1 < width:
                    neighbors.append(int(current[y, x + 1]))

                if len(neighbors) < 3:
                    continue

                values, counts = np.unique(neighbors, return_counts=True)
                majority_position = int(np.argmax(counts))
                majority = int(values[majority_position])
                majority_count = int(counts[majority_position])
                center = int(current[y, x])

                if (
                    majority_count >= 3
                    and center != majority
                    and distances[center, majority] <= max_palette_delta_e
                ):
                    updated[y, x] = majority
                    pass_changes += 1

        current = updated
        total_changes += pass_changes
        if pass_changes == 0:
            break

    target_rgb = np.asarray(palette_rgb(), dtype=np.uint8)
    cleaned_rgb = target_rgb[current]
    if mapped.shape[-1] == 4:
        cleaned = np.dstack((cleaned_rgb, mapped[..., 3]))
    else:
        cleaned = cleaned_rgb

    return cleaned.astype(np.uint8), current, total_changes


def convert_image(
    input_path: Path,
    output_path: Path,
    preview_path: Path,
    *,
    fit: str,
    preview_scale: int,
    dither: str,
    sobel_size: int,
    depth: int,
    svd: bool,
    auto_colors: int,
    cleanup_passes: int,
    cleanup_delta_e: float,
    mapping_mode: str,
) -> None:
    source = load_source(input_path, fit)

    if mapping_mode == "direct":
        converter = Pyx(
            width=24,
            height=24,
            palette=Pal.from_hex(palette_hex()),
            dither=dither,
            sobel=sobel_size,
            depth=depth,
            svd=svd,
        )
        result = converter.fit_transform(source)
        learned_colors = None
        cleanup_changes = 0
    else:
        converter = Pyx(
            width=24,
            height=24,
            palette=auto_colors,
            dither=dither,
            sobel=sobel_size,
            depth=depth,
            svd=svd,
        )

        auto_result = converter.fit_transform(source)
        mapped, labels, learned_colors = map_auto_colors_to_fixed_palette(auto_result)
        result, _cleaned_labels, cleanup_changes = cleanup_isolated_pixels(
            mapped,
            labels,
            passes=cleanup_passes,
            max_palette_delta_e=cleanup_delta_e,
        )
    used, unexpected = validate_palette(result)

    if unexpected:
        formatted = ", ".join("#{:02X}{:02X}{:02X}".format(*rgb) for rgb in sorted(unexpected))
        raise RuntimeError(f"Output contains colors outside the 64-color palette: {formatted}")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    preview_path.parent.mkdir(parents=True, exist_ok=True)

    pixel_image = Image.fromarray(result.astype(np.uint8))
    pixel_image.save(output_path, "PNG", optimize=True)

    preview = pixel_image.resize(
        (24 * preview_scale, 24 * preview_scale),
        Image.Resampling.NEAREST,
    )
    preview.save(preview_path, "PNG", optimize=True)

    print(f"Input:          {input_path.resolve()}")
    print(f"24x24 output:  {output_path.resolve()}")
    print(f"Preview:        {preview_path.resolve()}")
    print(f"Mapping mode:   {mapping_mode}")
    if mapping_mode == "direct":
        print(f"Colors used:    {len(used)} / {len(PALETTE)}")
    else:
        print(f"Auto colors:    {learned_colors} / requested {auto_colors}")
        print(f"Final colors:   {len(used)} / {len(PALETTE)}")
        print(f"Cleanup:        {cleanup_changes} isolated pixels changed")
    print("Palette check:  passed (no out-of-palette RGB colors)")


def label_text_color(rgb: tuple[int, int, int]) -> tuple[int, int, int]:
    luminance = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]
    return (30, 30, 30) if luminance >= 150 else (255, 255, 255)


def load_font(size: int) -> ImageFont.ImageFont:
    candidates = [
        Path(r"C:\Windows\Fonts\consola.ttf"),
        Path(r"C:\Windows\Fonts\arial.ttf"),
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"),
    ]
    for candidate in candidates:
        if candidate.exists():
            return ImageFont.truetype(str(candidate), size=size)
    return ImageFont.load_default()


def render_palette_board(output_path: Path, cell: int = 128, gap: int = 8) -> None:
    board = Image.new("RGB", (cell * 8, cell * 8), (48, 48, 48))
    draw = ImageDraw.Draw(board)
    id_font = load_font(max(13, cell // 9))
    hex_font = load_font(max(11, cell // 11))

    for index, (color_id, _name, rgb, confirmed) in enumerate(PALETTE):
        row, col = divmod(index, 8)
        x0 = col * cell + gap
        y0 = row * cell + gap
        x1 = (col + 1) * cell - gap - 1
        y1 = (row + 1) * cell - gap - 1
        ink = label_text_color(rgb)

        draw.rectangle((x0, y0, x1, y1), fill=rgb)
        draw.text(
            (x0 + 8, y0 + 7),
            f"{color_id}{'*' if confirmed else ''}",
            font=id_font,
            fill=ink,
        )
        draw.text(
            (x0 + 8, y1 - hex_font.size - 8),
            "#{:02X}{:02X}{:02X}".format(*rgb),
            font=hex_font,
            fill=ink,
        )

    output_path.parent.mkdir(parents=True, exist_ok=True)
    board.save(output_path, "PNG", optimize=True)
    print(f"Palette board:  {output_path.resolve()}")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Convert an image to strict 24x24 pixel art using the fixed 64-color "
            "palette. The softer legacy direct mapping is the default."
        )
    )
    parser.add_argument("input", type=Path, help="Source PNG/JPG/WebP image.")
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        help="24x24 PNG path. Default: <input>_24x24.png",
    )
    parser.add_argument(
        "--preview",
        type=Path,
        help="Nearest-neighbor preview path. Default: <input>_24x24_preview.png",
    )
    parser.add_argument(
        "--preview-scale",
        type=int,
        default=10,
        help="Preview enlargement factor. Default: 10.",
    )
    parser.add_argument(
        "--fit",
        choices=("crop", "stretch"),
        default="crop",
        help="crop: center-crop to square; stretch: keep the full image and force 24x24.",
    )
    parser.add_argument(
        "--dither",
        choices=("none", "naive", "bayer", "floyd", "atkinson"),
        default="none",
        help="Dithering mode. 'none' is recommended for 24x24.",
    )
    parser.add_argument(
        "--mapping-mode",
        choices=("direct", "two-stage"),
        default="direct",
        help=(
            "direct: legacy full-palette Pyxelate mapping (default); "
            "two-stage: experimental automatic palette plus Hungarian mapping."
        ),
    )
    parser.add_argument(
        "--auto-colors",
        type=int,
        default=18,
        help="Automatic Pyxelate palette size before fixed-palette mapping. Default: 18.",
    )
    parser.add_argument(
        "--cleanup-passes",
        type=int,
        default=2,
        help="Maximum conservative isolated-pixel cleanup passes. Default: 2.",
    )
    parser.add_argument(
        "--cleanup-delta-e",
        type=float,
        default=14.0,
        help="Maximum palette color difference eligible for isolated cleanup. Default: 14.",
    )
    parser.add_argument("--sobel", type=int, default=3, help="Pyxelate Sobel block size.")
    parser.add_argument("--depth", type=int, default=1, help="Pyxelate iteration depth.")
    parser.add_argument(
        "--no-svd",
        action="store_true",
        help="Disable Pyxelate's SVD low-pass preprocessing.",
    )
    parser.add_argument(
        "--board",
        type=Path,
        help="Optionally render the labeled 8x8 palette board.",
    )
    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()

    if len(PALETTE) != 64 or len(set(palette_rgb())) != 64:
        raise RuntimeError("The embedded palette must contain exactly 64 unique RGB colors.")
    if args.preview_scale < 1:
        parser.error("--preview-scale must be at least 1")
    if args.sobel < 2:
        parser.error("--sobel must be at least 2")
    if args.depth < 1:
        parser.error("--depth must be at least 1")
    if not 2 <= args.auto_colors <= 64:
        parser.error("--auto-colors must be between 2 and 64")
    if args.cleanup_passes < 0:
        parser.error("--cleanup-passes cannot be negative")
    if args.cleanup_delta_e < 0:
        parser.error("--cleanup-delta-e cannot be negative")
    if not args.input.is_file():
        parser.error(f"Input file does not exist: {args.input}")

    stem = args.input.stem
    output = args.output or args.input.with_name(f"{stem}_24x24.png")
    preview = args.preview or args.input.with_name(f"{stem}_24x24_preview.png")

    convert_image(
        args.input,
        output,
        preview,
        fit=args.fit,
        preview_scale=args.preview_scale,
        dither=args.dither,
        sobel_size=args.sobel,
        depth=args.depth,
        svd=not args.no_svd,
        auto_colors=args.auto_colors,
        cleanup_passes=args.cleanup_passes,
        cleanup_delta_e=args.cleanup_delta_e,
        mapping_mode=args.mapping_mode,
    )

    if args.board:
        render_palette_board(args.board)


if __name__ == "__main__":
    main()
