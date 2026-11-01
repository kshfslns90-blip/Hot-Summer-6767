// The presentation attributes a Data Grid cell can carry: what a column's attributesField
// points at in each row. The data source decides them (a severity, colours, bold, italic, an
// icon, a tooltip); the grid only draws them. An object and its JSON text both count, anything
// unknown or malformed is dropped, and a value with nothing usable in it comes back as null, so
// "no attributes" and "garbage" look the same to the formatter. No DOM here: the tests import
// this module directly.
import { isIconName } from './icons.js';

export const SEVERITIES = ['info', 'success', 'warning', 'danger'];

// A colour as the attributes may name one: a hex colour, a colour word (red, transparent,
// currentColor) or one of the colour functions with plain numbers inside. Nothing else - no
// var(), url() or expression(), no second declaration behind a semicolon. The browser still has
// the last word when it reads the custom property the colour lands in.
const COLOR_RE = /^(#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})|[a-z]{3,20}|(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\([0-9a-z.%,\s/-]*\))$/i;

export function isSafeColor(value) {
  return typeof value === 'string' && value.length <= 64 && COLOR_RE.test(value.trim());
}

// true, 1, 'true' and '1' switch a flag on: SQL and JSON text hand over numbers and strings,
// and 'false', '0' or 'no' must not read as on.
function flag(value) {
  return value === true || value === 1 || value === 'true' || value === '1';
}

function textOf(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return typeof value === 'string' ? value.trim() : '';
}

// The attributes object behind a cell: the object itself, or its JSON text. null for anything
// else (an array, a number, broken JSON), so the caller has one check to make.
function objectOf(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

// The usable attributes of a value, each checked: { severity, textColor, backgroundColor, bold,
// italic, icon, iconColor, tooltip } with only the keys that passed, or null.
export function parseCellAttrs(value) {
  const raw = objectOf(value);
  if (!raw) return null;
  const out = {};
  const severity = typeof raw.severity === 'string' ? raw.severity.trim().toLowerCase() : '';
  if (SEVERITIES.includes(severity)) out.severity = severity;
  for (const key of ['textColor', 'backgroundColor', 'iconColor']) {
    if (isSafeColor(raw[key])) out[key] = raw[key].trim();
  }
  if (flag(raw.bold)) out.bold = true;
  if (flag(raw.italic)) out.italic = true;
  if (isIconName(raw.icon)) out.icon = raw.icon;
  const tooltip = textOf(raw.tooltip);
  if (tooltip) out.tooltip = tooltip;
  return Object.keys(out).length ? out : null;
}
