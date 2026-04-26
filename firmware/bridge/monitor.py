"""Continuously print everything the SIXTH board sends.

A passive tail — no keystrokes are forwarded, the script just prints whatever
arrives over USB serial or the WiFi TCP socket. Useful for watching raw sensor
reports stream by while experimenting with calibration or hardware.

Usage:
    python monitor.py                                # auto: WiFi first, serial fallback
    python monitor.py --serial /dev/tty.usbmodem1101 # force serial
    python monitor.py --wifi 192.168.1.42:4040       # force wifi

Default behaviour (no flags): try WIFI_TARGET from .board.conf first, and fall
back to SERIAL_PORT if the WiFi connection fails or no WIFI_TARGET is set.
Ctrl-C to quit.
"""

from __future__ import annotations

import argparse
import sys
import time

from transport import (  # pyright: ignore[reportMissingImports]
    Transport,
    add_transport_args,
    build_transport,
)


POLL_INTERVAL_S = 0.05


def run(transport: Transport) -> None:
    print("Monitor ready. Ctrl-C to quit.", file=sys.stderr)
    while True:
        chunk = transport.recv_nonblocking()
        if chunk:
            sys.stdout.write(chunk.decode("utf-8", errors="replace"))
            sys.stdout.flush()
        else:
            time.sleep(POLL_INTERVAL_S)


def main() -> int:
    parser = argparse.ArgumentParser(description="Continuously print data streamed from the SIXTH board.")
    add_transport_args(parser)
    args = parser.parse_args()

    try:
        transport = build_transport(args)
    except Exception as e:
        print(f"FAIL connect: {e}", file=sys.stderr)
        return 1

    try:
        run(transport)
    except KeyboardInterrupt:
        print("\nExiting.", file=sys.stderr)
    finally:
        transport.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
