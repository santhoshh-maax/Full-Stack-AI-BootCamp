/*
 * board-registry.js
 * Central registry of supported microcontroller boards (frontend copy).
 *
 * This registry is the single source of truth for pin availability and
 * capabilities on the client. The backend keeps a matching copy used to
 * independently verify anything the client claims, so the client can never
 * convince the backend that an unsupported pin exists.
 *
 * NOTE ON ESP32: The ESP32 family has many variants with different pin maps.
 * The entry below targets the common "ESP32 DevKit V1" (ESP32-WROOM-32) and
 * exposes the pins that are safe to use for the lessons in this lab. Pins that
 * are input-only, used by flash, or are boot-strapping pins are explicitly
 * flagged so validation and code generation can avoid or warn about them.
 */

(function (global) {
  'use strict';

  // Pins that are safe, general purpose digital I/O on a typical ESP32 DevKit V1.
  var ESP32_DIGITAL = [
    'GPIO2', 'GPIO4', 'GPIO5',
    'GPIO12', 'GPIO13', 'GPIO14', 'GPIO15',
    'GPIO16', 'GPIO17', 'GPIO18', 'GPIO19',
    'GPIO21', 'GPIO22', 'GPIO23',
    'GPIO25', 'GPIO26', 'GPIO27',
    'GPIO32', 'GPIO33'
  ];

  // Input-only pins on ESP32 (no output capability).
  var ESP32_INPUT_ONLY = ['GPIO34', 'GPIO35', 'GPIO36', 'GPIO39'];

  // ADC1 channels. ADC2 is intentionally omitted because it cannot be used
  // while Wi-Fi is active, which is almost always true on an ESP32.
  var ESP32_ANALOG = [
    'GPIO32', 'GPIO33',
    'GPIO34', 'GPIO35', 'GPIO36', 'GPIO39',
    'GPIO25', 'GPIO26', 'GPIO27',
    'GPIO4'
  ];

  var ESP32_PWM = [
    'GPIO2', 'GPIO4', 'GPIO5',
    'GPIO12', 'GPIO13', 'GPIO14', 'GPIO15',
    'GPIO16', 'GPIO17', 'GPIO18', 'GPIO19',
    'GPIO21', 'GPIO22', 'GPIO23',
    'GPIO25', 'GPIO26', 'GPIO27',
    'GPIO32', 'GPIO33'
  ];

  var ESP32_PIN_RESTRICTIONS = {
    GPIO2: 'Boot-strapping pin. It must not be held LOW at boot. Good for a simple output.'
    + ' This is the pin used by the on-board LED on many DevKit boards.',
    GPIO12: 'Boot-strapping pin. Pulling it HIGH at boot can prevent the board from starting.',
    GPIO15: 'Boot-strapping pin. Affects boot log verbosity.',
    GPIO0: 'Boot-strapping pin used to enter flash mode. Avoid using it as an output.',
    GPIO34: 'Input-only. It cannot drive an LED or any output.',
    GPIO35: 'Input-only. It cannot drive an LED or any output.',
    GPIO36: 'Input-only. It cannot drive an LED or any output.',
    GPIO39: 'Input-only. It cannot drive an LED or any output.'
  };

  var ARDUINO_DIGITAL = [
    'D0', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7',
    'D8', 'D9', 'D10', 'D11', 'D12', 'D13'
  ];

  var ARDUINO_ANALOG = ['A0', 'A1', 'A2', 'A3', 'A4', 'A5'];

  var ARDUINO_PWM = ['D3', 'D5', 'D6', 'D9', 'D10', 'D11'];

  var ARDUINO_PIN_RESTRICTIONS = {
    D0: 'Used by the USB serial (RX). Avoid using it while the serial monitor is in use.',
    D1: 'Used by the USB serial (TX). Avoid using it while the serial monitor is in use.',
    D13: 'Connected to the on-board LED through a resistor on most Uno boards.'
  };

  function buildPinInfo(digital, analog, pwm, restrictions, extra) {
    var info = {};
    digital.forEach(function (pin) {
      info[pin] = {
        digital: true,
        analog: analog.indexOf(pin) !== -1,
        pwm: pwm.indexOf(pin) !== -1,
        inputOnly: false,
        restriction: restrictions[pin] || null
      };
    });
    (extra || []).forEach(function (pin) {
      info[pin] = {
        digital: false,
        analog: (analog.indexOf(pin) !== -1),
        pwm: false,
        inputOnly: true,
        restriction: restrictions[pin] || null
      };
    });
    return info;
  }

  var boardRegistry = {
    'arduino-uno-r3': {
      id: 'arduino-uno-r3',
      name: 'Arduino Uno R3',
      illustration: 'uno',
      platform: 'AVR',
      mcu: 'ATmega328P',
      logicVoltage: 5,
      maxPinCurrentMa: 20,
      digitalPins: ARDUINO_DIGITAL.slice(),
      analogPins: ARDUINO_ANALOG.slice(),
      pwmPins: ARDUINO_PWM.slice(),
      powerPins: ['5V', '3V3'],
      powerPinVoltage: { '5V': 5, '3V3': 3.3 },
      groundPins: ['GND'],
      variant: 'R3 (ATmega328P, 5V logic)',
      pinInfo: buildPinInfo(ARDUINO_DIGITAL, ARDUINO_ANALOG, ARDUINO_PWM, ARDUINO_PIN_RESTRICTIONS),
      defaultPins: {
        led: 'D8',
        button: 'D2',
        dht: 'D7'
      },
      // A0-A5 are analog inputs only on the Uno; they are not digital outputs.
      analogAreInputOnly: true,
      notes:
        'ATmega328P based. 5V logic. Digital pins D0-D13, analog inputs '
        + 'A0-A5, PWM on D3, D5, D6, D9, D10, D11. Do not treat Uno pins as '
        + 'interchangeable with ESP32 pins.',
      codeExample:
        'const int LED_PIN = 8;\n\n'
        + 'void setup() {\n'
        + '  pinMode(LED_PIN, OUTPUT);\n'
        + '}\n\n'
        + 'void loop() {\n'
        + '  digitalWrite(LED_PIN, HIGH);\n'
        + '  delay(500);\n'
        + '  digitalWrite(LED_PIN, LOW);\n'
        + '  delay(500);\n'
        + '}'
    },

    'esp32-devkit': {
      id: 'esp32-devkit',
      name: 'ESP32 DevKit',
      illustration: 'esp32',
      platform: 'ESP32',
      mcu: 'ESP32-WROOM-32 (dual-core, Wi-Fi/BT)',
      logicVoltage: 3.3,
      maxPinCurrentMa: 12,
      digitalPins: ESP32_DIGITAL.slice(),
      analogPins: ESP32_ANALOG.slice(),
      pwmPins: ESP32_PWM.slice(),
      powerPins: ['3V3', 'VIN'],
      powerPinVoltage: { '3V3': 3.3, 'VIN': 5 },
      groundPins: ['GND'],
      variant: 'ESP32 DevKit V1 (ESP32-WROOM-32, 3.3V logic)',
      pinInfo: buildPinInfo(
        ESP32_DIGITAL,
        ESP32_ANALOG,
        ESP32_PWM,
        ESP32_PIN_RESTRICTIONS,
        ESP32_INPUT_ONLY
      ),
      defaultPins: {
        led: 'GPIO2',
        button: 'GPIO4',
        dht: 'GPIO15'
      },
      analogAreInputOnly: false,
      notes:
        'ESP32-WROOM-32 based DevKit V1. 3.3V logic only: never feed 5V into a '
        + 'GPIO. Only the pins listed here are treated as verified for this lab. '
        + 'Pins 6-11 are reserved for flash and are excluded, and boot-strapping '
        + 'pins are flagged in their restrictions.',
      codeExample:
        'const int LED_PIN = 2;\n\n'
        + 'void setup() {\n'
        + '  pinMode(LED_PIN, OUTPUT);\n'
        + '}\n\n'
        + 'void loop() {\n'
        + '  digitalWrite(LED_PIN, HIGH);\n'
        + '  delay(500);\n'
        + '  digitalWrite(LED_PIN, LOW);\n'
        + '  delay(500);\n'
        + '}'
    }
  };

  function getBoard(id) {
    return boardRegistry[id] || null;
  }

  function listBoards() {
    return Object.keys(boardRegistry).map(function (id) {
      return boardRegistry[id];
    });
  }

  // Return the numeric portion of a pin id. Uno: "D8" -> 8, "A0" -> 14 (A0
  // maps to digital 14 on the ATmega328P). ESP32: "GPIO2" -> 2.
  function pinNumber(pin) {
    if (/^A[0-5]$/.test(pin)) {
      return 14 + parseInt(pin.slice(1), 10);
    }
    var m = /(\d+)$/.exec(pin);
    return m ? parseInt(m[1], 10) : NaN;
  }

  function pinExists(board, pin) {
    if (!board) return false;
    return Boolean(board.pinInfo[pin]);
  }

  function isDigitalPin(board, pin) {
    var info = board && board.pinInfo[pin];
    return Boolean(info && info.digital);
  }

  function isAnalogPin(board, pin) {
    var info = board && board.pinInfo[pin];
    return Boolean(info && info.analog);
  }

  function isPwmPin(board, pin) {
    var info = board && board.pinInfo[pin];
    return Boolean(info && info.pwm);
  }

  function resolveAlias(board, pin) {
    if (!board || !pin) return pin;
    if (pinNumber(pin) === 0) return pin; // handled below, keep as-is
    var n = pinNumber(pin);
    // Allow "8" -> "D8" on Arduino and "2" -> "GPIO2" on ESP32.
    if (board.platform === 'AVR' && /^\d+$/.test(String(pin))) {
      var candidate = 'D' + pin;
      if (pinExists(board, candidate)) return candidate;
    }
    if (board.platform === 'ESP32' && /^\d+$/.test(String(pin))) {
      var gpio = 'GPIO' + pin;
      if (pinExists(board, gpio)) return gpio;
    }
    return pin;
  }

  var api = {
    boardRegistry: boardRegistry,
    getBoard: getBoard,
    listBoards: listBoards,
    pinNumber: pinNumber,
    pinExists: pinExists,
    isDigitalPin: isDigitalPin,
    isAnalogPin: isAnalogPin,
    isPwmPin: isPwmPin,
    resolveAlias: resolveAlias
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.BoardRegistry = api;
  }
})(typeof window !== 'undefined' ? window : this);
