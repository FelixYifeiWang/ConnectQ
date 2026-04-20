"""Keybinding controller for the SIXTH Arduino sketch.

Captures single keystrokes in the terminal and forwards them to the Arduino
over USB serial or a WiFi TCP connection. Keys 1-5 activate the five PWM
outputs (haptics + ventilation) at 2000us; R resets all five to 1500us.

Usage:
    python controller.py                                # uses .board.conf defaults
    python controller.py --serial /dev/tty.usbmodem1101
    python controller.py --wifi 192.168.1.42:4040

Ctrl-C to quit. Terminal must stay focused to capture keys.
"""

from __future__ import annotations

import argparse
import sys
import termios
import tty
from contextlib import contextmanager

from transport import Transport, add_transport_args, build_transport  # pyright: ignore[reportMissingImports]


VALID_KEYS = set("12345Rr")


@contextmanager
def raw_terminal():
    fd = sys.stdin.fileno()
    original = termios.tcgetattr(fd)
    try:
        tty.setcbreak(fd)
        yield
    finally:
        termios.tcsetattr(fd, termios.TCSADRAIN, original)


def run(transport: Transport) -> None:
    print("Controller ready. Keys: 1-5 activate, R reset, Ctrl-C to quit.")
    with raw_terminal():
        while True:
            ch = sys.stdin.read(1)
            if not ch:
                continue
            if ch == "\x03":  # Ctrl-C
                raise KeyboardInterrupt
            if ch not in VALID_KEYS:
                continue
            transport.send(ch.encode("ascii"))
            ack = transport.recv_nonblocking().decode("ascii", errors="replace")
            if ack:
                sys.stdout.write(ack)
                sys.stdout.flush()


def main() -> int:
    parser = argparse.ArgumentParser(description="Forward keystrokes to the SIXTH Arduino over serial or WiFi.")
    add_transport_args(parser)
    args = parser.parse_args()

    transport = build_transport(args)
    try:
        run(transport)
    except KeyboardInterrupt:
        print("\nExiting.")
    finally:
        transport.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
