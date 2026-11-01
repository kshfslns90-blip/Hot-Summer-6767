// Message boxes and toasts for the code behind: showMessage, showConfirm, showPrompt and
// showToast. They share the modal look of showModal (overlay, frame, title bar) and are plain
// promises, so a handler awaits them like any other call. Each shows an icon picked from its
// tone; `options.icon` names another Lucide icon (or an emoji), and `icon: false` hides it.
import { iconGlyph, TONE_ICONS } from './icons.js';

function el(tag, className, props) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (props) Object.assign(node, props);
  return node;
}

const TONES = Object.keys(TONE_ICONS);

function toneOf(value, fallback) {
  return TONES.includes(value) ? value : fallback;
}

// The icon for a tone unless the options say otherwise; null means none.
function iconFor(options, tone, fallback = TONE_ICONS[tone]) {
  if (options.icon === false || options.icon === null || options.icon === '') return null;
  return iconGlyph(options.icon || fallback, 'gd-dialog-icon');
}

// One dialog: a title, a message with its icon, an optional input, and buttons. Resolves with
// the value of the button pressed; Enter presses the primary button and Escape the cancel one.
function dialog({ title, text, tone, icon, input = null, buttons }) {
  return new Promise((resolve) => {
    const overlay = el('div', 'gd-modal-overlay gd-dialog-overlay');
    const frame = el('div', 'gd-modal-frame gd-dialog');
    frame.dataset.tone = tone;
    const bar = el('div', 'gd-modal-title', { textContent: title });
    const body = el('div', 'gd-dialog-body');
    const message = el('div', 'gd-dialog-message');
    if (icon) {
      icon.dataset.tone = tone;
      message.append(icon);
    }
    message.append(el('div', 'gd-dialog-text', { textContent: text ?? '' }));
    body.append(message);
    let field = null;
    if (input) {
      field = el('input', 'gd-input gd-dialog-input', { type: 'text', value: input.value ?? '', placeholder: input.placeholder || '' });
      body.append(field);
    }
    const row = el('div', 'gd-dialog-buttons');
    const primary = buttons.find((b) => b.primary) || buttons[0];
    const cancel = buttons.find((b) => b.cancel) || null;

    const finish = (button) => {
      overlay.remove();
      document.removeEventListener('keydown', onKey, true);
      resolve(typeof button.value === 'function' ? button.value(field) : button.value);
    };
    const onKey = (e) => {
      if (e.key === 'Enter' && primary) {
        e.preventDefault();
        finish(primary);
      } else if (e.key === 'Escape' && cancel) {
        e.preventDefault();
        finish(cancel);
      }
    };

    for (const button of buttons) {
      const control = el('button', `gd-button${button.primary ? '' : ' gd-dialog-secondary'}`, { type: 'button' });
      control.append(el('span', 'gd-button-text', { textContent: button.label }));
      if (!button.primary) control.dataset.variant = 'default';
      control.addEventListener('click', () => finish(button));
      row.append(control);
    }
    frame.append(bar, body, row);
    overlay.append(frame);
    document.body.append(overlay);
    document.addEventListener('keydown', onKey, true);
    (field || row.querySelector('button')).focus();
    if (field) field.select();
  });
}

// showMessage(text, title, { tone, icon }) - the tone colours the icon: 'info' when omitted.
export function showMessage(text, title, options = {}) {
  const tone = toneOf(options.tone, 'info');
  return dialog({
    title: title || 'Message',
    text,
    tone,
    icon: iconFor(options, tone),
    buttons: [{ label: 'OK', value: undefined, primary: true, cancel: true }]
  });
}

// showConfirm(text, title, { tone, icon }) - a question mark unless told otherwise.
export function showConfirm(text, title, options = {}) {
  const tone = toneOf(options.tone, 'neutral');
  return dialog({
    title: title || 'Confirm',
    text,
    tone,
    icon: iconFor(options, tone, options.tone ? TONE_ICONS[tone] : 'circle-question-mark'),
    buttons: [
      { label: 'OK', value: true, primary: true },
      { label: 'Cancel', value: false, cancel: true }
    ]
  });
}

// showChoice(text, title, { tone, icon, buttons }) - buttons of one's own, [{ label, value,
// primary, cancel }]; resolves with the pressed one's value. For the System pages (a choice
// between more than OK and Cancel); the code behind is not handed it.
export function showChoice(text, title, options = {}) {
  const tone = toneOf(options.tone, 'neutral');
  return dialog({
    title: title || 'Choose',
    text,
    tone,
    icon: iconFor(options, tone, options.tone ? TONE_ICONS[tone] : 'circle-question-mark'),
    buttons: options.buttons
  });
}

// showPrompt(text, defaultValue, title, { tone, icon }) - a pencil unless told otherwise.
export function showPrompt(text, defaultValue, title, options = {}) {
  const tone = toneOf(options.tone, 'neutral');
  return dialog({
    title: title || 'Question',
    text,
    tone,
    icon: iconFor(options, tone, options.tone ? TONE_ICONS[tone] : 'pencil-line'),
    input: { value: defaultValue ?? '' },
    buttons: [
      { label: 'OK', value: (field) => field.value, primary: true },
      { label: 'Cancel', value: null, cancel: true }
    ]
  });
}

// A short notice in the corner; click it to dismiss, or it goes by itself after `duration` ms
// (0 keeps it until clicked). showToast(text, tone, duration, { icon }) or
// showToast(text, { tone, duration, icon }).
export function showToast(text, tone = 'neutral', duration = 3000, options = {}) {
  if (tone && typeof tone === 'object') {
    options = tone;
    tone = options.tone;
    duration = options.duration ?? 3000;
  }
  tone = toneOf(tone, 'neutral');
  let host = document.querySelector('.gd-toasts');
  if (!host) {
    host = el('div', 'gd-toasts');
    document.body.append(host);
  }
  const toast = el('div', 'gd-toast');
  const icon = iconFor(options, tone);
  if (icon) {
    icon.className = 'gd-toast-icon';
    toast.append(icon);
  }
  toast.append(el('span', 'gd-toast-text', { textContent: text ?? '' }));
  toast.dataset.tone = tone;
  toast.setAttribute('role', 'status');
  const remove = () => {
    if (!toast.isConnected) return;
    toast.classList.add('gd-toast-leaving');
    setTimeout(() => toast.remove(), 180);
  };
  toast.addEventListener('click', remove);
  host.append(toast);
  const ms = Number(duration);
  if (ms > 0) setTimeout(remove, ms);
  return toast;
}
