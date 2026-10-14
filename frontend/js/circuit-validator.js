/*
 * circuit-validator.js
 * Deterministic circuit validation. No AI, no guessing: this module decides
 * whether a circuit passes or fails for the selected board and lesson.
 *
 * validate(state) returns:
 *   {
 *     valid: boolean,
 *     board: boardId,
 *     lesson: lessonId,
 *     errors: [ { code, message } ],
 *     warnings: [ { code, message } ],
 *     info: { pins: { outputPin, inputPin, dataPin }, topology, resistor }
 *   }
 */

(function (global) {
  'use strict';

  var isNode = typeof module !== 'undefined' && module.exports;
  var BoardRegistry = isNode ? require('./board-registry') : global.BoardRegistry;
  var Components = isNode ? require('./components') : global.Components;
  var Lessons = isNode ? require('./lessons') : global.Lessons;

  function parseRef(r) {
    var i = String(r).indexOf('.');
    if (i === -1) return null;
    return { componentId: r.slice(0, i), pinId: r.slice(i + 1) };
  }

  function ref(componentId, pinId) {
    return componentId + '.' + pinId;
  }

  function findComponent(state, id) {
    for (var i = 0; i < state.components.length; i++) {
      if (state.components[i].id === id) return state.components[i];
    }
    return null;
  }

  function definitionFor(component) {
    return Components.getDefinition(component.type);
  }

  function resolvePin(state, r) {
    var parsed = parseRef(r);
    if (!parsed) return null;
    var component = findComponent(state, parsed.componentId);
    if (!component) return null;
    var def = definitionFor(component);
    if (!def) return null;
    var pin = null;
    for (var i = 0; i < def.pins.length; i++) {
      if (def.pins[i].id === parsed.pinId) { pin = def.pins[i]; break; }
    }
    if (!pin) return null;
    return {
      component: component,
      definition: def,
      pin: pin,
      abs: { x: component.x + pin.x, y: component.y + pin.y }
    };
  }

  // ---- Union-find over pin references -----------------------------

  function DSU() {
    this.parent = {};
  }
  DSU.prototype.add = function (x) {
    if (!(x in this.parent)) this.parent[x] = x;
  };
  DSU.prototype.find = function (x) {
    this.add(x);
    while (this.parent[x] !== x) {
      this.parent[x] = this.parent[this.parent[x]];
      x = this.parent[x];
    }
    return x;
  };
  DSU.prototype.union = function (a, b) {
    var ra = this.find(a);
    var rb = this.find(b);
    if (ra !== rb) this.parent[rb] = ra;
  };

  function buildDSU(state) {
    var dsu = new DSU();
    state.components.forEach(function (component) {
      var def = definitionFor(component);
      if (!def) return;
      def.pins.forEach(function (pin) { dsu.add(ref(component.id, pin.id)); });
      (def.internalBridges || []).forEach(function (bridge) {
        for (var i = 1; i < bridge.length; i++) {
          dsu.union(ref(component.id, bridge[0]), ref(component.id, bridge[i]));
        }
      });
    });

    state.connections.forEach(function (c) {
      if (resolvePin(state, c.from) && resolvePin(state, c.to)) {
        dsu.union(c.from, c.to);
      }
    });

    // Interior duplicates on microcontroller boards: all ground pins are the
    // same electrical node. Power rails are kept separate because they may
    // carry different voltages.
    var boardComp = state.components.filter(function (c) {
      return Components.isBoardType(c.type);
    })[0];
    if (boardComp) {
      var board = BoardRegistry.getBoard(boardComp.type);
      var gndRefs = board.groundPins.map(function (p) { return ref(boardComp.id, p); });
      for (var i = 1; i < gndRefs.length; i++) {
        dsu.union(gndRefs[0], gndRefs[i]);
      }
    }
    return dsu;
  }

  // ---- helpers -----------------------------------------------------

  function findResistorBetween(state, defs, netA, netB) {
    var resistors = state.components.filter(function (c) { return c.type === 'resistor'; });
    for (var i = 0; i < resistors.length; i++) {
      var r = resistors[i];
      var n1 = defs.netOf(ref(r.id, 'pin1'));
      var n2 = defs.netOf(ref(r.id, 'pin2'));
      if ((n1 === netA && n2 === netB) || (n1 === netB && n2 === netA)) return r;
    }
    return null;
  }

  function resistorValue(resistor) {
    var v = resistor && resistor.properties ? resistor.properties.resistance : NaN;
    var n = Number(v);
    return isFinite(n) ? n : NaN;
  }

  // ---- main validate ----------------------------------------------

  function validate(state) {
    var errors = [];
    var warnings = [];
    var info = { pins: {}, topology: null, resistor: null };

    function err(code, message) { errors.push({ code: code, message: message }); }
    function warn(code, message) { warnings.push({ code: code, message: message }); }

    if (!state || !Array.isArray(state.components)) {
      err('EMPTY_STATE', 'No circuit data was provided.');
      return { valid: false, errors: errors, warnings: warnings, info: info };
    }

    var board = BoardRegistry.getBoard(state.board);
    if (!board) {
      err('BOARD_NOT_CONFIGURED',
        'The selected board "' + state.board + '" is not configured in the board registry.');
      return { valid: false, errors: errors, warnings: warnings, info: info };
    }

    var lesson = Lessons.getLesson(state.lesson);

    // Board component checks.
    var boardComponents = state.components.filter(function (c) {
      return Components.isBoardType(c.type);
    });
    if (boardComponents.length === 0) {
      err('NO_BOARD', 'Place the ' + board.name + ' in the workspace.');
    } else if (boardComponents.length > 1) {
      err('MULTIPLE_BOARDS',
        'Only one microcontroller board is supported per circuit.');
    } else {
      var bc = boardComponents[0];
      if (bc.type !== state.board) {
        err('BOARD_MISMATCH',
          'The workspace contains a ' + Components.getDefinition(bc.type).label
          + ' but the selected board is ' + board.name + '.');
      }
    }

    // Connection endpoint checks.
    var seenPairs = {};
    state.connections.forEach(function (c) {
      var fromOk = resolvePin(state, c.from);
      var toOk = resolvePin(state, c.to);
      if (!fromOk) {
        err('BAD_ENDPOINT', 'A wire references a pin that does not exist: ' + c.from);
      }
      if (!toOk) {
        err('BAD_ENDPOINT', 'A wire references a pin that does not exist: ' + c.to);
      }
      if (c.from === c.to) {
        err('SELF_WIRE', 'A pin cannot be connected to itself: ' + c.from);
      }
      var key = [c.from, c.to].sort().join('|');
      if (seenPairs[key]) {
        warn('DUPLICATE_WIRE', 'There are duplicate wires between ' + c.from + ' and ' + c.to + '.');
      }
      seenPairs[key] = true;
    });

    // Required components.
    if (lesson) {
      lesson.components.forEach(function (type) {
        var present = state.components.some(function (c) { return c.type === type; });
        if (!present) {
          var label = Components.getDefinition(type).label;
          err('MISSING_COMPONENT', 'This lesson needs a ' + label + '.');
        }
      });
    }

    if (state.connections.length === 0) {
      err('NO_CONNECTIONS', 'No wires have been drawn yet.');
    }

    // If we already have structural problems, stop before electrical analysis.
    var hasStructuralBlock = errors.some(function (e) {
      return ['BOARD_NOT_CONFIGURED', 'NO_BOARD', 'MULTIPLE_BOARDS',
        'BOARD_MISMATCH', 'BAD_ENDPOINT', 'SELF_WIRE'].indexOf(e.code) !== -1;
    });
    if (hasStructuralBlock) {
      return { valid: false, errors: errors, warnings: warnings, info: info };
    }

    var dsu = buildDSU(state);
    var defs = {
      netOf: function (r) { return dsu.find(r); }
    };

    var gndRef = ref(boardComponents[0].id, board.groundPins[0]);
    var gndNet = defs.netOf(gndRef);

    var digitalPinNets = {};
    board.digitalPins.forEach(function (p) {
      digitalPinNets[p] = defs.netOf(ref(boardComponents[0].id, p));
    });
    var powerPinNets = {};
    board.powerPins.forEach(function (p) {
      powerPinNets[p] = defs.netOf(ref(boardComponents[0].id, p));
    });

    function digitalPinsOnNet(net) {
      return board.digitalPins.filter(function (p) { return digitalPinNets[p] === net; });
    }
    function powerPinsOnNet(net) {
      return board.powerPins.filter(function (p) { return powerPinNets[p] === net; });
    }

    // Detect any GPIO shorted directly to ground.
    board.digitalPins.forEach(function (p) {
      if (digitalPinNets[p] === gndNet) {
        err('GPIO_SHORT', 'Pin ' + p + ' is connected directly to ground.');
      }
    });

    // ---- LED output stage (used by LED and Button lessons) --------
    function validateLedStage() {
      var leds = state.components.filter(function (c) { return c.type === 'led'; });
      if (leds.length === 0) return null;
      if (leds.length > 1) {
        warn('MULTIPLE_LEDS', 'More than one LED is present; only the first is simulated.');
      }
      var led = leds[0];
      var anodeNet = defs.netOf(ref(led.id, 'anode'));
      var cathodeNet = defs.netOf(ref(led.id, 'cathode'));

      if (anodeNet === cathodeNet) {
        err('LED_SHORT', 'The LED anode and cathode are connected to the same net.');
        return null;
      }
      if (anodeNet === gndNet) {
        err('LED_REVERSED', 'The LED anode is connected to ground. Reverse the LED polarity.');
        return null;
      }

      var chosenOutput = null;
      var topology = null;
      var seriesResistor = null;

      board.digitalPins.forEach(function (dp) {
        if (chosenOutput) return;
        var g = digitalPinNets[dp];
        if (g === gndNet) return;
        // Topology A: GPIO -> resistor -> LED anode, cathode -> GND
        var rA = findResistorBetween(state, defs, g, anodeNet);
        if (rA && cathodeNet === gndNet) {
          chosenOutput = dp; topology = 'A'; seriesResistor = rA; return;
        }
        // Topology B: GPIO -> LED anode, cathode -> resistor -> GND
        if (anodeNet === g) {
          var rB = findResistorBetween(state, defs, cathodeNet, gndNet);
          if (rB) {
            chosenOutput = dp; topology = 'B'; seriesResistor = rB; return;
          }
        }
        // Direct (no resistor).
        if (anodeNet === g && cathodeNet === gndNet) {
          chosenOutput = dp; topology = 'direct';
        }
      });

      if (digitalPinsOnNet(cathodeNet).length > 0) {
        err('LED_REVERSED',
          'The LED cathode is connected to a GPIO pin. The cathode must go to ground.');
        return null;
      }

      if (!chosenOutput) {
        if (cathodeNet !== gndNet) {
          err('LED_NO_GROUND', 'The LED cathode does not return to a ground pin.');
        } else {
          err('LED_NO_GPIO', 'The LED anode is not connected to a GPIO output pin.');
        }
        return null;
      }

      if (topology === 'direct') {
        err('LED_NO_RESISTOR',
          'The LED is connected directly to the GPIO with no current-limiting resistor.');
      } else {
        info.resistor = seriesResistor;
        var rv = resistorValue(seriesResistor);
        if (isNaN(rv)) {
          warn('RESISTOR_VALUE', 'The series resistor has no usable resistance value.');
        } else if (rv < 100) {
          warn('RESISTOR_LOW',
            'The series resistor is ' + rv + ' ohm, which is low and may damage the LED or pin.');
        } else if (rv > 10000) {
          warn('RESISTOR_HIGH',
            'The series resistor is ' + rv + ' ohm; the LED may be very dim.');
        }
      }

      info.pins.outputPin = chosenOutput;
      info.topology = topology;
      return chosenOutput;
    }

    // ---- Button stage --------------------------------------------
    function validateButtonStage() {
      var buttons = state.components.filter(function (c) { return c.type === 'button'; });
      if (buttons.length === 0) return;
      var button = buttons[0];
      var sideA = defs.netOf(ref(button.id, 'a1'));
      var sideB = defs.netOf(ref(button.id, 'b1'));

      if (sideA === sideB) {
        err('BUTTON_SHORT', 'Both sides of the button are on the same net.');
        return;
      }

      var aPins = digitalPinsOnNet(sideA);
      var bPins = digitalPinsOnNet(sideB);
      var aGnd = sideA === gndNet;
      var bGnd = sideB === gndNet;

      if ((aGnd && bGnd)) {
        err('BUTTON_BOTH_GND', 'Both sides of the button are connected to ground.');
        return;
      }
      if (aPins.length === 0 && bPins.length === 0) {
        err('BUTTON_NO_PIN', 'The button is not connected to a GPIO input pin.');
        return;
      }
      if (!aGnd && !bGnd) {
        err('BUTTON_FLOAT',
          'One side of the button must go to GND so the input does not float '
          + '(this lesson uses INPUT_PULLUP).');
        return;
      }

      info.pins.inputPin = (aPins[0] || bPins[0]);
    }

    // ---- DHT11 stage ---------------------------------------------
    function validateDhtStage() {
      var sensors = state.components.filter(function (c) { return c.type === 'dht11'; });
      if (sensors.length === 0) return;
      var dht = sensors[0];
      var vccNet = defs.netOf(ref(dht.id, 'VCC'));
      var dataNet = defs.netOf(ref(dht.id, 'DATA'));
      var sensorGnd = defs.netOf(ref(dht.id, 'GND'));

      if (sensorGnd !== gndNet) {
        err('DHT_NO_GND', 'The DHT11 GND pin is not connected to a board ground pin.');
      }
      var powerOnVcc = powerPinsOnNet(vccNet);
      if (powerOnVcc.length === 0) {
        err('DHT_NO_POWER', 'The DHT11 VCC pin is not connected to a board power pin.');
      }
      var dataPins = digitalPinsOnNet(dataNet);
      if (dataPins.length === 0) {
        err('DHT_NO_DATA',
          'The DHT11 DATA pin is not connected to a GPIO pin on the board.');
      } else {
        info.pins.dataPin = dataPins[0];
      }
      if (dataNet === gndNet) {
        err('DHT_DATA_SHORT', 'The DHT11 DATA pin is shorted to ground.');
      }
      if (vccNet === gndNet) {
        err('DHT_POWER_SHORT', 'The DHT11 VCC pin is shorted to ground.');
      }

      // Voltage sanity check for 3.3V boards fed from a 5V rail.
      if (board.logicVoltage < 5) {
        powerOnVcc.forEach(function (p) {
          var v = board.powerPinVoltage ? board.powerPinVoltage[p] : null;
          if (v && v > board.logicVoltage) {
            warn('DHT_VOLTAGE',
              'The DHT11 VCC is on ' + p + ' (' + v + 'V) while the board logic is '
              + board.logicVoltage + 'V. Use a 3.3V-compatible module or the level '
              + 'requirements may not match.');
          }
        });
      }

      // Pull-up recommendation.
      var pullup = findResistorBetween(state, defs, dataNet, vccNet);
      if (!pullup) {
        warn('DHT_NO_PULLUP',
          'The DHT11 DATA line has no pull-up resistor to VCC (4.7k-10k is typical).');
      }
    }

    if (lesson) {
      if (lesson.id === 'led') {
        validateLedStage();
      } else if (lesson.id === 'button') {
        var out = validateLedStage();
        validateButtonStage();
        if (!info.pins.outputPin) info.pins.outputPin = out;
      } else if (lesson.id === 'dht11') {
        validateDhtStage();
      }
    }

    var valid = errors.length === 0;
    return {
      valid: valid,
      board: state.board,
      lesson: state.lesson,
      errors: errors,
      warnings: warnings,
      info: info
    };
  }

  var api = {
    validate: validate,
    resolvePin: resolvePin,
    parseRef: parseRef,
    ref: ref
  };

  if (isNode) {
    module.exports = api;
  } else {
    global.CircuitValidator = api;
  }
})(typeof window !== 'undefined' ? window : this);
