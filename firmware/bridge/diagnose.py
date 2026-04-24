"""Smoke test for a connected SIXTH board.

Connects to the Arduino over USB serial or WiFi, waits for a sensor report,
verifies the parsed values are plausible, and pings each activation key
(1-5) plus reset (R) to confirm both reading and writing work end-to-end.
Prints a PASS/FAIL line per check and exits non-zero on any failure.

Usage:
    python diagnose.py                                # uses .board.conf defaults
    python diagnose.py --serial /dev/tty.usbmodem1101
    python diagnose.py --wifi 192.168.1.42:4040
"""

from __future__ import annotations

import argparse
import math
import re
import sys
import time
from dataclasses import dataclass
from typing import Callable, Optional

from transport import Transport, add_transport_args, build_transport, resolve_args  # pyright: ignore[reportMissingImports]


REPORT_START = "====== SENSOR REPORT ======"
REPORT_END = "------------------------"
THERM_HEADER = "------ Thermistor ------"
MOIST_HEADER = "------ Moisture ------"
HR_HEADER = "------ Heart Rate ------"

_ADC_RAW_RE = re.compile(r"ADC raw:\s*(\d+)")
_TEMP_RE = re.compile(r"Temp:\s*([-+]?\d+(?:\.\d+)?)\s*°?C")
_MOIST_RE = re.compile(r"Moisture:\s*([-+]?\d+(?:\.\d+)?)\s*%")
_BPM_RE = re.compile(r"BPM:\s*([-+]?\d+(?:\.\d+)?)")
_AVG_BPM_RE = re.compile(r"Avg BPM:\s*(\d+)")
_ACK_ACT_RE = re.compile(r"ACT\s+(\S+)\s+(\d+)us")
_ACK_RESET_RE = re.compile(r"RESET\s+all\s+(\d+)us")
_ACK_BUZZ_RE = re.compile(r"BUZZ\s+pattern=(\w+)")
_ACK_HEAT_RE = re.compile(r"HEAT\s+on\s+auto_off=(\d+)ms")

KEY_TO_NAME = {
    "1": "right_top_haptic",
    "2": "right_bottom_haptic",
    "3": "left_bottom_haptic",
    "4": "ventilation",
    "5": "left_top_haptic",
}


@dataclass
class ReportValues:
    therm_raw: int
    temp_c: float
    moist_raw: int
    moist_pct: float
    heart_bpm: Optional[float] = None
    heart_avg: Optional[int] = None


# ---- Pure parsers (unit-testable without hardware) ----

def parse_report(block: str) -> Optional[ReportValues]:
    """Extract therm/moisture values from one sensor report block.

    Returns None if the block is missing any expected field.
    """
    therm_raw: Optional[int] = None
    temp_c: Optional[float] = None
    moist_raw: Optional[int] = None
    moist_pct: Optional[float] = None
    heart_bpm: Optional[float] = None
    heart_avg: Optional[int] = None

    in_therm = False
    in_moist = False
    in_hr = False
    for line in block.splitlines():
        if THERM_HEADER in line:
            in_therm, in_moist, in_hr = True, False, False
            continue
        if MOIST_HEADER in line:
            in_therm, in_moist, in_hr = False, True, False
            continue
        if HR_HEADER in line:
            in_therm, in_moist, in_hr = False, False, True
            continue
        adc = _ADC_RAW_RE.search(line)
        if adc:
            if in_therm and therm_raw is None:
                therm_raw = int(adc.group(1))
            elif in_moist and moist_raw is None:
                moist_raw = int(adc.group(1))
            continue
        temp = _TEMP_RE.search(line)
        if temp:
            temp_c = float(temp.group(1))
            continue
        moist = _MOIST_RE.search(line)
        if moist:
            moist_pct = float(moist.group(1))
            continue
        if in_hr:
            # Avg BPM must be matched before BPM (substring overlap).
            avg = _AVG_BPM_RE.search(line)
            if avg:
                heart_avg = int(avg.group(1))
                continue
            bpm = _BPM_RE.search(line)
            if bpm:
                heart_bpm = float(bpm.group(1))

    if therm_raw is None or temp_c is None or moist_raw is None or moist_pct is None:
        return None
    return ReportValues(
        therm_raw=therm_raw,
        temp_c=temp_c,
        moist_raw=moist_raw,
        moist_pct=moist_pct,
        heart_bpm=heart_bpm,
        heart_avg=heart_avg,
    )


def plausibility_errors(r: ReportValues) -> list[str]:
    """Return human-readable errors for sensor values; empty list = all plausible."""
    errs: list[str] = []
    if not (0 <= r.therm_raw <= 4095):
        errs.append(f"thermistor ADC raw out of range: {r.therm_raw}")
    if not (0 <= r.moist_raw <= 4095):
        errs.append(f"moisture ADC raw out of range: {r.moist_raw}")
    if not math.isfinite(r.temp_c):
        errs.append(f"temperature non-finite: {r.temp_c}")
    elif not (-40.0 <= r.temp_c <= 100.0):
        errs.append(f"temperature out of plausible range: {r.temp_c:.2f}°C (expected -40..100)")
    if not math.isfinite(r.moist_pct):
        errs.append(f"moisture non-finite: {r.moist_pct}")
    elif not (0.0 <= r.moist_pct <= 100.0):
        errs.append(f"moisture percent out of range: {r.moist_pct:.1f}% (expected 0..100)")
    if r.heart_bpm is not None:
        if not math.isfinite(r.heart_bpm):
            errs.append(f"heart rate non-finite: {r.heart_bpm}")
        elif not (40.0 <= r.heart_bpm <= 200.0):
            errs.append(f"heart rate out of plausible range: {r.heart_bpm:.1f} BPM (expected 40..200)")
    return errs


def match_activation_ack(line: str) -> Optional[tuple[str, int]]:
    m = _ACK_ACT_RE.search(line)
    return (m.group(1), int(m.group(2))) if m else None


def match_reset_ack(line: str) -> Optional[int]:
    m = _ACK_RESET_RE.search(line)
    return int(m.group(1)) if m else None


def match_buzz_ack(line: str) -> Optional[str]:
    m = _ACK_BUZZ_RE.search(line)
    return m.group(1) if m else None


def match_heat_ack(line: str) -> Optional[int]:
    m = _ACK_HEAT_RE.search(line)
    return int(m.group(1)) if m else None


# ---- Hardware-facing helpers ----

class LineReader:
    """Buffers bytes from a Transport and yields complete \\n-delimited lines."""

    def __init__(self, transport: Transport) -> None:
        self._t = transport
        self._buf = b""

    def poll(self) -> list[str]:
        data = self._t.recv_nonblocking()
        if data:
            self._buf += data
        lines: list[str] = []
        while b"\n" in self._buf:
            raw, self._buf = self._buf.split(b"\n", 1)
            lines.append(raw.decode("utf-8", errors="replace").rstrip("\r"))
        return lines


def wait_for_report(reader: LineReader, timeout_s: float) -> Optional[str]:
    deadline = time.monotonic() + timeout_s
    collecting = False
    block: list[str] = []
    while time.monotonic() < deadline:
        for line in reader.poll():
            if REPORT_START in line:
                collecting = True
                block = [line]
                continue
            if collecting:
                block.append(line)
                if REPORT_END in line:
                    return "\n".join(block)
        time.sleep(0.05)
    return None


def wait_for_line(
    reader: LineReader,
    predicate: Callable[[str], bool],
    timeout_s: float,
) -> Optional[str]:
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        for line in reader.poll():
            if predicate(line):
                return line
        time.sleep(0.02)
    return None


# ---- Check runner ----

@dataclass
class CheckResult:
    name: str
    ok: bool
    detail: str


def _is_ack_for(expected_name: str) -> Callable[[str], bool]:
    def _pred(line: str) -> bool:
        ack = match_activation_ack(line)
        return ack is not None and ack[0] == expected_name
    return _pred


def _is_reset_ack(line: str) -> bool:
    return match_reset_ack(line) is not None


def _is_buzz_ack(line: str) -> bool:
    return match_buzz_ack(line) is not None


def _is_heat_ack(line: str) -> bool:
    return match_heat_ack(line) is not None


def run_diagnostics(transport: Transport, timeout_s: float) -> list[CheckResult]:
    results: list[CheckResult] = []
    reader = LineReader(transport)

    block = wait_for_report(reader, timeout_s)
    if block is None:
        results.append(CheckResult(
            "Sensor report received",
            False,
            f"no report in {timeout_s:.1f}s — check power, baud, or WiFi link",
        ))
        return results
    results.append(CheckResult(
        "Sensor report received", True, f"within {timeout_s:.1f}s"
    ))

    values = parse_report(block)
    if values is None:
        results.append(CheckResult(
            "Sensor report parses",
            False,
            "missing one of: thermistor ADC raw, temperature, moisture ADC raw, moisture %",
        ))
        return results
    results.append(CheckResult(
        "Sensor report parses",
        True,
        f"therm_raw={values.therm_raw}, moist_raw={values.moist_raw}",
    ))

    errs = plausibility_errors(values)
    if errs:
        results.append(CheckResult("Sensor values plausible", False, "; ".join(errs)))
    else:
        results.append(CheckResult(
            "Sensor values plausible",
            True,
            f"temp={values.temp_c:.2f}°C, moist={values.moist_pct:.1f}%",
        ))

    for key, expected_name in KEY_TO_NAME.items():
        transport.send(key.encode("ascii"))
        matched = wait_for_line(reader, _is_ack_for(expected_name), timeout_s=1.5)
        if matched is None:
            results.append(CheckResult(
                f"Activate key '{key}' ({expected_name})",
                False,
                "no matching ACT ack within 1.5s",
            ))
        else:
            results.append(CheckResult(
                f"Activate key '{key}' ({expected_name})",
                True,
                matched.strip(),
            ))

    transport.send(b"6")
    matched = wait_for_line(reader, _is_buzz_ack, timeout_s=1.5)
    if matched is None:
        results.append(CheckResult("Buzzer key '6'", False, "no BUZZ ack within 1.5s"))
    else:
        results.append(CheckResult("Buzzer key '6'", True, matched.strip()))

    transport.send(b"7")
    matched = wait_for_line(reader, _is_heat_ack, timeout_s=1.5)
    if matched is None:
        results.append(CheckResult("Heater key '7'", False, "no HEAT ack within 1.5s"))
    else:
        results.append(CheckResult("Heater key '7'", True, matched.strip()))

    transport.send(b"R")
    matched = wait_for_line(reader, _is_reset_ack, timeout_s=1.5)
    if matched is None:
        results.append(CheckResult("Reset key 'R'", False, "no RESET ack within 1.5s"))
    else:
        results.append(CheckResult("Reset key 'R'", True, matched.strip()))

    return results


def print_results(results: list[CheckResult]) -> bool:
    print()
    print("--- SIXTH board diagnostics ---")
    all_ok = True
    for i, r in enumerate(results, 1):
        status = "OK  " if r.ok else "FAIL"
        print(f"[{i}/{len(results)}] {status}  {r.name}")
        if r.detail:
            print(f"         {r.detail}")
        all_ok = all_ok and r.ok
    print()
    if all_ok:
        print(f"All {len(results)} checks passed")
    else:
        n_fail = sum(1 for r in results if not r.ok)
        print(f"{n_fail} check(s) failed")
    return all_ok


def main() -> int:
    parser = argparse.ArgumentParser(description="Smoke-test a connected SIXTH board over serial or WiFi.")
    add_transport_args(parser)
    parser.add_argument("--timeout", type=float, default=5.0, help="Seconds to wait for first sensor report (default 5)")
    args = parser.parse_args()
    resolve_args(args)

    target = f"serial {args.serial}" if args.serial else f"wifi {args.wifi}"
    print(f"Connecting to board ({target})...")
    try:
        transport = build_transport(args)
    except Exception as e:
        print(f"FAIL  Connect: {e}")
        return 1

    try:
        results = run_diagnostics(transport, args.timeout)
    finally:
        transport.close()

    return 0 if print_results(results) else 1


if __name__ == "__main__":
    sys.exit(main())
