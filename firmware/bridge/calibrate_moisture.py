"""Interactive moisture calibration — 1-point offset, stored in ESP32 NVS.

Usage:
    python calibrate_moisture.py                         # uses .board.conf
    python calibrate_moisture.py --serial /dev/tty.usbmodem1101
    python calibrate_moisture.py --wifi 192.168.1.42:4040

Procedure:
    1. Hold the moisture sensor in a reference state (dry in air = 0%,
       fully saturated = 100%).
    2. Run the script. It reads the current ESP32 moisture %.
    3. Enter the reference % (0 if dry, 100 if soaked).
    4. Script sends the offset to the board; saved to NVS flash.
"""

from __future__ import annotations

import argparse
import sys

from calibrate import SensorSpec, run_calibration  # pyright: ignore[reportMissingImports]
from transport import add_transport_args, build_transport  # pyright: ignore[reportMissingImports]


SPEC = SensorSpec(
    key="M",
    label="moisture",
    unit="%",
    ack_field="moist_off",
    getter=lambda r: r.moist_pct,
    tolerance=2.0,  # ±2 % — resistive moisture is noisier than temp
)


def main() -> int:
    parser = argparse.ArgumentParser(description="Interactive moisture calibration (1-point offset)")
    add_transport_args(parser)
    args = parser.parse_args()

    print("Connecting to board...")
    try:
        transport = build_transport(args)
    except Exception as e:
        print(f"FAIL connect: {e}")
        return 1

    try:
        return run_calibration(transport, SPEC)
    finally:
        transport.close()


if __name__ == "__main__":
    sys.exit(main())
