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
      selectedWireId: null
    };

    function layer() {
      return lab.layers.wires;
    }

    function clearLayer() {
      var l = layer();
      while (l.firstChild) l.removeChild(l.firstChild);
    }

    function wireColor(wire) {
      var a = lab.resolvePin(wire.from);
      var b = lab.resolvePin(wire.to);
      if (!a || !b) return '#90a4ae';
      // Ground wins, then power, then signal.
      if (a.pin.kind === 'gnd' || b.pin.kind === 'gnd') return colorForPin('gnd');
      if (a.pin.kind === 'power' || b.pin.kind === 'power') return colorForPin('power');
      return colorForPin('digital');
    }

    function pathData(a, b) {
      var dx = Math.max(30, Math.abs(b.x - a.x) * 0.5);
      var c1x = a.x + (b.x >= a.x ? dx : -dx);
      var c2x = b.x + (b.x >= a.x ? -dx : dx);
      return 'M ' + a.x + ' ' + a.y
        + ' C ' + c1x + ' ' + a.y + ', ' + c2x + ' ' + b.y + ', ' + b.x + ' ' + b.y;
    }

    function render() {
      clearLayer();
      lab.state.connections.forEach(function (wire) {
        var a = lab.resolvePin(wire.from);
        var b = lab.resolvePin(wire.to);
        if (!a || !b) return;
        var selected = controller.selectedWireId === wire.id;
        var color = wireColor(wire);

        var hit = document.createElementNS(SVG_NS, 'path');
        hit.setAttribute('d', pathData(a.abs, b.abs));
        hit.setAttribute('fill', 'none');
        hit.setAttribute('stroke', 'transparent');
        hit.setAttribute('stroke-width', '14');
        hit.setAttribute('class', 'wire-hit');
        hit.style.cursor = 'pointer';
        hit.addEventListener('click', function (ev) {
          ev.stopPropagation();
          selectWire(wire.id);
        });
        layer().appendChild(hit);

        var path = document.createElementNS(SVG_NS, 'path');
        path.setAttribute('d', pathData(a.abs, b.abs));
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', color);
        path.setAttribute('stroke-width', selected ? '5' : '3');
        path.setAttribute('stroke-linecap', 'round');
        path.setAttribute('pointer-events', 'none');
        if (selected) path.setAttribute('stroke-dasharray', '10 5');
        layer().appendChild(path);

        if (selected) {
          var mid = { x: (a.abs.x + b.abs.x) / 2, y: (a.abs.y + b.abs.y) / 2 };
          var marker = document.createElementNS(SVG_NS, 'circle');
          marker.setAttribute('cx', mid.x);
          marker.setAttribute('cy', mid.y);
          marker.setAttribute('r', '7');
          marker.setAttribute('fill', '#fff');
          marker.setAttribute('stroke', color);
          marker.setAttribute('stroke-width', '2');
          marker.setAttribute('class', 'wire-delete');
          marker.style.cursor = 'pointer';
          marker.addEventListener('click', function (ev) {
            ev.stopPropagation();
            lab.removeConnection(wire.id);
            controller.selectedWireId = null;
            lab.setSelectedWire(null);
          });
          var label = document.createElementNS(SVG_NS, 'text');
          label.setAttribute('x', mid.x);
          label.setAttribute('y', mid.y + 4);
          label.setAttribute('text-anchor', 'middle');
          label.setAttribute('font-size', '10');
          label.setAttribute('fill', color);
          label.setAttribute('pointer-events', 'none');
          label.textContent = '\u2715';
          layer().appendChild(marker);
          layer().appendChild(label);
        }
      });

      renderPending();
    }

    function renderPending() {
      if (!controller.pendingRef) return;
      var p = lab.resolvePin(controller.pendingRef);
      if (!p) return;
      var g = document.createElementNS(SVG_NS, 'circle');
      g.setAttribute('cx', p.abs.x);
      g.setAttribute('cy', p.abs.y);
      g.setAttribute('r', '9');
      g.setAttribute('fill', 'none');
      g.setAttribute('stroke', '#ff9800');
      g.setAttribute('stroke-width', '2');
      g.setAttribute('class', 'pending-pin');
      layer().appendChild(g);
    }

    function selectWire(id) {
      controller.selectedWireId = id;
      lab.setSelectedWire(id);
      render();
      lab.setStatus('Wire selected. Click the \u2715 marker or press Delete to remove it.');
    }

    function onPinClick(ref) {
      if (!controller.pendingRef) {
        controller.pendingRef = ref;
        var p = lab.resolvePin(ref);
        lab.setStatus('Start wire at ' + ref + '. Now click a second pin.');
        lab.highlightPending(ref);
        render();
        return;
      }
      if (controller.pendingRef === ref) {
        controller.pendingRef = null;
        lab.highlightPending(null);
        lab.setStatus('Wire cancelled.');
        render();
        return;
      }
      var result = lab.addConnection(controller.pendingRef, ref);
      controller.pendingRef = null;
      lab.highlightPending(null);
      if (result && result.error) {
        lab.setStatus(result.error);
        lab.toast(result.error, 'error');
      } else {
        lab.setStatus('Connected ' + (result.from) + ' \u2192 ' + (result.to) + '.');
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
