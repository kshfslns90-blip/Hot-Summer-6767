// Column definitions for the Data Grid. Like items, they can be typed one per line in the
// property grid or handed over from code as an array; this module has no DOM so the tests can
// import it directly.

const ALIGNS = new Set(['left', 'center', 'right']);

// "field | Title | width | align" per line, a JSON array, or an array of column objects.
export function parseColumns(value) {
  if (Array.isArray(value)) return value.map(normalizeColumn).filter(Boolean);
  if (typeof value !== 'string' || value.trim() === '') return [];
  const trimmed = value.trim();
  if (trimmed.startsWith('[')) {
    try {
      return parseColumns(JSON.parse(trimmed));
    } catch {
      /* fall through to line parsing */
    }
  }
  return trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map(parseLine)
    .filter(Boolean);
}

function parseLine(line) {
  const [field, title, width, align] = line.split('|').map((part) => part.trim());
  return normalizeColumn({ field, title, width, align });
}

function normalizeColumn(column) {
  if (typeof column === 'string') return parseLine(column);
  if (!column || typeof column !== 'object') return null;
  const field = String(column.field ?? column.name ?? '').trim();
  if (!field) return null;
  const out = { field, title: column.title ? String(column.title) : titleOf(field) };
  const width = Number(column.width);
  if (column.width !== undefined && column.width !== '' && Number.isFinite(width) && width > 0) out.width = width;
  if (ALIGNS.has(column.align)) out.align = column.align;
  if (column.editor !== undefined) out.editor = column.editor;
  if (column.sortable !== undefined) out.sortable = Boolean(column.sortable);
  const attributesField = typeof column.attributesField === 'string' ? column.attributesField.trim() : '';
  if (attributesField) out.attributesField = attributesField;
  return out;
}

// "orderDate" -> "Order Date", "unit_price" -> "Unit price".
export function titleOf(field) {
  const spaced = field.replace(/[_-]+/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

// The columns a record suggests: one per field whose value a cell can show (an object or an
// array inside is skipped), titled from the field's name, numbers aligned right. What the
// Inspector's "Build from Data Source" makes of the first record a source returns.
export function columnsFromRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return [];
  const out = [];
  for (const [field, value] of Object.entries(record)) {
    if (value !== null && typeof value === 'object') continue;
    const column = { field, title: titleOf(field) };
    if (typeof value === 'number') column.align = 'right';
    out.push(column);
  }
  return out;
}

// The fields of a record with the kind of value each holds (number, text, yes/no, object, list,
// empty): what the columns picker's field and attributes boxes drop down. Every field counts
// here, an object one too - that is what an attributes field is.
export function fieldsOfRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return [];
  return Object.entries(record).map(([name, value]) => ({ name, kind: kindOf(value) }));
}

function kindOf(value) {
  if (value === null || value === undefined) return 'empty';
  if (Array.isArray(value)) return 'list';
  if (typeof value === 'object') return 'object';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'yes/no';
  return 'text';
}

// The stored text for columns: one "field | Title | width | align" line each, trailing empty
// parts dropped (an empty width before an align stays, as "id | Id | | right"), or a JSON array
// when a column says something the line form cannot (editor, sortable, attributesField).
// parseColumns reads both.
export function serializeColumns(columns) {
  const list = parseColumns(Array.isArray(columns) ? columns : []);
  if (list.length === 0) return '';
  if (list.some((c) => c.editor !== undefined || c.sortable !== undefined || c.attributesField !== undefined)) return JSON.stringify(list);
  return list
    .map((c) => {
      const parts = [c.field, c.title === titleOf(c.field) && c.width === undefined && c.align === undefined ? '' : c.title, c.width === undefined ? '' : String(c.width), c.align || ''];
      while (parts.length > 1 && parts[parts.length - 1] === '') parts.pop();
      return parts.join(' | ').replace(/\|  \|/g, '| |');
    })
    .join('\n');
}

// What Tabulator wants: the grid-level flags fill in whatever a column does not say itself. A
// column with an attributesField gets `attributesFormatter` - the grid's cell formatter, handed
// in by the widget so this module stays free of the DOM - with the field as its parameter;
// without one (the designer's picker) the field goes no further. `frozenLeft` and `frozenRight`
// are how many of the first and of the last columns stay in view while the grid scrolls
// sideways: Tabulator freezes by position (a frozen column before the first unfrozen one pins
// left, after it right), so the counts become the flag on those columns, clamped so the two
// groups never overlap.
export function toTabulatorColumns(columns, { editable = false, sortable = true, attributesFormatter, frozenLeft = 0, frozenRight = 0 } = {}) {
  const left = frozenCount(frozenLeft, columns.length);
  const right = frozenCount(frozenRight, columns.length - left);
  return columns.map((column, index) => {
    const out = { title: column.title, field: column.field, headerSort: column.sortable ?? sortable };
    if (column.width) out.width = column.width;
    if (column.align) out.hozAlign = column.align;
    const editor = column.editor ?? (editable ? true : undefined);
    if (editor === true) out.editor = 'input';
    else if (typeof editor === 'string') out.editor = editor;
    if (index < left || index >= columns.length - right) out.frozen = true;
    if (column.attributesField && attributesFormatter) {
      out.formatter = attributesFormatter;
      out.formatterParams = { attributesField: column.attributesField };
    }
    return out;
  });
}

// A frozen count as a whole number between 0 and `max`; anything that is not a number is 0.
function frozenCount(value, max) {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) ? Math.min(max, Math.max(0, n)) : 0;
}
