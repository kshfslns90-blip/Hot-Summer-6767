// What the two pages that manage secrets - the designer's Secrets panel and the app's Secrets
// page - say alike: a secret's state in words, the summary line, the note about the project's
// key when values can't be opened, the question a reset asks, and the whitespace check.
//
// A secret's value is stored exactly as typed or pasted - line breaks and surrounding spaces
// included, as a multi-line private key needs them. Whitespace at either end is usually a slip,
// so a page asks before saving a value that has it: what was found, in words, and whether to
// remove it.

export const STATE_TEXT = { configured: 'Configured', 'not-configured': 'Not configured', unavailable: 'Unavailable' };

export const REASON_TEXT = {
  'key-missing': 'The key that encrypted it is missing',
  'key-invalid': 'The key file is damaged',
  'key-mismatch': 'It was encrypted with a different key',
  undecryptable: "The stored value can't be decrypted"
};

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// "3 secrets · 1 not configured · 2 unavailable"
export function summaryOf(secrets) {
  const missing = secrets.filter((s) => s.state === 'not-configured').length;
  const bad = secrets.filter((s) => s.state === 'unavailable').length;
  return [plural(secrets.length, 'secret'), missing ? `${missing} not configured` : '', bad ? `${bad} unavailable` : ''].filter(Boolean).join(' · ');
}

// What the key's state asks of the person, or null: the note's text, the reset it offers
// ('partial' | 'start-over' | 'set-aside') and the count that reset is to clear. `where` names
// the key file the way the page's reader knows it.
export function keyNotice(listing, where = 'secrets.key') {
  const { key, secrets } = listing;
  const n = key.unreadable;
  const values = plural(n, 'stored value');
  if (key.state === 'missing') {
    return { mode: 'start-over', count: n, text: `The encryption key is missing - ${values} can't be read. Restore ${where} from a backup, or reset them and set them again.` };
  }
  if (key.state === 'invalid' && n) {
    return { mode: 'start-over', count: n, text: `The encryption key file is damaged - ${values} can't be read. Restore ${where} from a backup, or reset them and set them again.` };
  }
  if (key.state === 'invalid') {
    return { mode: 'set-aside', count: 0, text: 'The encryption key file is damaged. No stored values depend on it: set it aside, and the next value saved makes a new key.' };
  }
  if (key.state === 'ok' && n) {
    const mismatched = secrets.filter((s) => s.reason === 'key-mismatch').length;
    const lead = mismatched === n ? `${plural(n, 'value')} ${n === 1 ? 'was' : 'were'} encrypted with a different key.` : `${plural(n, 'value')} can't be read.`;
    const them = n === 1 ? 'it' : 'them';
    return { mode: 'partial', count: n, text: `${lead} If the right ${where} is in a backup, restore it; otherwise reset ${them} and set ${them} again.` };
  }
  return null;
}

// The button that offers a reset, by the notice's mode.
export function resetLabel(notice) {
  return notice.mode === 'set-aside' ? 'Set the damaged key aside' : 'Reset unreadable values';
}

// The confirmation a reset asks: its title, its words and the label of the button that does it.
export function resetQuestion(notice, listing) {
  const kept = listing.secrets.filter((s) => s.state === 'configured').length;
  if (notice.mode === 'set-aside') {
    return { title: 'Set the damaged key aside', text: 'Set the damaged key file aside? No stored value depends on it. It is renamed, not deleted, and the next value saved makes a new key.', button: 'Set it aside' };
  }
  if (notice.mode === 'partial') {
    const others = kept ? ` The other ${kept} stay${kept === 1 ? 's' : ''} as ${kept === 1 ? 'it is' : 'they are'}.` : '';
    return {
      title: 'Reset unreadable values',
      text: `Clear the ${plural(notice.count, 'value')} that can't be read?${others} If the right key file is in a backup, restore it instead. This cannot be undone.`,
      button: `Clear ${plural(notice.count, 'value')}`
    };
  }
  return {
    title: 'Start over with a new key',
    text: `Discard all ${plural(notice.count, 'stored value')} and start over with a new key? If you have a backup of secrets.key, restore it instead: the values come back with it. A damaged key file is kept aside. This cannot be undone.`,
    button: `Discard all ${plural(notice.count, 'value')}`
  };
}

// What a finished reset says.
export function resetDone(done) {
  if (done.cleared) return `${plural(done.cleared, 'value')} cleared${done.keySetAside ? `; the damaged key file is kept as ${done.keySetAside}` : ''}`;
  return done.keySetAside ? `The damaged key file is kept as ${done.keySetAside}` : 'Nothing to clear';
}

function counted(text, pattern, one, many) {
  const n = (text.match(pattern) || []).length;
  if (!n) return null;
  return n === 1 ? one : `${n} ${many}`;
}

function kindOf(whitespace) {
  const parts = [
    counted(whitespace, /\n/g, 'a line break', 'line breaks'),
    counted(whitespace, / /g, 'a space', 'spaces'),
    counted(whitespace, /\t/g, 'a tab', 'tabs')
  ].filter(Boolean);
  return parts.length ? parts.join(' and ') : 'blank characters';
}

// "The value ends with a line break." / "The value starts with 2 spaces and ends with a tab.",
// or null when neither end has whitespace.
export function edgeWhitespace(value) {
  const text = String(value ?? '');
  const lead = (/^\s+/.exec(text) || [''])[0];
  const trail = lead.length === text.length ? '' : (/\s+$/.exec(text) || [''])[0];
  if (!lead && !trail) return null;
  const said = [];
  if (lead) said.push(`starts with ${kindOf(lead)}`);
  if (trail) said.push(`ends with ${kindOf(trail)}`);
  return `The value ${said.join(' and ')}.`;
}

export const WHITESPACE_HINT = 'Keys and tokens rarely have that - but a private key may need it.';
