#!/bin/sh
# Make the mounted folders writable, drop root, fetch any missing model
# files, then start ComfyUI.
set -e

PUID="${PUID:-1000}"
PGID="${PGID:-1000}"
MODELS=/opt/ComfyUI/models
DATA=/data

if [ "$(id -u)" = "0" ]; then
  mkdir -p "$MODELS" "$DATA"
  # Docker creates a missing bind-mount folder as root; fix whatever is not ours.
  for folder in "$MODELS" "$DATA"; do
    find "$folder" -maxdepth 1 ! -user "$PUID" -exec chown -R "$PUID:$PGID" {} + 2>/dev/null || true
  done
  exec setpriv --reuid "$PUID" --regid "$PGID" --clear-groups "$0" "$@"
fi

mkdir -p "$DATA/output" "$DATA/input" "$DATA/temp" "$DATA/user"

# Exits non-zero if a download fails; the container then restarts and resumes it.
python /opt/nebiru/fetch_models.py

# Everything ComfyUI writes goes to the mounted data folder, never into the image.
# shellcheck disable=SC2086  # COMFYUI_ARGS is a list of flags, split on purpose
exec python /opt/ComfyUI/main.py \
  --listen 0.0.0.0 --port 8188 --disable-auto-launch \
  --output-directory "$DATA/output" \
  --input-directory "$DATA/input" \
  --temp-directory "$DATA/temp" \
  --user-directory "$DATA/user" \
  $COMFYUI_ARGS "$@"
