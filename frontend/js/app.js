/*
 * app.js
 * Application orchestrator. Owns the shared circuit data model, wires the
 * controllers together and handles navigation, the component palette, tabs,
 * validation display and the AI context payload.
 */

(function (global) {
  'use strict';

  var SVG_NS = 'http://www.w3.org/2000/svg';
  var Components = global.Components;
  var BoardRegistry = global.BoardRegistry;
  var Lessons = global.Lessons;
  var Validator = global.CircuitValidator;

  var API_BASE = global.API_BASE != null ? global.API_BASE : '';
  global.API_BASE = API_BASE;

  var listeners = {};
  var idCounters = {};

  function nextId(base) {
    idCounters[base] = (idCounters[base] || 0) + 1;
    return base + '-' + idCounters[base];
  }

  function idBaseForType(type) {
    if (Components.isBoardType(type)) return 'board';
    return type;
  }

  var Lab = {
    state: {
      board: 'arduino-uno-r3',
      lesson: 'led',
      components: [],
      connections: []
    },
    lastValidation: null,
    selectedComponentId: null,
    selectedWireId: null,
    pendingRef: null,
    blinkInterval: 500,
    svg: null,
    layers: {}
  };

  // ---- event bus ---------------------------------------------------

  Lab.on = function (evt, fn) {
    (listeners[evt] = listeners[evt] || []).push(fn);
  };
  Lab.emit = function (evt, data) {
    (listeners[evt] || []).forEach(function (fn) { fn(data); });
  };

  // ---- core helpers ------------------------------------------------

  Lab.activeBoard = function () { return BoardRegistry.getBoard(Lab.state.board); };
  Lab.activeLesson = function () { return Lessons.getLesson(Lab.state.lesson); };

  Lab.getDefinition = function (component) {
    return Components.getDefinition(component.type);
  };

  Lab.resolvePin = function (ref) {
    return Validator.resolvePin(Lab.state, ref);
  };

  Lab.highlightPending = function (ref) {
    Lab.pendingRef = ref;
    if (Lab.canvas) Lab.canvas.render();
  };

  Lab.setStatus = function (text) {
    var el = document.getElementById('workspaceStatus');
    if (el) el.textContent = text || '';
  };

  Lab.toast = function (message, kind) {
    var host = document.getElementById('toastHost');
    if (!host) return;
    var node = document.createElement('div');
    node.className = 'toast ' + (kind || 'info');
    node.textContent = message;
    host.appendChild(node);
    setTimeout(function () {
      node.classList.add('leaving');
      setTimeout(function () { node.remove(); }, 300);
    }, 3200);
  };

  // ---- model mutations ---------------------------------------------

  Lab.addComponent = function (type, x, y) {
    var def = Components.getDefinition(type);
    if (!def) { Lab.toast('Unknown component: ' + type, 'error'); return null; }

    if (Components.isBoardType(type)) {
      var existing = Lab.state.components.filter(function (c) {
        return Components.isBoardType(c.type);
      })[0];
      if (existing) {
        if (existing.type === type) { Lab.toast('The board is already placed.', 'info'); }
        else { Lab.setBoard(type); }
        return existing;
      }
      Lab.setBoard(type);
    }

    var id = nextId(idBaseForType(type));
    var component = Components.createInstance(type, x, y, { id: id });
    Lab.state.components.push(component);
    Lab.selectComponent(id);
    Lab.emit('state:changed', { reason: 'add' });
    Lab.toast(def.label + ' added.', 'success');
    return component;
  };

  Lab.removeComponent = function (id) {
    var before = Lab.state.components.length;
    Lab.state.components = Lab.state.components.filter(function (c) { return c.id !== id; });
    if (Lab.state.components.length === before) return;
    Lab.state.connections = Lab.state.connections.filter(function (c) {
      return c.from.indexOf(id + '.') !== 0 && c.to.indexOf(id + '.') !== 0;
    });
    if (Lab.selectedComponentId === id) Lab.selectedComponentId = null;
    Lab.emit('state:changed', { reason: 'remove' });
  };

  Lab.selectComponent = function (id) {
    Lab.selectedComponentId = id;
    if (id) {
      Lab.selectedWireId = null;
      Lab.emit('component:selected', id);
    }
    Lab.canvas.render();
  };

  Lab.setSelectedWire = function (id) {
    Lab.selectedWireId = id;
    if (id) Lab.selectedComponentId = null;
    var resetBtn = document.getElementById('btnResetWire');
    if (resetBtn) resetBtn.style.display = id ? 'inline-flex' : 'none';
  };

  Lab.addConnection = function (from, to, color) {
    var a = Lab.resolvePin(from);
    var b = Lab.resolvePin(to);
    if (!a || !b) return { error: 'One of those pins does not exist.' };
    var boardA = Components.isBoardType(a.component.type) || Components.isBoardType(b.component.type);
    var duplicate = Lab.state.connections.some(function (c) {
      return (c.from === from && c.to === to) || (c.from === to && c.to === from);
    });
    if (duplicate) return { error: 'These pins are already connected.' };
    if (boardA) {
      // Connecting a board pin to the board itself is never useful.
      if (Components.isBoardType(a.component.type) && Components.isBoardType(b.component.type)) {
        return { error: 'Two board pins cannot be wired directly together.' };
      }
    }
    var wire = { id: nextId('wire'), from: from, to: to };
    if (color) wire.color = color;
    Lab.state.connections.push(wire);
    Lab.emit('state:changed', { reason: 'connect' });
    return { from: from, to: to, id: wire.id };
  };

  Lab.removeConnection = function (id) {
    Lab.state.connections = Lab.state.connections.filter(function (c) { return c.id !== id; });
    Lab.emit('state:changed', { reason: 'disconnect' });
  };

  Lab.clear = function () {
    Lab.state.components = [];
    Lab.state.connections = [];
    Lab.selectedComponentId = null;
    Lab.selectedWireId = null;
    Lab.pendingRef = null;
    idCounters = {};
    Lab.emit('state:changed', { reason: 'clear' });
    Lab.toast('Workspace cleared.', 'info');
  };

  // ---- board / lesson ---------------------------------------------

  Lab.setBoard = function (id) {
    var board = BoardRegistry.getBoard(id);
    if (!board) { Lab.toast('Board not configured: ' + id, 'error'); return; }
    if (Lab.state.board === id && Lab.state.components.some(function (c) {
      return Components.isBoardType(c.type);
    })) return;

    Lab.state.board = id;

    var boardComp = Lab.state.components.filter(function (c) {
      return Components.isBoardType(c.type);
    })[0];
    if (boardComp) boardComp.type = id;

    // Drop connections whose pins no longer exist on the new board.
    var dropped = 0;
    Lab.state.connections = Lab.state.connections.filter(function (c) {
      var ok = Lab.resolvePin(c.from) && Lab.resolvePin(c.to);
      if (!ok) dropped++;
      return ok;
    });
    if (dropped) {
      Lab.toast('Board changed. ' + dropped + ' incompatible wire(s) were removed.', 'info');
    }

    var select = document.getElementById('boardSelect');
    if (select) select.value = id;

    Lab.refreshBoardInfo();
    Lab.refreshPalette();
    Lab.lastValidation = null;
    Lab.renderValidation(null);
    Lab.simulator.onLessonChange();
    Lab.codeEditor.setExternalCode('');
    Lab.emit('state:changed', { reason: 'board' });
    Lab.emit('board:changed', id);
  };

  Lab.setLesson = function (id, autoLoad) {
    var lesson = Lessons.getLesson(id);
    if (!lesson) return;
    Lab.state.lesson = id;

    var select = document.getElementById('lessonSelect');
    if (select) select.value = id;

    // Update interactive lesson pills
    var pills = document.querySelectorAll('.lesson-pill');
    pills.forEach(function (pill) {
      if (pill.getAttribute('data-lesson') === id) {
        pill.classList.add('active');
      } else {
        pill.classList.remove('active');
      }
    });

    // Update prev / next button states
    var idx = Lessons.lessonOrder.indexOf(id);
    var isFirst = idx <= 0;
    var isLast = idx >= Lessons.lessonOrder.length - 1;
    var btnPrev = document.getElementById('btnPrevLesson');
    var btnNext = document.getElementById('btnNextLesson');
    if (btnPrev) btnPrev.disabled = isFirst;
    if (btnNext) btnNext.disabled = isLast;

    var btnCardPrev = document.getElementById('btnCardPrevLesson');
    var btnCardNext = document.getElementById('btnCardNextLesson');
    if (btnCardPrev) btnCardPrev.disabled = isFirst;
    if (btnCardNext) btnCardNext.disabled = isLast;

    Lab.refreshLessonInfo();
    Lab.refreshProgress();
    Lab.lastValidation = null;
    Lab.renderValidation(null);
    Lab.simulator.onLessonChange();
    Lab.codeEditor.setExternalCode('');

    if (autoLoad) {
      Lab.loadLessonCircuit();
    } else {
      Lab.toast('Switched to: ' + lesson.title, 'info');
      Lab.setStatus('Lesson ' + (idx + 1) + ': ' + lesson.title + '. Click "Load Lesson Circuit Setup" to reset workspace.');
    }

    Lab.emit('state:changed', { reason: 'lesson' });
    Lab.emit('lesson:changed', id);
  };

  Lab.nextLesson = function () {
    var list = Lessons.lessonOrder;
    var idx = list.indexOf(Lab.state.lesson);
    if (idx < list.length - 1) {
      Lab.setLesson(list[idx + 1], true);
    }
  };

  Lab.prevLesson = function () {
    var list = Lessons.lessonOrder;
    var idx = list.indexOf(Lab.state.lesson);
    if (idx > 0) {
      Lab.setLesson(list[idx - 1], true);
    }
  };

  Lab.loadLessonCircuit = function () {
    var lesson = Lab.activeLesson();
    var board = Lab.activeBoard();
    Lab.state.components = [];
    Lab.state.connections = [];
    Lab.selectedComponentId = null;
    Lab.selectedWireId = null;
    Lab.pendingRef = null;
    idCounters = {};

    if (Components.getDefinition(board.id)) {
      Lab.state.components.push(Components.createInstance(board.id, 80, 140, {
        id: nextId('board')
      }));
    }
    lesson.defaultComponents.forEach(function (dc) {
      Lab.state.components.push(Components.createInstance(dc.type, dc.x, dc.y, {
        id: nextId(dc.type)
      }));
    });
    Lab.canvas.render();
    Lab.toast('Loaded circuit setup for ' + lesson.title, 'success');
    Lab.setStatus('Loaded ' + lesson.title + ' setup. Follow the lesson guide to wire pins.');
    Lab.emit('state:changed', { reason: 'lesson:load' });
  };

  // ---- validation --------------------------------------------------

  Lab.validate = function () {
    var result = Validator.validate(Lab.state);
    Lab.lastValidation = result;
    Lab.renderValidation(result);
    Lab.updateSimStatusBadge(result);
    return result;
  };

  Lab.renderValidation = function (result) {
    var panel = document.getElementById('validationPanel');
    var badge = document.getElementById('validationBadge');
    if (!panel) return;
    if (!result) {
      panel.innerHTML = '<p class="muted">Validate the circuit to see board-specific '
        + 'errors and warnings.</p>';
      if (badge) { badge.textContent = 'Not validated'; badge.className = 'badge neutral'; }
      return;
    }
    var html = '';
    if (result.valid) {
      html += '<div class="validation-pass">Circuit valid for '
        + Lab.activeBoard().name + '.</div>';
      if (badge) { badge.textContent = 'Circuit valid'; badge.className = 'badge ok'; }
    } else {
      html += '<div class="validation-fail">'
        + result.errors.length + ' error(s) found.</div>';
      if (badge) { badge.textContent = result.errors.length + ' error(s)'; badge.className = 'badge fail'; }
    }

    if (result.errors.length) {
      html += '<ul class="validation-list errors">';
      result.errors.forEach(function (e) {
        html += '<li><span class="code">' + e.code + '</span> ' + e.message + '</li>';
      });
      html += '</ul>';
    }
    if (result.warnings.length) {
      html += '<h4>Warnings</h4><ul class="validation-list warnings">';
      result.warnings.forEach(function (w) {
        html += '<li><span class="code">' + w.code + '</span> ' + w.message + '</li>';
      });
      html += '</ul>';
    }
    if (result.valid) {
      var pins = result.info.pins;
      var used = [];
      if (pins.outputPin) used.push('output ' + pins.outputPin);
      if (pins.inputPin) used.push('input ' + pins.inputPin);
      if (pins.dataPin) used.push('data ' + pins.dataPin);
      if (used.length) {
        html += '<p class="muted">Resolved pins: ' + used.join(', ') + '</p>';
      }
    }
    panel.innerHTML = html;
  };

  Lab.updateSimStatusBadge = function (result) {
    var badge = document.getElementById('simBadge');
    if (!badge) return;
    if (Lab.simulator && Lab.simulator.isRunning()) {
      badge.textContent = 'Sim: running';
      badge.className = 'badge ok';
    } else {
      badge.textContent = 'Sim: stopped';
      badge.className = 'badge neutral';
    }
  };

  // ---- palette -----------------------------------------------------

  Lab.refreshPalette = function () {
    var host = document.getElementById('componentPalette');
    if (!host) return;
    host.innerHTML = '';

    function makeItem(type, name, hint) {
      var def = Components.getDefinition(type);
      var item = document.createElement('div');
      item.className = 'palette-item';
      item.draggable = true;
      item.setAttribute('data-type', type);
      item.innerHTML = '<div class="palette-icon">' + iconFor(type) + '</div>'
        + '<div class="palette-text"><strong>' + name + '</strong>'
        + '<span>' + (hint || def.label) + '</span></div>';
      item.addEventListener('dragstart', function (ev) {
        ev.dataTransfer.setData('text/component-type', type);
        ev.dataTransfer.effectAllowed = 'copy';
      });
      item.addEventListener('click', function () {
        var cx = 720, cy = 360;
        Lab.addComponent(type, cx, cy);
      });
      host.appendChild(item);
    }

    var board = Lab.activeBoard();
    host.appendChild(sectionLabel('Microcontroller'));
    makeItem(board.id, board.name, board.mcu);
    host.appendChild(sectionLabel('Components'));
    makeItem('led', 'LED', 'Indicator light');
    makeItem('resistor', 'Resistor', 'Current limiting');
    makeItem('button', 'Push Button', 'Digital input');
    makeItem('dht11', 'DHT11 Sensor', 'Temperature + humidity');
  };

  function sectionLabel(text) {
    var el = document.createElement('div');
    el.className = 'palette-section';
    el.textContent = text;
    return el;
  }

  function iconFor(type) {
    var map = {
      led: '\u25C9',
      resistor: '\u223F',
      button: '\u23FB',
      dht11: '\u2601'
    };
    if (Components.isBoardType(type)) return '\u25A6';
    return map[type] || '\u25A1';
  }

  // ---- info panels -------------------------------------------------

  Lab.refreshBoardInfo = function () {
    var host = document.getElementById('boardInfo');
    if (!host) return;
    var b = Lab.activeBoard();
    var restrictions = Object.keys(b.pinInfo).filter(function (p) {
      return b.pinInfo[p].restriction;
    }).map(function (p) {
      return '<li><b>' + p + '</b>: ' + b.pinInfo[p].restriction + '</li>';
    }).join('');

    host.innerHTML = ''
      + '<h3>' + b.name + '</h3>'
      + '<div class="kv"><span>Variant</span> ' + b.variant + '</div>'
      + '<div class="kv"><span>MCU</span> ' + b.mcu + '</div>'
      + '<div class="kv"><span>Logic</span> ' + b.logicVoltage + 'V</div>'
      + '<div class="kv"><span>Platform</span> ' + b.platform + '</div>'
      + '<div class="kv"><span>Ground</span> ' + b.groundPins.join(', ') + '</div>'
      + '<div class="kv"><span>Power</span> ' + b.powerPins.join(', ') + '</div>'
      + '<p class="muted">' + b.notes + '</p>'
      + '<details><summary>Digital pins (' + b.digitalPins.length + ')</summary>'
      + '<div class="pin-chips">' + b.digitalPins.map(chip).join('') + '</div></details>'
      + '<details><summary>Analog input pins (' + b.analogPins.length + ')</summary>'
      + '<div class="pin-chips">' + b.analogPins.map(chip).join('') + '</div></details>'
      + '<details><summary>PWM-capable pins</summary>'
      + '<div class="pin-chips">' + b.pwmPins.map(chip).join('') + '</div></details>'
      + (restrictions ? '<details><summary>Pin restrictions</summary><ul class="restrictions">'
        + restrictions + '</ul></details>' : '')
      + '<details><summary>Board-compatible code example</summary>'
      + '<pre class="mini-code">' + b.codeExample.replace(/</g, '&lt;') + '</pre></details>';
  };

  function chip(p) { return '<span class="chip pin-chip">' + p + '</span>'; }

  Lab.refreshLessonInfo = function () {
    var host = document.getElementById('lessonInfo');
    if (!host) return;
    var lesson = Lab.activeLesson();
    var board = Lab.activeBoard();
    var supported = lesson.supportedBoards.indexOf(board.id) !== -1;
    host.innerHTML = ''
      + '<h3>' + lesson.title + '</h3>'
      + (supported ? '' : '<p class="usage-warn">This lesson is not configured for '
        + board.name + '.</p>')
      + '<p>' + lesson.summary + '</p>'
      + '<h4>You will learn</h4><ul>' + lesson.concepts.map(function (c) {
        return '<li>' + c + '</li>';
      }).join('') + '</ul>'
      + '<h4>Steps</h4><ol>' + lesson.steps.map(function (s) {
        return '<li>' + s + '</li>';
      }).join('') + '</ol>';
  };

  Lab.refreshProgress = function () {
    var host = document.getElementById('lessonProgress');
    if (!host) return;
    var idx = Lessons.lessonOrder.indexOf(Lab.state.lesson) + 1;
    host.textContent = 'Lesson ' + idx + ' of ' + Lessons.lessonOrder.length;
  };

  // ---- AI context --------------------------------------------------

  Lab.buildAIContext = function () {
    var board = Lab.activeBoard();
    var lesson = Lab.activeLesson();
    var validation = Lab.lastValidation || Validator.validate(Lab.state);
    return {
      board: {
        id: board.id,
        name: board.name,
        variant: board.variant,
        platform: board.platform,
        logicVoltage: board.logicVoltage,
        digitalPins: board.digitalPins,
        analogPins: board.analogPins,
        pwmPins: board.pwmPins,
        powerPins: board.powerPins,
        groundPins: board.groundPins
      },
      lesson: { id: lesson.id, title: lesson.title },
      circuit: {
        board: Lab.state.board,
        lesson: Lab.state.lesson,
        components: Lab.state.components,
        connections: Lab.state.connections
      },
      validation: validation,
      code: Lab.codeEditor ? Lab.codeEditor.getCode() : '',
      blinkInterval: Lab.blinkInterval
    };
  };

  // ---- code editor bridge -----------------------------------------

  Lab.codeEditor = {
    setExternalCode: function (code) {
      var el = document.getElementById('codeOutput');
      if (el) el.value = code || '';
    },
    getCode: function () {
      var el = document.getElementById('codeOutput');
      return el ? el.value : '';
    },
    generate: function () { if (Lab._codeEditor) Lab._codeEditor.generate(); },
    analyze: function (code) {
      return Lab._codeEditor ? Lab._codeEditor.analyze(code) : [];
    },
    requiredLibraries: function (lesson) {
      return Lab._codeEditor ? Lab._codeEditor.requiredLibraries(lesson) : [];
    }
  };

  // ---- init --------------------------------------------------------

  function bindNav() {
    var boardSelect = document.getElementById('boardSelect');
    BoardRegistry.listBoards().forEach(function (b) {
      var opt = document.createElement('option');
      opt.value = b.id;
      opt.textContent = b.name;
      boardSelect.appendChild(opt);
    });
    boardSelect.value = Lab.state.board;
    boardSelect.addEventListener('change', function () { Lab.setBoard(boardSelect.value); });

    var lessonSelect = document.getElementById('lessonSelect');
    Lessons.listLessons().forEach(function (l) {
      var opt = document.createElement('option');
      opt.value = l.id;
      opt.textContent = l.title;
      lessonSelect.appendChild(opt);
    });
    lessonSelect.value = Lab.state.lesson;
    lessonSelect.addEventListener('change', function () { Lab.setLesson(lessonSelect.value, true); });

    // Step Prev/Next buttons in topbar
    var btnPrev = document.getElementById('btnPrevLesson');
    if (btnPrev) btnPrev.addEventListener('click', function () { Lab.prevLesson(); });
    var btnNext = document.getElementById('btnNextLesson');
    if (btnNext) btnNext.addEventListener('click', function () { Lab.nextLesson(); });

    // Interactive lesson subnav pills
    var pills = document.querySelectorAll('.lesson-pill');
    pills.forEach(function (pill) {
      pill.addEventListener('click', function () {
        var lessonId = pill.getAttribute('data-lesson');
        if (lessonId) Lab.setLesson(lessonId, true);
      });
    });

    // Lesson card navigation buttons (left column)
    var btnCardPrev = document.getElementById('btnCardPrevLesson');
    if (btnCardPrev) btnCardPrev.addEventListener('click', function () { Lab.prevLesson(); });
    var btnCardNext = document.getElementById('btnCardNextLesson');
    if (btnCardNext) btnCardNext.addEventListener('click', function () { Lab.nextLesson(); });
    var btnLoadCircuit = document.getElementById('btnLoadLessonCircuit');
    if (btnLoadCircuit) btnLoadCircuit.addEventListener('click', function () { Lab.loadLessonCircuit(); });

    // Update initial button states and active pills
    var currentIdx = Lessons.lessonOrder.indexOf(Lab.state.lesson);
    if (btnPrev) btnPrev.disabled = currentIdx <= 0;
    if (btnNext) btnNext.disabled = currentIdx >= Lessons.lessonOrder.length - 1;
    if (btnCardPrev) btnCardPrev.disabled = currentIdx <= 0;
    if (btnCardNext) btnCardNext.disabled = currentIdx >= Lessons.lessonOrder.length - 1;
  }

  function bindToolbar() {
    document.getElementById('btnValidate').addEventListener('click', function () {
      var r = Lab.validate();
      Lab.toast(r.valid ? 'Circuit is valid.' : 'Circuit has errors.', r.valid ? 'success' : 'error');
    });

    // Wire connection tool button
    var wireBtn = document.getElementById('btnWireMode');
    if (wireBtn) {
      wireBtn.addEventListener('click', function () {
        if (Lab.wires && Lab.wires.toggleWireMode) {
          Lab.wires.toggleWireMode();
        }
      });
    }

    // Wire color chips
    var colorChips = document.querySelectorAll('.wire-chip');
    colorChips.forEach(function (chip) {
      chip.addEventListener('click', function () {
        var color = chip.getAttribute('data-color');
        if (Lab.wires && Lab.wires.setColor) {
          Lab.wires.setColor(color);
        }
      });
    });

    // Reset wire route button
    var resetWireBtn = document.getElementById('btnResetWire');
    if (resetWireBtn) {
      resetWireBtn.addEventListener('click', function () {
        if (Lab.wires && Lab.wires.resetSelectedWireRoute) {
          Lab.wires.resetSelectedWireRoute();
        }
      });
    }

    // Zoom controls dock buttons
    var btnZoomIn = document.getElementById('btnZoomIn');
    if (btnZoomIn) {
      btnZoomIn.addEventListener('click', function () {
        if (Lab.canvas && Lab.canvas.zoomIn) Lab.canvas.zoomIn();
      });
    }
    var btnZoomOut = document.getElementById('btnZoomOut');
    if (btnZoomOut) {
      btnZoomOut.addEventListener('click', function () {
        if (Lab.canvas && Lab.canvas.zoomOut) Lab.canvas.zoomOut();
      });
    }
    var btnZoomReset = document.getElementById('btnZoomReset');
    if (btnZoomReset) {
      btnZoomReset.addEventListener('click', function () {
        if (Lab.canvas && Lab.canvas.resetZoom) Lab.canvas.resetZoom();
      });
    }
    var zoomBadge = document.getElementById('zoomBadge');
    if (zoomBadge) {
      zoomBadge.addEventListener('click', function () {
        if (Lab.canvas && Lab.canvas.resetZoom) Lab.canvas.resetZoom();
      });
    }

    document.getElementById('btnClear').addEventListener('click', function () {
      if (Lab.state.components.length === 0) { Lab.toast('Workspace is already empty.', 'info'); return; }
      if (window.confirm('Clear the workspace and all wires?')) Lab.clear();
    });
    document.getElementById('btnDelete').addEventListener('click', function () {
      if (Lab.selectedComponentId) { Lab.removeComponent(Lab.selectedComponentId); return; }
      if (Lab.selectedWireId) { Lab.removeConnection(Lab.selectedWireId); Lab.setSelectedWire(null); Lab.canvas.render(); return; }
      Lab.toast('Select a component or wire first.', 'info');
    });
    var interval = document.getElementById('blinkInterval');
    if (interval) {
      interval.value = Lab.blinkInterval;
      interval.addEventListener('change', function () {
        var v = parseInt(interval.value, 10);
        Lab.blinkInterval = isFinite(v) && v >= 50 ? v : 500;
        interval.value = Lab.blinkInterval;
        if (Lab.activeLesson().id === 'led') Lab.codeEditor.generate();
      });
    }
  }

  function bindTabs() {
    var tabs = document.querySelectorAll('.tab');
    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        tabs.forEach(function (t) { t.classList.remove('active'); });
        document.querySelectorAll('.tab-panel').forEach(function (p) {
          p.classList.remove('active');
        });
        tab.classList.add('active');
        var panel = document.getElementById(tab.getAttribute('data-tab'));
        if (panel) panel.classList.add('active');
      });
    });
  }

  function bindKeyboard() {
    document.addEventListener('keydown', function (e) {
      var tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      if (e.key === 'Escape') {
        if (Lab.wires && Lab.wires.isWireMode()) {
          Lab.wires.setWireMode(false);
          Lab.toast('Wire Mode deactivated.', 'info');
        }
        Lab.pendingRef = null;
        Lab.canvas.render();
      } else if (e.key === 'w' || e.key === 'W') {
        if (Lab.wires && Lab.wires.toggleWireMode) {
          Lab.wires.toggleWireMode();
        }
      } else if (e.key === '+' || e.key === '=' || (e.ctrlKey && (e.key === '=' || e.key === '+'))) {
        if (Lab.canvas && Lab.canvas.zoomIn) {
          e.preventDefault();
          Lab.canvas.zoomIn();
        }
      } else if (e.key === '-' || e.key === '_' || (e.ctrlKey && (e.key === '-' || e.key === '_'))) {
        if (Lab.canvas && Lab.canvas.zoomOut) {
          e.preventDefault();
          Lab.canvas.zoomOut();
        }
      } else if (e.key === '0' && (e.ctrlKey || e.metaKey)) {
        if (Lab.canvas && Lab.canvas.resetZoom) {
          e.preventDefault();
          Lab.canvas.resetZoom();
        }
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (Lab.selectedComponentId) { Lab.removeComponent(Lab.selectedComponentId); }
        else if (Lab.selectedWireId) { Lab.removeConnection(Lab.selectedWireId); Lab.setSelectedWire(null); Lab.canvas.render(); }
      }
    });
  }

  function buildSvg() {
    var svg = document.getElementById('workspaceSvg');
    svg.setAttribute('viewBox', '0 0 1400 900');
    var defs = document.createElementNS(SVG_NS, 'defs');
    var pattern = document.createElementNS(SVG_NS, 'pattern');
    pattern.setAttribute('id', 'grid');
    pattern.setAttribute('width', '25');
    pattern.setAttribute('height', '25');
    pattern.setAttribute('patternUnits', 'userSpaceOnUse');
    var path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', 'M 25 0 L 0 0 0 25');
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', '#e8eef5');
    path.setAttribute('stroke-width', '1');
    pattern.appendChild(path);
    defs.appendChild(pattern);
    svg.appendChild(defs);
    var bg = document.createElementNS(SVG_NS, 'rect');
    bg.setAttribute('x', '0');
    bg.setAttribute('y', '0');
    bg.setAttribute('width', '1400');
    bg.setAttribute('height', '900');
    bg.setAttribute('fill', 'url(#grid)');
    bg.setAttribute('class', 'grid-bg');
    svg.appendChild(bg);

    var wiresLayer = document.createElementNS(SVG_NS, 'g');
    wiresLayer.setAttribute('id', 'wiresLayer');
    var compLayer = document.createElementNS(SVG_NS, 'g');
    compLayer.setAttribute('id', 'componentsLayer');
    svg.appendChild(wiresLayer);
    svg.appendChild(compLayer);

    Lab.svg = svg;
    Lab.layers.wires = wiresLayer;
    Lab.layers.components = compLayer;
    return svg;
  }

  function init() {
    buildSvg();
    Lab.canvas = global.Canvas.create(Lab);
    Lab.wires = global.Wires.create(Lab);
    Lab.simulator = global.Simulator.create(Lab);
    Lab._codeEditor = global.CodeEditor.create(Lab);
    Lab.aiClient = global.AIClient.create(Lab);
    Lab.usageDashboard = global.UsageDashboard.create(Lab);

    Lab.onPinClick = function (ref) { Lab.wires.onPinClick(ref); };
    Lab.toSvgPoint = function (ev) { return Lab.canvas ? Lab.canvas.toSvgPoint(ev) : { x: ev.clientX, y: ev.clientY }; };
    Lab.redraw = function () { Lab.canvas.render(); };

    bindNav();
    bindToolbar();
    bindTabs();
    bindKeyboard();

    Lab.canvas.bindSvg();
    Lab.simulator.init();
    Lab._codeEditor.init();
    Lab.aiClient.init();
    Lab.usageDashboard.init();

    var workspace = document.getElementById('workspaceSvg');
    workspace.addEventListener('dragover', function (e) { e.preventDefault(); });
    workspace.addEventListener('drop', function (e) { Lab.canvas.dropHandler(e); });

    Lab.refreshBoardInfo();
    Lab.refreshLessonInfo();
    Lab.refreshProgress();
    Lab.refreshPalette();
    Lab.renderValidation(null);

    Lab.emit('state:changed', { reason: 'init' });
    Lab.setStatus('Ready. Drag components in, click two pins to draw a wire.');

    // Seed the workspace with the example components so students can start fast.
    seedExample();
  }

  function seedExample() {
    var lesson = Lab.activeLesson();
    var board = Lab.activeBoard();
    var x = 120, y = 180;
    if (Components.getDefinition(board.id)) {
      Lab.state.components.push(Components.createInstance(board.id, 80, 140, {
        id: nextId('board')
      }));
    }
    lesson.defaultComponents.forEach(function (dc) {
      Lab.state.components.push(Components.createInstance(dc.type, dc.x, dc.y, {
        id: nextId(dc.type)
      }));
    });
    Lab.canvas.render();
    Lab.setStatus('Example components placed. Connect GPIO, resistor, LED and GND.');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  global.Lab = Lab;
})(window);
