# SIXTH

A wearable biosignal prototype. An ESP32 Feather reads a thermistor + moisture sensor, drives five PWM outputs (four haptics and a ventilation channel), and streams a sensor report to a laptop over USB-serial and/or WiFi. A small Python script on the laptop captures keystrokes and sends activation commands back to the board. A separate Expo app visualizes simulated metrics — it does not currently talk to the board.

## Architecture

```
                      ┌─────────────────────────┐
                      │  ESP32 Feather          │
  thermistor / moist ─┤  firmware/sketch/*.ino  │── PWM ─▶ 4 haptics + vent
                      │                         │
                      │  Serial  115200 baud   ◀┼──▶ laptop (USB cable)
                      │  TCP     :4040         ◀┼──▶ laptop (WiFi)
                      └─────────────────────────┘
                                    ▲
                                    │ "1"–"5" activate, "R" reset
                                    │
                      ┌─────────────────────────┐
                      │ firmware/bridge/        │
                      │   controller.py         │  (stdin keystrokes)
                      └─────────────────────────┘

                      ┌─────────────────────────┐
                      │ mobile/  (Expo)         │  simulated metrics; standalone
                      └─────────────────────────┘
```

## Firmware (`firmware/sketch/sketch.ino`)

Single ESP32 sketch. On boot it:

- Initializes a motor on **GPIO 21** (toggles 1 s on / 1 s off — existing test pattern).
- Reads a thermistor on **GPIO 34 / A2** and a resistive moisture sensor on **GPIO 39 / A3** (12-bit ADC, 11 dB attenuation, 16-sample average).
- Reads a **MAX30102** pulse-ox on the Feather default I²C pins (**SDA / SCL**, 3V3, GND). Absent sensor is detected at boot — the rest of the firmware runs unchanged and the report emits `Status: no sensor`. The MAX30105 SparkFun library is auto-installed by `flash.sh`.
- Attaches five servo-style PWM outputs (50 Hz, 16-bit) on **GPIO 12 / 13 / 27 / 32 / 33**, parked at 1500 µs.
- Attaches a piezo buzzer on **A0 / GPIO 26** driven by LEDC tone generation — plays a non-blocking three-tone alert pattern on command `6`, silenced by `R`.
- Drives a heating element on **GPIO 15** via a MOSFET gate — digital on/off on command `7`, with a 30 s auto-off safety timeout. `R` cuts it immediately.
- Connects to WiFi if credentials are filled in (`WIFI_SSID`, `WIFI_PASS`). Falls back to serial-only if WiFi is unreachable.
- Starts a TCP server on port **4040** for one WiFi client at a time.

Every second it prints a sensor report to both the USB serial monitor and the connected WiFi client. It also reads single-character commands from either stream:

| Key   | Action                                           |
| ----- | ------------------------------------------------ |
| `1`   | activate **right top haptic**    (GPIO 12, 2000 µs) |
| `2`   | activate **right bottom haptic** (GPIO 13, 2000 µs) |
| `3`   | activate **left bottom haptic**  (GPIO 27, 2000 µs) |
| `4`   | activate **ventilation**         (GPIO 32, 2000 µs) |
| `5`   | activate **left top haptic**     (GPIO 33, 2000 µs) |
| `6`   | play **buzzer alert pattern**    (A0 / GPIO 26, 1k–2k Hz sweep, ~1.1 s) |
| `7`   | activate **heater**              (GPIO 15, ON, auto-off after 30 s) |
| `R`/`r` | reset all haptics + silence buzzer + heater off |

## Laptop controller (`firmware/bridge/controller.py`)

Captures single keystrokes in the terminal (raw `tty` mode) and forwards matching ones to the board over USB serial or a TCP connection. Invalid keys are ignored; each command's ack line from the Arduino is echoed back to the terminal.

```bash
python3 firmware/bridge/controller.py --serial /dev/tty.usbmodem1101
python3 firmware/bridge/controller.py --wifi   192.168.1.42:4040
```

Needs `pyserial` when using `--serial` (see `requirements.txt`).

## Mobile app (`mobile/`)

An Expo dashboard for the wearable. Launches on the **LIVE** page (real sensor data); swipe left to browse the scenario demo deck.

Features:
- **LIVE page** (first page) — reads sensor data from the Arduino. Metrics without a real sensor source render `—` until wired. Daily/Extreme toggle is user-switchable. See "Wiring LIVE to the board" below.
- **SIXTH branding** with two palettes — **Daily** (cool blue) and **Extreme** (warm amber) — toggled via the mode switch, with a loading transition when entering Extreme.
- **Scenario presets** — swipe left/right to cycle through expedition and training scenarios (Mt. Rainier summit, Island Peak, etc.), onboarding, journey map, session feedback, and stamp-wall interstitials.
- **Live simulation** (demo presets only) — metric values and sparklines tick over time, seeded from the active preset.
- **Body map** heat visualization for applicable scenarios.
- **Alert cards** — sensor-accurate codes (E1–E4 extreme, D1–D4 daily) driven by metric thresholds.
- **Expedition hero** — altitude, weather, sun times, and progress toward summit in Extreme mode (demo presets).

### Wiring LIVE to the board

1. Flash the sketch. On boot it connects to WiFi and starts an HTTP server on port 80 alongside the existing TCP:4040 stream. The serial monitor prints the URL, e.g. `Mobile LIVE page: http://192.168.1.42/report`.
2. `cp mobile/.env.example mobile/.env` and set `EXPO_PUBLIC_BOARD_HOST` to that IP (or `<ip>:<port>`). `mobile/.env` is gitignored.
3. `cd mobile && npm run start`. The LIVE page polls `GET /report` every second, parses the plain-text format, and updates metric cards. Fails fast (2.5 s timeout) when the board isn't reachable, dropping the chip back to `OFFLINE`.

Board-backed metrics today: **thermistor → Temperature**, **moisture → Sweat**, and **MAX30102 → Heart Rate** (Avg BPM; zero when no finger on sensor). SpO₂ / HRV render `—` until ratio-of-ratios and RR-interval math are added. To bind a new metric, extend `liveValueFor` in `mobile/src/hooks/useLiveData.ts`.

## Project structure

```
SIXTH/
├── firmware/
│   ├── sketch/sketch.ino          # ESP32 sketch: sensors + PWM outputs + WiFi/Serial I/O
│   └── bridge/
│       ├── controller.py          # Laptop keystroke forwarder (live hardware)
│       ├── diagnose.py            # End-to-end smoke test against a connected board
│       ├── test_diagnose_parsers.py  # Unit tests for diagnose.py's parsers (no hardware)
│       ├── test_transport.py      # Unit tests for transport.py's .board.conf loader
│       ├── transport.py           # Shared serial/WiFi transports
│       └── setup_board.py         # Detect port/IP/FQBN → write .board.conf
├── mobile/                        # Expo app (standalone simulator)
│   ├── App.tsx
│   └── src/
│       ├── screens/DashboardScreen.tsx
│       ├── components/            # MetricCard, AlertCard, ExpeditionHero, BodyMap, ...
│       ├── hooks/                 # useScenarioSwipe, useSimulatedData
│       └── data/                  # mockData.ts, scenarioPresets.ts
├── dev.sh                         # macOS: start Expo + controller together
├── flash.sh                       # Compile + upload sketch.ino via arduino-cli
├── .board.conf.example            # Template for board defaults (SERIAL_PORT, WIFI_TARGET, ...)
├── requirements.txt               # Python deps (pyserial)
├── TODO.md
└── README.md
```

## Setup

### First-time install

```bash
# Mobile
cd mobile && npm install && cd ..

# Arduino toolchain
brew install arduino-cli
arduino-cli config init
arduino-cli config add board_manager.additional_urls \
  https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json
arduino-cli core update-index && arduino-cli core install esp32:esp32

# Python deps for the laptop scripts
pip install -r requirements.txt
```

Copy `firmware/sketch/secrets.h.example` to `firmware/sketch/secrets.h` and fill in your 2.4 GHz WiFi credentials (ESP32 Feather does not support 5 GHz). `secrets.h` is gitignored so credentials stay local.

Copy `mobile/.env.example` to `mobile/.env` and set `EXPO_PUBLIC_BOARD_HOST` to the board's IP (either `WIFI_TARGET` from `.board.conf` after running `setup_board.py`, or the line the sketch prints on boot: `Mobile LIVE page: http://<ip>/report`). Without this, the LIVE page stays on `OFFLINE`. `mobile/.env` is gitignored.

### macOS + iPhone Personal Hotspot: disable IPv6 on Wi-Fi

**Required if you're developing on a Mac connected to an iPhone's Personal Hotspot.** On IPv6-only carriers (e.g., Verizon, T-Mobile), macOS joins the hotspot in NAT64 / CLAT mode and assigns itself a stub `192.0.0.2/32` IPv4. The ESP32, on the same hotspot, gets a normal `172.20.10.x` — but the Mac has no IPv4 route to reach it, so `controller.py --wifi` and Metro both fail (`TimeoutError` / "internet connection appears to be offline").

Force the Mac to request IPv4 from the hotspot:

```bash
networksetup -setv6off Wi-Fi
```

Then reconnect to the hotspot. `ifconfig en0 | grep 'inet '` should now show `172.20.10.x`, and `ping 172.20.10.2` should succeed.

To revert when you're back on a normal network:

```bash
networksetup -setv6automatic Wi-Fi
```

Skip this step if your Mac and the ESP32 are on the same regular router (home/office Wi-Fi) — that case already works out of the box.

### Daily use

With the board plugged in:

```bash
python3 firmware/bridge/setup_board.py    # one-time: detects port/IP/FQBN → writes .board.conf
./flash.sh                                 # compile + upload sketch.ino
./dev.sh                                   # Expo + keystroke controller (macOS)
python3 firmware/bridge/diagnose.py        # verify sensors + PWM outputs end-to-end
```

All four take no arguments — they read defaults from `.board.conf` (gitignored, machine-local). The first time, pass `--skip-wifi` to `setup_board.py` if the sketch isn't flashed yet, then re-run after flashing to populate `WIFI_TARGET`.

### Overrides

Every script accepts explicit flags if you need to deviate from `.board.conf`:

- `./flash.sh --port /dev/tty.usbmodem... --fqbn esp32:esp32:<variant>`
- `./dev.sh --serial [/dev/...]` or `./dev.sh --wifi [<ip>:4040]`
- `python3 firmware/bridge/controller.py --serial ...` / `--wifi ...`
- `python3 firmware/bridge/diagnose.py --serial ...` / `--wifi ...`
- `python3 -m unittest discover firmware/bridge` — hardware-free unit tests (parser + .board.conf loader)

Prefer the Arduino IDE? Open `firmware/sketch/sketch.ino` and click Upload.

## Calibrating sensors

Each sensor has a 1-point offset stored in the ESP32's NVS flash (`sixth_cal` namespace). The offset is added to the reported value before it enters `/report` — so once calibrated, both the laptop and the mobile app see corrected numbers. **No reflashing needed after the initial firmware flash.** Offsets persist across reboots and power cycles.

```bash
python3 firmware/bridge/calibrate_temp.py        # thermistor — need a reference thermometer
python3 firmware/bridge/calibrate_moisture.py    # moisture — dry (0%) or soaked (100%) is easiest
python3 firmware/bridge/calibrate_heart.py       # MAX30102 — use a chest strap / pulse-ox as reference
```

Each script reads the current value, asks for your reference measurement, computes `offset = reference - reported`, sends it to the board (`CT`/`CM`/`CH <value>`), and verifies the next report matches. Takes about 15 seconds.

Low-level commands (also work from a raw serial terminal):

| Command | Effect |
| ------- | ------ |
| `CT <°C>` | set temperature offset |
| `CM <%>` | set moisture offset |
| `CH <BPM>` | set heart-rate offset |
| `CG` | print current offsets |
| `CC` | clear all three to zero |

## Known gaps

See `TODO.md`.
