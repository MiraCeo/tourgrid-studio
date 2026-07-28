FROM caddy:2.11.4-alpine@sha256:5f5c8640aae01df9654968d946d8f1a56c497f1dd5c5cda4cf95ab7c14d58648

COPY docker/Caddyfile /etc/caddy/Caddyfile
COPY frontend/index.html /srv/index.html
COPY frontend/favicon.ico /srv/favicon.ico
COPY frontend/admin /srv/admin
COPY frontend/css /srv/static/css
COPY frontend/js /srv/static/js
