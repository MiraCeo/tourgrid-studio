from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class ApiSettings:
    max_upload_bytes: int = 10 * 1024 * 1024
    max_image_width: int = 8192
    max_image_height: int = 8192
    max_image_pixels: int = 25_000_000
    min_output_size: int = 8
    max_output_size: int = 128
    processing_timeout_seconds: float = 30.0
    queue_timeout_seconds: float = 2.0
    max_concurrent_conversions: int = 2
    preview_scale: int = 10
    preview_ttl_seconds: int = 300
    preview_cache_entries: int = 128

    @classmethod
    def from_env(cls) -> "ApiSettings":
        defaults = cls()
        return cls(
            max_upload_bytes=_env_int(
                "TOURGRID_MAX_UPLOAD_BYTES",
                defaults.max_upload_bytes,
            ),
            max_image_width=_env_int(
                "TOURGRID_MAX_IMAGE_WIDTH",
                defaults.max_image_width,
            ),
            max_image_height=_env_int(
                "TOURGRID_MAX_IMAGE_HEIGHT",
                defaults.max_image_height,
            ),
            max_image_pixels=_env_int(
                "TOURGRID_MAX_IMAGE_PIXELS",
                defaults.max_image_pixels,
            ),
            min_output_size=_env_int(
                "TOURGRID_MIN_OUTPUT_SIZE",
                defaults.min_output_size,
            ),
            max_output_size=_env_int(
                "TOURGRID_MAX_OUTPUT_SIZE",
                defaults.max_output_size,
            ),
            processing_timeout_seconds=_env_float(
                "TOURGRID_PROCESSING_TIMEOUT_SECONDS",
                defaults.processing_timeout_seconds,
            ),
            queue_timeout_seconds=_env_float(
                "TOURGRID_QUEUE_TIMEOUT_SECONDS",
                defaults.queue_timeout_seconds,
            ),
            max_concurrent_conversions=_env_int(
                "TOURGRID_MAX_CONCURRENT_CONVERSIONS",
                defaults.max_concurrent_conversions,
            ),
            preview_scale=_env_int(
                "TOURGRID_PREVIEW_SCALE",
                defaults.preview_scale,
            ),
            preview_ttl_seconds=_env_int(
                "TOURGRID_PREVIEW_TTL_SECONDS",
                defaults.preview_ttl_seconds,
            ),
            preview_cache_entries=_env_int(
                "TOURGRID_PREVIEW_CACHE_ENTRIES",
                defaults.preview_cache_entries,
            ),
        ).validated()

    def validated(self) -> "ApiSettings":
        positive_values = {
            "max_upload_bytes": self.max_upload_bytes,
            "max_image_width": self.max_image_width,
            "max_image_height": self.max_image_height,
            "max_image_pixels": self.max_image_pixels,
            "min_output_size": self.min_output_size,
            "max_output_size": self.max_output_size,
            "processing_timeout_seconds": self.processing_timeout_seconds,
            "queue_timeout_seconds": self.queue_timeout_seconds,
            "max_concurrent_conversions": self.max_concurrent_conversions,
            "preview_scale": self.preview_scale,
            "preview_ttl_seconds": self.preview_ttl_seconds,
            "preview_cache_entries": self.preview_cache_entries,
        }
        for name, value in positive_values.items():
            if value <= 0:
                raise ValueError(f"{name} must be positive")
        if self.min_output_size > self.max_output_size:
            raise ValueError("min_output_size cannot exceed max_output_size")
        return self


def _env_int(name: str, default: int) -> int:
    value = os.getenv(name)
    if value is None:
        return default
    try:
        return int(value)
    except ValueError as error:
        raise ValueError(f"{name} must be an integer") from error


def _env_float(name: str, default: float) -> float:
    value = os.getenv(name)
    if value is None:
        return default
    try:
        return float(value)
    except ValueError as error:
        raise ValueError(f"{name} must be a number") from error
