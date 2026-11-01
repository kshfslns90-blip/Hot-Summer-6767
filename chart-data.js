// The Chart widget's data and settings, turned into a Chart.js configuration. No DOM here, so
// the tests can import it: labels and series arrive as the Inspector's text (one per line) or as
// arrays from code, and the widget's properties become the Chart.js options.

export const CHART_TYPES = ['bar', 'line', 'area', 'pie', 'doughnut', 'radar', 'polarArea', 'scatter'];

// The default colours, one per series (one per slice for a pie), when `colors` is empty.
export const PALETTE = ['#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16'];

// Charts drawn as slices around a centre: colours go per value, not per series, and there are no axes.
const CIRCULAR = new Set(['pie', 'doughnut', 'polarArea']);

// What the canvas shows for a chart that has no series yet, so the designer shows the shape.
const SAMPLE = {
  labels: ['Q1', 'Q2', 'Q3', 'Q4'],
  series: [
    { label: 'Sales', data: [12, 19, 8, 15] },
    { label: 'Costs', data: [8, 11, 6, 9] }
  ]
};

function lines(text) {
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function jsonArray(text) {
  if (!text.startsWith('[')) return null;
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

// One label per line; a single line is a comma-separated list; an array (or JSON array) as is.
export function parseLabels(value) {
  if (Array.isArray(value)) return value.map((v) => String(v));
  if (typeof value !== 'string' || value.trim() === '') return [];
  const text = value.trim();
  const array = jsonArray(text);
  if (array) return array.map((v) => String(v));
  const rows = lines(text);
  if (rows.length === 1) return rows[0].split(',').map((s) => s.trim()).filter(Boolean);
  return rows;
}

// "12", "3.5", "" (a gap) or "x:y" (a point of a scatter chart).
function parseValue(text) {
  const t = String(text).trim();
  if (t === '') return null;
  const pair = t.split(':');
  if (pair.length === 2) {
    const x = Number(pair[0]);
    const y = Number(pair[1]);
    if (Number.isFinite(x) && Number.isFinite(y)) return { x, y };
  }
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function normalizeDatum(d) {
  if (d === null || d === undefined || d === '') return null;
  if (typeof d === 'object') return d;
  const n = Number(d);
  return Number.isFinite(n) ? n : null;
}

function normalizeSeries(item, index) {
  const fallback = `Series ${index + 1}`;
  if (Array.isArray(item)) return { label: fallback, data: item.map(normalizeDatum) };
  if (item && typeof item === 'object') {
    const out = { label: String(item.label ?? item.name ?? fallback), data: Array.isArray(item.data) ? item.data.map(normalizeDatum) : [] };
    if (item.color) out.color = String(item.color);
    return out;
  }
  return { label: fallback, data: [] };
}

// One series per line as "Name | 1, 2, 3" (a value may be blank for a gap, or x:y for a scatter
// point; a line without "|" is data only), or an array of { label, data, color } objects.
export function parseSeries(value) {
  if (Array.isArray(value)) return value.map(normalizeSeries);
  if (typeof value !== 'string' || value.trim() === '') return [];
  const text = value.trim();
  const array = jsonArray(text);
  if (array) return array.map(normalizeSeries);
  return lines(text).map((line, i) => {
    const sep = line.indexOf('|');
    const label = (sep >= 0 ? line.slice(0, sep) : '').trim();
    const data = (sep >= 0 ? line.slice(sep + 1) : line).split(',').map(parseValue);
    return { label: label || `Series ${i + 1}`, data };
  });
}

// "#3b82f6, red, rgb(0 0 0)" -> the list; an array as is.
export function parseColors(value) {
  if (Array.isArray(value)) return value.map((c) => String(c).trim()).filter(Boolean);
  if (typeof value !== 'string') return [];
  return value.split(',').map((c) => c.trim()).filter(Boolean);
}

function parseOptions(value) {
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string' || value.trim() === '') return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// Deep merge of plain objects; arrays and scalars in `source` replace what is in `target`.
export function merge(target, source) {
  const out = { ...target };
  for (const [key, value] of Object.entries(source || {})) {
    out[key] = isPlain(value) && isPlain(out[key]) ? merge(out[key], value) : value;
  }
  return out;
}

// A translucent version of a #rrggbb colour; anything else is handed back unchanged.
function withAlpha(color, alpha) {
  const m = /^#([0-9a-f]{6})$/i.exec(color);
  if (!m) return color;
  return `#${m[1]}${Math.round(alpha * 255).toString(16).padStart(2, '0')}`;
}

function styleDataset(dataset, chartType, color, palette) {
  const ds = { label: dataset.label, data: dataset.data };
  if (CIRCULAR.has(chartType)) {
    ds.backgroundColor = dataset.data.map((_, i) => palette[i % palette.length]);
    ds.borderColor = '#ffffff';
    ds.borderWidth = 1;
  } else if (chartType === 'line') {
    Object.assign(ds, { borderColor: color, backgroundColor: color, fill: false, tension: 0.3, pointRadius: 3 });
  } else if (chartType === 'area' || chartType === 'radar') {
    Object.assign(ds, { borderColor: color, backgroundColor: withAlpha(color, 0.25), fill: chartType === 'area' ? 'origin' : true, tension: chartType === 'area' ? 0.3 : 0, pointRadius: 3 });
  } else {
    // bar, scatter
    Object.assign(ds, { backgroundColor: color, borderColor: color });
  }
  return ds;
}

// The widget's properties -> { type, data, options } for new Chart(canvas, ...). In design mode
// animation is off and a chart without series shows sample data.
export function buildConfig(props = {}, { design = false } = {}) {
  const chartType = CHART_TYPES.includes(props.chartType) ? props.chartType : 'bar';
  let labels = parseLabels(props.labels);
  let series = parseSeries(props.series);
  if (design && series.length === 0) {
    series = SAMPLE.series;
    if (labels.length === 0) labels = SAMPLE.labels;
  }
  const colors = parseColors(props.colors);
  const palette = colors.length ? colors : PALETTE;
  const datasets = series.map((s, i) => styleDataset(s, chartType, s.color || palette[i % palette.length], palette));

  const legend = ['none', 'top', 'bottom', 'left', 'right'].includes(props.legend) ? props.legend : 'top';
  const title = String(props.title || '');
  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: legend !== 'none', position: legend === 'none' ? 'top' : legend },
      title: { display: title !== '', text: title }
    }
  };
  if (design || props.animate === false) options.animation = false;
  if (!CIRCULAR.has(chartType) && chartType !== 'radar') {
    const stacked = Boolean(props.stacked);
    options.scales = {
      x: { stacked },
      y: { stacked, beginAtZero: props.beginAtZero !== false }
    };
    if (chartType === 'bar' && props.horizontal) options.indexAxis = 'y';
  }

  return {
    type: chartType === 'area' ? 'line' : chartType,
    data: { labels, datasets },
    options: merge(options, parseOptions(props.options))
  };
}
