#include <Arduino.h>
#include <Preferences.h>
#include <WebServer.h>
#include <WiFi.h>
#include <Wire.h>
#include <math.h>

#include "MAX30105.h"
#include "heartRate.h"
#include "secrets.h"  // defines WIFI_SSID and WIFI_PASS; gitignored

// ===================== WiFi configuration =====================
// WIFI_SSID / WIFI_PASS come from secrets.h. If the network is unreachable,
// the sketch still runs over USB serial — WiFi is additive, not required.
const uint16_t TCP_PORT = 4040;           // Laptop connects with: nc <ip> 4040
const uint16_t HTTP_PORT = 80;            // Mobile app hits GET http://<ip>/report
const unsigned long WIFI_CONNECT_TIMEOUT_MS = 10000;

WiFiServer server(TCP_PORT);
WiFiClient client;                         // single active client (dev prototype; no auth)
WebServer httpServer(HTTP_PORT);
String lastReport;                         // cache of most recent report text (served to HTTP)

// ===================== Pin definitions =====================
const int MOTOR_PIN = 21;    // Feather MI pin -> ULN2803A 1B
const int THERM_PIN = 34;    // Feather A2 / GPIO34
const int MOIST_PIN = 39;    // Feather A3 / GPIO39
const int BUZZER_PIN = A0;   // Feather A0 / GPIO26 — piezo buzzer, LEDC tone output
const int HEATER_PIN = 15;   // Feather GPIO 15 — heating element via MOSFET, digital on/off

// ===================== Command-driven outputs =====================
// Servo-style PWM outputs driven by single-char commands from Serial or WiFi.
// '1'..'5' activate (2000us); 'R'/'r' resets all five to 1500us.
struct CommandOutput {
  uint8_t pin;
  const char* name;
};

const CommandOutput OUTPUTS[] = {
  { 12, "right_top_haptic" },     // key '1'
  { 13, "right_bottom_haptic" },  // key '2'
  { 27, "left_bottom_haptic" },   // key '3'
  { 32, "ventilation" },          // key '4'
  { 33, "left_top_haptic" },      // key '5'
};
const uint8_t OUTPUT_COUNT = sizeof(OUTPUTS) / sizeof(OUTPUTS[0]);

const uint16_t OUT_RESET_US = 1500;
const uint16_t OUT_ACTIVATE_US = 2000;
const uint32_t OUT_PWM_FREQ = 50;       // 50 Hz servo-style
const uint8_t  OUT_PWM_RES = 16;        // 16-bit duty
const uint32_t OUT_PWM_PERIOD_US = 20000; // 1/50 Hz

// ===================== Thermistor calibration =====================
// Fixed divider resistor for thermistor
const float SERIES_RESISTOR = 220000.0;

// Calibrated nominal thermistor resistance at 25C
const float THERMISTOR_NOMINAL = 1000000.0;

// Reference temperature
const float TEMPERATURE_NOMINAL = 25.0;

// Beta value estimate
const float BETA_VALUE = 3950.0;

// ===================== Moisture sensor calibration =====================
// Fixed divider resistor for moisture sensor
const float MOIST_SERIES_RESISTOR = 560000.0;

// Moisture reference points based on your measurements
const float MOIST_RES_WET = 100000.0;      // heavily moistened
const float MOIST_RES_DAMP = 1000000.0;    // slightly moistened

// ADC settings
const float ADC_MAX = 4095.0;
const float VREF = 3.3;

// Calibration offsets — defined up here so sensor read functions below can
// reference them. Loaded from NVS in setup(); full docs in the calibration
// section near the bottom of this file.
float g_temp_offset = 0.0f;
float g_moist_offset = 0.0f;
float g_heart_offset = 0.0f;

// ===================== Heart rate sensor (MAX30102) =====================
// Optional sensor wired over I2C (SDA/SCL on Feather defaults). If absent at
// boot, g_hr_available stays false and the report emits a "no sensor" marker
// instead of stale BPM values — the rest of the firmware runs unchanged.
MAX30105 particleSensor;
bool g_hr_available = false;

const byte HR_RATE_SIZE = 8;          // rolling-average window, matches reference sketch
byte g_hr_rates[HR_RATE_SIZE];
byte g_hr_rate_spot = 0;
unsigned long g_hr_last_beat = 0;
float g_hr_bpm = 0.0f;
int   g_hr_bpm_avg = 0;
long  g_hr_last_ir = 0;

const long HR_FINGER_IR_THRESHOLD = 50000;  // below this, treat as "no finger"

// ===================== Timing =====================
unsigned long lastPrint = 0;
unsigned long lastMotorToggle = 0;
bool motorState = false;

// Motor timing: 1 second ON, 1 second OFF
const unsigned long MOTOR_ON_TIME = 1000;
const unsigned long MOTOR_OFF_TIME = 1000;

// ===================== Thermistor functions =====================
int readThermistorRawAveraged(int samples = 16) {
  long total = 0;
  for (int i = 0; i < samples; i++) {
    total += analogRead(THERM_PIN);
    delay(5);
  }
  return total / samples;
}

float readThermistorResistance() {
  int raw = readThermistorRawAveraged();

  if (raw <= 0) raw = 1;
  if (raw >= 4095) raw = 4094;

  // Divider:
  // 3.3V -- 220k -- ADC node -- thermistor -- GND
  float resistance = SERIES_RESISTOR * ((float)raw / (ADC_MAX - raw));
  return resistance;
}

float readTemperatureC() {
  float R = readThermistorResistance();

  float steinhart;
  steinhart = R / THERMISTOR_NOMINAL;
  steinhart = log(steinhart);
  steinhart /= BETA_VALUE;
  steinhart += 1.0 / (TEMPERATURE_NOMINAL + 273.15);
  steinhart = 1.0 / steinhart;
  steinhart -= 273.15;

  return steinhart + g_temp_offset;
}

// ===================== Moisture functions =====================
int readMoistureRawAveraged(int samples = 16) {
  long total = 0;
  for (int i = 0; i < samples; i++) {
    total += analogRead(MOIST_PIN);
    delay(5);
  }
  return total / samples;
}

float readMoistureResistance() {
  int raw = readMoistureRawAveraged();

  if (raw <= 0) raw = 1;
  if (raw >= 4095) raw = 4094;

  // Divider:
  // 3.3V -- 560k -- ADC node -- moisture sensor -- GND
  float resistance = MOIST_SERIES_RESISTOR * ((float)raw / (ADC_MAX - raw));
  return resistance;
}

float readMoisturePercent() {
  float R = readMoistureResistance();

  // Clamp rough range:
  // 100k  -> 100% wet
  // 1M    -> 0% wet
  float percent = 100.0 * (MOIST_RES_DAMP - R) / (MOIST_RES_DAMP - MOIST_RES_WET);

  percent += g_moist_offset;  // user calibration

  if (percent > 100.0) percent = 100.0;
  if (percent < 0.0) percent = 0.0;

  return percent;
}

// ===================== Buzzer (piezo, LEDC tone) =====================
// Non-blocking alert pattern: the reference sketch uses delayMicroseconds +
// digitalWrite which would block the main loop for ~1.2s and starve WiFi /
// HR sampling. Instead we drive a state machine from millis() — each step
// calls ledcWriteTone() and returns immediately. A step of freq=0 is silence.
struct BuzzerStep {
  uint32_t freq_hz;      // 0 = silence (noTone)
  uint32_t duration_ms;
};

const BuzzerStep ALERT_PATTERN[] = {
  { 1000, 200 },
  {    0, 200 },
  { 1500, 200 },
  {    0, 200 },
  { 2000, 300 },
  {    0, 800 },
};
const uint8_t ALERT_PATTERN_LEN = sizeof(ALERT_PATTERN) / sizeof(ALERT_PATTERN[0]);

bool g_buzzer_active = false;
uint8_t g_buzzer_step = 0;
unsigned long g_buzzer_step_end = 0;

void stopBuzzer() {
  ledcWriteTone(BUZZER_PIN, 0);
  g_buzzer_active = false;
  g_buzzer_step = 0;
}

void startBuzzerPattern() {
  g_buzzer_active = true;
  g_buzzer_step = 0;
  g_buzzer_step_end = millis();  // expired → next serviceBuzzer() plays step 0
}

void setupBuzzer() {
  // 1 kHz / 8-bit is a placeholder; ledcWriteTone() overrides freq on demand.
  ledcAttach(BUZZER_PIN, 1000, 8);
  ledcWriteTone(BUZZER_PIN, 0);
}

// Called every loop iteration; advances the pattern when the current step expires.
void serviceBuzzer() {
  if (!g_buzzer_active) return;
  unsigned long now = millis();
  if (now < g_buzzer_step_end) return;

  if (g_buzzer_step >= ALERT_PATTERN_LEN) {
    stopBuzzer();
    return;
  }

  const BuzzerStep& step = ALERT_PATTERN[g_buzzer_step];
  ledcWriteTone(BUZZER_PIN, step.freq_hz);  // 0 = silence, still a valid "tone"
  g_buzzer_step_end = now + step.duration_ms;
  g_buzzer_step++;
}

// ===================== Heater (digital, auto-off safety timeout) =====================
// Simple HIGH/LOW control of a heating element via MOSFET. Activation has a
// non-blocking safety timeout so an unattended board can't cook itself — the
// haptics pulse briefly, but heating is sustained, so auto-off is a guardrail
// the haptics don't need.
const unsigned long HEATER_AUTO_OFF_MS = 30000;   // 30 s max on-time per activation

bool g_heater_on = false;
unsigned long g_heater_off_at = 0;

void heaterOff() {
  digitalWrite(HEATER_PIN, LOW);
  g_heater_on = false;
}

void heaterOn() {
  digitalWrite(HEATER_PIN, HIGH);
  g_heater_on = true;
  g_heater_off_at = millis() + HEATER_AUTO_OFF_MS;
}

void setupHeater() {
  pinMode(HEATER_PIN, OUTPUT);
  digitalWrite(HEATER_PIN, LOW);
}

// Called every loop iteration; turns the heater off when the auto-off deadline
// passes. Re-pressing '7' refreshes the deadline.
void serviceHeater() {
  if (!g_heater_on) return;
  if ((long)(millis() - g_heater_off_at) >= 0) {
    heaterOff();
  }
}

// ===================== Heart rate (MAX30102) =====================
void setupHeartRate() {
  Wire.begin();
  if (!particleSensor.begin(Wire, I2C_SPEED_FAST)) {
    Serial.println("MAX30102 not found on I2C — heart rate disabled.");
    g_hr_available = false;
    return;
  }

  // Settings from the MAX30102 reference sketch (proven to work on this board).
  particleSensor.setup(
    60,    // LED brightness 0..255
    4,     // sample average
    2,     // LED mode: 2 = Red + IR
    100,   // sample rate (Hz)
    411,   // pulse width
    4096   // ADC range
  );
  particleSensor.setPulseAmplitudeRed(0x1F);
  particleSensor.setPulseAmplitudeIR(0x1F);
  particleSensor.setPulseAmplitudeGreen(0);

  for (byte i = 0; i < HR_RATE_SIZE; i++) g_hr_rates[i] = 0;
  g_hr_available = true;
  Serial.println("MAX30102 initialised — heart rate sensor active.");
}

// Polled from the main loop on every iteration. The sensor's FIFO runs at
// 100 Hz internally; checkForBeat() needs frequent samples to detect peaks.
void serviceHeartRate() {
  if (!g_hr_available) return;

  long ir = particleSensor.getIR();
  g_hr_last_ir = ir;

  if (ir < HR_FINGER_IR_THRESHOLD) {
    // No finger → don't update BPM state, so the report emits 0 / avg=0.
    g_hr_bpm = 0.0f;
    g_hr_bpm_avg = 0;
    return;
  }

  if (checkForBeat(ir)) {
    unsigned long now = millis();
    unsigned long delta = now - g_hr_last_beat;
    g_hr_last_beat = now;

    if (delta > 0) {
      float bpm = 60000.0f / (float)delta;
      if (bpm > 20.0f && bpm < 255.0f) {
        g_hr_bpm = bpm;
        g_hr_rates[g_hr_rate_spot++] = (byte)bpm;
        g_hr_rate_spot %= HR_RATE_SIZE;

        int sum = 0;
        for (byte i = 0; i < HR_RATE_SIZE; i++) sum += g_hr_rates[i];
        g_hr_bpm_avg = sum / HR_RATE_SIZE;
      }
    }
  }
}

// ===================== Calibration offsets (NVS-backed) =====================
// User-facing offsets added to each sensor reading before it enters the
// report. Stored in the "sixth_cal" Preferences namespace so they survive
// reboots and reflashing the sketch (NVS is separate from program flash).
// Commands are multi-character and arrive line-buffered — see processInputByte.
//
//   CT <float>   set temperature offset (°C)
//   CM <float>   set moisture offset (%)
//   CH <float>   set heart-rate offset (BPM)
//   CC           clear all three to 0.0
//   CG           print current offsets
Preferences g_cal_prefs;
// g_temp_offset / g_moist_offset / g_heart_offset are declared above the
// thermistor block so readTemperatureC() / readMoisturePercent() can see them.

void loadCalibration() {
  g_cal_prefs.begin("sixth_cal", /*readOnly=*/true);
  g_temp_offset  = g_cal_prefs.getFloat("temp_off",  0.0f);
  g_moist_offset = g_cal_prefs.getFloat("moist_off", 0.0f);
  g_heart_offset = g_cal_prefs.getFloat("heart_off", 0.0f);
  g_cal_prefs.end();
  Serial.printf("Calibration loaded: temp_off=%.2f moist_off=%.2f heart_off=%.2f\n",
                g_temp_offset, g_moist_offset, g_heart_offset);
}

void saveCalibration() {
  g_cal_prefs.begin("sixth_cal", /*readOnly=*/false);
  g_cal_prefs.putFloat("temp_off",  g_temp_offset);
  g_cal_prefs.putFloat("moist_off", g_moist_offset);
  g_cal_prefs.putFloat("heart_off", g_heart_offset);
  g_cal_prefs.end();
}

// ===================== Reporting =====================
// Builds a full sensor report into a String. Each call re-reads the sensors,
// so the caller controls cadence. Same format the laptop controller and the
// mobile parser expect.
String buildReport() {
  int thermRaw = readThermistorRawAveraged();
  float thermVoltage = (thermRaw / ADC_MAX) * VREF;
  float thermResistance = readThermistorResistance();
  float tempC = readTemperatureC();
  float tempF = tempC * 9.0 / 5.0 + 32.0;

  int moistRaw = readMoistureRawAveraged();
  float moistVoltage = (moistRaw / ADC_MAX) * VREF;
  float moistResistance = readMoistureResistance();
  float moistPercent = readMoisturePercent();

  String s;
  s.reserve(640);

  s += "====== SENSOR REPORT ======\n";

  s += "------ Thermistor ------\n";
  s += "ADC raw: "; s += thermRaw; s += "\n";
  s += "Voltage: "; s += String(thermVoltage, 3); s += " V\n";
  s += "Resistance: "; s += String(thermResistance, 0); s += " ohms\n";
  s += "Temp: "; s += String(tempC, 2);
  s += " \xC2\xB0""C  |  ";  // UTF-8 ° sign, matches existing output
  s += String(tempF, 2);
  s += " \xC2\xB0""F\n";

  s += "------ Moisture ------\n";
  s += "ADC raw: "; s += moistRaw; s += "\n";
  s += "Voltage: "; s += String(moistVoltage, 3); s += " V\n";
  s += "Resistance: "; s += String(moistResistance, 0); s += " ohms\n";
  s += "Moisture: "; s += String(moistPercent, 1); s += " %\n";

  s += "------ Heart Rate ------\n";
  if (!g_hr_available) {
    s += "Status: no sensor\n";
  } else {
    // Apply HR offset only when we have an actual beat — otherwise the
    // "no finger" 0-reading would get shifted to a fake value.
    float reported_bpm = (g_hr_bpm > 0.0f) ? (g_hr_bpm + g_heart_offset) : 0.0f;
    int reported_avg = (g_hr_bpm_avg > 0) ? (g_hr_bpm_avg + (int)g_heart_offset) : 0;

    s += "IR: "; s += g_hr_last_ir; s += "\n";
    s += "BPM: "; s += String(reported_bpm, 1); s += "\n";
    s += "Avg BPM: "; s += reported_avg; s += "\n";
    s += "Finger: ";
    s += (g_hr_last_ir >= HR_FINGER_IR_THRESHOLD) ? "yes" : "no";
    s += "\n";
  }

  s += "------------------------\n";

  return s;
}

// Writes the current cached report to any Print target (Serial, WiFiClient, etc.).
void printReport(Print& out) {
  out.print(lastReport);
}

void handleHttpReport() {
  if (lastReport.length() == 0) {
    // Cold start before the first tick — build one on demand.
    lastReport = buildReport();
  }
  httpServer.sendHeader("Access-Control-Allow-Origin", "*");
  httpServer.send(200, "text/plain; charset=utf-8", lastReport);
}

void handleHttpNotFound() {
  httpServer.send(404, "text/plain", "Not found. Try GET /report.\n");
}

// ===================== WiFi =====================
// Scans for visible networks and prints them. Useful for diagnosing why the
// configured SSID isn't connecting — if it doesn't appear here, the ESP32
// can't see it (out of range, 5 GHz-only, hidden, etc.).
void scanAndPrintNetworks() {
  Serial.println("Scanning WiFi networks...");
  WiFi.mode(WIFI_STA);
  WiFi.disconnect(false, true);
  delay(100);

  int n = WiFi.scanNetworks();
  if (n <= 0) {
    Serial.println("  (no networks found)");
    return;
  }

  Serial.print("Found ");
  Serial.print(n);
  Serial.println(" network(s):");
  for (int i = 0; i < n; i++) {
    Serial.print("  ");
    Serial.print(i + 1);
    Serial.print(". \"");
    Serial.print(WiFi.SSID(i));
    Serial.print("\"  ");
    Serial.print(WiFi.RSSI(i));
    Serial.print(" dBm  ch");
    Serial.print(WiFi.channel(i));
    Serial.print("  ");
    Serial.println(WiFi.encryptionType(i) == WIFI_AUTH_OPEN ? "open" : "secured");
  }
  WiFi.scanDelete();
}

void beginWiFi() {
  scanAndPrintNetworks();

  Serial.print("Connecting to WiFi SSID: \"");
  Serial.print(WIFI_SSID);
  Serial.println("\"");

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);

  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED &&
         millis() - start < WIFI_CONNECT_TIMEOUT_MS) {
    delay(250);
    Serial.print(".");
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    server.begin();
    httpServer.on("/report", HTTP_GET, handleHttpReport);
    httpServer.onNotFound(handleHttpNotFound);
    httpServer.begin();
    Serial.print("WiFi connected. Listening on ");
    Serial.print(WiFi.localIP());
    Serial.print(":");
    Serial.println(TCP_PORT);
    Serial.print("From your laptop on the same network, run: nc ");
    Serial.print(WiFi.localIP());
    Serial.print(" ");
    Serial.println(TCP_PORT);
    Serial.print("Mobile LIVE page: http://");
    Serial.print(WiFi.localIP());
    Serial.println("/report");
  } else {
    Serial.println("WiFi unavailable — continuing over USB serial only.");
  }
}

void serviceWiFiClient() {
  if (WiFi.status() != WL_CONNECTED) return;

  // Accept a new client if one is waiting and we don't already have one.
  if (!client || !client.connected()) {
    if (client) client.stop();
    WiFiClient incoming = server.available();
    if (incoming) {
      client = incoming;
      Serial.print("WiFi client connected: ");
      Serial.println(client.remoteIP());
    }
  }
}

// ===================== Command-driven outputs =====================
uint32_t microsToDuty(uint16_t us) {
  // Clamp to one period; convert us -> duty in 16-bit space.
  if (us > OUT_PWM_PERIOD_US) us = OUT_PWM_PERIOD_US;
  const uint32_t maxDuty = (1UL << OUT_PWM_RES) - 1;
  return ((uint32_t)us * maxDuty) / OUT_PWM_PERIOD_US;
}

void setOutputMicros(uint8_t idx, uint16_t us) {
  if (idx >= OUTPUT_COUNT) return;
  ledcWrite(OUTPUTS[idx].pin, microsToDuty(us));
}

void setupCommandOutputs() {
  for (uint8_t i = 0; i < OUTPUT_COUNT; i++) {
    ledcAttach(OUTPUTS[i].pin, OUT_PWM_FREQ, OUT_PWM_RES);
    setOutputMicros(i, OUT_RESET_US);
  }
}

void resetAllOutputs(Print& reply) {
  for (uint8_t i = 0; i < OUTPUT_COUNT; i++) {
    setOutputMicros(i, OUT_RESET_US);
  }
  stopBuzzer();
  heaterOff();
  reply.print("RESET all ");
  reply.print(OUT_RESET_US);
  reply.println("us");
}

void handleCommand(char c, Print& reply) {
  if (c >= '1' && c <= '5') {
    uint8_t idx = c - '1';
    if (idx < OUTPUT_COUNT) {
      setOutputMicros(idx, OUT_ACTIVATE_US);
      reply.print("ACT ");
      reply.print(OUTPUTS[idx].name);
      reply.print(" ");
      reply.print(OUT_ACTIVATE_US);
      reply.println("us");
    }
  } else if (c == '6') {
    startBuzzerPattern();
    reply.println("BUZZ pattern=alert");
  } else if (c == '7') {
    heaterOn();
    reply.print("HEAT on auto_off=");
    reply.print(HEATER_AUTO_OFF_MS);
    reply.println("ms");
  } else if (c == 'R' || c == 'r') {
    resetAllOutputs(reply);
  }
  // Silently ignore anything else (newlines, keepalives, noise).
}

// ---------- Line-buffered multi-char command path (calibration) ----------
// Single-char commands still dispatch immediately when the buffer is empty,
// so existing keystroke forwarders (controller.py) keep working unchanged.

void handleLineCommand(const char* cmd, uint8_t len, Print& reply) {
  if (len < 2 || cmd[0] != 'C') return;  // not a calibration command
  char op = cmd[1];

  if (op == 'C') {  // CC — clear all offsets
    g_temp_offset = 0.0f;
    g_moist_offset = 0.0f;
    g_heart_offset = 0.0f;
    saveCalibration();
    reply.println("CAL ok cleared");
    return;
  }
  if (op == 'G') {  // CG — get all offsets
    reply.print("CAL temp_off=");
    reply.print(g_temp_offset, 2);
    reply.print(" moist_off=");
    reply.print(g_moist_offset, 2);
    reply.print(" heart_off=");
    reply.println(g_heart_offset, 2);
    return;
  }

  // Set commands need a value after the key.
  if (len < 4) return;  // "Cx n" minimum
  float value = atof(cmd + 2);
  if (op == 'T') {
    g_temp_offset = value;
    saveCalibration();
    reply.print("CAL ok temp_off=");
    reply.println(g_temp_offset, 2);
  } else if (op == 'M') {
    g_moist_offset = value;
    saveCalibration();
    reply.print("CAL ok moist_off=");
    reply.println(g_moist_offset, 2);
  } else if (op == 'H') {
    g_heart_offset = value;
    saveCalibration();
    reply.print("CAL ok heart_off=");
    reply.println(g_heart_offset, 2);
  }
}

const uint8_t CMD_BUF_MAX = 63;
char g_serial_cmd_buf[CMD_BUF_MAX + 1];
uint8_t g_serial_cmd_len = 0;
char g_wifi_cmd_buf[CMD_BUF_MAX + 1];
uint8_t g_wifi_cmd_len = 0;

void processInputByte(char c, Print& reply, char* buf, uint8_t& len) {
  // Mid-line: accumulate until newline. Single-char commands can't fire
  // while a multi-char command is being typed (digits inside a float must
  // not trigger haptics).
  if (len > 0) {
    if (c == '\n' || c == '\r') {
      buf[len] = '\0';
      handleLineCommand(buf, len, reply);
      len = 0;
      return;
    }
    if (len < CMD_BUF_MAX) buf[len++] = c;
    return;
  }

  // Buffer empty — existing single-char commands dispatch immediately.
  if ((c >= '1' && c <= '7') || c == 'R' || c == 'r') {
    handleCommand(c, reply);
    return;
  }
  if (c == '\n' || c == '\r') return;  // ignore leading terminators
  if (c >= ' ' && c < 127 && len < CMD_BUF_MAX) buf[len++] = c;
}

void serviceInput() {
  while (Serial.available() > 0) {
    processInputByte((char)Serial.read(), Serial, g_serial_cmd_buf, g_serial_cmd_len);
  }
  if (client && client.connected()) {
    while (client.available() > 0) {
      processInputByte((char)client.read(), client, g_wifi_cmd_buf, g_wifi_cmd_len);
    }
  }
}

// ===================== Setup =====================
void setup() {
  Serial.begin(115200);
  delay(1000);

  pinMode(MOTOR_PIN, OUTPUT);
  digitalWrite(MOTOR_PIN, LOW);

  analogReadResolution(12);
  analogSetPinAttenuation(THERM_PIN, ADC_11db);
  analogSetPinAttenuation(MOIST_PIN, ADC_11db);

  setupCommandOutputs();
  setupBuzzer();
  setupHeater();
  setupHeartRate();
  loadCalibration();

  Serial.println("Integrated Motor + Thermistor + Moisture + HR + Buzzer + Heater Test Starting...");

  beginWiFi();
}

// ===================== Loop =====================
void loop() {
  unsigned long now = millis();

  // -------- Motor control --------
  if (motorState) {
    if (now - lastMotorToggle >= MOTOR_ON_TIME) {
      motorState = false;
      digitalWrite(MOTOR_PIN, LOW);
      lastMotorToggle = now;
      Serial.println("Motor OFF");
    }
  } else {
    if (now - lastMotorToggle >= MOTOR_OFF_TIME) {
      motorState = true;
      digitalWrite(MOTOR_PIN, HIGH);
      lastMotorToggle = now;
      Serial.println("Motor ON");
    }
  }

  // -------- WiFi client management --------
  serviceWiFiClient();

  // -------- Command input (Serial + WiFi) --------
  serviceInput();

  // -------- Heart rate sampling (must run every iteration to catch beats) --------
  serviceHeartRate();

  // -------- Buzzer pattern state machine (non-blocking) --------
  serviceBuzzer();

  // -------- Heater auto-off safety timer (non-blocking) --------
  serviceHeater();

  // -------- HTTP server (serves cached /report to mobile app) --------
  if (WiFi.status() == WL_CONNECTED) {
    httpServer.handleClient();
  }

  // -------- Sensor reading and print --------
  if (now - lastPrint >= 1000) {
    lastPrint = now;

    lastReport = buildReport();
    Serial.print(lastReport);
    if (client && client.connected()) {
      client.print(lastReport);
    }
  }
}