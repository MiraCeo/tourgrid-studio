FROM caddy:2.11.4-alpine@sha256:6aeddd44c3078b0f9a35206472a11420648a79c184603ef95957d0a20044cb2b

COPY docker/Caddyfile /etc/caddy/Caddyfile
COPY frontend/index.html /srv/index.html
COPY frontend/favicon.ico /srv/favicon.ico
COPY frontend/admin /srv/admin
COPY frontend/css /srv/static/css
COPY frontend/js /srv/static/js
