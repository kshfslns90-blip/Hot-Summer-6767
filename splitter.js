// The maths behind a Splitter: which sibling it resizes and by how much. Pure functions shared
// by the runtime widget and the designer's drag, and unit-tested without a DOM.

export const SPLITTER_DOCKS = ['left', 'right', 'top', 'bottom'];

// A splitter resizes the nearest earlier sibling docked to the same side - the pane it sits
// against in dock order. Nothing precedes it: nothing to resize.
export function splitterTarget(parentNode, node) {
  const children = (parentNode && parentNode.children) || [];
  const at = children.indexOf(node);
  for (let i = at - 1; i >= 0; i -= 1) {
    const sibling = children[i];
    if ((sibling.dock || 'none') === node.dock && sibling.type !== 'splitter') return sibling;
  }
  return null;
}

export function splitAxis(dock) {
  return dock === 'top' || dock === 'bottom' ? 'y' : 'x';
}

// The target's new size for a pointer movement of `delta` pixels along the axis (positive =
// right/down). A left- or top-docked pane grows with the pointer, a right- or bottom-docked pane
// grows against it. The result is clamped so neither the pane nor what remains for the fill
// area drops below minSize.
export function splitSize(node, target, startSize, delta, containerSize, minSize = 40) {
  const axis = splitAxis(node.dock);
  const thickness = axis === 'x' ? Number(node.width) || 0 : Number(node.height) || 0;
  const grows = node.dock === 'left' || node.dock === 'top' ? delta : -delta;
  const upper = Math.max(minSize, containerSize - thickness - minSize);
  return Math.round(Math.min(upper, Math.max(minSize, startSize + grows)));
}
