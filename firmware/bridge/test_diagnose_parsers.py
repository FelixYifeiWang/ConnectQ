"""Unit tests for diagnose.py's pure-Python parser helpers.

Covers parse_report, plausibility_errors, match_activation_ack, and
match_reset_ack. No hardware or transport needed — runs without an
ESP32 attached. The hardware-facing end-to-end smoke test lives in
diagnose.py itself.
"""

from __future__ import annotations

import math
import unittest

from diagnose import (  # pyright: ignore[reportMissingImports]
    ReportValues,
    match_activation_ack,
    match_buzz_ack,
    match_heat_ack,
    match_reset_ack,
    parse_report,
    plausibility_errors,
)


SAMPLE_REPORT = """====== SENSOR REPORT ======
------ Thermistor ------
ADC raw: 2048
Voltage: 1.650 V
Resistance: 220000 ohms
Temp: 25.00 °C  |  77.00 °F
------ Moisture ------
ADC raw: 1024
Voltage: 0.825 V
Resistance: 186667 ohms
Moisture: 42.1 %
------------------------"""


SAMPLE_REPORT_WITH_HR = """====== SENSOR REPORT ======
------ Thermistor ------
ADC raw: 2048
Voltage: 1.650 V
Resistance: 220000 ohms
Temp: 25.00 °C  |  77.00 °F
------ Moisture ------
ADC raw: 1024
Voltage: 0.825 V
Resistance: 186667 ohms
Moisture: 42.1 %
------ Heart Rate ------
IR: 123456
BPM: 72.3
Avg BPM: 71
------------------------"""


SAMPLE_REPORT_HR_NO_SENSOR = """====== SENSOR REPORT ======
------ Thermistor ------
ADC raw: 2048
Voltage: 1.650 V
Resistance: 220000 ohms
Temp: 25.00 °C  |  77.00 °F
------ Moisture ------
ADC raw: 1024
Voltage: 0.825 V
Resistance: 186667 ohms
Moisture: 42.1 %
------ Heart Rate ------
Status: no sensor
------------------------"""


SAMPLE_REPORT_HR_TRACKING_OFF = """====== SENSOR REPORT ======
------ Thermistor ------
ADC raw: 2048
Voltage: 1.650 V
Resistance: 220000 ohms
Temp: 25.00 °C  |  77.00 °F
------ Moisture ------
ADC raw: 1024
Voltage: 0.825 V
Resistance: 186667 ohms
Moisture: 42.1 %
------ Heart Rate ------
Status: tracking off
------------------------"""


class ParseReportTests(unittest.TestCase):
    def test_parses_thermistor_raw(self):
        r = parse_report(SAMPLE_REPORT)
        self.assertIsNotNone(r)
        assert r is not None
        self.assertEqual(r.therm_raw, 2048)

    def test_parses_moisture_raw(self):
        r = parse_report(SAMPLE_REPORT)
        assert r is not None
        self.assertEqual(r.moist_raw, 1024)

    def test_parses_temperature(self):
        r = parse_report(SAMPLE_REPORT)
        assert r is not None
        self.assertAlmostEqual(r.temp_c, 25.0)

    def test_parses_moisture_percent(self):
        r = parse_report(SAMPLE_REPORT)
        assert r is not None
        self.assertAlmostEqual(r.moist_pct, 42.1)

    def test_returns_none_on_missing_field(self):
        broken = SAMPLE_REPORT.replace("Moisture: 42.1 %", "")
        self.assertIsNone(parse_report(broken))

    def test_adc_raws_are_separated_by_section(self):
        # Regression: thermistor ADC must not be used for moisture if
        # the moisture section is missing its own "ADC raw:" line.
        missing_moist_adc = SAMPLE_REPORT.replace(
            "ADC raw: 1024\nVoltage: 0.825 V", "Voltage: 0.825 V"
        )
        self.assertIsNone(parse_report(missing_moist_adc))

    def test_backward_compatible_without_hr_section(self):
        # Old-format report (no Heart Rate section) must still parse.
        r = parse_report(SAMPLE_REPORT)
        assert r is not None
        self.assertIsNone(r.heart_bpm)
        self.assertIsNone(r.heart_avg)

    def test_parses_hr_bpm(self):
        r = parse_report(SAMPLE_REPORT_WITH_HR)
        assert r is not None
        assert r.heart_bpm is not None
        self.assertAlmostEqual(r.heart_bpm, 72.3)

    def test_parses_hr_avg(self):
        r = parse_report(SAMPLE_REPORT_WITH_HR)
        assert r is not None
        self.assertEqual(r.heart_avg, 71)

    def test_hr_section_no_sensor_yields_none(self):
        # "Status: no sensor" in HR section -> heart_bpm/avg are None
        # but thermistor + moisture still parse successfully.
        r = parse_report(SAMPLE_REPORT_HR_NO_SENSOR)
        assert r is not None
        self.assertIsNone(r.heart_bpm)
        self.assertIsNone(r.heart_avg)
        self.assertAlmostEqual(r.temp_c, 25.0)
        self.assertAlmostEqual(r.moist_pct, 42.1)

    def test_hr_section_tracking_off_yields_none(self):
        # "Status: tracking off" (runtime toggle via hr_toggle.py) — same
        # treatment as no-sensor: BPM fields stay None, others parse.
        r = parse_report(SAMPLE_REPORT_HR_TRACKING_OFF)
        assert r is not None
        self.assertIsNone(r.heart_bpm)
        self.assertIsNone(r.heart_avg)
        self.assertAlmostEqual(r.temp_c, 25.0)


class PlausibilityTests(unittest.TestCase):
    def _base(self) -> ReportValues:
        return ReportValues(
            therm_raw=2000,
            temp_c=25.0,
            moist_raw=1000,
            moist_pct=50.0,
            heart_bpm=None,
            heart_avg=None,
        )

    def test_base_passes(self):
        self.assertEqual(plausibility_errors(self._base()), [])

    def test_flags_therm_adc_out_of_range(self):
        v = self._base()
        v.therm_raw = 5000
        self.assertTrue(plausibility_errors(v))

    def test_flags_moist_adc_out_of_range(self):
        v = self._base()
        v.moist_raw = -1
        self.assertTrue(plausibility_errors(v))

    def test_flags_temp_out_of_range(self):
        v = self._base()
        v.temp_c = 500.0
        self.assertTrue(plausibility_errors(v))

    def test_flags_non_finite_temp(self):
        v = self._base()
        v.temp_c = math.nan
        self.assertTrue(plausibility_errors(v))

    def test_flags_moisture_out_of_range(self):
        v = self._base()
        v.moist_pct = 150.0
        self.assertTrue(plausibility_errors(v))

    def test_heart_bpm_none_is_ok(self):
        v = self._base()
        v.heart_bpm = None
        v.heart_avg = None
        self.assertEqual(plausibility_errors(v), [])

    def test_heart_bpm_in_range_is_ok(self):
        v = self._base()
        v.heart_bpm = 72.0
        v.heart_avg = 71
        self.assertEqual(plausibility_errors(v), [])

    def test_flags_heart_bpm_too_high(self):
        v = self._base()
        v.heart_bpm = 500.0
        self.assertTrue(plausibility_errors(v))

    def test_flags_heart_bpm_too_low(self):
        v = self._base()
        v.heart_bpm = 10.0
        self.assertTrue(plausibility_errors(v))


class AckMatchTests(unittest.TestCase):
    def test_activation_ack(self):
        self.assertEqual(
            match_activation_ack("ACT right_top_haptic 2000us"),
            ("right_top_haptic", 2000),
        )

    def test_activation_ack_none_on_noise(self):
        self.assertIsNone(match_activation_ack("====== SENSOR REPORT ======"))

    def test_reset_ack(self):
        self.assertEqual(match_reset_ack("RESET all 1500us"), 1500)

    def test_reset_ack_none_on_act_line(self):
        self.assertIsNone(match_reset_ack("ACT ventilation 2000us"))

    def test_buzz_ack(self):
        self.assertEqual(match_buzz_ack("BUZZ pattern=alert"), "alert")

    def test_buzz_ack_none_on_noise(self):
        self.assertIsNone(match_buzz_ack("RESET all 1500us"))

    def test_heat_ack(self):
        self.assertEqual(match_heat_ack("HEAT on auto_off=30000ms"), 30000)

    def test_heat_ack_none_on_noise(self):
        self.assertIsNone(match_heat_ack("BUZZ pattern=alert"))


if __name__ == "__main__":
    unittest.main()
