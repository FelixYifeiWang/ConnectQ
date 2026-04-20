# TODO

## Firmware

- [ ] Replace the temporary keyboard trigger in `firmware/bridge/controller.py`
  - Keys 1–5 / R are a stand-in so we can bench-test the five PWM outputs by hand.

## Mobile

- [ ] Wire sensors for the remaining LIVE metrics. Thermistor → Temperature and moisture → Sweat are live; Heart Rate, SpO₂, and HRV still render `—` until pulse-ox / ECG hardware is added.
