# TODO

## Firmware

- [ ] Replace the temporary keyboard trigger in `firmware/bridge/controller.py`
  - Keys 1–5 / R are a stand-in so we can bench-test the five PWM outputs by hand.

## Mobile

- [ ] Wire sensors for the remaining LIVE metrics. Thermistor → Temperature, moisture → Sweat, and MAX30102 → Heart Rate are live; SpO₂ and HRV still render `—` until the Red/IR ratio math and RR-interval buffer are added.
