from __future__ import annotations

import argparse
from pathlib import Path

from .converter import (
    SUPPORTED_DITHER_MODES,
    SUPPORTED_FIT_MODES,
    SUPPORTED_MAPPING_MODES,
    ConversionOptions,
    convert_path,
    render_palette_board,
    save_conversion,
)
from .palette import DEFAULT_PALETTE_ID, load_palette


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Convert an image to strict pixel art using a versioned fixed palette. "
            "The softer direct Pyxelate mapping is the default."
        )
    )
    parser.add_argument("input", type=Path, help="Source PNG/JPG/WebP image.")
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        help="Pixel PNG path. Default: <input>_<width>x<height>.png",
    )
    parser.add_argument(
        "--preview",
        type=Path,
        help="Nearest-neighbor preview path. Default: <input>_<width>x<height>_preview.png",
    )
    parser.add_argument("--width", type=int, default=24, help="Output width. Default: 24.")
    parser.add_argument("--height", type=int, default=24, help="Output height. Default: 24.")
    parser.add_argument(
        "--palette-id",
        default=DEFAULT_PALETTE_ID,
        help=f"Versioned palette id. Default: {DEFAULT_PALETTE_ID}.",
    )
    parser.add_argument(
        "--preview-scale",
        type=int,
        default=10,
        help="Preview enlargement factor. Default: 10.",
    )
    parser.add_argument(
        "--fit",
        choices=SUPPORTED_FIT_MODES,
        default="crop",
        help="crop: center-crop to target aspect; stretch: force the full image to target size.",
    )
    parser.add_argument(
        "--dither",
        choices=SUPPORTED_DITHER_MODES,
        default="none",
        help="Dithering mode. 'none' is recommended and is the default.",
    )
    parser.add_argument(
        "--mapping-mode",
        choices=SUPPORTED_MAPPING_MODES,
        default="direct",
        help=(
            "direct: full-palette Pyxelate mapping (default); "
            "two-stage: experimental automatic palette plus Hungarian mapping."
        ),
    )
    parser.add_argument(
        "--auto-colors",
        type=int,
        default=18,
        help="Automatic Pyxelate palette size for two-stage mode. Default: 18.",
    )
    parser.add_argument(
        "--cleanup-passes",
        type=int,
        default=2,
        help="Maximum isolated-pixel cleanup passes in two-stage mode. Default: 2.",
    )
    parser.add_argument(
        "--cleanup-delta-e",
        type=float,
        default=14.0,
        help="Maximum cleanup color difference in two-stage mode. Default: 14.",
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
        help="Optionally render a labeled palette board.",
    )
    return parser


def main(argv: list[str] | None = None) -> None:
    parser = build_parser()
    args = parser.parse_args(argv)

    if not args.input.is_file():
        parser.error(f"Input file does not exist: {args.input}")
    if args.preview_scale < 1:
        parser.error("--preview-scale must be at least 1")

    try:
        palette = load_palette(args.palette_id)
        options = ConversionOptions(
            width=args.width,
            height=args.height,
            fit=args.fit,
            dither=args.dither,
            sobel=args.sobel,
            depth=args.depth,
            svd=not args.no_svd,
            mapping_mode=args.mapping_mode,
            auto_colors=args.auto_colors,
            cleanup_passes=args.cleanup_passes,
            cleanup_delta_e=args.cleanup_delta_e,
        )
        options.validate(len(palette.colors))
    except (FileNotFoundError, ValueError) as error:
        parser.error(str(error))

    stem = args.input.stem
    size_suffix = f"{options.width}x{options.height}"
    output = args.output or args.input.with_name(f"{stem}_{size_suffix}.png")
    preview = args.preview or args.input.with_name(f"{stem}_{size_suffix}_preview.png")

    result = convert_path(args.input, options=options, palette=palette)
    save_conversion(
        result,
        output,
        preview,
        preview_scale=args.preview_scale,
    )

    print(f"Input:             {args.input.resolve()}")
    print(f"Pixel output:      {output.resolve()}")
    print(f"Preview:           {preview.resolve()}")
    print(f"Palette:           {result.palette_id} v{result.palette_version}")
    print(f"Converter version: {result.converter_version}")
    print(f"Mapping mode:      {result.mapping_mode}")
    if result.mapping_mode == "two-stage":
        print(f"Auto colors:       {result.learned_colors} / requested {options.auto_colors}")
        print(f"Cleanup:           {result.cleanup_changes} isolated pixels changed")
    print(f"Colors used:       {result.used_colors} / {len(palette.colors)}")
    print("Palette check:     passed (no out-of-palette RGB colors)")

    if args.board:
        render_palette_board(args.board, palette=palette)
        print(f"Palette board:     {args.board.resolve()}")
