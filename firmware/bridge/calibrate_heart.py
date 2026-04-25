"""Interactive heart-rate calibration — 1-point offset, stored in ESP32 NVS.

Usage:
    python calibrate_heart.py                            # uses .board.conf
    python calibrate_heart.py --serial /dev/tty.usbmodem1101
    python calibrate_heart.py --wifi 192.168.1.42:4040

Procedure:
    1. Keep a finger on the MAX30102 for at least 10 s so the 8-sample
       rolling average has stabilised.
    2. Take a simultaneous reference reading with a chest strap or medical
       pulse-ox.
    3. Run the script and enter the reference BPM.
    4. Script sends the offset to the board; saved to NVS flash.

Notes:
    HR varies naturally breath-to-breath. Calibrate at rest for the most
    stable comparison. Re-run if you see consistent drift — a single
    measurement on a noisy signal isn't the whole picture.
"""

from __future__ import annotations

import argparse
import sys

from calibrate import SensorSpec, run_calibration  # pyright: ignore[reportMissingImports]
from transport import add_transport_args, build_transport  # pyright: ignore[reportMissingImports]


SPEC = SensorSpec(
    key="H",
    label="heart rate",
    unit="BPM",
    ack_field="heart_off",
    getter=lambda r: float(r.heart_avg) if r.heart_avg else None,
    tolerance=3.0,  # ±3 BPM — normal beat-to-beat variability
)


def main() -> int:
    parser = argparse.ArgumentParser(description="Interactive heart-rate calibration (1-point offset)")
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
