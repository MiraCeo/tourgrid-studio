from __future__ import annotations

import warnings
from io import BytesIO

from fastapi import UploadFile
from PIL import Image, UnidentifiedImageError

from .config import ApiSettings
from .errors import ApiError
from .models import ImageMetadata


ALLOWED_CONTENT_TYPES = {
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/webp",
}
ALLOWED_IMAGE_FORMATS = {"JPEG", "PNG", "WEBP"}
FORMAT_CONTENT_TYPES = {
    "JPEG": {"image/jpeg", "image/jpg"},
    "PNG": {"image/png"},
    "WEBP": {"image/webp"},
}
UPLOAD_CHUNK_SIZE = 1024 * 1024


async def read_limited_upload(upload: UploadFile, max_bytes: int) -> bytes:
    if upload.content_type not in ALLOWED_CONTENT_TYPES:
        raise ApiError(
            415,
            "unsupported_media_type",
            "Only PNG, JPEG and WebP images are accepted.",
        )

    content = bytearray()
    while True:
        chunk = await upload.read(UPLOAD_CHUNK_SIZE)
        if not chunk:
            break
        content.extend(chunk)
        if len(content) > max_bytes:
            raise ApiError(
                413,
                "file_too_large",
                f"Uploaded image exceeds the {max_bytes}-byte limit.",
            )

    if not content:
        raise ApiError(400, "empty_file", "Uploaded image is empty.")
    return bytes(content)


def inspect_image(
    content: bytes,
    settings: ApiSettings,
    declared_content_type: str | None,
) -> ImageMetadata:
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(BytesIO(content)) as image:
                image_format = image.format
                width, height = image.size
                frames = getattr(image, "n_frames", 1)
                image.verify()
    except (
        Image.DecompressionBombError,
        Image.DecompressionBombWarning,
        UnidentifiedImageError,
        OSError,
        SyntaxError,
    ) as error:
        raise ApiError(
            400,
            "invalid_image",
            "The uploaded file is not a valid supported image.",
        ) from error

    if image_format not in ALLOWED_IMAGE_FORMATS:
        raise ApiError(
            415,
            "unsupported_image_format",
            "Decoded image format must be PNG, JPEG or WebP.",
        )
    if declared_content_type not in FORMAT_CONTENT_TYPES[image_format]:
        raise ApiError(
            415,
            "content_type_mismatch",
            "Declared media type does not match the decoded image format.",
        )
    if frames != 1:
        raise ApiError(
            400,
            "animated_image_not_supported",
            "Animated images are not supported.",
        )
    if width > settings.max_image_width or height > settings.max_image_height:
        raise ApiError(
            413,
            "image_dimensions_too_large",
            (
                f"Image dimensions exceed "
                f"{settings.max_image_width}x{settings.max_image_height}."
            ),
        )
    if width * height > settings.max_image_pixels:
        raise ApiError(
            413,
            "image_pixel_count_too_large",
            f"Image exceeds the {settings.max_image_pixels}-pixel limit.",
        )

    return ImageMetadata(
        format=image_format,
        width=width,
        height=height,
        frames=frames,
    )
