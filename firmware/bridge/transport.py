"""Shared serial/WiFi transports for the SIXTH bridge scripts.

Both controller.py (keystroke forwarder) and diagnose.py (board smoke test)
talk to the Arduino over either USB serial or a TCP socket. The transport
classes implement a tiny Protocol so the callers can stay transport-agnostic.

When neither --serial nor --wifi is given, build_transport falls back to the
repo-root .board.conf (same file dev.sh / flash.sh read). Run
firmware/bridge/setup_board.py to populate it.
"""

from __future__ import annotations

import argparse
import socket
import sys
from pathlib import Path
from typing import Optional, Protocol


class Transport(Protocol):
    def send(self, data: bytes) -> None: ...
    def recv_nonblocking(self) -> bytes: ...
    def close(self) -> None: ...


class SerialTransport:
    def __init__(self, port: str, baud: int = 115200) -> None:
        import serial  # pyserial — imported lazily so --wifi doesn't need it

        self._ser = serial.Serial(port, baud, timeout=0)

    def send(self, data: bytes) -> None:
        self._ser.write(data)

    def recv_nonblocking(self) -> bytes:
        waiting = self._ser.in_waiting
        return self._ser.read(waiting) if waiting else b""

    def close(self) -> None:
        self._ser.close()


class WifiTransport:
    def __init__(self, host: str, port: int) -> None:
        sock = socket.create_connection((host, port), timeout=5)
        try:
            sock.setblocking(False)
        except OSError:
            sock.close()  # don't leak the FD if setblocking fails
            raise
        self._sock = sock

    def send(self, data: bytes) -> None:
        self._sock.sendall(data)

    def recv_nonblocking(self) -> bytes:
        try:
            return self._sock.recv(4096)
        except BlockingIOError:
            return b""

    def close(self) -> None:
        self._sock.close()


def parse_wifi_target(value: str) -> tuple[str, int]:
    if ":" not in value:
        raise argparse.ArgumentTypeError("WiFi target must be host:port")
    host, port_str = value.rsplit(":", 1)
    return host, int(port_str)


def add_transport_args(parser: argparse.ArgumentParser) -> None:
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--serial", help="Serial device path, e.g. /dev/tty.usbmodem1101")
    group.add_argument("--wifi", help="WiFi target host:port, e.g. 192.168.1.42:4040")
    parser.add_argument("--baud", type=int, default=115200, help="Serial baud (default 115200)")


def _repo_root() -> Path:
    # transport.py lives at firmware/bridge/transport.py → parents[2] is repo root.
    return Path(__file__).resolve().parents[2]


def _load_board_conf(path: Path) -> dict[str, str]:
    """Parse the repo-root .board.conf. Missing file returns an empty dict."""
    if not path.exists():
        return {}
    values: dict[str, str] = {}
    for raw in path.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        values[key.strip()] = value.strip()
    return values


def resolve_transport_args(args: argparse.Namespace, conf: dict[str, str]) -> None:
    """Fill args.serial or args.wifi from conf when neither flag was given."""
    if args.serial or args.wifi:
        return
    default = conf.get("DEFAULT_TRANSPORT", "")
    if default == "wifi":
        target = conf.get("WIFI_TARGET", "")
        if not target:
            raise SystemExit(
                "No --serial/--wifi given and WIFI_TARGET is empty in .board.conf. "
                "Run firmware/bridge/setup_board.py or pass --wifi <host:port>."
            )
        args.wifi = target
    elif default == "serial":
        target = conf.get("SERIAL_PORT", "")
        if not target:
            raise SystemExit(
                "No --serial/--wifi given and SERIAL_PORT is empty in .board.conf. "
                "Run firmware/bridge/setup_board.py or pass --serial <device>."
            )
        args.serial = target
    else:
        raise SystemExit(
            "No --serial/--wifi given and DEFAULT_TRANSPORT is not set in .board.conf. "
            "Run firmware/bridge/setup_board.py or pass --serial/--wifi explicitly."
        )


def resolve_args(args: argparse.Namespace) -> None:
    """Populate args.serial/wifi from the repo's .board.conf if neither was given."""
    if args.serial or args.wifi:
        return
    resolve_transport_args(args, _load_board_conf(_repo_root() / ".board.conf"))


def load_board_conf() -> dict[str, str]:
    """Return the parsed repo-root .board.conf, or an empty dict if missing."""
    return _load_board_conf(_repo_root() / ".board.conf")


def build_transport(args: argparse.Namespace) -> Transport:
    """Build the Transport for this invocation, with automatic fallback.

    - If the caller passed --serial or --wifi, honour it exactly (no fallback).
    - Otherwise: read .board.conf and try the preferred transport first. If it
      fails (e.g. WiFi unreachable because the board has no IP, or the AP is
      down), fall back to whichever other transport is configured.
    """
    if args.serial:
        return SerialTransport(args.serial, baud=args.baud)
    if args.wifi:
        host, port = parse_wifi_target(args.wifi)
        return WifiTransport(host, port)

    conf = load_board_conf()
    default = conf.get("DEFAULT_TRANSPORT", "").strip().lower()
    wifi_target = conf.get("WIFI_TARGET", "").strip()
    serial_port = conf.get("SERIAL_PORT", "").strip()

    if default == "serial":
        attempts: list[tuple[str, str]] = [("serial", serial_port), ("wifi", wifi_target)]
    else:
        # Covers default == "wifi" and the unset case.
        attempts = [("wifi", wifi_target), ("serial", serial_port)]

    last_err: Optional[Exception] = None
    for kind, target in attempts:
        if not target:
            continue
        try:
            if kind == "wifi":
                host, port = parse_wifi_target(target)
                print(f"Trying WiFi at {target}...", file=sys.stderr)
                return WifiTransport(host, port)
            print(f"Using serial {target}.", file=sys.stderr)
            return SerialTransport(target, baud=args.baud)
        except OSError as e:
            print(f"  {kind} connect failed: {e}; trying next transport.", file=sys.stderr)
            last_err = e

    if last_err is not None:
        raise SystemExit(f"No usable transport: all attempts failed. Last error: {last_err}")
    raise SystemExit(
        "No --serial/--wifi given and .board.conf has neither SERIAL_PORT nor "
        "WIFI_TARGET set. Run firmware/bridge/setup_board.py or pass --serial/--wifi."
    )
