from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path as FilePath
from typing import Annotated, Any, Callable, Literal
from uuid import uuid4

from fastapi import APIRouter, FastAPI, File, Form, Path, Request, Response, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from backend import CONVERTER_VERSION
from backend.converter import ConversionOptions
from backend.palette import DEFAULT_PALETTE_ID, PaletteDefinition, list_palettes, load_palette

from .cache import PreviewCache
from .config import ApiSettings
from .errors import ApiError, ConversionProcessFailed, ConversionTimedOut
from .models import (
    ConvertResponse,
    ErrorResponse,
    HealthResponse,
    PaletteColorResponse,
    PaletteDetail,
    PaletteSummary,
)
from .observability import configure_error_monitoring, install_operational_middleware
from .uploads import inspect_image, read_limited_upload
from .worker import run_conversion_with_timeout


LOGGER = logging.getLogger(__name__)
FRONTEND_DIR = FilePath(__file__).resolve().parents[2] / "frontend"
EDITOR_HTML = FRONTEND_DIR / "index.html"
ConverterCallable = Callable[
    [bytes, ConversionOptions, str, float, int],
    dict[str, Any],
]


def _palette_summary(palette: PaletteDefinition) -> PaletteSummary:
    return PaletteSummary(
        id=palette.palette_id,
        name=palette.name,
        version=palette.version,
        status=palette.status,
        color_count=len(palette.colors),
    )


def _palette_detail(palette: PaletteDefinition) -> PaletteDetail:
    return PaletteDetail(
        **_palette_summary(palette).model_dump(),
        description=palette.description,
        sampled_color_count=palette.sampled_color_count,
        predicted_color_count=palette.predicted_color_count,
        colors=[
            PaletteColorResponse(
                id=color.color_id,
                name=color.name,
                rgb=color.rgb,
                hex=color.hex,
                confirmed=color.confirmed,
            )
            for color in palette.colors
        ],
    )


def create_router() -> APIRouter:
    router = APIRouter(prefix="/api/v1")

    @router.get("/health", response_model=HealthResponse)
    async def health() -> HealthResponse:
        return HealthResponse(
            status="ok",
            converter_version=CONVERTER_VERSION,
            default_palette_id=DEFAULT_PALETTE_ID,
        )

    @router.get("/palettes", response_model=list[PaletteSummary])
    async def palettes() -> list[PaletteSummary]:
        return [_palette_summary(palette) for palette in list_palettes()]

    @router.get(
        "/palettes/{palette_id}",
        response_model=PaletteDetail,
        responses={404: {"model": ErrorResponse}},
    )
    async def palette_detail(
        palette_id: Annotated[
            str,
            Path(min_length=1, max_length=64, pattern=r"^[a-z0-9][a-z0-9-]*$"),
        ],
    ) -> PaletteDetail:
        try:
            palette = load_palette(palette_id)
        except FileNotFoundError as error:
            raise ApiError(404, "palette_not_found", "Palette does not exist.") from error
        return _palette_detail(palette)

    @router.post(
        "/convert",
        response_model=ConvertResponse,
        responses={
            400: {"model": ErrorResponse},
            409: {"model": ErrorResponse},
            413: {"model": ErrorResponse},
            415: {"model": ErrorResponse},
            422: {"model": ErrorResponse},
            500: {"model": ErrorResponse},
            503: {"model": ErrorResponse},
            504: {"model": ErrorResponse},
        },
    )
    async def convert(
        request: Request,
        image: Annotated[UploadFile, File(description="PNG, JPEG or WebP image.")],
        width: Annotated[int, Form()] = 24,
        height: Annotated[int, Form()] = 24,
        palette_id: Annotated[
            str,
            Form(min_length=1, max_length=64, pattern=r"^[a-z0-9][a-z0-9-]*$"),
        ] = DEFAULT_PALETTE_ID,
        dither: Annotated[
            Literal["none", "naive", "bayer", "floyd", "atkinson"],
            Form(),
        ] = "none",
        sobel: Annotated[int, Form(ge=2, le=9)] = 3,
        depth: Annotated[int, Form(ge=1, le=3)] = 1,
        fit: Annotated[Literal["crop", "stretch"], Form()] = "crop",
        mapping_mode: Annotated[Literal["direct", "two-stage"], Form()] = "direct",
        auto_colors: Annotated[int, Form(ge=2, le=64)] = 18,
        cleanup_passes: Annotated[int, Form(ge=0, le=4)] = 2,
        cleanup_delta_e: Annotated[float, Form(ge=0, le=100)] = 14.0,
        svd: Annotated[bool, Form()] = True,
        converter_version: Annotated[str, Form(min_length=1, max_length=32)] = (
            CONVERTER_VERSION
        ),
    ) -> ConvertResponse:
        settings: ApiSettings = request.app.state.settings

        if converter_version != CONVERTER_VERSION:
            raise ApiError(
                409,
                "converter_version_mismatch",
                (
                    f"Requested converter version {converter_version!r}; "
                    f"server provides {CONVERTER_VERSION!r}."
                ),
            )
        if width != 24 or height != 24:
            raise ApiError(
                422,
                "invalid_output_size",
                "Output size is fixed at 24x24.",
            )

        try:
            palette = load_palette(palette_id)
        except (FileNotFoundError, ValueError) as error:
            raise ApiError(404, "palette_not_found", "Palette does not exist.") from error

        options = ConversionOptions(
            width=width,
            height=height,
            fit=fit,
            dither=dither,
            sobel=sobel,
            depth=depth,
            svd=svd,
            mapping_mode=mapping_mode,
            auto_colors=auto_colors,
            cleanup_passes=cleanup_passes,
            cleanup_delta_e=cleanup_delta_e,
        )
        try:
            options.validate(len(palette.colors))
        except ValueError as error:
            raise ApiError(422, "invalid_conversion_options", str(error)) from error

        declared_content_type = image.content_type
        try:
            image_bytes = await read_limited_upload(image, settings.max_upload_bytes)
        finally:
            await image.close()
        inspect_image(image_bytes, settings, declared_content_type)

        try:
            async with asyncio.timeout(settings.queue_timeout_seconds):
                await request.app.state.conversion_slots.acquire()
        except TimeoutError as error:
            raise ApiError(
                503,
                "server_busy",
                "All conversion workers are busy. Please retry shortly.",
            ) from error

        try:
            converter: ConverterCallable = request.app.state.converter
            payload = await asyncio.to_thread(
                converter,
                image_bytes,
                options,
                palette.palette_id,
                settings.processing_timeout_seconds,
                settings.preview_scale,
            )
        except ConversionTimedOut as error:
            raise ApiError(504, "conversion_timeout", str(error)) from error
        except ConversionProcessFailed as error:
            LOGGER.exception("Image conversion subprocess failed")
            raise ApiError(
                500,
                "conversion_failed",
                "Image conversion failed.",
            ) from error
        finally:
            request.app.state.conversion_slots.release()

        preview_png = payload.pop("preview_png")
        result_id = uuid4().hex
        preview_cache: PreviewCache = request.app.state.preview_cache
        preview_cache.put(result_id, preview_png)
        payload["preview_url"] = f"/api/v1/results/{result_id}/preview.png"
        return ConvertResponse(**payload)

    @router.get(
        "/results/{result_id}/preview.png",
        responses={404: {"model": ErrorResponse}},
        response_class=Response,
    )
    async def preview(
        request: Request,
        result_id: Annotated[str, Path(pattern=r"^[0-9a-f]{32}$")],
    ) -> Response:
        preview_cache: PreviewCache = request.app.state.preview_cache
        content = preview_cache.get(result_id)
        if content is None:
            raise ApiError(
                404,
                "preview_not_found",
                "Preview does not exist or has expired.",
            )
        return Response(
            content=content,
            media_type="image/png",
            headers={
                "Cache-Control": (
                    f"private, max-age={preview_cache.ttl_seconds}, immutable"
                )
            },
        )

    return router


def create_app(
    settings: ApiSettings | None = None,
    *,
    converter: ConverterCallable = run_conversion_with_timeout,
) -> FastAPI:
    settings = (settings or ApiSettings.from_env()).validated()
    sentry_sdk = configure_error_monitoring(settings)
    preview_cache = PreviewCache(
        max_entries=settings.preview_cache_entries,
        ttl_seconds=settings.preview_ttl_seconds,
    )

    @asynccontextmanager
    async def lifespan(application: FastAPI):
        load_palette(DEFAULT_PALETTE_ID)
        yield
        application.state.preview_cache.clear()

    application = FastAPI(
        title="Tourgrid Studio API",
        version=CONVERTER_VERSION,
        description="Versioned image conversion API for Tourgrid Studio.",
        lifespan=lifespan,
    )
    application.state.settings = settings
    application.state.preview_cache = preview_cache
    application.state.converter = converter
    application.state.conversion_slots = asyncio.Semaphore(
        settings.max_concurrent_conversions
    )
    install_operational_middleware(
        application,
        settings,
        sentry_sdk=sentry_sdk,
    )
    application.mount(
        "/static",
        StaticFiles(directory=FRONTEND_DIR),
        name="frontend-static",
    )

    @application.get("/", include_in_schema=False)
    async def editor() -> FileResponse:
        return FileResponse(EDITOR_HTML, media_type="text/html")

    @application.exception_handler(ApiError)
    async def handle_api_error(_request: Request, error: ApiError) -> JSONResponse:
        body = ErrorResponse(
            error={
                "code": error.code,
                "message": error.message,
                "details": error.details,
            }
        )
        return JSONResponse(
            status_code=error.status_code,
            content=body.model_dump(by_alias=True, exclude_none=True),
        )

    @application.exception_handler(RequestValidationError)
    async def handle_validation_error(
        _request: Request,
        error: RequestValidationError,
    ) -> JSONResponse:
        details = [
            {
                "location": list(item["loc"]),
                "message": item["msg"],
                "type": item["type"],
            }
            for item in error.errors()
        ]
        body = ErrorResponse(
            error={
                "code": "request_validation_failed",
                "message": "Request parameters are invalid.",
                "details": details,
            }
        )
        return JSONResponse(
            status_code=422,
            content=body.model_dump(by_alias=True, exclude_none=True),
        )

    application.include_router(create_router())
    return application


app = create_app()


def run() -> None:
    import uvicorn

    uvicorn.run(
        "backend.api.app:app",
        host="127.0.0.1",
        port=8000,
        reload=False,
    )
