#!/usr/bin/env bash
# Compiles and uploads firmware/sketch/sketch.ino to an ESP32 Feather using
# arduino-cli. Requires `arduino-cli` on PATH and the esp32:esp32 core
# already installed (see README → Firmware → "Flash from the terminal").
#
# Defaults (SERIAL_PORT, FQBN) come from .board.conf at the repo root;
# copy .board.conf.example and edit.
#
# Usage:
#   ./flash.sh                                   # uses SERIAL_PORT + FQBN from .board.conf
#   ./flash.sh --port /dev/tty.usbmodem1101      # explicit port, FQBN from conf
#   ./flash.sh --port ... --fqbn esp32:esp32:... # both explicit

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

SERIAL_PORT=""
FQBN=""

if [[ -f "$REPO_ROOT/.board.conf" ]]; then
  # shellcheck disable=SC1091
  source "$REPO_ROOT/.board.conf"
fi

PORT="${SERIAL_PORT:-}"
FQBN="${FQBN:-esp32:esp32:featheresp32}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --port)
      PORT="${2:-}"
      shift 2
      ;;
    --fqbn)
      FQBN="${2:-}"
      shift 2
      ;;
    -h|--help)
      echo "Usage: $0 [--port <device>] [--fqbn <fqbn>]"
      echo "  With no args, uses SERIAL_PORT + FQBN from .board.conf."
      echo "  run 'arduino-cli board list' to find your port + fqbn"
      exit 0
      ;;
    *)
      echo "Unknown arg: $1" >&2
      exit 1
      ;;
  esac
done

if [[ -z "$PORT" ]]; then
  echo "Error: no port given and SERIAL_PORT not set in .board.conf" >&2
  echo "Hint: run 'arduino-cli board list' to find it." >&2
  exit 1
fi

if ! command -v arduino-cli >/dev/null 2>&1; then
  echo "Error: arduino-cli not found on PATH." >&2
  echo "Install with: brew install arduino-cli" >&2
  echo "Then follow README → Firmware → 'Flash from the terminal' for one-time core setup." >&2
  exit 1
fi

SKETCH_DIR="$REPO_ROOT/firmware/sketch"

# Ensure the MAX30102 library is installed. Idempotent — a second run is a no-op.
HR_LIB='SparkFun MAX3010x Pulse and Proximity Sensor Library'
if ! arduino-cli lib list 2>/dev/null | grep -q "MAX3010x"; then
  echo "Installing Arduino library: $HR_LIB"
  arduino-cli lib install "$HR_LIB"
fi

echo "Compiling $SKETCH_DIR for $FQBN..."
arduino-cli compile --fqbn "$FQBN" "$SKETCH_DIR"

echo "Uploading to $PORT..."
arduino-cli upload --fqbn "$FQBN" -p "$PORT" --upload-property "upload.speed=115200" "$SKETCH_DIR"

echo "Done. Open a serial monitor at 115200 baud (e.g. 'screen $PORT 115200') to see output."
