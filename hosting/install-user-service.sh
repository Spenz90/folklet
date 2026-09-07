#!/bin/sh
set -eu
crew_app=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)
if [ ! -x "$crew_app/runtime/node" ]; then
  printf '%s\n' 'Run sh Setup.sh --skip-browser in the Crew folder first.' >&2
  exit 1
fi
exec "$crew_app/runtime/node" "$crew_app/hosting/install-user-service.mjs" "$@"
