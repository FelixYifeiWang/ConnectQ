"""Interactive thermistor calibration — 1-point offset, stored in ESP32 NVS.

Usage:
    python calibrate_temp.py                             # uses .board.conf
    python calibrate_temp.py --serial /dev/tty.usbmodem1101
    python calibrate_temp.py --wifi 192.168.1.42:4040

Procedure:
    1. Place the thermistor next to a reference thermometer.
    2. Run the script. It reads the current ESP32 temperature.
    3. Enter the reference thermometer's reading.
    4. Script sends the offset to the board; value is saved to NVS flash
       and survives reboots. Next /report will reflect it.
"""

from __future__ import annotations

import argparse
import sys

from calibrate import SensorSpec, run_calibration  # pyright: ignore[reportMissingImports]
from transport import add_transport_args, build_transport  # pyright: ignore[reportMissingImports]


SPEC = SensorSpec(
    key="T",
    label="temperature",
    unit="°C",
    ack_field="temp_off",
    getter=lambda r: r.temp_c,
    tolerance=0.3,  # ±0.3 °C — thermistor noise is usually under this at rest
)


def main() -> int:
    parser = argparse.ArgumentParser(description="Interactive thermistor calibration (1-point offset)")
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
