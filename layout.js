// Absolute positioning with WinForms style docking and anchoring.
// The same code lays out the live application and the designer canvas, so what you draw is
// exactly what you run.

export const DOCK_VALUES = ['none', 'top', 'bottom', 'left', 'right', 'fill'];
export const ANCHOR_VALUES = ['left', 'top', 'right', 'bottom'];

function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

// The height a node takes on screen. A widget that folds (an expandable Group Box) sets __renderHeight
// while keeping its stored height, so opening it again restores the designed size.
export function heightOf(node) {
  return node.__renderHeight !== undefined ? node.__renderHeight : node.height;
}

// Whether a node takes part in the layout. `visible` is a run-time property: on the design
// canvas (the builder marks its nodes) every control shows and takes its place, so it can be
// found and edited whatever the running app will do with it.
export function shown(node) {
  return Boolean(node.__designing) || !(node.props && node.props.visible === false);
}

export function place(el, rect) {
  el.style.left = `${Math.round(rect.left)}px`;
  el.style.top = `${Math.round(rect.top)}px`;
  el.style.width = `${Math.max(0, Math.round(rect.width))}px`;
  el.style.height = `${Math.max(0, Math.round(rect.height))}px`;
}

// The width a window's box (a modal's frame, a popup) gets so the page inside keeps the form's
// designed width while the body shows a vertical scrollbar: the design, the box's own border
// (boxes are border-box) and the gutter the scrollbar takes - 0 with overlay scrollbars, ~17 px
// with classic ones. Null when `current` (the width requested last time, not the rendered one:
// a CSS max-width may cap that) already is it, so an observer that re-applies the rule settles
// after one write, on a capped screen too. The gutter is the body's offsetWidth - clientWidth,
// right while the body has no border of its own.
export function windowBoxWidth({ designed, border = 0, gutter = 0, current = null }) {
  const width = Math.round(Math.max(0, Number(designed) || 0) + Math.max(0, Number(border) || 0) + Math.max(0, Number(gutter) || 0));
  return current === width ? null : width;
}

// The size the container had while it was being designed. Everything else is a delta from it.
// A design size recorded with the container's chrome of that moment (`inset`: a Tab Control's
// header strip) keeps the container's outer size: should the chrome change since - code switching
// the header style at run time - the inside grows or shrinks by the difference, so a control
// anchored to the bottom keeps the place it was designed at.
export function designSize(node, contentEl, inset) {
  const frozen = node.__design;
  if (frozen) {
    if (!frozen.inset) return frozen;
    return { w: Math.max(1, frozen.w + frozen.inset.x - inset.x), h: Math.max(1, frozen.h + frozen.inset.y - inset.y) };
  }
  return {
    w: Math.max(1, num(node.width, contentEl.clientWidth + inset.x) - inset.x),
    h: Math.max(1, num(node.height, contentEl.clientHeight + inset.y) - inset.y)
  };
}

export function layoutChildren(node, contentEl, inset = { x: 0, y: 0 }) {
  const children = node.children || [];
  if (children.length === 0) return;

  const cw = contentEl.clientWidth;
  const ch = contentEl.clientHeight;
  const design = designSize(node, contentEl, inset);
  const dx = cw - design.w;
  const dy = ch - design.h;

  // Pass one: docked children eat the edges of the remaining rectangle, in child order.
  let left = 0;
  let top = 0;
  let right = cw;
  let bottom = ch;

  for (const child of children) {
    const el = child.__el;
    const dock = child.dock || 'none';
    if (!el || dock === 'none') continue;
    if (!shown(child)) continue;

    let rect;
    if (dock === 'top') {
      const h = Math.min(num(heightOf(child), 0), bottom - top);
      rect = { left, top, width: right - left, height: h };
      top += h;
    } else if (dock === 'bottom') {
      const h = Math.min(num(heightOf(child), 0), bottom - top);
      rect = { left, top: bottom - h, width: right - left, height: h };
      bottom -= h;
    } else if (dock === 'left') {
      const w = Math.min(num(child.width, 0), right - left);
      rect = { left, top, width: w, height: bottom - top };
      left += w;
    } else if (dock === 'right') {
      const w = Math.min(num(child.width, 0), right - left);
      rect = { left: right - w, top, width: w, height: bottom - top };
      right -= w;
    } else {
      rect = { left, top, width: right - left, height: bottom - top };
      left = right;
      top = bottom;
    }
    place(el, rect);
  }

  // Pass two: anchored children work against the full client rectangle, as in WinForms.
  for (const child of children) {
    const el = child.__el;
    if (!el || (child.dock || 'none') !== 'none') continue;

    const anchor = new Set(Array.isArray(child.anchor) ? child.anchor : ['left', 'top']);
    let x = num(child.left, 0);
    let w = num(child.width, 0);
    let y = num(child.top, 0);
    let h = num(heightOf(child), 0);

    if (anchor.has('left') && anchor.has('right')) w += dx;
    else if (anchor.has('right')) x += dx;
    else if (!anchor.has('left')) x += Math.round(dx / 2);

    if (anchor.has('top') && anchor.has('bottom')) h += dy;
    else if (anchor.has('bottom')) y += dy;
    else if (!anchor.has('top')) y += Math.round(dy / 2);

    place(el, { left: x, top: y, width: w, height: h });
  }
}
