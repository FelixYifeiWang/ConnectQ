"""Turn the heart-rate tracking on or off at runtime.

The setting is persisted in the ESP32's NVS flash (`sixth_cal` namespace,
key `hr_track`) and survives reboots — same storage as the calibration
offsets.

Usage:
    python hr_toggle.py on        # enable tracking
    python hr_toggle.py off       # disable tracking
    python hr_toggle.py status    # query current state (default if no arg)

Note: this only affects runtime. The compile-time `HR_ENABLED` flag in
sketch.ino still gates whether the MAX30102 is initialized at boot. If
HR_ENABLED is false, this script can't bring the sensor online — reflash
the firmware first.
"""

from __future__ import annotations

import argparse
import re
import sys
import time
from typing import Optional

from transport import (  # pyright: ignore[reportMissingImports]
    Transport,
    add_transport_args,
    build_transport,
)


_VALID_STATES = {"on", "off", "status"}

# `HR ok tracking=on` (after a set) or `HR tracking=on` (after a query).
_HR_ACK_RE = re.compile(r"HR(?:\s+ok)?\s+tracking=(on|off)\b")


def format_hr_command(state: str) -> str:
    """Wire-format the firmware command for a desired state."""
    if state == "on":
        return "HR 1\n"
    if state == "off":
        return "HR 0\n"
    if state == "status":
        return "HR ?\n"
    raise ValueError(f"unknown state: {state!r}")


def parse_hr_ack(line: str) -> Optional[str]:
    """Return 'on'/'off' if `line` is a valid HR ack from the firmware, else None."""
    if not line:
        return None
    m = _HR_ACK_RE.search(line)
    return m.group(1) if m else None


def _wait_for_ack(transport: Transport, timeout_s: float = 2.0) -> Optional[str]:
    """Read serial/wifi until an HR ack arrives or timeout. Returns the line, or None."""
    deadline = time.time() + timeout_s
    buf = b""
    while time.time() < deadline:
        chunk = transport.recv_nonblocking()
        if chunk:
            buf += chunk
            while b"\n" in buf:
                line, _, buf = buf.partition(b"\n")
                text = line.decode("utf-8", errors="replace").strip()
                if parse_hr_ack(text) is not None:
                    return text
        else:
            time.sleep(0.02)
    return None


def main() -> int:
    parser = argparse.ArgumentParser(description="Turn heart-rate tracking on/off.")
    parser.add_argument(
        "state",
        nargs="?",
        default="status",
        choices=sorted(_VALID_STATES),
        help="Desired state (default: status)",
    )
    add_transport_args(parser)
    args = parser.parse_args()

    print(f"Connecting to board...")
    try:
        transport = build_transport(args)
    except Exception as e:
        print(f"FAIL connect: {e}", file=sys.stderr)
        return 1

    try:
        cmd = format_hr_command(args.state)
        transport.send(cmd.encode("ascii"))
        ack_line = _wait_for_ack(transport)
        if ack_line is None:
            print("FAIL no HR ack within 2s", file=sys.stderr)
            return 1
        print(ack_line)
        return 0
    finally:
        transport.close()


if __name__ == "__main__":
    sys.exit(main())
