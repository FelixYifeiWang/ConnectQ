#include <Arduino.h>
#include <WebServer.h>
#include <WiFi.h>
#include <math.h>

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

  return steinhart;
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

  if (percent > 100.0) percent = 100.0;
  if (percent < 0.0) percent = 0.0;

  return percent;
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
  } else if (c == 'R' || c == 'r') {
    resetAllOutputs(reply);
  }
  // Silently ignore anything else (newlines, keepalives, noise).
}

void serviceInput() {
  while (Serial.available() > 0) {
    handleCommand((char)Serial.read(), Serial);
  }
  if (client && client.connected()) {
    while (client.available() > 0) {
      handleCommand((char)client.read(), client);
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

  Serial.println("Integrated Motor + Thermistor + Moisture Test Starting...");

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