// Icons for the running application: the Lucide set (lucide.dev/icons, ISC licence), drawn from
// the compressed sprite the server mounts under /vendor/lucide. An icon is an <svg> that
// references one symbol of the sprite, so the browser fetches the sprite once and every icon
// after that is free. The designer has its own small icon table in public/ide/icons.js.
export const LUCIDE_SPRITE = '/vendor/lucide/sprite.svg';

const NS = 'http://www.w3.org/2000/svg';
const XLINK = 'http://www.w3.org/1999/xlink';

// Lucide names are lower-case words joined by dashes: folder, file-text, chevron-right.
export function isIconName(value) {
  return typeof value === 'string' && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(value);
}

// A fresh <svg> for the named icon; styling (size, stroke) comes from the .gd-icon rule.
export function lucideIcon(name, className) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', className ? `gd-icon ${className}` : 'gd-icon');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(NS, 'use');
  use.setAttribute('href', `${LUCIDE_SPRITE}#${name}`);
  use.setAttributeNS(XLINK, 'xlink:href', `${LUCIDE_SPRITE}#${name}`);
  svg.append(use);
  return svg;
}

// An icon value as widgets take it: a Lucide name (drawn from the sprite) or a short glyph such
// as an emoji (shown as text). Returns a holder element, or null when there is nothing to show.
export function iconGlyph(value, className = 'gd-glyph') {
  if (!value) return null;
  const holder = document.createElement('span');
  holder.className = className;
  if (isIconName(value)) holder.append(lucideIcon(value));
  else if (String(value).length <= 3) holder.textContent = value;
  else return null;
  return holder;
}

// The icon a notice or message box shows for a tone when none is given.
export const TONE_ICONS = {
  neutral: 'message-square',
  info: 'info',
  success: 'circle-check',
  warning: 'triangle-alert',
  danger: 'circle-x'
};
