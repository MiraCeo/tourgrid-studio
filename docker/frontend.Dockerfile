FROM caddy:2.11.7-alpine@sha256:d8542f48d34a9cf4e4c11a478865229840e87e4c96ea3f439101f31a5d35f75f

COPY docker/Caddyfile /etc/caddy/Caddyfile
COPY frontend/index.html /srv/index.html
COPY frontend/favicon.ico /srv/favicon.ico
COPY frontend/admin /srv/admin
COPY frontend/css /srv/static/css
COPY frontend/js /srv/static/js
