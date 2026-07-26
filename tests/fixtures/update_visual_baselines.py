from __future__ import annotations

import hashlib
import json
from pathlib import Path

from PIL import Image

from backend.converter import ConversionOptions, convert_path, save_conversion


FIXTURE_DIR = Path(__file__).resolve().parent
BASELINE_DIR = FIXTURE_DIR / "baselines"


def main() -> None:
    BASELINE_DIR.mkdir(exist_ok=True)
    manifest = json.loads((FIXTURE_DIR / "manifest.json").read_text(encoding="utf-8"))
    baselines: dict[str, object] = {}
    options = ConversionOptions()

    for fixture in manifest["fixtures"]:
        source = FIXTURE_DIR / fixture["file"]
        result = convert_path(source, options=options)
        stem = source.stem
        raw = BASELINE_DIR / f"{stem}-24x24.png"
        preview = BASELINE_DIR / f"{stem}-preview.png"
        save_conversion(result, raw, preview, preview_scale=10)
        with Image.open(raw) as image:
            pixels = image.convert("RGB").tobytes()
        baselines[fixture["file"]] = {
            "pixelSha256": hashlib.sha256(pixels).hexdigest(),
            "usedColors": result.used_colors,
            "usedColorIds": list(result.used_color_ids),
            "raw": raw.relative_to(FIXTURE_DIR).as_posix(),
            "preview": preview.relative_to(FIXTURE_DIR).as_posix(),
        }

    payload = {
        "version": 1,
        "converterOptions": {
            "width": options.width,
            "height": options.height,
            "fit": options.fit,
            "dither": options.dither,
            "sobel": options.sobel,
            "depth": options.depth,
            "svd": options.svd,
            "mappingMode": options.mapping_mode,
        },
        "baselines": baselines,
    }
    (BASELINE_DIR / "baseline.json").write_text(
        json.dumps(payload, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
