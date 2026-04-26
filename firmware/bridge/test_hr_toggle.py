"""Unit tests for hr_toggle.py's pure helpers."""

from __future__ import annotations

import unittest

from hr_toggle import (  # pyright: ignore[reportMissingImports]
    format_hr_command,
    parse_hr_ack,
)


class FormatHrCommandTests(unittest.TestCase):
    def test_on(self):
        self.assertEqual(format_hr_command("on"), "HR 1\n")

    def test_off(self):
        self.assertEqual(format_hr_command("off"), "HR 0\n")

    def test_status(self):
        self.assertEqual(format_hr_command("status"), "HR ?\n")

    def test_rejects_unknown(self):
        with self.assertRaises(ValueError):
            format_hr_command("toggle")


class ParseHrAckTests(unittest.TestCase):
    def test_on_ack(self):
        self.assertEqual(parse_hr_ack("HR ok tracking=on"), "on")

    def test_off_ack(self):
        self.assertEqual(parse_hr_ack("HR ok tracking=off"), "off")

    def test_state_query_on(self):
        self.assertEqual(parse_hr_ack("HR tracking=on"), "on")

    def test_state_query_off(self):
        self.assertEqual(parse_hr_ack("HR tracking=off"), "off")

    def test_ignores_unrelated_lines(self):
        self.assertIsNone(parse_hr_ack("CAL ok temp_off=1.50"))
        self.assertIsNone(parse_hr_ack("Motor ON"))
        self.assertIsNone(parse_hr_ack(""))

    def test_rejects_malformed_state(self):
        self.assertIsNone(parse_hr_ack("HR tracking=maybe"))


if __name__ == "__main__":
    unittest.main()
