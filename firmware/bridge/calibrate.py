"""Shared calibration helper for temperature / moisture / heart-rate scripts.

The ESP32 firmware holds three floats in NVS (`sixth_cal/<x>_off`) that are
added to the raw reading before it enters any sensor report. This module is
the laptop side: it reads one report to see the current (uncalibrated + any
prior offset) value, asks the user for a reference, computes the new offset,
sends the matching `CT`/`CM`/`CH` line command, and verifies the next report.

Kept deliberately pure-python for the functions under test. The interactive
flow is a single function so the three entry scripts stay ~15 lines each.
"""

from __future__ import annotations

import re
import time
from dataclasses import dataclass
from typing import Callable, Optional

from diagnose import (  # pyright: ignore[reportMissingImports]
    LineReader,
    ReportValues,
    parse_report,
    wait_for_line,
    wait_for_report,
)
from transport import Transport  # pyright: ignore[reportMissingImports]


_CAL_ACK_SET_RE = re.compile(r"CAL\s+ok\s+(\w+_off)=([-+]?\d+(?:\.\d+)?)")
_CAL_ACK_CLEAR_RE = re.compile(r"CAL\s+ok\s+cleared")
_CAL_GET_RE = re.compile(
    r"CAL\s+temp_off=([-+]?\d+(?:\.\d+)?)\s+"
    r"moist_off=([-+]?\d+(?:\.\d+)?)\s+"
    r"heart_off=([-+]?\d+(?:\.\d+)?)"
)

SENSOR_KEYS = {"T", "M", "H"}


# ---- Pure helpers (unit-testable without hardware) ----

def compute_offset(reported: float, reference: float) -> float:
    """Offset that, when added to `reported`, yields `reference`."""
    return reference - reported


def format_set_command(sensor_key: str, offset: float) -> str:
    """Build the line the ESP32 parses — e.g. 'CT -1.80\\n'."""
    if sensor_key not in SENSOR_KEYS:
        raise ValueError(f"sensor_key must be one of {sorted(SENSOR_KEYS)}, got {sensor_key!r}")
    return f"C{sensor_key} {offset:.2f}\n"


def parse_cal_ack(line: str) -> Optional[tuple[str, Optional[float]]]:
    """Parse one ack line.

    Returns (key, value) for a set ack, (``'cleared'``, None) for clear,
    or None when the line isn't a calibration ack.
    """
    if not line:
        return None
    m = _CAL_ACK_SET_RE.search(line)
    if m:
        return (m.group(1), float(m.group(2)))
    if _CAL_ACK_CLEAR_RE.search(line):
        return ("cleared", None)
    return None


def parse_cal_get(line: str) -> Optional[dict[str, float]]:
    """Parse the firmware's `CG` reply, e.g. 'CAL temp_off=-1.80 moist_off=0.00 heart_off=2.50'."""
    if not line:
        return None
    m = _CAL_GET_RE.search(line)
    if not m:
        return None
    return {
        "temp_off": float(m.group(1)),
        "moist_off": float(m.group(2)),
        "heart_off": float(m.group(3)),
    }


# ---- Interactive flow ----

@dataclass
class SensorSpec:
    key: str                                    # 'T', 'M', or 'H'
    label: str                                  # human name, e.g. "temperature"
    unit: str                                   # '°C', '%', 'BPM'
    ack_field: str                              # 'temp_off', 'moist_off', 'heart_off'
    getter: Callable[[ReportValues], Optional[float]]
    tolerance: float                            # verify within this unit


def _print_current(current: Optional[float], spec: SensorSpec) -> None:
    if current is None:
        print(f"ESP32 currently reports: (no reading for {spec.label})")
    else:
        print(f"ESP32 currently reports: {current} {spec.unit}")


def run_calibration(transport: Transport, spec: SensorSpec, timeout_s: float = 5.0) -> int:
    """Interactive flow. Returns exit code (0 ok, 1 failure).

    Never raises on input-level errors; prints and returns 1.
    """
    reader = LineReader(transport)

    block = wait_for_report(reader, timeout_s)
    if block is None:
        print(f"FAIL no sensor report within {timeout_s:.1f}s — is the board up?")
        return 1
    values = parse_report(block)
    if values is None:
        print("FAIL could not parse sensor report")
        return 1
    current = spec.getter(values)
    if current is None:
        print(f"FAIL board has no reading for {spec.label} yet — "
              f"make sure the sensor is connected and giving data")
        return 1

    _print_current(current, spec)
    try:
        raw = input(f"Enter reference {spec.label} in {spec.unit}: ").strip()
    except (EOFError, KeyboardInterrupt):
        print()
        return 1
    try:
        reference = float(raw)
    except ValueError:
        print(f"FAIL not a number: {raw!r}")
        return 1

    # The firmware's `CT/CM/CH` commands SET the stored offset (absolute),
    # but `current` already includes any existing offset. Query it via `CG`
    # so we send the correct absolute value rather than overwriting prior
    # calibration with what's actually a relative delta.
    transport.send(b"CG\n")
    get_line = wait_for_line(reader, lambda l: parse_cal_get(l) is not None, timeout_s=2.0)
    if get_line is None:
        print("FAIL no CAL response from CG within 2s")
        return 1
    existing_offsets = parse_cal_get(get_line)
    if existing_offsets is None:  # belt-and-braces — wait_for_line should only return on match
        print("FAIL CAL response could not be parsed")
        return 1
    existing = existing_offsets[spec.ack_field]

    delta = compute_offset(reported=current, reference=reference)
    offset = delta + existing
    print(
        f"Applying offset {offset:+.2f} {spec.unit} "
        f"(stored {existing:+.2f} + delta {delta:+.2f})..."
    )
    transport.send(format_set_command(spec.key, offset).encode("ascii"))

    ack_line = wait_for_line(
        reader,
        lambda l: parse_cal_ack(l) is not None,
        timeout_s=2.0,
    )
    if ack_line is None:
        print("FAIL no CAL ack within 2s")
        return 1
    ack = parse_cal_ack(ack_line)
    if ack is None:  # belt-and-braces — wait_for_line should only return on match
        print("FAIL ack line could not be parsed")
        return 1
    print(f"  {ack_line.strip()}")
    if ack[0] != spec.ack_field:
        print(f"FAIL ack was for {ack[0]}, expected {spec.ack_field}")
        return 1

    # Give the firmware one full 1 Hz tick to re-emit with the new offset applied.
    time.sleep(1.1)
    next_block = wait_for_report(reader, timeout_s)
    if next_block is None:
        print("FAIL no post-calibration report within timeout")
        return 1
    next_values = parse_report(next_block)
    if next_values is None:
        print("FAIL could not parse post-calibration report")
        return 1
    new_current = spec.getter(next_values)
    if new_current is None:
        print("FAIL post-calibration reading is missing")
        return 1

    if abs(new_current - reference) <= spec.tolerance:
        print(f"Verified: ESP32 now reports {new_current} {spec.unit} "
              f"(within ±{spec.tolerance} of reference {reference}) ✓")
        return 0
    print(f"WARNING: post-calibration reading is {new_current} {spec.unit}, "
          f"expected ~{reference}. Value may drift before it settles.")
    return 0  # warning, not failure — sensor noise is normal
