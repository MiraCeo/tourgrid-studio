from __future__ import annotations

import multiprocessing
import queue
import time
from dataclasses import asdict
from io import BytesIO
from typing import Any

from PIL import Image

from backend.converter import ConversionOptions, convert_pillow_image
from backend.palette import load_palette

from .errors import ConversionProcessFailed, ConversionTimedOut


def _conversion_worker(
    result_queue: multiprocessing.Queue,
    image_bytes: bytes,
    options_data: dict[str, Any],
    palette_id: str,
    preview_scale: int,
) -> None:
    try:
        options = ConversionOptions(**options_data)
        palette = load_palette(palette_id)
        with Image.open(BytesIO(image_bytes)) as image:
            result = convert_pillow_image(image, options=options, palette=palette)

        pixel_image = Image.fromarray(result.image)
        preview = pixel_image.resize(
            (result.width * preview_scale, result.height * preview_scale),
            Image.Resampling.NEAREST,
        )
        preview_buffer = BytesIO()
        preview.save(preview_buffer, "PNG", optimize=True)

        result_queue.put(
            (
                "ok",
                {
                    "width": result.width,
                    "height": result.height,
                    "palette_id": result.palette_id,
                    "palette_version": result.palette_version,
                    "converter_version": result.converter_version,
                    "used_colors": result.used_colors,
                    "used_color_ids": list(result.used_color_ids),
                    "pixels": result.pixels,
                    "hex_pixels": result.hex_pixels,
                    "mapping_mode": result.mapping_mode,
                    "learned_colors": result.learned_colors,
                    "cleanup_changes": result.cleanup_changes,
                    "preview_png": preview_buffer.getvalue(),
                },
            )
        )
    except Exception as error:
        result_queue.put(("error", type(error).__name__, str(error)))


def run_conversion_with_timeout(
    image_bytes: bytes,
    options: ConversionOptions,
    palette_id: str,
    timeout_seconds: float,
    preview_scale: int,
) -> dict[str, Any]:
    context = multiprocessing.get_context("spawn")
    result_queue = context.Queue(maxsize=1)
    process = context.Process(
        target=_conversion_worker,
        args=(
            result_queue,
            image_bytes,
            asdict(options),
            palette_id,
            preview_scale,
        ),
        daemon=True,
    )
    process.start()
    deadline = time.monotonic() + timeout_seconds
    message: tuple[Any, ...] | None = None

    try:
        while time.monotonic() < deadline:
            remaining = deadline - time.monotonic()
            try:
                message = result_queue.get(timeout=min(0.1, max(remaining, 0.001)))
                break
            except queue.Empty:
                if not process.is_alive():
                    break

        if message is None:
            if process.is_alive():
                _stop_process(process)
                raise ConversionTimedOut(
                    f"Image conversion exceeded {timeout_seconds:g} seconds."
                )
            raise ConversionProcessFailed(
                f"Image conversion process exited with code {process.exitcode}."
            )

        process.join(timeout=1)
        if process.is_alive():
            _stop_process(process)

        if message[0] == "error":
            raise ConversionProcessFailed(f"{message[1]}: {message[2]}")
        return message[1]
    finally:
        if process.is_alive():
            _stop_process(process)
        result_queue.close()
        result_queue.join_thread()


def _stop_process(process: multiprocessing.Process) -> None:
    process.terminate()
    process.join(timeout=1)
    if process.is_alive():
        process.kill()
        process.join(timeout=1)
