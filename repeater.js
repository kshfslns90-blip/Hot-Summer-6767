// The pure part of the Repeater: where each item sits and how tall they are together. No DOM
// here, so the tests can import it.

// One rectangle per item, stacked top to bottom with `gap` between them, each the full width.
export function itemRects({ count, width, itemHeight, gap }) {
  const h = Math.max(0, Number(itemHeight) || 0);
  const g = Math.max(0, Number(gap) || 0);
  const w = Math.max(0, Number(width) || 0);
  const rects = [];
  for (let i = 0; i < Math.max(0, Number(count) || 0); i += 1) {
    rects.push({ left: 0, top: i * (h + g), width: w, height: h });
  }
  return rects;
}

// The height the items take together: nothing for no items, no gap after the last one.
export function contentHeight(count, itemHeight, gap) {
  const n = Math.max(0, Number(count) || 0);
  if (n === 0) return 0;
  return n * Math.max(0, Number(itemHeight) || 0) + (n - 1) * Math.max(0, Number(gap) || 0);
}
