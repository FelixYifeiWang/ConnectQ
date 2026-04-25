"""Unit tests for calibrate.py pure-python helpers.

Covers offset math, command formatting, and calibration ack parsing. No
hardware or transport needed — runs without an ESP32 attached. The
hardware-facing flow lives in the three calibrate_* entry scripts.
"""

from __future__ import annotations

import unittest

from calibrate import (  # pyright: ignore[reportMissingImports]
    compute_offset,
    format_set_command,
    parse_cal_ack,
    parse_cal_get,
)


class ComputeOffsetTests(unittest.TestCase):
    def test_reference_above_reported(self):
        self.assertAlmostEqual(compute_offset(reported=23.8, reference=22.0), -1.8)

    def test_reference_below_reported(self):
        self.assertAlmostEqual(compute_offset(reported=65.0, reference=72.0), 7.0)

    def test_zero_when_equal(self):
        self.assertAlmostEqual(compute_offset(reported=22.0, reference=22.0), 0.0)


class FormatSetCommandTests(unittest.TestCase):
    def test_temp_negative_offset(self):
        self.assertEqual(format_set_command("T", -1.80), "CT -1.80\n")

    def test_moist_zero_offset(self):
        self.assertEqual(format_set_command("M", 0.0), "CM 0.00\n")

    def test_heart_positive_offset(self):
        self.assertEqual(format_set_command("H", 7.0), "CH 7.00\n")

    def test_rejects_unknown_sensor_key(self):
        with self.assertRaises(ValueError):
            format_set_command("X", 1.0)


class ParseCalAckTests(unittest.TestCase):
    def test_set_temp_ack(self):
        self.assertEqual(parse_cal_ack("CAL ok temp_off=-1.80"), ("temp_off", -1.80))

    def test_set_moist_ack(self):
        self.assertEqual(parse_cal_ack("CAL ok moist_off=2.50"), ("moist_off", 2.50))

    def test_set_heart_ack(self):
        self.assertEqual(parse_cal_ack("CAL ok heart_off=-7.00"), ("heart_off", -7.00))

    def test_cleared_ack(self):
        self.assertEqual(parse_cal_ack("CAL ok cleared"), ("cleared", None))

    def test_none_on_noise(self):
        self.assertIsNone(parse_cal_ack("BUZZ pattern=alert"))

    def test_none_on_empty(self):
        self.assertIsNone(parse_cal_ack(""))


class ParseCalGetTests(unittest.TestCase):
    def test_all_zero(self):
        self.assertEqual(
            parse_cal_get("CAL temp_off=0.00 moist_off=0.00 heart_off=0.00"),
            {"temp_off": 0.0, "moist_off": 0.0, "heart_off": 0.0},
        )

    def test_mixed_signs(self):
        self.assertEqual(
            parse_cal_get("CAL temp_off=-52.97 moist_off=2.50 heart_off=-7.00"),
            {"temp_off": -52.97, "moist_off": 2.5, "heart_off": -7.0},
        )

    def test_explicit_plus_sign(self):
        self.assertEqual(
            parse_cal_get("CAL temp_off=+1.32 moist_off=+0.00 heart_off=+0.00"),
            {"temp_off": 1.32, "moist_off": 0.0, "heart_off": 0.0},
        )

    def test_none_on_ack_line(self):
        self.assertIsNone(parse_cal_get("CAL ok temp_off=-1.80"))

    def test_none_on_empty(self):
        self.assertIsNone(parse_cal_get(""))


if __name__ == "__main__":
    unittest.main()
