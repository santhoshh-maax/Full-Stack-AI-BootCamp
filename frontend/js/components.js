/*
 * components.js
 * Component catalog and instance factory.
 *
 * Every component is described by:
 *   - a type id
 *   - a display label
 *   - a bounding box (width/height) in workspace units
 *   - a list of pins with coordinates relative to the component's top-left
 *   - default editable properties
 *   - internal bridges (pins that are wired together inside the part, such as
 *     the two legs of one side of a tactile push button)
 *
 * The board component is generated dynamically from the selected board in the
 * board registry, so its pins always match the configured microcontroller.
 */

(function (global) {
  'use strict';

  var BoardRegistry = (typeof require === 'function')
    ? require('./board-registry')
    : global.BoardRegistry;

  var LED_COLORS = {
    red: '#e53935',
    green: '#43a047',
    yellow: '#fdd835',
    blue: '#1e88e5',
    white: '#f5f5f5'
  };

  // ---- Static component definitions -------------------------------

  var definitions = {
    led: {
      type: 'led',
      label: 'LED',
      width: 60,
      height: 90,
      pins: [
        { id: 'anode', label: '+', x: 30, y: 0, kind: 'anode' },
        { id: 'cathode', label: '\u2013', x: 30, y: 90, kind: 'cathode' }
      ],
      internalBridges: [],
      properties: { color: 'red' },
      description: 'A light emitting diode. The anode (+, longer leg) must be '
        + 'connected toward the GPIO through a current limiting resistor, and '
        + 'the cathode goes to ground.'
    },

    resistor: {
      type: 'resistor',
      label: 'Resistor',
      width: 100,
      height: 32,
      pins: [
        { id: 'pin1', label: '1', x: 0, y: 16, kind: 'passive' },
        { id: 'pin2', label: '2', x: 100, y: 16, kind: 'passive' }
      ],
      internalBridges: [],
      properties: { resistance: 220 },
      description: 'A current limiting resistor. 220-330 ohm is typical for a '
        + '5V LED circuit. It is not polarised, so either pin can face the GPIO.'
    },

    button: {
      type: 'button',
      label: 'Push Button',
      width: 90,
      height: 80,
      pins: [
        { id: 'a1', label: 'A1', x: 0, y: 20, kind: 'passive' },
        { id: 'a2', label: 'A2', x: 0, y: 60, kind: 'passive' },
        { id: 'b1', label: 'B1', x: 90, y: 20, kind: 'passive' },
        { id: 'b2', label: 'B2', x: 90, y: 60, kind: 'passive' }
      ],
      // A tactile 4-leg button has two legs per side; the two legs on the same
      // side are always connected internally.
      internalBridges: [['a1', 'a2'], ['b1', 'b2']],
      properties: {},
      description: 'A momentary push button. The two sides connect only while '
        + 'the button is held down. Legs on the same side are internally joined.'
    },

    dht11: {
      type: 'dht11',
      label: 'DHT11 Sensor',
      width: 100,
      height: 130,
      pins: [
        { id: 'VCC', label: 'VCC', x: 0, y: 25, kind: 'power' },
        { id: 'DATA', label: 'DATA', x: 0, y: 60, kind: 'data' },
        { id: 'GND', label: 'GND', x: 0, y: 95, kind: 'gnd' }
      ],
      internalBridges: [],
      properties: {},
      description: 'A DHT11 temperature and humidity sensor. VCC is for power, '
        + 'DATA carries the digital reading, GND completes the circuit. The '
        + 'DATA pin needs a pull-up resistor on the data line.'
    }
  };

  // ---- Board component factory -----------------------------------

  function labelForBoardPin(board, pin) {
    return pin;
  }

  function kindForBoardPin(board, pin) {
    if (board.groundPins.indexOf(pin) !== -1) return 'gnd';
    if (board.powerPins.indexOf(pin) !== -1) return 'power';
    var info = board.pinInfo[pin];
    if (info && info.analog && !info.digital) return 'analog';
    return 'digital';
  }

  /**
   * Build a board component definition whose pins reflect the given board.
   * Power and ground pins are placed on the left rail; digital/analog pins
   * are laid out in two columns.
   */
  function createBoardDefinition(boardId) {
    var board = BoardRegistry.getBoard(boardId);
    if (!board) return null;

    if (boardId === 'esp32-devkit') {
      var width = 270;
      var height = 450;
      var top = 62;
      var rowGap = 28;
      var leftX = 16;
      var rightX = width - 16; // 254

      // Real physical 30-pin ESP32 DevKit V1 DIP layout (all 26 supported pins preserved)
      var leftPinIds = [
        '3V3', 'GPIO36', 'GPIO39', 'GPIO34', 'GPIO35',
        'GPIO32', 'GPIO33', 'GPIO25', 'GPIO26', 'GPIO27',
        'GPIO14', 'GPIO12', 'GPIO13'
      ];
      var rightPinIds = [
        'VIN', 'GND', 'GPIO23', 'GPIO22', 'GPIO21',
        'GPIO19', 'GPIO18', 'GPIO5', 'GPIO17', 'GPIO16',
        'GPIO4', 'GPIO2', 'GPIO15'
      ];

      var pins = [];
      leftPinIds.forEach(function (pinId, i) {
        pins.push({
          id: pinId,
          label: labelForBoardPin(board, pinId),
          x: leftX,
          y: top + i * rowGap,
          kind: kindForBoardPin(board, pinId),
          anchor: 'left'
        });
      });

      rightPinIds.forEach(function (pinId, i) {
        pins.push({
          id: pinId,
          label: labelForBoardPin(board, pinId),
          x: rightX,
          y: top + i * rowGap,
          kind: kindForBoardPin(board, pinId),
          anchor: 'right'
        });
      });

      return {
        type: boardId,
        label: board.name,
        width: width,
        height: height,
        isBoard: true,
        pins: pins,
        internalBridges: [],
        properties: {},
        description: board.notes
      };
    }

    var rows = [];
    board.powerPins.forEach(function (p) { rows.push({ pin: p, rail: 'left' }); });
    board.groundPins.forEach(function (p) { rows.push({ pin: p, rail: 'left' }); });

    var ioPins = board.digitalPins.concat(
      board.analogPins.filter(function (p) { return board.digitalPins.indexOf(p) === -1; })
    );
    // include input-only ESP32 pins that are not already listed
    Object.keys(board.pinInfo).forEach(function (p) {
      if (ioPins.indexOf(p) === -1) ioPins.push(p);
    });

    var colCount = 2;
    var perCol = Math.ceil(ioPins.length / colCount);

    var width = 300;
    var top = 70;
    var rowGap = 26;
    var height = Math.max(320, top + perCol * rowGap + 30);

    var leftX = 16;
    var colX = [150, 278];
    var pins = [];

    // Left rail: power + ground.
    rows.forEach(function (row, i) {
      pins.push({
        id: row.pin,
        label: row.pin,
        x: leftX,
        y: top + i * rowGap,
        kind: kindForBoardPin(board, row.pin),
        anchor: 'left'
      });
    });

    // IO columns.
    ioPins.forEach(function (pin, i) {
      var col = i % colCount;
      var rowIdx = Math.floor(i / colCount);
      var anchor = col === 0 ? 'left' : 'right';
      pins.push({
        id: pin,
        label: labelForBoardPin(board, pin),
        x: colX[col],
        y: top + rowIdx * rowGap,
        kind: kindForBoardPin(board, pin),
        anchor: anchor
      });
    });

    return {
      type: boardId,
      label: board.name,
      width: width,
      height: height,
      isBoard: true,
      pins: pins,
      internalBridges: [],
      properties: {},
      description: board.notes
    };
  }

  // ---- Public API -------------------------------------------------

  function getDefinition(type) {
    if (definitions[type]) return definitions[type];
    if (BoardRegistry.getBoard(type)) return createBoardDefinition(type);
    return null;
  }

  function isBoardType(type) {
    return Boolean(BoardRegistry.getBoard(type));
  }

  function cloneDefinition(def) {
    return JSON.parse(JSON.stringify(def));
  }

  /**
   * Create a new component instance at (x, y).
   */
  function createInstance(type, x, y, overrides) {
    var def = getDefinition(type);
    if (!def) throw new Error('Unknown component type: ' + type);
    var instance = {
      id: overrides && overrides.id ? overrides.id : null,
      type: type,
      x: x,
      y: y,
      properties: Object.assign({}, def.properties, (overrides && overrides.properties) || {})
    };
    return instance;
  }

  var api = {
    LED_COLORS: LED_COLORS,
    definitions: definitions,
    getDefinition: getDefinition,
    isBoardType: isBoardType,
    cloneDefinition: cloneDefinition,
    createInstance: createInstance,
    createBoardDefinition: createBoardDefinition
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.Components = api;
  }
})(typeof window !== 'undefined' ? window : this);
