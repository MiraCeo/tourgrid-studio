FROM caddy:2.11.4-alpine

COPY docker/Caddyfile /etc/caddy/Caddyfile
COPY frontend/index.html /srv/index.html
COPY frontend/css /srv/static/css
COPY frontend/js /srv/static/js
