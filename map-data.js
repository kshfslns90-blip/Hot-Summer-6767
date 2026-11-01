// The pure part of the Map: a "lat, lng" pair and the markers, from the Inspector's text, JSON
// or the objects code and a dataSource hand over. No DOM here, so the tests can import it.

export const DEFAULT_TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
export const DEFAULT_ATTRIBUTION = '&copy; OpenStreetMap contributors';

function finite(value) {
  if (typeof value === 'string') {
    if (value.trim() === '') return null;
    value = Number(value);
  }
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

// A position: "51.5, -0.12", [51.5, -0.12] or { lat, lng } (also latitude/longitude, lat/lon).
// null when it is not a pair of numbers, or the latitude is off the globe.
export function parseLatLng(value) {
  let lat;
  let lng;
  if (typeof value === 'string') {
    const parts = value.split(/[,;\s]+/).filter(Boolean);
    if (parts.length !== 2) return null;
    lat = finite(parts[0]);
    lng = finite(parts[1]);
  } else if (Array.isArray(value)) {
    if (value.length < 2) return null;
    lat = finite(value[0]);
    lng = finite(value[1]);
  } else if (value && typeof value === 'object') {
    lat = finite(value.lat ?? value.latitude);
    lng = finite(value.lng ?? value.lon ?? value.longitude);
  } else return null;
  if (lat === null || lng === null || lat < -90 || lat > 90) return null;
  return { lat, lng };
}

const text = (value) => (value === null || value === undefined ? '' : String(value));

// One marker: a line "lat, lng | Title | popup text", an array [lat, lng, title, popup] or an
// object { lat, lng, title, popup } (its other fields ride along, so a row from a dataSource
// comes back whole in onMarkerClick). null when it has no position.
function markerFrom(entry) {
  if (typeof entry === 'string') {
    const [position, title, popup] = entry.split('|').map((part) => part.trim());
    const at = parseLatLng(position);
    return at ? { ...at, title: title || '', popup: popup || '' } : null;
  }
  if (Array.isArray(entry)) {
    const at = parseLatLng(entry);
    return at ? { ...at, title: text(entry[2]), popup: text(entry[3]) } : null;
  }
  if (entry && typeof entry === 'object') {
    const at = parseLatLng(entry);
    return at ? { ...entry, ...at, title: text(entry.title), popup: text(entry.popup) } : null;
  }
  return null;
}

// The markers: an array from code or a dataSource, JSON text with an array, or one per line.
export function parseMarkers(value) {
  if (Array.isArray(value)) return value.map(markerFrom).filter(Boolean);
  if (typeof value !== 'string' || value.trim() === '') return [];
  const trimmed = value.trim();
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed.map(markerFrom).filter(Boolean);
    } catch {
      /* fall through to line parsing */
    }
  }
  return trimmed.split(/\r?\n/).map(markerFrom).filter(Boolean);
}
