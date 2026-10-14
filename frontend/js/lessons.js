/*
 * lessons.js
 * Lesson definitions used by the app, validator, code generator and simulator.
 * Lesson wiring rules live in circuit-validator.js; this file only holds the
 * descriptive content and the component requirements.
 */

(function (global) {
  'use strict';

  var lessons = {
    led: {
      id: 'led',
      title: 'LED Blinking',
      summary: 'Blink an LED on and off using a GPIO pin and a current limiting resistor.',
      supportedBoards: ['arduino-uno-r3', 'esp32-devkit'],
      components: ['led', 'resistor'],
      defaultComponents: [
        { type: 'led', x: 620, y: 180 },
        { type: 'resistor', x: 470, y: 210 }
      ],
      concepts: [
        'A GPIO pin can be set HIGH (about the board logic voltage) or LOW (0V).',
        'An LED only lights when current flows from anode to cathode.',
        'A resistor limits the current so the LED and the pin are not damaged.',
        'The cathode must return to a GND pin to complete the circuit.'
      ],
      simulatorSupport: ['pinMode()', 'digitalWrite()', 'delay()'],
      steps: [
        'Drag the board, an LED and a resistor into the workspace.',
        'Connect the GPIO pin to one end of the resistor.',
        'Connect the other end of the resistor to the LED anode.',
        'Connect the LED cathode to a GND pin.',
        'Validate the circuit, then generate and simulate the code.'
      ]
    },

    button: {
      id: 'button',
      title: 'Push Button',
      summary: 'Read a digital input from a push button and use it to control an LED.',
      supportedBoards: ['arduino-uno-r3', 'esp32-devkit'],
      components: ['button', 'led', 'resistor'],
      defaultComponents: [
        { type: 'button', x: 470, y: 120 },
        { type: 'led', x: 700, y: 180 },
        { type: 'resistor', x: 620, y: 300 }
      ],
      concepts: [
        'A digital input reads either HIGH or LOW.',
        'A button only connects its two sides while it is pressed.',
        'The input must never float: use INPUT_PULLUP or an external resistor.',
        'With INPUT_PULLUP the pin reads HIGH when released and LOW when pressed.'
      ],
      simulatorSupport: ['pinMode()', 'digitalWrite()', 'digitalRead()', 'delay()'],
      steps: [
        'Drag the board, a push button, an LED and a resistor into the workspace.',
        'Connect one side of the button to the chosen input pin and the other side to GND.',
        'The input pin uses the internal pull-up.',
        'Wire the LED and its resistor from an output pin to GND.',
        'Validate, generate code and press the virtual button to see the LED react.'
      ]
    },

    dht11: {
      id: 'dht11',
      title: 'DHT11 Sensor',
      summary: 'Read simulated temperature and humidity from a DHT11 sensor.',
      supportedBoards: ['arduino-uno-r3', 'esp32-devkit'],
      components: ['dht11'],
      defaultComponents: [
        { type: 'dht11', x: 520, y: 150 }
      ],
      concepts: [
        'The DHT11 reports temperature and relative humidity over a single data wire.',
        'It needs a power and ground connection in addition to the data line.',
        'The data line usually needs a pull-up resistor so it idles HIGH.',
        'Simulated readings are samples, not real measurements from hardware.'
      ],
      simulatorSupport: ['DHT sensor library calls (simulated samples)'],
      steps: [
        'Drag the board and a DHT11 sensor into the workspace.',
        'Connect sensor VCC to a board power pin.',
        'Connect sensor GND to a board GND pin.',
        'Connect sensor DATA to a digital pin.',
        'Validate, generate code and read the simulated values.'
      ]
    }
  };

  var lessonOrder = ['led', 'button', 'dht11'];

  var api = {
    lessons: lessons,
    lessonOrder: lessonOrder,
    getLesson: function (id) { return lessons[id] || null; },
    listLessons: function () {
      return lessonOrder.map(function (id) { return lessons[id]; });
    }
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.Lessons = api;
  }
})(typeof window !== 'undefined' ? window : this);
