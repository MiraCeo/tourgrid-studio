# syntax=docker/dockerfile:1

FROM python:3.12-slim-bookworm AS builder

ENV PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /build
COPY requirements-prod.lock ./
RUN python -m pip install --prefix=/install --requirement requirements-prod.lock


FROM python:3.12-slim-bookworm AS runtime

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

RUN groupadd --system --gid 10001 tourgrid \
    && useradd --system --uid 10001 --gid tourgrid --home-dir /app tourgrid

COPY --from=builder /install /usr/local

WORKDIR /app
COPY --chown=tourgrid:tourgrid backend ./backend
COPY --chown=tourgrid:tourgrid palettes ./palettes
COPY --chown=tourgrid:tourgrid frontend ./frontend
COPY --chown=tourgrid:tourgrid docker/uvicorn-logging.json ./docker/uvicorn-logging.json

USER tourgrid
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=3 \
    CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/v1/health', timeout=3).read()"]

CMD ["python", "-m", "uvicorn", "backend.api.app:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips=*", "--log-config", "/app/docker/uvicorn-logging.json"]
