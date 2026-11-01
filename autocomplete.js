// The pure part of the Autocomplete: the suggestions in the Combo Box's formats with a row's
// own fields kept, and the local filter. No DOM here, so the tests can import it.
import { parseItems } from './widgets.js';

// One value=Text per line, JSON text, or an array of strings or objects. An object keeps its
// other fields beside value and text, so a row from a dataSource comes back whole in onSelect.
export function parseSuggestions(value) {
  if (typeof value === 'string' && value.trim().startsWith('[')) {
    try {
      const parsed = JSON.parse(value.trim());
      if (Array.isArray(parsed)) return parseSuggestions(parsed);
    } catch {
      /* not JSON: lines */
    }
    return parseItems(value);
  }
  if (!Array.isArray(value)) return parseItems(value);
  return value
    .filter((item) => item !== null && item !== undefined)
    .map((item) => {
      const [base] = parseItems([item]);
      return item && typeof item === 'object' ? { ...item, ...base } : base;
    });
}

// The suggestions whose text contains what was typed (case does not matter), at most `max`;
// nothing typed gives the first `max`.
export function filterSuggestions(items, text, max = 8) {
  const needle = String(text || '').trim().toLowerCase();
  const limit = Math.max(0, Number(max) || 0) || items.length;
  const hits = needle ? items.filter((item) => String(item.text).toLowerCase().includes(needle)) : items;
  return hits.slice(0, limit);
}
