from __future__ import annotations

from fastapi import APIRouter, Request, Response

from .models import FeaturedWorksResponse
from .work_store import WorkStore, WorkStoreUnavailable
from .works import work_response


def create_featured_router() -> APIRouter:
    router = APIRouter(
        prefix="/api/v1/featured-works",
        tags=["featured-works"],
    )

    @router.get("", response_model=FeaturedWorksResponse)
    async def get_featured_works(
        request: Request,
        response: Response,
    ) -> FeaturedWorksResponse:
        store: WorkStore = request.app.state.work_store
        try:
            records = await store.get_featured_works()
        except WorkStoreUnavailable:
            response.headers["Cache-Control"] = "no-store"
            return FeaturedWorksResponse(works=[])
        response.headers["Cache-Control"] = "public, max-age=60"
        return FeaturedWorksResponse(
            works=[work_response(record) for record in records]
        )

    return router
