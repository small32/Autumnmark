#!/bin/bash
# Antumnmark+ in-place updater (macOS .app bundle and Linux AppImage).
#
# Runs detached from the app: waits for the old process to exit, moves the
# current bundle/AppImage aside, copies the staged build over it, restarts,
# and rolls back when copying fails. Nothing here downloads anything.
#
# Usage:
#   apply-update.sh --pid <pid> --source <path> --target <path> --launch <path>
#                   --mode <app|file> [--log <path>] [--cleanup <dir>]

set -u

PID=""
SOURCE=""
TARGET=""
LAUNCH=""
MODE="app"
LOG=""
CLEANUP=""
WAIT_SECONDS=90

while [ $# -gt 0 ]; do
  case "$1" in
    --pid) PID="$2"; shift 2 ;;
    --source) SOURCE="$2"; shift 2 ;;
    --target) TARGET="$2"; shift 2 ;;
    --launch) LAUNCH="$2"; shift 2 ;;
    --mode) MODE="$2"; shift 2 ;;
    --log) LOG="$2"; shift 2 ;;
    --cleanup) CLEANUP="$2"; shift 2 ;;
    *) shift ;;
  esac
done

log() {
  if [ -n "$LOG" ]; then
    printf '%s [apply-update] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1" >> "$LOG" 2>/dev/null || true
  fi
}

log "start (mode=$MODE, source=$SOURCE, target=$TARGET, pid=$PID)"

# 1. Wait for the running app to release the bundle.
if [ -n "$PID" ]; then
  waited=0
  while kill -0 "$PID" 2>/dev/null; do
    if [ "$waited" -ge "$WAIT_SECONDS" ]; then
      log "old process $PID still alive after ${WAIT_SECONDS}s; terminating"
      kill -9 "$PID" 2>/dev/null || true
      sleep 2
      break
    fi
    sleep 1
    waited=$((waited + 1))
  done
fi

if [ ! -e "$SOURCE" ]; then
  log "staged build is missing; aborting"
  [ -n "$CLEANUP" ] && rm -rf "$CLEANUP"
  exit 2
fi

STAMP="$(date '+%Y%m%d%H%M%S')"
BACKUP="${TARGET}.backup-${STAMP}"
MOVED=0

# 2. Move the current build aside (same volume, so this is instant and atomic
#    enough to restore on failure).
if [ -e "$TARGET" ]; then
  if mv "$TARGET" "$BACKUP" 2>/dev/null; then
    MOVED=1
    log "current build moved to $BACKUP"
  else
    log "cannot move the current build aside (permission denied?)"
    exit 3
  fi
fi

# 3. Copy the staged build into place.
COPY_OK=0
if [ "$MODE" = "file" ]; then
  if cp "$SOURCE" "$TARGET" 2>/dev/null; then
    chmod +x "$TARGET" 2>/dev/null || true
    COPY_OK=1
  fi
else
  if cp -R "$SOURCE" "$TARGET" 2>/dev/null; then
    # Unsigned builds stay quarantined otherwise and Gatekeeper blocks them.
    xattr -dr com.apple.quarantine "$TARGET" 2>/dev/null || true
    COPY_OK=1
  fi
fi

if [ "$COPY_OK" -ne 1 ]; then
  log "copy failed; rolling back"
  rm -rf "$TARGET" 2>/dev/null || true
  if [ "$MOVED" -eq 1 ] && [ -e "$BACKUP" ]; then
    mv "$BACKUP" "$TARGET" 2>/dev/null || log "rollback failed, backup kept at $BACKUP"
  fi
  if [ -e "$LAUNCH" ]; then
    if [ "$MODE" = "app" ]; then open "$LAUNCH" || true; else "$LAUNCH" >/dev/null 2>&1 & fi
  fi
  [ -n "$CLEANUP" ] && rm -rf "$CLEANUP"
  exit 4
fi

log "staged build copied"

# 4. Keep only the newest backup.
if [ "$MOVED" -eq 1 ]; then
  ls -1dt "${TARGET}".backup-* 2>/dev/null | tail -n +2 | while read -r old; do
    rm -rf "$old" 2>/dev/null || true
  done
fi

# 5. Restart.
if [ -e "$LAUNCH" ]; then
  if [ "$MODE" = "app" ]; then
    open "$LAUNCH" || true
  else
    ( cd "$(dirname "$LAUNCH")" && "$LAUNCH" >/dev/null 2>&1 & )
  fi
  log "restarted the application"
fi

[ -n "$CLEANUP" ] && rm -rf "$CLEANUP"
log "done"
exit 0
