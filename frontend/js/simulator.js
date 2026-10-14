/*
 * simulator.js
 * Lightweight in-browser simulator.
 *
 * The simulator does NOT compile or execute the generated program. It runs a
 * validated structured representation of the lesson behaviour using the pins
 * resolved from the circuit. Only a documented subset of behaviour is modelled
 * and every panel clearly labels the output as simulated.
 */

(function (global) {
  'use strict';

  function create(lab) {
    var els = {};
    var timer = null;
    var sim = {
      running: false,
      lesson: null,
      outputPin: null,
      inputPin: null,
      dataPin: null,
      intervalMs: 500,
      ledOn: false,
      buttonPressed: false,
      temperature: 28,
      humidity: 65
    };

    function cache() {
      els.run = document.getElementById('btnSimRun');
      els.stop = document.getElementById('btnSimStop');
      els.reset = document.getElementById('btnSimReset');
      els.status = document.getElementById('simStatus');
      els.serial = document.getElementById('serialOutput');
      els.led = document.getElementById('virtualLed');
      els.button = document.getElementById('virtualButton');
      els.buttonState = document.getElementById('buttonStateLabel');
      els.sensorPanel = document.getElementById('sensorPanel');
      els.temp = document.getElementById('tempSlider');
      els.tempVal = document.getElementById('tempValue');
      els.hum = document.getElementById('humSlider');
      els.humVal = document.getElementById('humValue');
      els.buttonPanel = document.getElementById('buttonSimPanel');
      els.ledPanel = document.getElementById('ledSimPanel');
    }

    function log(line) {
      if (!els.serial) return;
      var time = new Date().toLocaleTimeString();
      var t = '[' + time + '] ' + line + '\n';
      els.serial.textContent += t;
      els.serial.scrollTop = els.serial.scrollHeight;
    }

    function clearLog() {
      if (els.serial) els.serial.textContent = '';
    }

    function setStatus(text, kind) {
      if (!els.status) return;
      els.status.textContent = text;
      els.status.className = 'sim-status' + (kind ? ' ' + kind : '');
    }

    function findComponent(type) {
      return lab.state.components.filter(function (c) { return c.type === type; })[0] || null;
    }

    function updateLed(newState) {
      sim.ledOn = newState;
      var led = findComponent('led');
      if (led) led.properties._on = newState;
      if (els.led) {
        els.led.className = 'virtual-led' + (newState ? ' on' : '');
      }
      lab.canvas.render();
    }

    function updateButton(pressed) {
      sim.buttonPressed = pressed;
      var button = findComponent('button');
      if (button) button.properties._pressed = pressed;
      if (els.buttonState) {
        els.buttonState.textContent = pressed ? 'Pressed (LOW)' : 'Released (HIGH)';
      }
      if (els.button) {
        els.button.className = 'virtual-button' + (pressed ? ' pressed' : '');
        els.button.setAttribute('aria-pressed', pressed ? 'true' : 'false');
      }
      lab.canvas.render();
    }

    function clearTimer() {
      if (timer) { clearInterval(timer); timer = null; }
    }

    function refreshBadge() {
      if (lab.updateSimStatusBadge) lab.updateSimStatusBadge();
    }

    function panelVisibility() {
      var lesson = sim.lesson;
      if (els.ledPanel) els.ledPanel.style.display = (lesson === 'led' || lesson === 'button') ? '' : 'none';
      if (els.buttonPanel) els.buttonPanel.style.display = (lesson === 'button') ? '' : 'none';
      if (els.sensorPanel) els.sensorPanel.style.display = (lesson === 'dht11') ? '' : 'none';
    }

    function start() {
      var v = lab.lastValidation;
      if (!v || !v.valid) {
        setStatus('Cannot simulate: fix the validation errors first.', 'error');
        lab.toast('Validate and fix the circuit before simulating.', 'error');
        return;
      }
      var lesson = lab.activeLesson();
      sim.lesson = lesson.id;
      sim.outputPin = v.info.pins.outputPin || lab.activeBoard().defaultPins.led;
      sim.inputPin = v.info.pins.inputPin || lab.activeBoard().defaultPins.button;
      sim.dataPin = v.info.pins.dataPin || lab.activeBoard().defaultPins.dht;
      sim.intervalMs = lab.blinkInterval || 500;
      sim.running = true;
      panelVisibility();

      var unsupported = lab.codeEditor.analyze(lab.codeEditor.getCode());
      if (unsupported.length) {
        log('Simulator note: these calls are not modelled -> ' + unsupported.join(', '));
      }

      setStatus('Running (simulated).', 'running');
      refreshBadge();
      log('--- simulation started ---');

      if (lesson.id === 'led') {
        log('Board ' + lab.activeBoard().name + ' drives ' + sim.outputPin + ' as an output.');
        timer = setInterval(function () {
          updateLed(!sim.ledOn);
        }, sim.intervalMs);
      } else if (lesson.id === 'button') {
        updateButton(false);
        log('Board reads input pin ' + sim.inputPin + ' with INPUT_PULLUP.');
        log('Press the virtual button to pull the pin LOW.');
      } else if (lesson.id === 'dht11') {
        log('Reading DHT11 on data pin ' + sim.dataPin + ' (simulated samples).');
        publishSensor();
      }
    }

    function stopInternal(reason) {
      clearTimer();
      sim.running = false;
      setStatus(reason || 'Stopped.', 'stopped');
      refreshBadge();
    }

    function stop() {
      if (!sim.running && !timer) { setStatus('Simulation is not running.'); return; }
      stopInternal('Stopped (simulated).');
      log('--- simulation stopped ---');
    }

    function reset() {
      clearTimer();
      sim.running = false;
      sim.ledOn = false;
      sim.buttonPressed = false;
      updateLed(false);
      updateButton(false);
      clearLog();
      setStatus('Reset. Not running.');
      refreshBadge();
      log('--- simulation reset ---');
    }

    function publishSensor() {
      if (els.tempVal) els.tempVal.textContent = sim.temperature.toFixed(1) + ' \u00B0C';
      if (els.humVal) els.humVal.textContent = sim.humidity + ' %';
      log('Temperature: ' + sim.temperature.toFixed(1) + ' C  |  Humidity: ' + sim.humidity + ' % (simulated)');
    }

    function setButton(pressed) {
      if (!sim.running || sim.lesson !== 'button') return;
      if (pressed === sim.buttonPressed) return;
      updateButton(pressed);
      // INPUT_PULLUP: pressed => LOW => LED on.
      updateLed(pressed);
      log('digitalRead(' + sim.inputPin + ') = ' + (pressed ? 'LOW' : 'HIGH')
        + '  ->  digitalWrite(' + sim.outputPin + ', ' + (pressed ? 'HIGH' : 'LOW') + ')');
    }

    function init() {
      cache();
      els.run.addEventListener('click', start);
      els.stop.addEventListener('click', stop);
      els.reset.addEventListener('click', reset);

      if (els.button) {
        els.button.addEventListener('mousedown', function () { setButton(true); });
        els.button.addEventListener('mouseup', function () { setButton(false); });
        els.button.addEventListener('mouseleave', function () { setButton(false); });
        els.button.addEventListener('touchstart', function (e) { e.preventDefault(); setButton(true); });
        els.button.addEventListener('touchend', function (e) { e.preventDefault(); setButton(false); });
      }

      if (els.temp) {
        els.temp.addEventListener('input', function () {
          sim.temperature = parseFloat(els.temp.value);
          if (els.tempVal) els.tempVal.textContent = sim.temperature.toFixed(1) + ' \u00B0C';
        });
        els.temp.addEventListener('change', function () { if (sim.running) publishSensor(); });
      }
      if (els.hum) {
        els.hum.addEventListener('input', function () {
          sim.humidity = parseInt(els.hum.value, 10);
          if (els.humVal) els.humVal.textContent = sim.humidity + ' %';
        });
        els.hum.addEventListener('change', function () { if (sim.running) publishSensor(); });
      }

      setStatus('Idle. Validate a circuit to enable simulation.');
      panelVisibility();
    }

    return {
      init: init,
      start: start,
      stop: stop,
      reset: reset,
      setButton: setButton,
      isRunning: function () { return sim.running; },
      onLessonChange: function () { reset(); panelVisibility(); }
    };
  }

  var api = { create: create };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.Simulator = api;
  }
})(typeof window !== 'undefined' ? window : this);
