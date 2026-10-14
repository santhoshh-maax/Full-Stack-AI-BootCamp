/*
 * canvas.js
 * SVG circuit workspace: renders components and handles placement, dragging,
 * selection and pin clicks. Wires are rendered by the Wires controller into a
 * separate layer beneath the components.
 */

(function (global) {
  'use strict';

  var SVG_NS = 'http://www.w3.org/2000/svg';
  var Components = (typeof require === 'function')
    ? require('./components')
    : global.Components;

  function el(name, attrs) {
    var node = document.createElementNS(SVG_NS, name);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        node.setAttribute(k, attrs[k]);
      });
    }
    return node;
  }

  function pinFill(kind) {
    switch (kind) {
      case 'gnd': return '#455a64';
      case 'power': return '#e53935';
      case 'analog': return '#8e24aa';
      case 'anode': return '#e53935';
      case 'cathode': return '#37474f';
      default: return '#1e88e5';
    }
  }

  function create(lab) {
    var controller = {
      dragging: null,
      dragMoved: false
    };

    function toSvgPoint(evt) {
      var pt = lab.svg.createSVGPoint();
      pt.x = evt.clientX;
      pt.y = evt.clientY;
      var ctm = lab.svg.getScreenCTM();
      if (!ctm) return { x: evt.clientX, y: evt.clientY };
      var p = pt.matrixTransform(ctm.inverse());
      return { x: p.x, y: p.y };
    }

    // ---- individual component drawings ---------------------------

    function drawBoard(group, component, def) {
      group.appendChild(el('rect', {
        x: 0, y: 0, width: def.width, height: def.height,
        rx: 12, fill: '#eef3fb', stroke: '#1e88e5', 'stroke-width': 2
      }));
      group.appendChild(el('rect', {
        x: 0, y: 0, width: def.width, height: 46, rx: 12,
        fill: '#1e88e5'
      }));
      group.appendChild(el('rect', {
        x: 0, y: 30, width: def.width, height: 16, fill: '#1e88e5'
      }));
      var t = el('text', {
        x: 14, y: 29, fill: '#ffffff', 'font-size': '16',
        'font-weight': '600'
      });
      t.textContent = def.label;
      group.appendChild(t);
      var sub = el('text', {
        x: 14, y: 60, fill: '#546e7a', 'font-size': '11'
      });
      sub.textContent = lab.activeBoard().mcu + '  \u00B7  '
        + lab.activeBoard().logicVoltage + 'V logic';
      group.appendChild(sub);
    }

    function drawLed(group, component, def) {
      var on = component.properties._on === true;
      var color = Components.LED_COLORS[component.properties.color] || Components.LED_COLORS.red;
      var glow = on ? color : '#cfd8dc';
      group.appendChild(el('line', {
        x1: 30, y1: 0, x2: 30, y2: 26, stroke: '#90a4ae', 'stroke-width': 2
      }));
      group.appendChild(el('line', {
        x1: 30, y1: 64, x2: 30, y2: 90, stroke: '#90a4ae', 'stroke-width': 2
      }));
      group.appendChild(el('circle', {
        cx: 30, cy: 45, r: on ? 22 : 20,
        fill: glow, stroke: '#546e7a', 'stroke-width': 1.5,
        opacity: on ? 1 : 0.85
      }));
      if (on) {
        group.appendChild(el('circle', {
          cx: 30, cy: 45, r: 32, fill: color, opacity: 0.25
        }));
      }
      group.appendChild(el('polygon', {
        points: '14,58 46,58 30,30', fill: 'none', stroke: '#455a64',
        'stroke-width': 1.5
      }));
      group.appendChild(el('line', {
        x1: 14, y1: 58, x2: 46, y2: 58, stroke: '#455a64', 'stroke-width': 2
      }));
      var label = el('text', {
        x: 30, y: 86, 'text-anchor': 'middle', 'font-size': '10', fill: '#607d8b'
      });
      label.textContent = component.properties.color || 'red';
      group.appendChild(label);
    }

    function drawResistor(group, component, def) {
      group.appendChild(el('line', {
        x1: 0, y1: 16, x2: 22, y2: 16, stroke: '#90a4ae', 'stroke-width': 2
      }));
      group.appendChild(el('line', {
        x1: 78, y1: 16, x2: 100, y2: 16, stroke: '#90a4ae', 'stroke-width': 2
      }));
      group.appendChild(el('rect', {
        x: 22, y: 2, width: 56, height: 28, rx: 4,
        fill: '#ffe0b2', stroke: '#ef6c00', 'stroke-width': 1.5
      }));
      var label = el('text', {
        x: 50, y: 21, 'text-anchor': 'middle', 'font-size': '11',
        fill: '#5d4037', 'font-weight': '600'
      });
      label.textContent = (component.properties.resistance || '?') + '\u03A9';
      group.appendChild(label);
    }

    function drawButton(group, component, def) {
      var pressed = component.properties._pressed === true;
      group.appendChild(el('circle', { cx: 0, cy: 20, r: 4, fill: '#455a64' }));
      group.appendChild(el('circle', { cx: 0, cy: 60, r: 4, fill: '#455a64' }));
      group.appendChild(el('circle', { cx: 90, cy: 20, r: 4, fill: '#455a64' }));
      group.appendChild(el('circle', { cx: 90, cy: 60, r: 4, fill: '#455a64' }));
      group.appendChild(el('rect', {
        x: 18, y: 14, width: 54, height: 52, rx: 6,
        fill: '#eceff1', stroke: '#607d8b', 'stroke-width': 1.5
      }));
      group.appendChild(el('circle', {
        cx: 45, cy: pressed ? 44 : 40, r: 12,
        fill: pressed ? '#1e88e5' : '#90a4ae', stroke: '#546e7a'
      }));
      group.appendChild(el('path', {
        d: 'M 45 4 v 6', stroke: '#546e7a', 'stroke-width': 2
      }));
      var label = el('text', {
        x: 45, y: 82, 'text-anchor': 'middle', 'font-size': '10', fill: '#607d8b'
      });
      label.textContent = pressed ? 'pressed' : 'release';
      group.appendChild(label);
    }

    function drawDht(group, component, def) {
      group.appendChild(el('rect', {
        x: 10, y: 4, width: 80, height: 120, rx: 6,
        fill: '#e3f2fd', stroke: '#1565c0', 'stroke-width': 1.5
      }));
      for (var i = 0; i < 4; i++) {
        group.appendChild(el('line', {
          x1: 24, y1: 20 + i * 10, x2: 76, y2: 20 + i * 10,
          stroke: '#90caf9', 'stroke-width': 2
        }));
      }
      var label = el('text', {
        x: 50, y: 92, 'text-anchor': 'middle', 'font-size': '12',
        fill: '#0d47a1', 'font-weight': '600'
      });
      label.textContent = 'DHT11';
      group.appendChild(label);
      var sub = el('text', {
        x: 50, y: 108, 'text-anchor': 'middle', 'font-size': '9', fill: '#1565c0'
      });
      sub.textContent = 'temp + humidity';
      group.appendChild(sub);
    }

    function drawComponent(group, component, def) {
      if (def.isBoard) return drawBoard(group, component, def);
      if (component.type === 'led') return drawLed(group, component, def);
      if (component.type === 'resistor') return drawResistor(group, component, def);
      if (component.type === 'button') return drawButton(group, component, def);
      if (component.type === 'dht11') return drawDht(group, component, def);
      group.appendChild(el('rect', {
        x: 0, y: 0, width: def.width, height: def.height,
        fill: '#fff', stroke: '#90a4ae'
      }));
    }

    function drawPins(group, component, def) {
      def.pins.forEach(function (pin) {
        var ref = component.id + '.' + pin.id;
        if (lab.pendingRef === ref) {
          group.appendChild(el('circle', {
            cx: pin.x, cy: pin.y, r: 9, fill: 'none',
            stroke: '#ff9800', 'stroke-width': 2, 'pointer-events': 'none'
          }));
        }
        var hit = el('circle', {
          cx: pin.x, cy: pin.y, r: 10, fill: 'transparent',
          class: 'pin-hit', 'data-ref': ref
        });
        hit.style.cursor = 'crosshair';
        hit.addEventListener('mousedown', function (ev) {
          ev.stopPropagation();
        });
        hit.addEventListener('click', function (ev) {
          ev.stopPropagation();
          lab.onPinClick(ref);
        });
        hit.addEventListener('mouseenter', function () {
          lab.setStatus('Pin ' + ref + (pin.kind ? ' (' + pin.kind + ')' : ''));
        });
        group.appendChild(hit);

        var dot = el('circle', {
          cx: pin.x, cy: pin.y, r: 5,
          fill: '#ffffff', stroke: pinFill(pin.kind), 'stroke-width': 2,
          class: 'pin-dot', 'pointer-events': 'none'
        });
        group.appendChild(dot);

        if (pin.anchor !== 'none') {
          var text;
          if (pin.anchor === 'right') {
            text = el('text', {
              x: pin.x - 10, y: pin.y + 3, 'text-anchor': 'end',
              'font-size': '9.5', fill: '#546e7a', 'pointer-events': 'none'
            });
          } else if (pin.anchor === 'left') {
            text = el('text', {
              x: pin.x + 10, y: pin.y + 3,
              'font-size': '9.5', fill: '#546e7a', 'pointer-events': 'none'
            });
          } else {
            text = el('text', {
              x: pin.x + 9, y: pin.y + 3,
              'font-size': '9.5', fill: '#546e7a', 'pointer-events': 'none'
            });
          }
          text.textContent = pin.label;
          group.appendChild(text);
        }
      });
    }

    // ---- rendering ------------------------------------------------

    function render() {
      var layer = lab.layers.components;
      while (layer.firstChild) layer.removeChild(layer.firstChild);

      lab.state.components.forEach(function (component) {
        var def = lab.getDefinition(component);
        if (!def) return;
        var group = el('g', {
          transform: 'translate(' + component.x + ',' + component.y + ')',
          class: 'component',
          'data-id': component.id
        });
        if (lab.selectedComponentId === component.id) {
          group.appendChild(el('rect', {
            x: -8, y: -8, width: def.width + 16, height: def.height + 16,
            rx: 10, fill: 'none', stroke: '#ff9800',
            'stroke-width': 2, 'stroke-dasharray': '6 4'
          }));
        }
        var body = el('g', { class: 'component-body' });
        drawComponent(body, component, def);
        group.appendChild(body);
        drawPins(group, component, def);

        group.addEventListener('mousedown', function (ev) {
          if (ev.target.classList && ev.target.classList.contains('pin-hit')) return;
          startDrag(component.id, evtPoint(ev));
        });
        group.addEventListener('click', function (ev) {
          if (controller.dragMoved) { controller.dragMoved = false; return; }
          lab.selectComponent(component.id);
        });

        layer.appendChild(group);
      });

      if (lab.wires) lab.wires.render();
    }

    function evtPoint(ev) {
      return toSvgPoint(ev);
    }

    function startDrag(id, point) {
      var component = lab.state.components.filter(function (c) { return c.id === id; })[0];
      if (!component) return;
      controller.dragging = {
        id: id,
        offsetX: point.x - component.x,
        offsetY: point.y - component.y
      };
      controller.dragMoved = false;
      lab.selectComponent(id);
    }

    function bindSvg() {
      lab.svg.addEventListener('mousemove', function (ev) {
        if (!controller.dragging) return;
        var point = toSvgPoint(ev);
        var component = lab.state.components.filter(function (c) {
          return c.id === controller.dragging.id;
        })[0];
        if (!component) return;
        var nx = Math.max(0, point.x - controller.dragging.offsetX);
        var ny = Math.max(0, point.y - controller.dragging.offsetY);
        if (Math.abs(nx - component.x) > 1 || Math.abs(ny - component.y) > 1) {
          controller.dragMoved = true;
        }
        component.x = nx;
        component.y = ny;
        render();
      });

      lab.svg.addEventListener('mouseup', function () {
        if (controller.dragging) {
          controller.dragging = null;
          lab.emit('state:changed', { reason: 'move' });
        }
      });

      lab.svg.addEventListener('click', function (ev) {
        if (ev.target === lab.svg || ev.target.classList.contains('grid-bg')) {
          lab.selectComponent(null);
          lab.setSelectedWire(null);
          lab.wires.cancel();
        }
      });
    }

    function dropHandler(ev) {
      ev.preventDefault();
      var type = ev.dataTransfer.getData('text/component-type');
      if (!type) return;
      var point = toSvgPoint(ev);
      lab.addComponent(type, point.x - 40, point.y - 40);
    }

    return {
      render: render,
      bindSvg: bindSvg,
      dropHandler: dropHandler
    };
  }

  var api = { create: create };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.Canvas = api;
  }
})(typeof window !== 'undefined' ? window : this);
