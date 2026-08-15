#!/bin/sh
set -e

# Render private DNS uses the pserv hostname from fromService, not always the
# Blueprint service name. Build URLs from injected hosts when set.
if [ -z "${BROWSER_WEB_URL:-}" ] && [ -n "${BROWSER_WEB_HOST:-}" ]; then
  export BROWSER_WEB_URL="http://${BROWSER_WEB_HOST}:${BROWSER_WEB_PORT:-9222}"
fi

if [ -z "${MEILI_ADDR:-}" ] && [ -n "${MEILI_HOST:-}" ]; then
  export MEILI_ADDR="http://${MEILI_HOST}:${MEILI_PORT:-7700}"
fi

exec /init "$@"
