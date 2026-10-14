/*
 * wires.js
 * Wire drawing, selection and deletion between component pins.
 *
 * The controller keeps a "pending" pin. Clicking one pin starts a wire;
 * clicking a second pin completes it. Clicking a wire selects it so it can be
 * deleted. Wire colours are derived from the pins they touch.
 */

(function (global) {
  'use strict';

  var SVG_NS = 'http://www.w3.org/2000/svg';

  function colorForPin(kind) {
    switch (kind) {
      case 'gnd': return '#37474f';
      case 'power': return '#e53935';
      case 'analog': return '#8e24aa';
      default: return '#1e88e5';
    }
  }

  function create(lab) {
    var controller = {
      pendingRef: null,
      selectedWireId: null,
      wireMode: false,
      selectedColor: 'auto'
    };

    function layer() {
      return lab.layers.wires;
    }

    function clearLayer() {
      var l = layer();
      while (l.firstChild) l.removeChild(l.firstChild);
    }

    var dragWireState = null;

    function toPoint(evt) {
      if (lab.canvas && typeof lab.canvas.toSvgPoint === 'function') {
        return lab.canvas.toSvgPoint(evt);
      }
      var pt = lab.svg.createSVGPoint();
      pt.x = evt.clientX;
      pt.y = evt.clientY;
      var ctm = lab.svg.getScreenCTM();
      if (!ctm) return { x: evt.clientX, y: evt.clientY };
      var p = pt.matrixTransform(ctm.inverse());
      return { x: p.x, y: p.y };
    }

    function wireColor(wire) {
      if (wire.color) return wire.color;
      var a = lab.resolvePin(wire.from);
      var b = lab.resolvePin(wire.to);
      if (!a || !b) return '#90a4ae';
      // Ground wins, then power, then signal.
      if (a.pin.kind === 'gnd' || b.pin.kind === 'gnd') return colorForPin('gnd');
      if (a.pin.kind === 'power' || b.pin.kind === 'power') return colorForPin('power');
      return colorForPin('digital');
    }

    function pathData(a, b, wire) {
      var midX = (a.x + b.x) / 2;
      var midY = (a.y + b.y) / 2;
      var hasBend = wire && (wire.dx != null || wire.dy != null) && (Math.abs(wire.dx) > 1 || Math.abs(wire.dy) > 1);

      if (!hasBend) {
        var dx = Math.max(30, Math.abs(b.x - a.x) * 0.5);
        var c1x = a.x + (b.x >= a.x ? dx : -dx);
        var c2x = b.x + (b.x >= a.x ? -dx : dx);
        return 'M ' + a.x + ' ' + a.y
          + ' C ' + c1x + ' ' + a.y + ', ' + c2x + ' ' + b.y + ', ' + b.x + ' ' + b.y;
      }

      var wx = midX + (wire.dx || 0);
      var wy = midY + (wire.dy || 0);

      // Curve precisely passing through waypoint W(wx, wy)
      var cx = 2 * wx - 0.5 * (a.x + b.x);
      var cy = 2 * wy - 0.5 * (a.y + b.y);
      return 'M ' + a.x + ' ' + a.y + ' Q ' + cx + ' ' + cy + ' ' + b.x + ' ' + b.y;
    }

    function startWireDrag(wireId, ev) {
      var pt = toPoint(ev);
      var wire = lab.state.connections.find(function (c) { return c.id === wireId; });
      if (!wire) return;
      var a = lab.resolvePin(wire.from);
      var b = lab.resolvePin(wire.to);
      if (!a || !b) return;

      var midX = (a.abs.x + b.abs.x) / 2;
      var midY = (a.abs.y + b.abs.y) / 2;
      var curWx = midX + (wire.dx || 0);
      var curWy = midY + (wire.dy || 0);

      dragWireState = {
        wireId: wireId,
        offsetDx: pt.x - curWx,
        offsetDy: pt.y - curWy,
        hasMoved: false
      };
      lab.setStatus('Dragging wire route. Move mouse to bend wire, release to place.');
    }

    function onSvgMouseMove(ev) {
      if (!dragWireState) return;
      var pt = toPoint(ev);
      var wire = lab.state.connections.find(function (c) { return c.id === dragWireState.wireId; });
      if (!wire) return;
      var a = lab.resolvePin(wire.from);
      var b = lab.resolvePin(wire.to);
      if (!a || !b) return;

      var midX = (a.abs.x + b.abs.x) / 2;
      var midY = (a.abs.y + b.abs.y) / 2;
      wire.dx = Math.round(pt.x - dragWireState.offsetDx - midX);
      wire.dy = Math.round(pt.y - dragWireState.offsetDy - midY);
      dragWireState.hasMoved = true;
      render();
    }

    function onSvgMouseUp() {
      if (dragWireState) {
        if (dragWireState.hasMoved) {
          lab.emit('state:changed', { reason: 'wire:route' });
          lab.setStatus('Wire route adjusted. Double-click handle to reset curve.');
        }
        dragWireState = null;
      }
    }

    function resetSelectedWireRoute() {
      if (!controller.selectedWireId) return;
      var wire = lab.state.connections.find(function (c) { return c.id === controller.selectedWireId; });
      if (wire) {
        wire.dx = 0;
        wire.dy = 0;
        render();
        lab.setStatus('Wire route straightened to default.');
        lab.toast('Wire path straightened.', 'info');
        lab.emit('state:changed', { reason: 'wire:route' });
      }
    }

    function renderPending() {
      if (!controller.pendingRef) return;
      var p = lab.resolvePin(controller.pendingRef);
      if (!p || !p.abs) return;
      var g = document.createElementNS(SVG_NS, 'circle');
      g.setAttribute('cx', p.abs.x);
      g.setAttribute('cy', p.abs.y);
      g.setAttribute('r', '13');
      g.setAttribute('fill', 'none');
      g.setAttribute('stroke', '#ff9800');
      g.setAttribute('stroke-width', '3');
      g.setAttribute('stroke-dasharray', '4 2');
      g.setAttribute('class', 'pending-beacon');
      g.setAttribute('pointer-events', 'none');
      layer().appendChild(g);
    }

    function render() {
      clearLayer();
      lab.state.connections.forEach(function (wire) {
        var a = lab.resolvePin(wire.from);
        var b = lab.resolvePin(wire.to);
        if (!a || !b) return;
        var selected = controller.selectedWireId === wire.id;
        var color = wireColor(wire);
        var d = pathData(a.abs, b.abs, wire);

        // Wide hit area for clicking to select wire
        var hit = document.createElementNS(SVG_NS, 'path');
        hit.setAttribute('d', d);
        hit.setAttribute('fill', 'none');
        hit.setAttribute('stroke', 'transparent');
        hit.setAttribute('stroke-width', '16');
        hit.setAttribute('class', 'wire-hit');
        hit.style.cursor = 'pointer';
        hit.addEventListener('click', function (ev) {
          ev.stopPropagation();
          selectWire(wire.id);
        });
        layer().appendChild(hit);

        // Selected halo glow under wire
        if (selected) {
          var halo = document.createElementNS(SVG_NS, 'path');
          halo.setAttribute('d', d);
          halo.setAttribute('fill', 'none');
          halo.setAttribute('stroke', color);
          halo.setAttribute('stroke-width', '10');
          halo.setAttribute('opacity', '0.28');
          halo.setAttribute('stroke-linecap', 'round');
          halo.setAttribute('pointer-events', 'none');
          layer().appendChild(halo);
        }

        // Visible wire
        var path = document.createElementNS(SVG_NS, 'path');
        path.setAttribute('d', d);
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', color);
        path.setAttribute('stroke-width', selected ? '4.5' : '3.5');
        path.setAttribute('stroke-linecap', 'round');
        path.setAttribute('pointer-events', 'none');
        if (selected) path.setAttribute('stroke-dasharray', '8 4');
        layer().appendChild(path);

        if (selected) {
          var midX = (a.abs.x + b.abs.x) / 2;
          var midY = (a.abs.y + b.abs.y) / 2;
          var wx = midX + (wire.dx || 0);
          var wy = midY + (wire.dy || 0);

          // 1. Draggable Adjustment Handle (located at waypoint W)
          var handleGroup = document.createElementNS(SVG_NS, 'g');
          handleGroup.setAttribute('class', 'wire-handle-group');

          // Outer dashed guide ring
          var ring = document.createElementNS(SVG_NS, 'circle');
          ring.setAttribute('cx', wx);
          ring.setAttribute('cy', wy);
          ring.setAttribute('r', '13');
          ring.setAttribute('fill', 'none');
          ring.setAttribute('stroke', color);
          ring.setAttribute('stroke-width', '2');
          ring.setAttribute('stroke-dasharray', '3 2');
          ring.setAttribute('class', 'wire-handle-ring');
          handleGroup.appendChild(ring);

          // Inner solid grab dot
          var dot = document.createElementNS(SVG_NS, 'circle');
          dot.setAttribute('cx', wx);
          dot.setAttribute('cy', wy);
          dot.setAttribute('r', '7');
          dot.setAttribute('fill', '#ffffff');
          dot.setAttribute('stroke', color);
          dot.setAttribute('stroke-width', '2.5');
          dot.setAttribute('class', 'wire-handle-dot');
          handleGroup.appendChild(dot);

          var centerPip = document.createElementNS(SVG_NS, 'circle');
          centerPip.setAttribute('cx', wx);
          centerPip.setAttribute('cy', wy);
          centerPip.setAttribute('r', '2.8');
          centerPip.setAttribute('fill', color);
          centerPip.setAttribute('pointer-events', 'none');
          handleGroup.appendChild(centerPip);

          // Large invisible hit target for effortless dragging
          var handleHit = document.createElementNS(SVG_NS, 'circle');
          handleHit.setAttribute('cx', wx);
          handleHit.setAttribute('cy', wy);
          handleHit.setAttribute('r', '18');
          handleHit.setAttribute('fill', 'transparent');
          handleHit.setAttribute('class', 'wire-handle-hit');
          handleHit.style.cursor = 'grab';
          handleHit.addEventListener('mousedown', function (ev) {
            ev.stopPropagation();
            startWireDrag(wire.id, ev);
          });
          handleHit.addEventListener('dblclick', function (ev) {
            ev.stopPropagation();
            wire.dx = 0;
            wire.dy = 0;
            render();
            lab.setStatus('Wire route reset to default curve.');
            lab.toast('Wire route straightened.', 'info');
            lab.emit('state:changed', { reason: 'wire:route' });
          });
          handleHit.addEventListener('mouseenter', function () {
            lab.setStatus('⚡ Wire route handle: Click & drag to curve wire | Double-click to straighten');
          });
          handleGroup.appendChild(handleHit);
          layer().appendChild(handleGroup);

          // 2. Separate Delete Button (✕) positioned cleanly at 22% along the wire
          var delX = a.abs.x * 0.75 + wx * 0.25;
          var delY = a.abs.y * 0.75 + wy * 0.25;

          var marker = document.createElementNS(SVG_NS, 'circle');
          marker.setAttribute('cx', delX);
          marker.setAttribute('cy', delY);
          marker.setAttribute('r', '8');
          marker.setAttribute('fill', '#ffffff');
          marker.setAttribute('stroke', '#e53935');
          marker.setAttribute('stroke-width', '2');
          marker.setAttribute('class', 'wire-delete-marker');
          marker.style.cursor = 'pointer';
          marker.addEventListener('click', function (ev) {
            ev.stopPropagation();
            lab.removeConnection(wire.id);
            controller.selectedWireId = null;
            lab.setSelectedWire(null);
            updateWireToolbar();
          });

          var label = document.createElementNS(SVG_NS, 'text');
          label.setAttribute('x', delX);
          label.setAttribute('y', delY + 4);
          label.setAttribute('text-anchor', 'middle');
          label.setAttribute('font-size', '10.5');
          label.setAttribute('font-weight', '700');
          label.setAttribute('fill', '#e53935');
          label.setAttribute('pointer-events', 'none');
          label.textContent = '\u2715';

          layer().appendChild(marker);
          layer().appendChild(label);
        }
      });

      renderPending();
    }

    function updateWireToolbar() {
      var resetBtn = document.getElementById('btnResetWire');
      if (resetBtn) {
        resetBtn.style.display = controller.selectedWireId ? 'inline-flex' : 'none';
      }
    }

    function selectWire(id) {
      controller.selectedWireId = id;
      lab.setSelectedWire(id);
      updateWireToolbar();
      render();
      if (id) {
        lab.setStatus('⚡ Wire selected: Drag the circular handle to route wire • Click ✕ to delete • Double-click handle to straighten');
      }
    }

    function updateWireModeUI() {
      var btnOff = document.getElementById('btnWireModeOff');
      var btnOn = document.getElementById('btnWireModeOn');
      var btnExit = document.getElementById('btnExitWireMode');
      var btn = document.getElementById('btnWireMode');
      var picker = document.getElementById('wireColorPicker');
      var svg = lab.svg || document.getElementById('workspaceSvg');

      if (btnOff) {
        btnOff.classList.toggle('active', !controller.wireMode);
      }
      if (btnOn) {
        btnOn.classList.toggle('active', controller.wireMode);
      }
      if (btnExit) {
        btnExit.style.display = controller.wireMode ? 'inline-flex' : 'none';
      }

      if (btn) {
        if (controller.wireMode) {
          btn.classList.add('active');
          var textEl = btn.querySelector('.wire-btn-text');
          if (textEl) textEl.textContent = 'Wire Mode: ON (Click to OFF)';
        } else {
          btn.classList.remove('active');
          var textEl2 = btn.querySelector('.wire-btn-text');
          if (textEl2) textEl2.textContent = 'Wire Mode: OFF (Click to ON)';
        }
      }

      if (picker) {
        picker.style.display = controller.wireMode ? 'inline-flex' : 'none';
      }

      if (svg) {
        if (controller.wireMode) {
          svg.classList.add('wire-mode-active');
        } else {
          svg.classList.remove('wire-mode-active');
        }
      }
    }

    function setWireMode(active) {
      var prev = controller.wireMode;
      controller.wireMode = Boolean(active);
      if (!controller.wireMode) {
        controller.pendingRef = null;
        lab.highlightPending(null);
        lab.setStatus('Wire Mode is OFF. Drag and select components freely. Click [ON] to connect wires.');
        if (prev) {
          lab.toast('⚡ Wire Mode turned OFF. Select & drag mode active.', 'info');
        }
      } else {
        lab.setStatus('⚡ Wire Mode is ON: Click the first pin to start drawing a wire. Click [OFF] or Esc to exit.');
        if (!prev) {
          lab.toast('⚡ Wire Mode turned ON. Click two pins to connect them.', 'info');
        }
      }
      updateWireModeUI();
      if (lab.canvas && lab.canvas.render) lab.canvas.render();
      render();
    }

    function toggleWireMode() {
      setWireMode(!controller.wireMode);
    }

    function setColor(color) {
      controller.selectedColor = color || 'auto';
      var chips = document.querySelectorAll('.wire-chip');
      chips.forEach(function (c) {
        if (c.getAttribute('data-color') === controller.selectedColor) {
          c.classList.add('active');
        } else {
          c.classList.remove('active');
        }
      });
    }

    function onPinClick(ref) {
      // REQUIRE WIRE MODE TO CONNECT:
      if (!controller.wireMode) {
        lab.setStatus('Wire Mode is OFF. Click [ON] in the toolbar to connect components.');
        lab.toast('🔌 Click the [ON] button in the toolbar to activate Wire Mode.', 'info');
        return;
      }

      if (!controller.pendingRef) {
        controller.pendingRef = ref;
        lab.setStatus('Connecting from ' + ref + '. Click a second pin to connect, or click canvas to cancel.');
        lab.highlightPending(ref);
        render();
        return;
      }
      if (controller.pendingRef === ref) {
        controller.pendingRef = null;
        lab.highlightPending(null);
        lab.setStatus('Wire start cancelled.');
        render();
        return;
      }
      var chosenColor = controller.selectedColor === 'auto' ? null : controller.selectedColor;
      var result = lab.addConnection(controller.pendingRef, ref, chosenColor);
      controller.pendingRef = null;
      lab.highlightPending(null);
      if (result && result.error) {
        lab.setStatus(result.error);
        lab.toast(result.error, 'error');
      } else {
        lab.setStatus('Connected ' + (result.from) + ' → ' + (result.to) + '. Click another pin to connect, or click [OFF] to stop.');
        lab.toast('Connected ' + result.from + ' ➜ ' + result.to, 'success');
      }
      render();
    }

    function cancel() {
      controller.pendingRef = null;
      controller.selectedWireId = null;
      lab.highlightPending(null);
      render();
    }

    return {
      render: render,
      onPinClick: onPinClick,
      cancel: cancel,
      selectWire: selectWire,
      isWireMode: function () { return controller.wireMode; },
      setWireMode: setWireMode,
      toggleWireMode: toggleWireMode,
      setColor: setColor,
      onSvgMouseMove: onSvgMouseMove,
      onSvgMouseUp: onSvgMouseUp,
      isDraggingWire: function () { return Boolean(dragWireState); },
      resetSelectedWireRoute: resetSelectedWireRoute,
      get selectedColor() { return controller.selectedColor; },
      get selectedWireId() { return controller.selectedWireId; }
    };
  }

  var api = { create: create };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.Wires = api;
  }
})(typeof window !== 'undefined' ? window : this);
