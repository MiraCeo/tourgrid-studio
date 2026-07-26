from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from io import BytesIO
from threading import Event, Lock
from typing import Any

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from backend import CONVERTER_VERSION
from backend.api.app import create_app
from backend.api.config import ApiSettings
from backend.api.errors import ConversionProcessFailed, ConversionTimedOut
from backend.converter import ConversionOptions


def image_bytes(
    *,
    width: int = 32,
    height: int = 32,
    image_format: str = "PNG",
) -> bytes:
    image = Image.new("RGB", (width, height), (120, 80, 40))
    output = BytesIO()
    image.save(output, image_format)
    return output.getvalue()


def preview_bytes() -> bytes:
    image = Image.new("RGB", (16, 16), (34, 34, 34))
    output = BytesIO()
    image.save(output, "PNG")
    return output.getvalue()


def fake_conversion(
    _content: bytes,
    options: ConversionOptions,
    palette_id: str,
    _timeout_seconds: float,
    _preview_scale: int,
) -> dict[str, Any]:
    return {
        "width": options.width,
        "height": options.height,
        "palette_id": palette_id,
        "palette_version": 1,
        "converter_version": CONVERTER_VERSION,
        "used_colors": 1,
        "used_color_ids": ["N01"],
        "pixels": [["N01"] * options.width for _ in range(options.height)],
        "hex_pixels": [["#222222"] * options.width for _ in range(options.height)],
        "mapping_mode": options.mapping_mode,
        "learned_colors": None,
        "cleanup_changes": 0,
        "preview_png": preview_bytes(),
    }


@pytest.fixture
def settings() -> ApiSettings:
    return ApiSettings(
        max_upload_bytes=1024 * 1024,
        max_image_width=512,
        max_image_height=512,
        max_image_pixels=512 * 512,
        processing_timeout_seconds=5,
        queue_timeout_seconds=1,
        preview_ttl_seconds=60,
        preview_cache_entries=4,
    )


@pytest.fixture
def client(settings: ApiSettings):
    application = create_app(settings, converter=fake_conversion)
    with TestClient(application) as test_client:
        yield test_client


def test_health(client: TestClient) -> None:
    response = client.get("/api/v1/health")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "converterVersion": CONVERTER_VERSION,
        "defaultPaletteId": "natural-64-v1",
    }


def test_editor_is_served_from_same_origin(client: TestClient) -> None:
    response = client.get("/")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/html")
    assert 'id="pixelCanvas"' in response.text
    assert '/static/js/import.js' in response.text

    script_response = client.get("/static/js/import.js")
    assert script_response.status_code == 200
    assert "/api/v1/convert" in script_response.text


def test_palette_list_and_detail(client: TestClient) -> None:
    list_response = client.get("/api/v1/palettes")
    detail_response = client.get("/api/v1/palettes/natural-64-v1")

    assert list_response.status_code == 200
    assert list_response.json() == [
        {
            "id": "natural-64-v1",
            "name": "Natural 64 v1",
            "version": 1,
            "status": "provisional",
            "colorCount": 64,
        }
    ]

    detail = detail_response.json()
    assert detail_response.status_code == 200
    assert detail["sampledColorCount"] == 24
    assert detail["predictedColorCount"] == 40
    assert len(detail["colors"]) == 64
    assert detail["colors"][0] == {
        "id": "N01",
        "name": "Black",
        "rgb": [34, 34, 34],
        "hex": "#222222",
        "confirmed": True,
    }


def test_unknown_palette_uses_error_envelope(client: TestClient) -> None:
    response = client.get("/api/v1/palettes/does-not-exist")

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "palette_not_found"


def test_convert_returns_matrices_and_short_lived_preview(client: TestClient) -> None:
    response = client.post(
        "/api/v1/convert",
        files={"image": ("source.png", image_bytes(), "image/png")},
    )

    assert response.status_code == 200, response.text
    result = response.json()
    assert result["width"] == 24
    assert result["height"] == 24
    assert result["paletteId"] == "natural-64-v1"
    assert result["paletteVersion"] == 1
    assert result["converterVersion"] == CONVERTER_VERSION
    assert result["usedColors"] == 1
    assert result["usedColorIds"] == ["N01"]
    assert len(result["pixels"]) == 24
    assert len(result["hexPixels"]) == 24
    assert result["previewUrl"].startswith("/api/v1/results/")

    preview = client.get(result["previewUrl"])
    assert preview.status_code == 200
    assert preview.headers["content-type"] == "image/png"
    assert preview.content.startswith(b"\x89PNG\r\n\x1a\n")
    assert "private" in preview.headers["cache-control"]


def test_convert_accepts_explicit_supported_options(client: TestClient) -> None:
    response = client.post(
        "/api/v1/convert",
        files={"image": ("source.webp", image_bytes(image_format="WEBP"), "image/webp")},
        data={
            "width": "52",
            "height": "52",
            "dither": "atkinson",
            "fit": "stretch",
            "mapping_mode": "two-stage",
            "auto_colors": "16",
            "svd": "false",
        },
    )

    assert response.status_code == 200, response.text
    result = response.json()
    assert (result["width"], result["height"]) == (52, 52)
    assert result["mappingMode"] == "two-stage"


def test_convert_rejects_unsupported_mime_type(client: TestClient) -> None:
    response = client.post(
        "/api/v1/convert",
        files={"image": ("source.gif", b"GIF89a", "image/gif")},
    )

    assert response.status_code == 415
    assert response.json()["error"]["code"] == "unsupported_media_type"


def test_convert_rejects_invalid_image_content(client: TestClient) -> None:
    response = client.post(
        "/api/v1/convert",
        files={"image": ("source.png", b"not a png", "image/png")},
    )

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "invalid_image"


def test_convert_rejects_content_type_mismatch(client: TestClient) -> None:
    response = client.post(
        "/api/v1/convert",
        files={"image": ("source.jpg", image_bytes(), "image/jpeg")},
    )

    assert response.status_code == 415
    assert response.json()["error"]["code"] == "content_type_mismatch"


def test_convert_rejects_file_over_byte_limit(settings: ApiSettings) -> None:
    limited = ApiSettings(
        **{
            **settings.__dict__,
            "max_upload_bytes": 16,
        }
    )
    with TestClient(create_app(limited, converter=fake_conversion)) as client:
        response = client.post(
            "/api/v1/convert",
            files={"image": ("source.png", image_bytes(), "image/png")},
        )

    assert response.status_code == 413
    assert response.json()["error"]["code"] == "file_too_large"


def test_convert_rejects_large_decoded_dimensions(settings: ApiSettings) -> None:
    limited = ApiSettings(
        **{
            **settings.__dict__,
            "max_image_width": 16,
        }
    )
    with TestClient(create_app(limited, converter=fake_conversion)) as client:
        response = client.post(
            "/api/v1/convert",
            files={"image": ("source.png", image_bytes(width=32), "image/png")},
        )

    assert response.status_code == 413
    assert response.json()["error"]["code"] == "image_dimensions_too_large"


def test_convert_rejects_invalid_output_size(client: TestClient) -> None:
    response = client.post(
        "/api/v1/convert",
        files={"image": ("source.png", image_bytes(), "image/png")},
        data={"width": "129"},
    )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "invalid_output_size"


def test_convert_rejects_converter_version_mismatch(client: TestClient) -> None:
    response = client.post(
        "/api/v1/convert",
        files={"image": ("source.png", image_bytes(), "image/png")},
        data={"converter_version": "0.9.0"},
    )

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "converter_version_mismatch"


def test_missing_upload_uses_validation_error_envelope(client: TestClient) -> None:
    response = client.post("/api/v1/convert")

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "request_validation_failed"


def test_unknown_preview_returns_404(client: TestClient) -> None:
    response = client.get(
        "/api/v1/results/00000000000000000000000000000000/preview.png"
    )

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "preview_not_found"


@pytest.mark.parametrize(
    ("error", "status_code", "code"),
    [
        (ConversionTimedOut("too slow"), 504, "conversion_timeout"),
        (ConversionProcessFailed("crashed"), 500, "conversion_failed"),
    ],
)
def test_conversion_process_errors_are_sanitized(
    settings: ApiSettings,
    error: Exception,
    status_code: int,
    code: str,
) -> None:
    def failing_converter(*_args, **_kwargs):
        raise error

    with TestClient(create_app(settings, converter=failing_converter)) as client:
        response = client.post(
            "/api/v1/convert",
            files={"image": ("source.png", image_bytes(), "image/png")},
        )

    assert response.status_code == status_code
    assert response.json()["error"]["code"] == code
    if status_code == 500:
        assert "crashed" not in response.text


def test_two_conversions_can_run_up_to_configured_limit(settings: ApiSettings) -> None:
    entered = Event()
    release = Event()
    state_lock = Lock()
    active = 0
    maximum_active = 0

    def blocking_converter(
        content: bytes,
        options: ConversionOptions,
        palette_id: str,
        timeout_seconds: float,
        preview_scale: int,
    ) -> dict[str, Any]:
        nonlocal active, maximum_active
        with state_lock:
            active += 1
            maximum_active = max(maximum_active, active)
            if active == 2:
                entered.set()
        try:
            assert release.wait(3)
            return fake_conversion(
                content,
                options,
                palette_id,
                timeout_seconds,
                preview_scale,
            )
        finally:
            with state_lock:
                active -= 1

    concurrent_settings = ApiSettings(
        **{
            **settings.__dict__,
            "max_concurrent_conversions": 2,
            "queue_timeout_seconds": 1,
        }
    )
    application = create_app(concurrent_settings, converter=blocking_converter)
    with TestClient(application) as client, ThreadPoolExecutor(max_workers=2) as pool:
        futures = [
            pool.submit(
                client.post,
                "/api/v1/convert",
                files={"image": ("source.png", image_bytes(), "image/png")},
            )
            for _ in range(2)
        ]
        assert entered.wait(2), "both conversion slots should become active"
        release.set()
        responses = [future.result(timeout=3) for future in futures]

    assert [response.status_code for response in responses] == [200, 200]
    assert maximum_active == 2


def test_conversion_queue_returns_busy_when_limit_is_reached(
    settings: ApiSettings,
) -> None:
    entered = Event()
    release = Event()

    def blocking_converter(
        content: bytes,
        options: ConversionOptions,
        palette_id: str,
        timeout_seconds: float,
        preview_scale: int,
    ) -> dict[str, Any]:
        entered.set()
        assert release.wait(3)
        return fake_conversion(
            content,
            options,
            palette_id,
            timeout_seconds,
            preview_scale,
        )

    limited_settings = ApiSettings(
        **{
            **settings.__dict__,
            "max_concurrent_conversions": 1,
            "queue_timeout_seconds": 0.05,
        }
    )
    application = create_app(limited_settings, converter=blocking_converter)
    with TestClient(application) as client, ThreadPoolExecutor(max_workers=1) as pool:
        first_future = pool.submit(
            client.post,
            "/api/v1/convert",
            files={"image": ("first.png", image_bytes(), "image/png")},
        )
        assert entered.wait(2), "first conversion should occupy the only slot"
        second = client.post(
            "/api/v1/convert",
            files={"image": ("second.png", image_bytes(), "image/png")},
        )
        release.set()
        first = first_future.result(timeout=3)

    assert first.status_code == 200
    assert second.status_code == 503
    assert second.json()["error"]["code"] == "server_busy"
