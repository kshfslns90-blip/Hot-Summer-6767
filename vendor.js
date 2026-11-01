// Third-party libraries loaded on demand. Only a widget that needs one asks for it, so a form
// without a Data Grid never fetches Tabulator; the server mounts the package under /vendor.
// The ES module builds are used rather than the UMD ones: the IDE page carries Monaco's AMD
// loader, which a UMD bundle would register with instead of defining a global.
const pending = new Map();

function loadStyle(href) {
  if (document.querySelector(`link[href="${href}"]`)) return;
  document.head.append(Object.assign(document.createElement('link'), { rel: 'stylesheet', href }));
}

function once(name, load) {
  if (!pending.has(name)) {
    pending.set(name, load().catch((err) => {
      pending.delete(name);
      throw err;
    }));
  }
  return pending.get(name);
}

// Resolves with the Chart.js constructor, every controller, scale and element registered. Its
// module imports "@kurkle/color" by name; the pages carry an import map that points it at
// /vendor/kurkle-color.
export function loadChartJs() {
  return once('chartjs', async () => {
    const mod = await import('/vendor/chartjs/chart.js');
    const { Chart, registerables } = mod;
    if (!Chart) throw new Error('Chart.js did not load');
    Chart.register(...(registerables || []));
    return Chart;
  });
}

// Resolves with the Leaflet namespace (the ES module build). The default marker images sit
// beside the stylesheet, which the library would work out from the CSS; said outright here so
// a marker made before the stylesheet has landed finds them too.
export function loadLeaflet() {
  return once('leaflet', async () => {
    loadStyle('/vendor/leaflet/leaflet.css');
    const mod = await import('/vendor/leaflet/leaflet-src.esm.js');
    const L = mod.default && mod.default.map ? mod.default : mod;
    if (!L || typeof L.map !== 'function') throw new Error('Leaflet did not load');
    L.Icon.Default.imagePath = '/vendor/leaflet/images/';
    return L;
  });
}

// Resolves with the Tabulator constructor (the full build, all modules included).
export function loadTabulator() {
  return once('tabulator', async () => {
    loadStyle('/vendor/tabulator/css/tabulator_simple.min.css');
    const mod = await import('/vendor/tabulator/js/tabulator_esm.min.mjs');
    const Tabulator = mod.TabulatorFull || mod.Tabulator || mod.default;
    if (!Tabulator) throw new Error('Tabulator did not load');
    return Tabulator;
  });
}
