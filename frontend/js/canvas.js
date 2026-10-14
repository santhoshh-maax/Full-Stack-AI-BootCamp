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

    // ---- Realistic SVG Defs & Helpers -----------------------------

    function ensureRealisticDefs() {
      if (!lab.svg || lab.svg.querySelector('#realisticDefs')) return;
      var defs = lab.svg.querySelector('defs') || el('defs');
      var gDefs = el('g', { id: 'realisticDefs' });

      // Metallic silver gradient for wires, leads, pins, and metal shells
      var gMetal = el('linearGradient', { id: 'grad-metal-lead', x1: '0%', y1: '0%', x2: '0%', y2: '100%' });
      gMetal.innerHTML = '<stop offset="0%" stop-color="#78909c"/><stop offset="30%" stop-color="#cfd8dc"/><stop offset="50%" stop-color="#ffffff"/><stop offset="85%" stop-color="#b0bec5"/><stop offset="100%" stop-color="#546e7a"/>';
      defs.appendChild(gMetal);

      var gMetalH = el('linearGradient', { id: 'grad-metal-lead-h', x1: '0%', y1: '0%', x2: '100%', y2: '0%' });
      gMetalH.innerHTML = '<stop offset="0%" stop-color="#78909c"/><stop offset="30%" stop-color="#cfd8dc"/><stop offset="50%" stop-color="#ffffff"/><stop offset="85%" stop-color="#b0bec5"/><stop offset="100%" stop-color="#546e7a"/>';
      defs.appendChild(gMetalH);

      // Resistor ceramic body 3D gradient
      var gRes = el('linearGradient', { id: 'grad-resistor-body', x1: '0%', y1: '0%', x2: '0%', y2: '100%' });
      gRes.innerHTML = '<stop offset="0%" stop-color="#b88f5a"/><stop offset="20%" stop-color="#dcb882"/><stop offset="45%" stop-color="#faeccf"/><stop offset="75%" stop-color="#c99f6b"/><stop offset="100%" stop-color="#936c39"/>';
      defs.appendChild(gRes);

      // Arduino Uno PCB gradient
      var gUno = el('linearGradient', { id: 'grad-pcb-uno', x1: '0%', y1: '0%', x2: '100%', y2: '100%' });
      gUno.innerHTML = '<stop offset="0%" stop-color="#00636d"/><stop offset="40%" stop-color="#007987"/><stop offset="100%" stop-color="#004d55"/>';
      defs.appendChild(gUno);

      // ESP32 PCB gradient
      var gEsp = el('linearGradient', { id: 'grad-pcb-esp32', x1: '0%', y1: '0%', x2: '0%', y2: '100%' });
      gEsp.innerHTML = '<stop offset="0%" stop-color="#242830"/><stop offset="60%" stop-color="#181a1f"/><stop offset="100%" stop-color="#101114"/>';
      defs.appendChild(gEsp);

      // Brushed stainless steel RF shield gradient
      var gRf = el('linearGradient', { id: 'grad-rf-shield', x1: '0%', y1: '0%', x2: '100%', y2: '90%' });
      gRf.innerHTML = '<stop offset="0%" stop-color="#b0bec5"/><stop offset="30%" stop-color="#eceff1"/><stop offset="60%" stop-color="#cfd8dc"/><stop offset="90%" stop-color="#ffffff"/><stop offset="100%" stop-color="#90a4ae"/>';
      defs.appendChild(gRf);

      // IC chip gradient
      var gChip = el('linearGradient', { id: 'grad-ic-chip', x1: '0%', y1: '0%', x2: '100%', y2: '0%' });
      gChip.innerHTML = '<stop offset="0%" stop-color="#15181c"/><stop offset="12%" stop-color="#292f38"/><stop offset="50%" stop-color="#20242b"/><stop offset="88%" stop-color="#292f38"/><stop offset="100%" stop-color="#15181c"/>';
      defs.appendChild(gChip);

      // Gold pins / pads
      var gGold = el('linearGradient', { id: 'grad-gold', x1: '0%', y1: '0%', x2: '100%', y2: '100%' });
      gGold.innerHTML = '<stop offset="0%" stop-color="#ffa000"/><stop offset="50%" stop-color="#ffe082"/><stop offset="100%" stop-color="#ff8f00"/>';
      defs.appendChild(gGold);

      // Drop shadow filter for realism
      var filter = el('filter', { id: 'comp-shadow', x: '-15%', y: '-15%', width: '130%', height: '130%' });
      filter.innerHTML = '<feDropShadow dx="1.5" dy="3" stdDeviation="3.5" flood-color="#0f172a" flood-opacity="0.18"/>';
      defs.appendChild(filter);

      // Luminous glow filter for active LED
      var glow = el('filter', { id: 'led-bloom', x: '-60%', y: '-60%', width: '220%', height: '220%' });
      glow.innerHTML = '<feGaussianBlur in="SourceGraphic" stdDeviation="5" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>';
      defs.appendChild(glow);

      if (!lab.svg.querySelector('defs')) lab.svg.insertBefore(defs, lab.svg.firstChild);
    }

    function getResistorBands(resistance) {
      var colorMap = [
        '#212121', // 0 Black
        '#6d4c41', // 1 Brown
        '#d32f2f', // 2 Red
        '#ef6c00', // 3 Orange
        '#fbc02d', // 4 Yellow
        '#388e3c', // 5 Green
        '#1976d2', // 6 Blue
        '#7b1fa2', // 7 Violet
        '#757575', // 8 Gray
        '#ffffff'  // 9 White
      ];
      var multMap = {
        '-2': '#c0c0c0', // Silver
        '-1': '#d4af37', // Gold
        '0': '#212121',
        '1': '#6d4c41',
        '2': '#d32f2f',
        '3': '#ef6c00',
        '4': '#fbc02d',
        '5': '#388e3c',
        '6': '#1976d2'
      };
      var ohms = Number(resistance) || 220;
      var s = String(ohms).replace(/[^0-9.]/g, '');
      var num = parseFloat(s) || 220;
      var exp = Math.floor(Math.log10(num));
      var norm = num / Math.pow(10, exp);
      var d1 = Math.floor(norm);
      var d2 = Math.round((norm - d1) * 10);
      if (d2 >= 10) { d1++; d2 = 0; }
      var multExp = exp - 1;
      return {
        band1: colorMap[d1] || '#d32f2f',
        band2: colorMap[d2] || '#d32f2f',
        band3: multMap[String(multExp)] || '#6d4c41',
        band4: '#d4af37' // Gold 5% tolerance
      };
    }

    // ---- Individual Component Drawings ---------------------------

    function drawBoard(group, component, def) {
      ensureRealisticDefs();
      var isEsp = def.type === 'esp32-devkit' || (lab.activeBoard() && lab.activeBoard().platform === 'ESP32');
      var cGroup = el('g', { filter: 'url(#comp-shadow)' });
      group.appendChild(cGroup);

      if (!isEsp) {
        // ---- REALISTIC ARDUINO UNO R3 ----
        // 1. PCB Body
        cGroup.appendChild(el('rect', {
          x: 0, y: 0, width: def.width, height: def.height, rx: 12,
          fill: 'url(#grad-pcb-uno)', stroke: '#00434a', 'stroke-width': 2
        }));

        // 2. Corner Mounting Holes
        var holes = [
          { cx: 16, cy: 16 }, { cx: def.width - 16, cy: 16 },
          { cx: 16, cy: def.height - 16 }, { cx: def.width - 16, cy: def.height - 16 }
        ];
        holes.forEach(function (h) {
          cGroup.appendChild(el('circle', { cx: h.cx, cy: h.cy, r: 8, fill: '#b0bec5', stroke: '#78909c', 'stroke-width': 1 }));
          cGroup.appendChild(el('circle', { cx: h.cx, cy: h.cy, r: 5, fill: '#14181c' }));
        });

        // 3. Silver USB Type-B Port (top edge)
        cGroup.appendChild(el('rect', {
          x: 32, y: -6, width: 38, height: 42, rx: 3,
          fill: 'url(#grad-metal-lead)', stroke: '#546e7a', 'stroke-width': 1.5
        }));
        cGroup.appendChild(el('rect', {
          x: 39, y: 0, width: 24, height: 26, rx: 2,
          fill: '#1c2024', stroke: '#37474f', 'stroke-width': 1
        }));
        for (var u = 0; u < 4; u++) {
          cGroup.appendChild(el('rect', { x: 43 + u * 4.5, y: 4, width: 2, height: 12, fill: 'url(#grad-gold)' }));
        }

        // 4. Black DC Power Barrel Jack (bottom left edge)
        cGroup.appendChild(el('rect', {
          x: 28, y: def.height - 36, width: 46, height: 38, rx: 3,
          fill: '#1c2024', stroke: '#0f1214', 'stroke-width': 1.5
        }));
        cGroup.appendChild(el('ellipse', {
          cx: 28, cy: def.height - 17, rx: 6, ry: 10, fill: '#0a0c0e'
        }));
        cGroup.appendChild(el('circle', {
          cx: 28, cy: def.height - 17, r: 3, fill: '#cfd8dc'
        }));

        // 5. ATmega328P DIP-28 Microcontroller Chip
        var chipX = 72, chipY = 120, chipW = 54, chipH = 138;
        cGroup.appendChild(el('rect', {
          x: chipX - 3, y: chipY - 3, width: chipW + 6, height: chipH + 6, rx: 4,
          fill: '#111417', stroke: '#080a0b', 'stroke-width': 1
        }));
        for (var leg = 0; leg < 14; leg++) {
          var legY = chipY + 6 + leg * 9.2;
          cGroup.appendChild(el('rect', { x: chipX - 8, y: legY, width: 6, height: 4, fill: '#b0bec5', rx: 0.5 }));
          cGroup.appendChild(el('rect', { x: chipX + chipW + 2, y: legY, width: 6, height: 4, fill: '#b0bec5', rx: 0.5 }));
        }
        cGroup.appendChild(el('rect', {
          x: chipX, y: chipY, width: chipW, height: chipH, rx: 3,
          fill: 'url(#grad-ic-chip)', stroke: '#15181c', 'stroke-width': 1
        }));
        cGroup.appendChild(el('path', {
          d: 'M ' + (chipX + 21) + ' ' + chipY + ' A 6 6 0 0 0 ' + (chipX + 33) + ' ' + chipY,
          fill: '#15181c', stroke: '#21252b'
        }));
        var chipText1 = el('text', {
          x: chipX + chipW / 2, y: chipY + 48, 'text-anchor': 'middle', 'font-size': '8.5',
          'font-weight': '700', fill: '#cfd8dc', 'font-family': 'monospace',
          transform: 'rotate(-90 ' + (chipX + chipW / 2) + ' ' + (chipY + 48) + ')'
        });
        chipText1.textContent = 'ATMEGA328P-PU';
        cGroup.appendChild(chipText1);

        // 6. Silver Quartz Crystal Oscillator (16MHz)
        cGroup.appendChild(el('rect', {
          x: 38, y: 72, width: 26, height: 14, rx: 7,
          fill: 'url(#grad-rf-shield)', stroke: '#78909c', 'stroke-width': 1
        }));
        var xtal = el('text', {
          x: 51, y: 82.5, 'text-anchor': 'middle', 'font-size': '7',
          'font-weight': '700', fill: '#455a64', 'font-family': 'monospace'
        });
        xtal.textContent = '16.000';
        cGroup.appendChild(xtal);

        // 7. Red Tactile Reset Button
        cGroup.appendChild(el('rect', {
          x: 82, y: 14, width: 16, height: 16, rx: 3,
          fill: '#eceff1', stroke: '#90a4ae', 'stroke-width': 1
        }));
        cGroup.appendChild(el('circle', {
          cx: 90, cy: 22, r: 5, fill: '#d32f2f', stroke: '#b71c1c'
        }));
        var rstText = el('text', {
          x: 90, y: 38, 'text-anchor': 'middle', 'font-size': '7.5',
          'font-weight': '800', fill: '#ffffff', 'font-family': 'sans-serif'
        });
        rstText.textContent = 'RESET';
        cGroup.appendChild(rstText);

        // 8. ICSP 6-pin Header
        cGroup.appendChild(el('rect', {
          x: 78, y: def.height - 75, width: 22, height: 32, rx: 2,
          fill: '#15181c', stroke: '#263238', 'stroke-width': 1
        }));
        for (var px = 0; px < 2; px++) {
          for (var py = 0; py < 3; py++) {
            cGroup.appendChild(el('circle', {
              cx: 83 + px * 10, cy: def.height - 68 + py * 10, r: 2, fill: 'url(#grad-gold)'
            }));
          }
        }
        var icspText = el('text', {
          x: 89, y: def.height - 78, 'text-anchor': 'middle', 'font-size': '7',
          'font-weight': '700', fill: '#b0bec5'
        });
        icspText.textContent = 'ICSP';
        cGroup.appendChild(icspText);

        // 9. Status & Indicator LEDs (ON, L, TX, RX)
        var leds = [
          { x: 42, y: 150, color: '#43a047', label: 'ON' },
          { x: 42, y: 175, color: '#fbc02d', label: 'L' },
          { x: 42, y: 200, color: '#fbc02d', label: 'TX' },
          { x: 42, y: 225, color: '#fbc02d', label: 'RX' }
        ];
        leds.forEach(function (l) {
          cGroup.appendChild(el('rect', { x: l.x - 1, y: l.y - 1, width: 8, height: 6, fill: '#37474f', rx: 1 }));
          cGroup.appendChild(el('rect', { x: l.x, y: l.y, width: 6, height: 4, fill: l.color, rx: 0.8 }));
          var lt = el('text', {
            x: l.x + 10, y: l.y + 4.5, 'font-size': '7.5', 'font-weight': '700',
            fill: '#ffffff', 'font-family': 'monospace'
          });
          lt.textContent = l.label;
          cGroup.appendChild(lt);
        });

        // 10. Female Header Socket Blocks
        cGroup.appendChild(el('rect', {
          x: 6, y: 56, width: 20, height: 86, rx: 2,
          fill: '#15181c', stroke: '#212529', 'stroke-width': 1
        }));
        cGroup.appendChild(el('rect', {
          x: 140, y: 56, width: 20, height: def.height - 72, rx: 2,
          fill: '#15181c', stroke: '#212529', 'stroke-width': 1
        }));
        cGroup.appendChild(el('rect', {
          x: 268, y: 56, width: 20, height: def.height - 72, rx: 2,
          fill: '#15181c', stroke: '#212529', 'stroke-width': 1
        }));

        var pwrLbl = el('text', {
          x: 16, y: 50, 'text-anchor': 'middle', 'font-size': '8.5',
          'font-weight': '800', fill: '#ffffff', 'font-family': 'sans-serif'
        });
        pwrLbl.textContent = 'POWER';
        cGroup.appendChild(pwrLbl);

        var digLbl = el('text', {
          x: 214, y: 50, 'text-anchor': 'middle', 'font-size': '9',
          'font-weight': '800', fill: '#ffffff', 'font-family': 'sans-serif'
        });
        digLbl.textContent = 'DIGITAL / ANALOG';
        cGroup.appendChild(digLbl);

        // 11. Large Arduino Silkscreen Branding
        var brand = el('text', {
          x: 214, y: def.height - 32, 'text-anchor': 'middle', 'font-size': '15',
          'font-weight': '800', fill: '#ffffff', 'font-family': 'sans-serif', 'letter-spacing': '1px'
        });
        brand.textContent = '\u221E ARDUINO';
        cGroup.appendChild(brand);

        var model = el('text', {
          x: 214, y: def.height - 15, 'text-anchor': 'middle', 'font-size': '12',
          'font-weight': '700', fill: '#b2ebf2', 'font-family': 'sans-serif'
        });
        model.textContent = 'UNO R3';
        cGroup.appendChild(model);

      } else {
        // ---- REALISTIC ESP32 DEVKIT ----
        // 1. Dark Slate PCB
        cGroup.appendChild(el('rect', {
          x: 0, y: 0, width: def.width, height: def.height, rx: 10,
          fill: 'url(#grad-pcb-esp32)', stroke: '#0a0b0d', 'stroke-width': 2
        }));

        // 2. Gold Meandering PCB Wi-Fi / BT Antenna (at top)
        var antX = 85, antY = 8;
        cGroup.appendChild(el('rect', { x: antX, y: antY, width: 130, height: 32, rx: 3, fill: '#14161a', stroke: '#21252d' }));
        cGroup.appendChild(el('path', {
          d: 'M ' + (antX + 15) + ' ' + (antY + 24)
            + ' L ' + (antX + 15) + ' ' + (antY + 12)
            + ' L ' + (antX + 35) + ' ' + (antY + 12)
            + ' L ' + (antX + 35) + ' ' + (antY + 24)
            + ' L ' + (antX + 55) + ' ' + (antY + 24)
            + ' L ' + (antX + 55) + ' ' + (antY + 12)
            + ' L ' + (antX + 75) + ' ' + (antY + 12)
            + ' L ' + (antX + 75) + ' ' + (antY + 24)
            + ' L ' + (antX + 95) + ' ' + (antY + 24)
            + ' L ' + (antX + 95) + ' ' + (antY + 12)
            + ' L ' + (antX + 115) + ' ' + (antY + 12),
          stroke: 'url(#grad-gold)', 'stroke-width': 2.5, fill: 'none'
        }));

        // 3. Silver Metal RF Shield Can
        var rfX = 65, rfY = 48, rfW = 170, rfH = 135;
        cGroup.appendChild(el('rect', {
          x: rfX, y: rfY, width: rfW, height: rfH, rx: 5,
          fill: 'url(#grad-rf-shield)', stroke: '#78909c', 'stroke-width': 1.5
        }));
        var rfText1 = el('text', {
          x: rfX + rfW / 2, y: rfY + 45, 'text-anchor': 'middle', 'font-size': '15',
          'font-weight': '800', fill: '#37474f', 'font-family': 'sans-serif'
        });
        rfText1.textContent = 'ESP-WROOM-32';
        cGroup.appendChild(rfText1);

        var rfText2 = el('text', {
          x: rfX + rfW / 2, y: rfY + 70, 'text-anchor': 'middle', 'font-size': '10',
          'font-weight': '600', fill: '#546e7a', 'font-family': 'sans-serif'
        });
        rfText2.textContent = 'Espressif \u00B7 Wi-Fi + BT SoC';
        cGroup.appendChild(rfText2);

        var rfText3 = el('text', {
          x: rfX + rfW / 2, y: rfY + 95, 'text-anchor': 'middle', 'font-size': '8.5',
          'font-weight': '600', fill: '#78909c', 'font-family': 'monospace'
        });
        rfText3.textContent = 'FCC ID: 2AC7Z-ESPWROOM32';
        cGroup.appendChild(rfText3);

        // 4. Micro-USB Port (bottom)
        cGroup.appendChild(el('rect', {
          x: 130, y: def.height - 20, width: 40, height: 26, rx: 3,
          fill: 'url(#grad-metal-lead)', stroke: '#546e7a', 'stroke-width': 1.2
        }));
        cGroup.appendChild(el('rect', {
          x: 138, y: def.height - 10, width: 24, height: 12, rx: 1, fill: '#14181c'
        }));

        // 5. EN and BOOT micro-tactile pushbuttons
        var btns = [
          { x: 75, y: def.height - 35, label: 'EN' },
          { x: 200, y: def.height - 35, label: 'BOOT' }
        ];
        btns.forEach(function (b) {
          cGroup.appendChild(el('rect', { x: b.x, y: b.y, width: 24, height: 18, rx: 2, fill: '#cfd8dc', stroke: '#78909c' }));
          cGroup.appendChild(el('circle', { cx: b.x + 12, cy: b.y + 9, r: 4.5, fill: '#263238' }));
          var bt = el('text', {
            x: b.x + 12, y: b.y + 26, 'text-anchor': 'middle', 'font-size': '7.5',
            'font-weight': '700', fill: '#ffffff', 'font-family': 'sans-serif'
          });
          bt.textContent = b.label;
          cGroup.appendChild(bt);
        });

        // 6. Header Socket Strips for left and right rails
        cGroup.appendChild(el('rect', {
          x: 6, y: 56, width: 20, height: def.height - 72, rx: 2,
          fill: '#0f1114', stroke: '#1a1d22', 'stroke-width': 1
        }));
        cGroup.appendChild(el('rect', {
          x: 140, y: 56, width: 20, height: def.height - 72, rx: 2,
          fill: '#0f1114', stroke: '#1a1d22', 'stroke-width': 1
        }));
        cGroup.appendChild(el('rect', {
          x: 268, y: 56, width: 20, height: def.height - 72, rx: 2,
          fill: '#0f1114', stroke: '#1a1d22', 'stroke-width': 1
        }));

        var espBrand = el('text', {
          x: 150, y: 215, 'text-anchor': 'middle', 'font-size': '13',
          'font-weight': '800', fill: '#ffffff', 'font-family': 'sans-serif', 'letter-spacing': '1px'
        });
        espBrand.textContent = 'ESP32 DEVKIT V1';
        cGroup.appendChild(espBrand);
      }
    }

    function drawLed(group, component, def) {
      ensureRealisticDefs();
      var on = component.properties._on === true;
      var colorKey = component.properties.color || 'red';
      var hexColor = Components.LED_COLORS[colorKey] || Components.LED_COLORS.red;

      var cGroup = el('g', { filter: 'url(#comp-shadow)' });
      group.appendChild(cGroup);

      // Anode (+) top lead: silver metal wire from (30,0) down to (30, 24)
      cGroup.appendChild(el('rect', {
        x: 28.5, y: 0, width: 3, height: 26, rx: 1,
        fill: 'url(#grad-metal-lead)', stroke: '#546e7a', 'stroke-width': 0.5
      }));
      // Cathode (-) bottom lead: silver metal wire from (30, 65) down to (30, 90)
      cGroup.appendChild(el('rect', {
        x: 28.5, y: 65, width: 3, height: 25, rx: 1,
        fill: 'url(#grad-metal-lead)', stroke: '#546e7a', 'stroke-width': 0.5
      }));

      // If LED is on, render multi-layered luminous bloom!
      if (on) {
        group.appendChild(el('circle', {
          cx: 30, cy: 45, r: 42, fill: hexColor, opacity: '0.22', filter: 'url(#led-bloom)', 'pointer-events': 'none'
        }));
        group.appendChild(el('circle', {
          cx: 30, cy: 45, r: 28, fill: hexColor, opacity: '0.5', filter: 'url(#led-bloom)', 'pointer-events': 'none'
        }));
      }

      // LED Base Flange / Rim
      cGroup.appendChild(el('rect', {
        x: 14, y: 59, width: 32, height: 7, rx: 2,
        fill: on ? hexColor : '#78909c', opacity: on ? '0.95' : '0.7',
        stroke: on ? '#ffffff' : '#37474f', 'stroke-width': 1
      }));

      // 5mm Epoxy Dome
      var dome = el('path', {
        d: 'M 15 61 L 15 39 A 15 15 0 0 1 45 39 L 45 61 Z',
        fill: hexColor,
        opacity: on ? '1' : '0.85',
        stroke: on ? '#ffffff' : '#37474f',
        'stroke-width': on ? '1.5' : '1',
        filter: on ? 'url(#led-bloom)' : undefined
      });
      cGroup.appendChild(dome);

      // Internal metal leadframe
      var anvil = el('path', {
        d: 'M 24 58 L 24 45 L 29 41 L 29 58 Z',
        fill: on ? '#fff' : '#b0bec5', opacity: on ? '0.9' : '0.6'
      });
      cGroup.appendChild(anvil);

      var post = el('path', {
        d: 'M 32 58 L 32 46 L 30 43',
        stroke: on ? '#fff' : '#b0bec5', 'stroke-width': '1.5', fill: 'none', opacity: on ? '0.9' : '0.6'
      });
      cGroup.appendChild(post);

      if (on) {
        cGroup.appendChild(el('circle', {
          cx: 29.5, cy: 43, r: 6, fill: '#ffffff', filter: 'url(#led-bloom)'
        }));
      }

      // Curved glass specular highlight on top-left of the dome
      var highlight = el('path', {
        d: 'M 18 52 C 18 36, 24 28, 30 26 C 26 28, 20 36, 20 52 Z',
        fill: '#ffffff', opacity: on ? '0.65' : '0.45', 'pointer-events': 'none'
      });
      cGroup.appendChild(highlight);

      var label = el('text', {
        x: 42, y: 78, 'font-size': '9', 'font-weight': '700',
        fill: on ? hexColor : '#546e7a', 'font-family': 'sans-serif'
      });
      label.textContent = colorKey.toUpperCase() + (on ? ' (ON)' : '');
      group.appendChild(label);
    }

    function drawResistor(group, component, def) {
      ensureRealisticDefs();
      var cGroup = el('g', { filter: 'url(#comp-shadow)' });
      group.appendChild(cGroup);

      // Left & right shiny silver metallic lead wires
      cGroup.appendChild(el('rect', {
        x: 0, y: 14.5, width: 25, height: 3, rx: 1.5,
        fill: 'url(#grad-metal-lead-h)', stroke: '#60707a', 'stroke-width': 0.5
      }));
      cGroup.appendChild(el('rect', {
        x: 75, y: 14.5, width: 25, height: 3, rx: 1.5,
        fill: 'url(#grad-metal-lead-h)', stroke: '#60707a', 'stroke-width': 0.5
      }));

      // Dumbbell / contoured ceramic resistor body
      cGroup.appendChild(el('ellipse', {
        cx: 29, cy: 16, rx: 6, ry: 11,
        fill: 'url(#grad-resistor-body)', stroke: '#8d6e63', 'stroke-width': 0.8
      }));
      cGroup.appendChild(el('ellipse', {
        cx: 71, cy: 16, rx: 6, ry: 11,
        fill: 'url(#grad-resistor-body)', stroke: '#8d6e63', 'stroke-width': 0.8
      }));
      cGroup.appendChild(el('rect', {
        x: 29, y: 7, width: 42, height: 18, rx: 2,
        fill: 'url(#grad-resistor-body)', stroke: '#8d6e63', 'stroke-width': 0.8
      }));
      cGroup.appendChild(el('rect', {
        x: 28, y: 7.5, width: 44, height: 17,
        fill: 'url(#grad-resistor-body)'
      }));

      // Calculate authentic color bands from resistance value
      var bands = getResistorBands(component.properties.resistance || 220);
      cGroup.appendChild(el('rect', { x: 33, y: 7, width: 4.5, height: 18, fill: bands.band1 }));
      cGroup.appendChild(el('rect', { x: 42, y: 7, width: 4.5, height: 18, fill: bands.band2 }));
      cGroup.appendChild(el('rect', { x: 51, y: 7, width: 4.5, height: 18, fill: bands.band3 }));
      cGroup.appendChild(el('rect', { x: 63, y: 6.5, width: 5.5, height: 19, fill: bands.band4, stroke: '#b59325', 'stroke-width': 0.5 }));

      // Cylindrical 3D highlight reflection stripe
      cGroup.appendChild(el('rect', {
        x: 26, y: 8.5, width: 48, height: 3.5, rx: 1.5,
        fill: '#ffffff', opacity: '0.45', 'pointer-events': 'none'
      }));

      // Resistance label underneath
      var label = el('text', {
        x: 50, y: 35, 'text-anchor': 'middle', 'font-size': '10.5',
        'font-weight': '700', fill: '#3e2723', 'font-family': 'Consolas, monospace'
      });
      label.textContent = (component.properties.resistance || 220) + '\u03A9';
      group.appendChild(label);
    }

    function drawButton(group, component, def) {
      ensureRealisticDefs();
      var pressed = component.properties._pressed === true;
      var cGroup = el('g', { filter: 'url(#comp-shadow)' });
      group.appendChild(cGroup);

      // 4 silver metal curved gull-wing legs extending to pins
      var legs = [
        { x1: 0, y1: 20, x2: 18, y2: 20 },
        { x1: 0, y1: 60, x2: 18, y2: 60 },
        { x1: 90, y1: 20, x2: 72, y2: 20 },
        { x1: 90, y1: 60, x2: 72, y2: 60 }
      ];
      legs.forEach(function (leg) {
        cGroup.appendChild(el('line', {
          x1: leg.x1, y1: leg.y1, x2: leg.x2, y2: leg.y2,
          stroke: 'url(#grad-metal-lead)', 'stroke-width': 4, 'stroke-linecap': 'round'
        }));
      });

      // Dark heat-resistant plastic base
      cGroup.appendChild(el('rect', {
        x: 16, y: 10, width: 58, height: 60, rx: 7,
        fill: '#263238', stroke: '#102027', 'stroke-width': 1
      }));

      // Brushed stainless steel metal top retainer plate
      cGroup.appendChild(el('rect', {
        x: 19, y: 13, width: 52, height: 54, rx: 5,
        fill: 'url(#grad-rf-shield)', stroke: '#78909c', 'stroke-width': 1
      }));

      // 4 Corner silver rivets
      var rivets = [
        { cx: 24, cy: 18 }, { cx: 66, cy: 18 },
        { cx: 24, cy: 62 }, { cx: 66, cy: 62 }
      ];
      rivets.forEach(function (r) {
        cGroup.appendChild(el('circle', { cx: r.cx, cy: r.cy, r: 2.2, fill: '#78909c', stroke: '#455a64', 'stroke-width': 0.5 }));
        cGroup.appendChild(el('circle', { cx: r.cx - 0.5, cy: r.cy - 0.5, r: 0.8, fill: '#ffffff' }));
      });

      // Center raised bezel collar
      cGroup.appendChild(el('circle', {
        cx: 45, cy: 40, r: 16.5, fill: '#263238', stroke: '#455a64', 'stroke-width': 1
      }));

      // Round actuator plunger button in center
      var buttonY = pressed ? 42 : 40;
      var btnColor = pressed ? '#0d47a1' : '#1976d2';
      cGroup.appendChild(el('circle', {
        cx: 45, cy: buttonY, r: pressed ? 12 : 13,
        fill: btnColor, stroke: pressed ? '#002171' : '#0d47a1', 'stroke-width': 1.5
      }));
      cGroup.appendChild(el('ellipse', {
        cx: 45, cy: buttonY - (pressed ? 3 : 4), rx: 7, ry: 3.5,
        fill: '#ffffff', opacity: pressed ? '0.3' : '0.55', 'pointer-events': 'none'
      }));

      var lbl = el('text', {
        x: 45, y: 78, 'text-anchor': 'middle', 'font-size': '9',
        'font-weight': '700', fill: pressed ? '#1976d2' : '#78909c', 'font-family': 'sans-serif'
      });
      lbl.textContent = pressed ? 'CLICKED' : 'PUSH';
      group.appendChild(lbl);
    }

    function drawDht(group, component, def) {
      ensureRealisticDefs();
      var cGroup = el('g', { filter: 'url(#comp-shadow)' });
      group.appendChild(cGroup);

      var pinsY = [25, 60, 95];
      pinsY.forEach(function (y) {
        cGroup.appendChild(el('rect', {
          x: 0, y: y - 1.5, width: 20, height: 3, rx: 1,
          fill: 'url(#grad-metal-lead-h)', stroke: '#546e7a', 'stroke-width': 0.5
        }));
      });

      // Bottom PCB carrier strip
      cGroup.appendChild(el('rect', {
        x: 16, y: 15, width: 78, height: 100, rx: 5,
        fill: '#1b2a4a', stroke: '#0d182b', 'stroke-width': 1
      }));

      // Blue sensor casing with 3D gradient
      cGroup.appendChild(el('rect', {
        x: 22, y: 10, width: 68, height: 110, rx: 6,
        fill: '#0288d1', stroke: '#01579b', 'stroke-width': 1.5
      }));

      // 4 Horizontal ventilation grid slots
      for (var i = 0; i < 4; i++) {
        var slotY = 24 + i * 16;
        cGroup.appendChild(el('rect', {
          x: 32, y: slotY, width: 48, height: 8, rx: 3,
          fill: '#013a63', stroke: '#012a4a', 'stroke-width': 0.8
        }));
        cGroup.appendChild(el('line', {
          x1: 44, y1: slotY + 2, x2: 44, y2: slotY + 6, stroke: '#29b6f6', 'stroke-width': 1
        }));
        cGroup.appendChild(el('line', {
          x1: 56, y1: slotY + 2, x2: 56, y2: slotY + 6, stroke: '#29b6f6', 'stroke-width': 1
        }));
        cGroup.appendChild(el('line', {
          x1: 68, y1: slotY + 2, x2: 68, y2: slotY + 6, stroke: '#29b6f6', 'stroke-width': 1
        }));
      }

      var brand = el('text', {
        x: 56, y: 102, 'text-anchor': 'middle', 'font-size': '13',
        'font-weight': '800', fill: '#ffffff', 'font-family': 'sans-serif', 'letter-spacing': '1px'
      });
      brand.textContent = 'DHT11';
      cGroup.appendChild(brand);

      var sub = el('text', {
        x: 56, y: 114, 'text-anchor': 'middle', 'font-size': '8',
        'font-weight': '600', fill: '#b3e5fc', 'font-family': 'sans-serif'
      });
      sub.textContent = 'HUMIDITY / TEMP';
      cGroup.appendChild(sub);

      var pinLabels = [
        { y: 28, text: 'VCC (+)' },
        { y: 63, text: 'DATA' },
        { y: 98, text: 'GND (-)' }
      ];
      pinLabels.forEach(function (pl) {
        var t = el('text', {
          x: 23, y: pl.y, 'font-size': '8', 'font-weight': '700',
          fill: '#ffffff', 'font-family': 'sans-serif'
        });
        t.textContent = pl.text;
        cGroup.appendChild(t);
      });
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
      var isWiring = lab.wires && typeof lab.wires.isWireMode === 'function' && lab.wires.isWireMode();

      def.pins.forEach(function (pin) {
        var ref = component.id + '.' + pin.id;
        var isPending = lab.pendingRef === ref;

        // Visual target ring around pins when in Wire Mode
        if (isWiring) {
          group.appendChild(el('circle', {
            cx: pin.x, cy: pin.y, r: 8, fill: 'none',
            stroke: pinFill(pin.kind), 'stroke-width': 1.5,
            'stroke-dasharray': '2 2', opacity: '0.8',
            class: 'pin-wire-target', 'pointer-events': 'none'
          }));
        }

        if (isPending) {
          group.appendChild(el('circle', {
            cx: pin.x, cy: pin.y, r: 12, fill: 'none',
            stroke: '#ff9800', 'stroke-width': 3,
            class: 'pending-beacon', 'pointer-events': 'none'
          }));
        }

        var hit = el('circle', {
          cx: pin.x, cy: pin.y, r: 12, fill: 'transparent',
          class: 'pin-hit' + (isWiring ? ' active-wire' : ''),
          'data-ref': ref
        });
        hit.style.cursor = isWiring ? 'crosshair' : 'pointer';
        hit.addEventListener('mousedown', function (ev) {
          ev.stopPropagation();
        });
        hit.addEventListener('click', function (ev) {
          ev.stopPropagation();
          lab.onPinClick(ref);
        });
        hit.addEventListener('mouseenter', function () {
          var wireModeNote = isWiring ? ' [Click to connect wire]' : ' [Click "Connect Wire" to connect]';
          lab.setStatus('Pin ' + ref + (pin.kind ? ' (' + pin.kind + ')' : '') + wireModeNote);
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
