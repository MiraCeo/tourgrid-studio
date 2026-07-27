from __future__ import annotations

from dataclasses import dataclass
from math import ceil, sqrt
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageOps
from pyxelate import Pal, Pyx
from scipy.optimize import linear_sum_assignment
from skimage.color import deltaE_ciede2000, rgb2lab

from . import CONVERTER_VERSION
from .palette import DEFAULT_PALETTE_ID, PaletteDefinition, load_palette


SUPPORTED_DITHER_MODES = ("none", "naive", "bayer", "floyd", "atkinson")
SUPPORTED_FIT_MODES = ("crop", "stretch")
SUPPORTED_MAPPING_MODES = ("direct", "two-stage")
RGBA_FIT_MAX_SAMPLES = 4096


@dataclass(frozen=True)
class ConversionOptions:
    width: int = 24
    height: int = 24
    fit: str = "crop"
    dither: str = "none"
    sobel: int = 3
    depth: int = 1
    svd: bool = True
    mapping_mode: str = "direct"
    auto_colors: int = 18
    cleanup_passes: int = 2
    cleanup_delta_e: float = 14.0

    def validate(self, palette_size: int) -> None:
        if self.width != 24 or self.height != 24:
            raise ValueError("output size is fixed at 24x24")
        if self.fit not in SUPPORTED_FIT_MODES:
            raise ValueError(f"Unsupported fit mode: {self.fit}")
        if self.dither not in SUPPORTED_DITHER_MODES:
            raise ValueError(f"Unsupported dither mode: {self.dither}")
        if self.mapping_mode not in SUPPORTED_MAPPING_MODES:
            raise ValueError(f"Unsupported mapping mode: {self.mapping_mode}")
        if self.sobel < 2:
            raise ValueError("sobel must be at least 2")
        if self.depth < 1:
            raise ValueError("depth must be at least 1")
        if not 2 <= self.auto_colors <= palette_size:
            raise ValueError(f"auto_colors must be between 2 and {palette_size}")
        if self.cleanup_passes < 0:
            raise ValueError("cleanup_passes cannot be negative")
        if self.cleanup_delta_e < 0:
            raise ValueError("cleanup_delta_e cannot be negative")


@dataclass(frozen=True)
class ConversionResult:
    width: int
    height: int
    palette_id: str
    palette_version: int
    converter_version: str
    used_color_ids: tuple[str, ...]
    pixels: list[list[str | None]]
    hex_pixels: list[list[str | None]]
    image: np.ndarray
    mapping_mode: str
    learned_colors: int | None = None
    cleanup_changes: int = 0

    @property
    def used_colors(self) -> int:
        return len(self.used_color_ids)


def crop_to_aspect(image: Image.Image, width: int, height: int) -> Image.Image:
    target_ratio = width / height
    source_ratio = image.width / image.height

    if source_ratio > target_ratio:
        crop_width = max(1, round(image.height * target_ratio))
        left = (image.width - crop_width) // 2
        return image.crop((left, 0, left + crop_width, image.height))

    crop_height = max(1, round(image.width / target_ratio))
    top = (image.height - crop_height) // 2
    return image.crop((0, top, image.width, top + crop_height))


def prepare_pillow_image(
    image: Image.Image,
    *,
    width: int,
    height: int,
    fit: str,
) -> np.ndarray:
    image = ImageOps.exif_transpose(image)
    has_alpha = image.mode in ("RGBA", "LA") or "transparency" in image.info
    image = image.convert("RGBA" if has_alpha else "RGB")

    if fit == "crop":
        image = crop_to_aspect(image, width, height)
    elif fit != "stretch":
        raise ValueError(f"Unsupported fit mode: {fit}")

    return np.asarray(image)


def load_source(
    path: Path,
    *,
    width: int = 24,
    height: int = 24,
    fit: str = "crop",
) -> np.ndarray:
    with Image.open(path) as opened:
        return prepare_pillow_image(opened, width=width, height=height, fit=fit)


def validate_palette(
    result: np.ndarray,
    palette: PaletteDefinition,
) -> tuple[set[tuple[int, int, int]], set[tuple[int, int, int]]]:
    allowed = set(palette.rgb_colors)
    rgb_pixels = result[..., :3].reshape(-1, 3)

    if result.shape[-1] == 4:
        opaque = result[..., 3].reshape(-1) > 0
        rgb_pixels = rgb_pixels[opaque]

    used = {tuple(map(int, pixel)) for pixel in rgb_pixels}
    return used, used - allowed


def lab_colors(rgb: np.ndarray) -> np.ndarray:
    rgb = np.asarray(rgb, dtype=np.float64).reshape(1, -1, 3) / 255.0
    return rgb2lab(rgb).reshape(-1, 3)


def palette_distance_matrix(palette: PaletteDefinition) -> np.ndarray:
    lab = lab_colors(np.asarray(palette.rgb_colors, dtype=np.uint8))
    return deltaE_ciede2000(lab[:, None, :], lab[None, :, :])


def map_auto_colors_to_fixed_palette(
    auto_result: np.ndarray,
    palette: PaletteDefinition,
) -> tuple[np.ndarray, np.ndarray, int]:
    rgb = auto_result[..., :3]
    flat = rgb.reshape(-1, 3)
    unique_rgb, inverse, counts = np.unique(
        flat,
        axis=0,
        return_inverse=True,
        return_counts=True,
    )

    if len(unique_rgb) > len(palette.colors):
        raise RuntimeError(
            f"Automatic stage produced {len(unique_rgb)} colors, "
            f"but palette {palette.palette_id} contains only {len(palette.colors)}."
        )

    source_lab = lab_colors(unique_rgb)
    target_rgb = np.asarray(palette.rgb_colors, dtype=np.uint8)
    target_lab = lab_colors(target_rgb)
    cost = deltaE_ciede2000(source_lab[:, None, :], target_lab[None, :, :])

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
    palette: PaletteDefinition,
    *,
    passes: int,
    max_palette_delta_e: float,
) -> tuple[np.ndarray, np.ndarray, int]:
    if passes <= 0:
        return mapped, labels, 0

    distances = palette_distance_matrix(palette)
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

    target_rgb = np.asarray(palette.rgb_colors, dtype=np.uint8)
    cleaned_rgb = target_rgb[current]
    if mapped.shape[-1] == 4:
        cleaned = np.dstack((cleaned_rgb, mapped[..., 3]))
    else:
        cleaned = cleaned_rgb

    return cleaned.astype(np.uint8), current, total_changes


def _build_pixel_matrices(
    image: np.ndarray,
    palette: PaletteDefinition,
) -> tuple[list[list[str | None]], list[list[str | None]]]:
    rgb_to_id = palette.rgb_to_id
    rgb_to_hex = palette.rgb_to_hex
    pixels: list[list[str | None]] = []
    hex_pixels: list[list[str | None]] = []

    for y in range(image.shape[0]):
        id_row: list[str | None] = []
        hex_row: list[str | None] = []
        for x in range(image.shape[1]):
            if image.shape[-1] == 4 and int(image[y, x, 3]) == 0:
                id_row.append(None)
                hex_row.append(None)
                continue

            rgb = tuple(map(int, image[y, x, :3]))
            try:
                id_row.append(rgb_to_id[rgb])
                hex_row.append(rgb_to_hex[rgb])
            except KeyError as error:
                raise RuntimeError(f"Cannot serialize out-of-palette color: {rgb}") from error
        pixels.append(id_row)
        hex_pixels.append(hex_row)

    return pixels, hex_pixels


def _opaque_rgb_fit_source(
    source: np.ndarray,
    *,
    min_samples: int,
    alpha_threshold: float = 0.6,
) -> np.ndarray:
    """Build a compact RGB training image without transparent background pixels."""
    visible_alpha = round(alpha_threshold * 255)
    visible_rgb = source[source[..., 3] >= visible_alpha, :3]
    if len(visible_rgb) == 0:
        visible_rgb = np.zeros((1, 3), dtype=np.uint8)

    max_samples = min(Pyx.BGM_RESIZE**2, RGBA_FIT_MAX_SAMPLES)
    if len(visible_rgb) > max_samples:
        indices = np.linspace(
            0,
            len(visible_rgb) - 1,
            max_samples,
            dtype=np.int64,
        )
        visible_rgb = visible_rgb[indices]

    side = ceil(sqrt(max(len(visible_rgb), min_samples + 1)))
    sample_indices = np.arange(side * side) % len(visible_rgb)
    return visible_rgb[sample_indices].reshape(side, side, 3)


def _fit_transform(
    converter: Pyx,
    source: np.ndarray,
    *,
    min_samples: int,
) -> np.ndarray:
    if source.shape[-1] == 3:
        return converter.fit_transform(source)

    # Pyxelate 2.1.1 reshapes RGBA input to a 1×N strip during fit, creating
    # many interpolated colors and extremely slow convergence. Train on only
    # visible RGB samples, then transform the original RGBA image so Pyxelate
    # still performs its normal edge dilation and alpha-mask reconstruction.
    converter.fit(
        _opaque_rgb_fit_source(
            source,
            min_samples=min_samples,
            alpha_threshold=converter.alpha,
        )
    )
    return converter.transform(source)


def convert_array(
    source: np.ndarray,
    *,
    options: ConversionOptions | None = None,
    palette: PaletteDefinition | None = None,
) -> ConversionResult:
    options = options or ConversionOptions()
    palette = palette or load_palette(DEFAULT_PALETTE_ID)
    options.validate(len(palette.colors))

    source = np.asarray(source)
    if source.ndim != 3 or source.shape[-1] not in (3, 4):
        raise ValueError("source must be an H×W RGB or RGBA image")
    if source.shape[0] < 1 or source.shape[1] < 1:
        raise ValueError("source image cannot be empty")

    if options.mapping_mode == "direct":
        converter = Pyx(
            width=options.width,
            height=options.height,
            palette=Pal.from_hex(palette.hex_colors),
            dither=options.dither,
            sobel=options.sobel,
            depth=options.depth,
            svd=options.svd,
        )
        result = _fit_transform(
            converter,
            source,
            min_samples=len(palette.colors),
        )
        learned_colors = None
        cleanup_changes = 0
    else:
        converter = Pyx(
            width=options.width,
            height=options.height,
            palette=options.auto_colors,
            dither=options.dither,
            sobel=options.sobel,
            depth=options.depth,
            svd=options.svd,
        )
        auto_result = _fit_transform(
            converter,
            source,
            min_samples=options.auto_colors,
        )
        mapped, labels, learned_colors = map_auto_colors_to_fixed_palette(
            auto_result,
            palette,
        )
        result, _cleaned_labels, cleanup_changes = cleanup_isolated_pixels(
            mapped,
            labels,
            palette,
            passes=options.cleanup_passes,
            max_palette_delta_e=options.cleanup_delta_e,
        )

    result = np.asarray(result, dtype=np.uint8)
    expected_shape = (options.height, options.width)
    if result.shape[:2] != expected_shape:
        raise RuntimeError(
            f"Converter returned {result.shape[1]}x{result.shape[0]}, "
            f"expected {options.width}x{options.height}"
        )

    used, unexpected = validate_palette(result, palette)
    if unexpected:
        formatted = ", ".join(
            "#{:02X}{:02X}{:02X}".format(*rgb) for rgb in sorted(unexpected)
        )
        raise RuntimeError(
            f"Output contains colors outside palette {palette.palette_id}: {formatted}"
        )

    pixels, hex_pixels = _build_pixel_matrices(result, palette)
    used_ids = tuple(color.color_id for color in palette.colors if color.rgb in used)

    return ConversionResult(
        width=options.width,
        height=options.height,
        palette_id=palette.palette_id,
        palette_version=palette.version,
        converter_version=CONVERTER_VERSION,
        used_color_ids=used_ids,
        pixels=pixels,
        hex_pixels=hex_pixels,
        image=result,
        mapping_mode=options.mapping_mode,
        learned_colors=learned_colors,
        cleanup_changes=cleanup_changes,
    )


def convert_pillow_image(
    image: Image.Image,
    *,
    options: ConversionOptions | None = None,
    palette: PaletteDefinition | None = None,
) -> ConversionResult:
    options = options or ConversionOptions()
    source = prepare_pillow_image(
        image,
        width=options.width,
        height=options.height,
        fit=options.fit,
    )
    return convert_array(source, options=options, palette=palette)


def convert_path(
    input_path: Path,
    *,
    options: ConversionOptions | None = None,
    palette: PaletteDefinition | None = None,
) -> ConversionResult:
    options = options or ConversionOptions()
    with Image.open(input_path) as opened:
        return convert_pillow_image(opened, options=options, palette=palette)


def save_conversion(
    result: ConversionResult,
    output_path: Path,
    preview_path: Path,
    *,
    preview_scale: int = 10,
) -> None:
    if preview_scale < 1:
        raise ValueError("preview_scale must be at least 1")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    preview_path.parent.mkdir(parents=True, exist_ok=True)

    pixel_image = Image.fromarray(result.image)
    pixel_image.save(output_path, "PNG", optimize=True)

    preview = pixel_image.resize(
        (result.width * preview_scale, result.height * preview_scale),
        Image.Resampling.NEAREST,
    )
    preview.save(preview_path, "PNG", optimize=True)


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


def render_palette_board(
    output_path: Path,
    *,
    palette: PaletteDefinition | None = None,
    columns: int = 8,
    cell: int = 128,
    gap: int = 8,
) -> None:
    palette = palette or load_palette(DEFAULT_PALETTE_ID)
    if columns < 1 or cell < 16 or gap < 0 or gap * 2 >= cell:
        raise ValueError("Invalid palette board layout")

    rows = (len(palette.colors) + columns - 1) // columns
    board = Image.new("RGB", (cell * columns, cell * rows), (48, 48, 48))
    draw = ImageDraw.Draw(board)
    id_font = load_font(max(13, cell // 9))
    hex_font = load_font(max(11, cell // 11))

    for index, color in enumerate(palette.colors):
        row, column = divmod(index, columns)
        x0 = column * cell + gap
        y0 = row * cell + gap
        x1 = (column + 1) * cell - gap - 1
        y1 = (row + 1) * cell - gap - 1
        ink = label_text_color(color.rgb)

        draw.rectangle((x0, y0, x1, y1), fill=color.rgb)
        draw.text(
            (x0 + 8, y0 + 7),
            f"{color.color_id}{'*' if color.confirmed else ''}",
            font=id_font,
            fill=ink,
        )
        draw.text(
            (x0 + 8, y1 - getattr(hex_font, "size", 11) - 8),
            color.hex,
            font=hex_font,
            fill=ink,
        )

    output_path.parent.mkdir(parents=True, exist_ok=True)
    board.save(output_path, "PNG", optimize=True)
