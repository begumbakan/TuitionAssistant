#!/bin/sh
set -e
# Cloud Run sets PORT; Kong must listen on it.
export KONG_PROXY_LISTEN="0.0.0.0:${PORT:-8000}"
sed -e "s#\${{ env \"DECK_JWT_SECRET\" }}#${DECK_JWT_SECRET}#" \
    -e "s#\${{ env \"DECK_API_UPSTREAM\" }}#${DECK_API_UPSTREAM}#" \
    -e "s#\${{ env \"DECK_GATEWAY_KEY\" }}#${DECK_GATEWAY_KEY}#" /kong/kong.yml.tmpl > /tmp/kong.yml
exec /docker-entrypoint.sh kong docker-start
