/*
 * code-editor.js
 * Board-compatible Arduino-style code generation, editing and explanation.
 *
 * The generator uses the actual pins resolved from the validated circuit when
 * available and falls back to the board's default example pin otherwise. Pin
 * numbers are always converted per board (D8 -> 8 on the Uno, GPIO2 -> 2 on
 * the ESP32) so board-specific numbers are never reused blindly.
 */

(function (global) {
  'use strict';

  var BoardRegistry = (typeof require === 'function')
    ? require('./board-registry')
    : global.BoardRegistry;

  var SUPPORTED_FUNCTIONS = [
    'pinMode', 'digitalWrite', 'digitalRead', 'delay',
    'digitalWrite', 'delayMicroseconds', 'Serial.begin', 'Serial.print',
    'Serial.println'
  ];

  function create(lab) {
    var els = {};

    function cacheEls() {
      els.output = document.getElementById('codeOutput');
      els.generate = document.getElementById('btnGenerateCode');
      els.copy = document.getElementById('btnCopyCode');
      els.explain = document.getElementById('codeExplain');
      els.libs = document.getElementById('codeLibraries');
      els.support = document.getElementById('codeSupport');
    }

    function pinNumber(pin) {
      if (!pin) return null;
      return BoardRegistry.pinNumber(pin);
    }

    function header(board, lesson) {
      return '/*\n'
        + ' * Microcontroller AI Lab\n'
        + ' * Board : ' + board.name + ' (' + board.variant + ')\n'
        + ' * Lesson: ' + lesson.title + '\n'
        + ' * NOTE  : Code is generated for the selected board. The in-browser\n'
        + ' *         simulator runs a limited subset of these operations.\n'
        + ' */\n\n';
    }

    function resolvePins() {
      var v = lab.lastValidation;
      var board = lab.activeBoard();
      var pins = {
        outputPin: (v && v.info && v.info.pins && v.info.pins.outputPin)
          || board.defaultPins.led,
        outputPins: (v && v.info && v.info.pins && v.info.pins.outputPins
          && v.info.pins.outputPins.length) ? v.info.pins.outputPins.slice() : null,
        inputPin: (v && v.info && v.info.pins && v.info.pins.inputPin)
          || board.defaultPins.button,
        dataPin: (v && v.info && v.info.pins && v.info.pins.dataPin)
          || board.defaultPins.dht
      };
      return pins;
    }

    function generate() {
      var board = lab.activeBoard();
      var lesson = lab.activeLesson();
      var pins = resolvePins();
      var interval = lab.blinkInterval || 500;
      var code = header(board, lesson);

      var outs = (pins.outputPins && pins.outputPins.length) ? pins.outputPins : [pins.outputPin];
      var multi = outs.length > 1;
      function ledName(i) { return multi ? 'LED' + (i + 1) + '_PIN' : 'LED_PIN'; }
      function ledDecls() {
        return outs.map(function (p, i) {
          return 'const int ' + ledName(i) + ' = ' + pinNumber(p) + ';  // ' + p + '\n';
        }).join('');
      }
      function ledEach(fmt) {
        return outs.map(function (p, i) { return fmt(ledName(i)); }).join('');
      }

      if (lesson.id === 'led') {
        code += ledDecls();
        code += 'const int BLINK_INTERVAL = ' + interval + ';  // milliseconds\n\n';
        code += 'void setup() {\n';
        code += ledEach(function (n) { return '  pinMode(' + n + ', OUTPUT);\n'; });
        code += '}\n\n';
        code += 'void loop() {\n';
        code += ledEach(function (n) { return '  digitalWrite(' + n + ', HIGH);\n'; });
        code += '  delay(BLINK_INTERVAL);\n\n';
        code += ledEach(function (n) { return '  digitalWrite(' + n + ', LOW);\n'; });
        code += '  delay(BLINK_INTERVAL);\n';
        code += '}\n';      } else if (lesson.id === 'button') {
        var inNo = pinNumber(pins.inputPin);
        code += 'const int BUTTON_PIN = ' + inNo + ';  // ' + pins.inputPin + '\n';
        code += ledDecls() + '\n';
        code += 'void setup() {\n';
        code += ledEach(function (n) { return '  pinMode(' + n + ', OUTPUT);\n'; });
        code += '  pinMode(BUTTON_PIN, INPUT_PULLUP);  // idle HIGH, pressed LOW\n';
        code += '}\n\n';
        code += 'void loop() {\n';
        code += '  int buttonState = digitalRead(BUTTON_PIN);\n';
        code += '  if (buttonState == LOW) {\n';
        code += ledEach(function (n) { return '    digitalWrite(' + n + ', HIGH);  // button pressed -> LED on\n'; });
        code += '  } else {\n';
        code += ledEach(function (n) { return '    digitalWrite(' + n + ', LOW);\n'; });
        code += '  }\n';
        code += '}\n';
      } else if (lesson.id === 'dht11') {
        var dNo = pinNumber(pins.dataPin);
        code += '#include <DHT.h>\n\n';
        code += '#define DHTPIN ' + dNo + '  // ' + pins.dataPin + '\n';
        code += '#define DHTTYPE DHT11\n\n';
        code += 'DHT dht(DHTPIN, DHTTYPE);\n\n';
        code += 'void setup() {\n';
        code += '  Serial.begin(9600);\n';
        code += '  dht.begin();\n';
        code += '}\n\n';
        code += 'void loop() {\n';
        code += '  float temperature = dht.readTemperature();\n';
        code += '  float humidity = dht.readHumidity();\n\n';
        code += '  Serial.print("Temperature: ");\n';
        code += '  Serial.print(temperature);\n';
        code += '  Serial.println(" C");\n\n';
        code += '  Serial.print("Humidity: ");\n';
        code += '  Serial.print(humidity);\n';
        code += '  Serial.println(" %");\n\n';
        code += '  delay(2000);\n';
        code += '}\n';
      }

      els.output.value = code;
      renderExplanation(board, lesson, pins);
      return code;
    }

    function renderExplanation(board, lesson, pins) {
      var lines = [];
      lines.push('<strong>' + board.name + ' \u00B7 ' + lesson.title + '</strong>');
      lines.push('<p>' + lesson.summary + '</p>');

      if (lesson.id === 'led') {
        lines.push('<ul>'
          + '<li>LED pin(s): <b>' + ((pins.outputPins || [pins.outputPin]).join(', '))
          + '</b> (one <code>const int</code> per LED, mapped to the board pin number).</li>'
          + '<li><code>pinMode(..., OUTPUT)</code> makes each LED pin a driver.</li>'
          + '<li><code>digitalWrite</code> HIGH/LOW turns the LED on and off.</li>'
          + '<li><code>delay(BLINK_INTERVAL)</code> pauses the program.</li>'
          + '</ul>');
      } else if (lesson.id === 'button') {
        lines.push('<ul>'
          + '<li><code>BUTTON_PIN</code> = <b>' + pins.inputPin + '</b> ('
          + pinNumber(pins.inputPin) + ').</li>'
          + '<li><code>INPUT_PULLUP</code> holds the pin HIGH when the button is released.</li>'
          + '<li>Pressing the button pulls the pin LOW, so the code treats LOW as pressed.</li>'
          + '<li>The LED is driven through the <code>LED_PIN</code> output stage.</li>'
          + '</ul>');
      } else if (lesson.id === 'dht11') {
        lines.push('<ul>'
          + '<li><code>DHTPIN</code> = <b>' + pins.dataPin + '</b> ('
          + pinNumber(pins.dataPin) + ').</li>'
          + '<li><code>dht.readTemperature()</code> and <code>dht.readHumidity()</code> '
          + 'read the sensor over the single data wire.</li>'
          + '<li>The data wire needs a pull-up resistor (4.7k-10k).</li>'
          + '<li>Serial output prints the simulated values.</li>'
          + '</ul>');
      }

      els.explain.innerHTML = lines.join('');
      els.libs.innerHTML = '<h4>Required libraries</h4><ul>'
        + requiredLibraries(lesson).map(function (l) { return '<li>' + l + '</li>'; }).join('')
        + '</ul>';
      els.support.innerHTML = '<h4>Simulator-supported operations</h4>'
        + '<p class="muted">The simulator does not compile or run your code. It only '
        + 'models the operations listed below for this lesson.</p><ul>'
        + lesson.simulatorSupport.map(function (l) { return '<li><code>' + l + '</code></li>'; }).join('')
        + '</ul>';
    }

    function requiredLibraries(lesson) {
      if (lesson.id === 'dht11') {
        return ['DHT sensor library (Adafruit DHT)', 'Adafruit Unified Sensor (dependency)'];
      }
      if (lesson.id === 'button' || lesson.id === 'led') {
        return ['None (core Arduino API only)'];
      }
      return ['None'];
    }

    /** Return a list of function calls that the simulator cannot model. */
    function analyze(code) {
      var unsupported = [];
      var callRe = /([A-Za-z_][A-Za-z0-9_.]*)\s*\(/g;
      var m;
      var skip = ['setup', 'loop', 'if', 'for', 'while', 'switch', 'sizeof', 'return'];
      var seen = {};
      while ((m = callRe.exec(code)) !== null) {
        var name = m[1];
        if (seen[name]) continue;
        seen[name] = true;
        if (skip.indexOf(name) !== -1) continue;
        var ok = SUPPORTED_FUNCTIONS.some(function (f) {
          return name === f || name.indexOf(f + '.') === 0;
        });
        if (!ok) unsupported.push(name);
      }
      return unsupported;
    }

    function init() {
      cacheEls();
      els.generate.addEventListener('click', function () {
        generate();
        lab.toast('Code generated for ' + lab.activeBoard().name + '.', 'info');
      });
      els.copy.addEventListener('click', function () {
        var code = els.output.value;
        if (!code) { lab.toast('Nothing to copy yet.', 'error'); return; }
        if (navigator.clipboard) {
          navigator.clipboard.writeText(code).then(function () {
            lab.toast('Code copied to clipboard.', 'success');
          }, function () {
            lab.toast('Copy failed. Select the code manually.', 'error');
          });
        } else {
          els.output.select();
          document.execCommand('copy');
          lab.toast('Code copied.', 'success');
        }
      });
    }

    return {
      init: init,
      generate: generate,
      getCode: function () { return els.output ? els.output.value : ''; },
      analyze: analyze,
      requiredLibraries: requiredLibraries
    };
  }

  var api = { create: create, SUPPORTED_FUNCTIONS: SUPPORTED_FUNCTIONS };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.CodeEditor = api;
  }
})(typeof window !== 'undefined' ? window : this);


