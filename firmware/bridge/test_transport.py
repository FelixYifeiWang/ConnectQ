"""Unit tests for transport.py's .board.conf loader and arg resolver."""

from __future__ import annotations

import argparse
import tempfile
import unittest
from pathlib import Path

from transport import (  # pyright: ignore[reportMissingImports]
    _load_board_conf,
    resolve_transport_args,
)


def _args(serial: str | None = None, wifi: str | None = None) -> argparse.Namespace:
    return argparse.Namespace(serial=serial, wifi=wifi, baud=115200)


class LoadBoardConfTests(unittest.TestCase):
    def test_parses_key_value_pairs(self):
        with tempfile.NamedTemporaryFile("w", suffix=".conf", delete=False) as f:
            f.write("SERIAL_PORT=/dev/tty.usbmodem1\nWIFI_TARGET=1.2.3.4:4040\n")
            path = Path(f.name)
        try:
            conf = _load_board_conf(path)
            self.assertEqual(conf["SERIAL_PORT"], "/dev/tty.usbmodem1")
            self.assertEqual(conf["WIFI_TARGET"], "1.2.3.4:4040")
        finally:
            path.unlink()

    def test_skips_comments_and_blank_lines(self):
        with tempfile.NamedTemporaryFile("w", suffix=".conf", delete=False) as f:
            f.write("# a comment\n\nDEFAULT_TRANSPORT=wifi\n  \n# another\n")
            path = Path(f.name)
        try:
            conf = _load_board_conf(path)
            self.assertEqual(conf, {"DEFAULT_TRANSPORT": "wifi"})
        finally:
            path.unlink()

    def test_missing_file_returns_empty(self):
        self.assertEqual(_load_board_conf(Path("/nonexistent/.board.conf")), {})

    def test_strips_whitespace_around_values(self):
        with tempfile.NamedTemporaryFile("w", suffix=".conf", delete=False) as f:
            f.write("SERIAL_PORT = /dev/tty.foo \n")
            path = Path(f.name)
        try:
            self.assertEqual(_load_board_conf(path)["SERIAL_PORT"], "/dev/tty.foo")
        finally:
            path.unlink()


class ResolveTransportArgsTests(unittest.TestCase):
    def test_explicit_serial_is_noop(self):
        args = _args(serial="/dev/tty.explicit")
        resolve_transport_args(args, {"DEFAULT_TRANSPORT": "wifi", "WIFI_TARGET": "x:1"})
        self.assertEqual(args.serial, "/dev/tty.explicit")
        self.assertIsNone(args.wifi)

    def test_explicit_wifi_is_noop(self):
        args = _args(wifi="10.0.0.1:4040")
        resolve_transport_args(args, {"DEFAULT_TRANSPORT": "serial", "SERIAL_PORT": "/dev/x"})
        self.assertEqual(args.wifi, "10.0.0.1:4040")
        self.assertIsNone(args.serial)

    def test_fills_wifi_from_conf(self):
        args = _args()
        resolve_transport_args(
            args, {"DEFAULT_TRANSPORT": "wifi", "WIFI_TARGET": "192.168.1.2:4040"}
        )
        self.assertEqual(args.wifi, "192.168.1.2:4040")
        self.assertIsNone(args.serial)

    def test_fills_serial_from_conf(self):
        args = _args()
        resolve_transport_args(
            args, {"DEFAULT_TRANSPORT": "serial", "SERIAL_PORT": "/dev/tty.fromconf"}
        )
        self.assertEqual(args.serial, "/dev/tty.fromconf")
        self.assertIsNone(args.wifi)

    def test_raises_when_default_transport_missing(self):
        with self.assertRaises(SystemExit):
            resolve_transport_args(_args(), {})

    def test_raises_when_wifi_default_but_target_empty(self):
        with self.assertRaises(SystemExit):
            resolve_transport_args(_args(), {"DEFAULT_TRANSPORT": "wifi", "WIFI_TARGET": ""})

    def test_raises_when_serial_default_but_port_empty(self):
        with self.assertRaises(SystemExit):
            resolve_transport_args(_args(), {"DEFAULT_TRANSPORT": "serial", "SERIAL_PORT": ""})


if __name__ == "__main__":
    unittest.main()
