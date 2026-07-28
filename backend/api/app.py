from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path as FilePath
from typing import Annotated

from fastapi import APIRouter, FastAPI, Path, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from backend import APP_VERSION
from backend.palette import (
    DEFAULT_PALETTE_ID,
    PaletteDefinition,
    list_palettes,
    load_palette,
)

from .admin import create_admin_router
from .config import ApiSettings
from .errors import ApiError
from .models import (
    ErrorResponse,
    HealthResponse,
    PaletteColorResponse,
    PaletteDetail,
    PaletteSummary,
)
from .observability import configure_error_monitoring, install_operational_middleware
from .shared_state import SharedState, create_shared_state
from .work_store import WorkStore, create_work_store
from .works import create_works_router


FRONTEND_DIR = FilePath(__file__).resolve().parents[2] / "frontend"
EDITOR_HTML = FRONTEND_DIR / "index.html"
ADMIN_DIR = FRONTEND_DIR / "admin"


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
            app_version=APP_VERSION,
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
            return _palette_detail(load_palette(palette_id))
        except (FileNotFoundError, ValueError) as error:
            raise ApiError(
                404,
                "palette_not_found",
                "Palette does not exist.",
            ) from error

    return router


def create_app(
    settings: ApiSettings | None = None,
    *,
    work_store: WorkStore | None = None,
    shared_state: SharedState | None = None,
) -> FastAPI:
    settings = (settings or ApiSettings.from_env()).validated()
    sentry_sdk = configure_error_monitoring(settings)
    work_store = work_store or create_work_store(settings.database_url)
    shared_state = shared_state or create_shared_state(
        settings.redis_url,
        max_clients=settings.rate_limit_max_clients,
    )

    @asynccontextmanager
    async def lifespan(application: FastAPI):
        load_palette(DEFAULT_PALETTE_ID)
        await application.state.work_store.initialize()
        try:
            await application.state.shared_state.initialize()
            try:
                yield
            finally:
                await application.state.shared_state.close()
        finally:
            await application.state.work_store.close()

    application = FastAPI(
        title="Tourgrid Studio API",
        version=APP_VERSION,
        description="Palette and immutable work sharing API for Tourgrid Studio.",
        lifespan=lifespan,
    )
    application.state.settings = settings
    application.state.work_store = work_store
    application.state.shared_state = shared_state
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
    application.mount(
        "/admin",
        StaticFiles(directory=ADMIN_DIR, html=True),
        name="admin-static",
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
    application.include_router(create_works_router())
    application.include_router(create_admin_router())
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
