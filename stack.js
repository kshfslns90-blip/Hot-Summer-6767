// The maths behind Row and Column: children stacked along one axis in child order. Pure, so
// the designer, the runtime and the tests all share one definition of where things go.
//
// axis     'x' (Row) or 'y' (Column)
// size     { w, h } of the content box
// children [{ main, cross, grow, visible }] - main/cross are the child's own sizes on each axis
// Returns one { left, top, width, height } per child (hidden children get a zero rect).

export const STACK_ALIGN = ['stretch', 'start', 'center', 'end'];
export const STACK_JUSTIFY = ['start', 'center', 'end', 'spaceBetween'];

// The main-axis size the children need as they are: the padding on both ends, the visible
// children's own sizes, one gap between each pair. What a Column in content mode is tall.
export function stackContentSize({ children, gap = 0, padding = 0 }) {
  const shown = children.filter((c) => c.visible !== false);
  const own = shown.reduce((sum, c) => sum + Math.max(0, Number(c.main) || 0), 0);
  return padding * 2 + own + Math.max(0, shown.length - 1) * gap;
}

export function stackLayout({ axis, size, children, gap = 0, padding = 0, align = 'stretch', justify = 'start' }) {
  const mainTotal = axis === 'x' ? size.w : size.h;
  const crossTotal = axis === 'x' ? size.h : size.w;
  const inner = Math.max(0, mainTotal - padding * 2);
  const crossInner = Math.max(0, crossTotal - padding * 2);

  const shown = children.filter((c) => c.visible !== false);
  const gaps = Math.max(0, shown.length - 1) * gap;
  const own = shown.reduce((sum, c) => sum + Math.max(0, Number(c.main) || 0), 0);
  const growTotal = shown.reduce((sum, c) => sum + Math.max(0, Number(c.grow) || 0), 0);
  let leftover = inner - gaps - own;

  // Growers share a positive leftover in proportion; a negative one is simply overflow.
  const mains = shown.map((c) => {
    const base = Math.max(0, Number(c.main) || 0);
    const grow = Math.max(0, Number(c.grow) || 0);
    return growTotal > 0 && leftover > 0 && grow > 0 ? base + (leftover * grow) / growTotal : base;
  });
  if (growTotal > 0 && leftover > 0) leftover = 0;

  // With nothing growing, justify decides where the leftover goes.
  let cursor = padding;
  let between = gap;
  if (leftover > 0) {
    if (justify === 'center') cursor += leftover / 2;
    else if (justify === 'end') cursor += leftover;
    else if (justify === 'spaceBetween' && shown.length > 1) between += leftover / (shown.length - 1);
  }

  const rects = new Map();
  shown.forEach((child, i) => {
    const main = mains[i];
    const ownCross = Math.max(0, Number(child.cross) || 0);
    const cross = align === 'stretch' ? crossInner : Math.min(ownCross, crossInner);
    let crossStart = padding;
    if (align === 'center') crossStart += (crossInner - cross) / 2;
    else if (align === 'end') crossStart += crossInner - cross;

    rects.set(
      child,
      axis === 'x'
        ? { left: cursor, top: crossStart, width: main, height: cross }
        : { left: crossStart, top: cursor, width: cross, height: main }
    );
    cursor += main + between;
  });

  return children.map((child) => {
    const rect = rects.get(child) || { left: 0, top: 0, width: 0, height: 0 };
    return {
      left: Math.round(rect.left),
      top: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height)
    };
  });
}
