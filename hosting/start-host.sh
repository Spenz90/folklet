#!/bin/sh
set -eu
: "${CREW_APP:?Crew application path is missing}"
: "${CREW_DATA:?Crew data path is missing}"
case "$CREW_APP:$CREW_DATA" in
  *'
'*) printf '%s\n' 'Crew paths cannot contain newlines.' >&2; exit 1 ;;
esac
if [ ! -x "$CREW_APP/runtime/node" ] || [ ! -f "$CREW_APP/server.mjs" ]; then
  printf '%s\n' 'Crew runtime is missing. Run Setup.sh in the application folder.' >&2
  exit 1
fi
# The browser path must match an explicit browser installation. Desktop access
# still starts disabled inside Crew; this launcher never creates a desktop.
PLAYWRIGHT_BROWSERS_PATH=${PLAYWRIGHT_BROWSERS_PATH:-"$CREW_DATA/browsers"}
PATH="$CREW_APP/runtime:$CREW_APP/runtime/codex/bin:$CREW_APP/runtime/codex/codex-path:${PATH:-/usr/local/bin:/usr/bin:/bin}"
CREW_PORT=4318
CREW_MOBILE_PORT=4320
export PLAYWRIGHT_BROWSERS_PATH PATH CREW_PORT CREW_MOBILE_PORT
unset NODE_OPTIONS NODE_PATH CREW_CODEX_OVERRIDE
umask 077
cd -- "$CREW_APP"
exec "$CREW_APP/runtime/node" "$CREW_APP/server.mjs"
