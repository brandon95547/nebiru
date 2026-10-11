#!/bin/sh
# Start as root only long enough to make the data folder writable, then run
# as an ordinary user so files in ./data belong to the person who installed it.
set -e

PUID="${PUID:-1000}"
PGID="${PGID:-1000}"
DATA="${NEBIRU_DATA_DIR:-/data}"

if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA"
  # Docker creates a missing bind-mount folder as root; fix whatever is not ours.
  find "$DATA" -maxdepth 1 ! -user "$PUID" -exec chown -R "$PUID:$PGID" {} + 2>/dev/null || true
  exec setpriv --reuid "$PUID" --regid "$PGID" --clear-groups "$@"
fi

exec "$@"
