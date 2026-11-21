FROM kong:3.7
COPY kong.yml /kong/kong.yml.tmpl
USER root
RUN apt-get update >/dev/null 2>&1 || true
# Render env placeholders at start, then run Kong in DB-less mode.
COPY entrypoint.sh /entrypoint-render.sh
RUN chmod +x /entrypoint-render.sh
USER kong
ENV KONG_DATABASE=off KONG_DECLARATIVE_CONFIG=/tmp/kong.yml KONG_PROXY_LISTEN="0.0.0.0:8000" KONG_ADMIN_LISTEN=off KONG_PROXY_ACCESS_LOG=/dev/stdout KONG_PROXY_ERROR_LOG=/dev/stderr
ENTRYPOINT ["/entrypoint-render.sh"]
