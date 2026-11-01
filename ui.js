// ui: estilo resort tropical y ayudantes que comparten todas las pantallas de HOT SUMMER.

const CSS = `
.hs{font-family:'Segoe UI',system-ui,sans-serif;color:#073B46;max-width:1100px;margin:0 auto;padding:16px;box-sizing:border-box}
.hs *{box-sizing:border-box}
.hs h1,.hs h2,.hs h3{margin:0 0 10px;font-family:Georgia,'Times New Roman',serif;color:#073B46}
.hs-hero{position:relative;border-radius:22px;overflow:hidden;min-height:260px;background:#073B46 center/cover no-repeat;display:flex;align-items:flex-end;margin-bottom:18px;box-shadow:0 10px 30px rgba(7,59,70,.25)}
.hs-hero .in{width:100%;padding:28px;background:linear-gradient(transparent,rgba(7,59,70,.85));color:#FFF0D0}
.hs-hero h1{color:#FFF0D0;font-size:44px;letter-spacing:4px;margin:0}
.hs-hero p{margin:6px 0 0;font-size:17px;color:#F4C46A}
.hs-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:16px}
.hs-card{background:#fff;border-radius:18px;padding:16px;box-shadow:0 4px 16px rgba(7,59,70,.10);margin-bottom:16px;transition:transform .2s,box-shadow .2s}
.hs-card:hover{box-shadow:0 8px 24px rgba(7,59,70,.16)}
.hs-card.item{padding:0;overflow:hidden;display:flex;flex-direction:column}
.hs-card.item img{width:100%;height:160px;object-fit:cover}
.hs-card.item .b{padding:14px;display:flex;flex-direction:column;gap:6px;flex:1}
.hs-btn{border:0;border-radius:999px;padding:9px 18px;font-weight:600;cursor:pointer;background:#12A6A0;color:#fff;transition:background .2s,transform .1s;font-size:14px}
.hs-btn:hover{background:#0e8c87}.hs-btn:active{transform:scale(.97)}
.hs-btn.sand{background:#F4C46A;color:#073B46}.hs-btn.coral{background:#F28B70}.hs-btn.ghost{background:transparent;color:#12A6A0;border:1px solid #12A6A0}
.hs-btn.sm{padding:5px 12px;font-size:12px}.hs-btn[disabled]{opacity:.5;cursor:default}
.hs-price{font-size:20px;font-weight:700;color:#F28B70}
.hs-pill{display:inline-block;border-radius:999px;padding:3px 10px;font-size:12px;font-weight:600;background:#FFF0D0;color:#073B46}
.hs-pill.ok{background:#d4f3ef;color:#0b6e69}.hs-pill.wait{background:#fde9c2;color:#8a5a00}.hs-pill.bad{background:#fde0d8;color:#a1381d}
.hs-av{width:44px;height:44px;border-radius:50%;object-fit:cover;background:#12A6A0;color:#fff;display:inline-flex;align-items:center;justify-content:center;font-weight:700;flex-shrink:0;cursor:pointer}
.hs-av.big{width:110px;height:110px;font-size:40px;border:4px solid #F4C46A}
.hs-row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.hs-muted{color:#5d7d84;font-size:13px}
.hs-in{width:100%;border:1px solid #cfe3e2;border-radius:12px;padding:10px;font:inherit;background:#fffdf7;color:#073B46}
.hs-in:focus{outline:2px solid #12A6A0}
.hs-post img.ph{width:100%;max-height:480px;object-fit:cover;border-radius:14px;margin-top:10px}
.hs-com{background:#FFF0D0;border-radius:12px;padding:8px 10px;margin-top:6px;font-size:14px}
.hs-stats{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px;margin-bottom:16px}
.hs-stat{background:linear-gradient(135deg,#073B46,#12A6A0);color:#FFF0D0;border-radius:16px;padding:14px}
.hs-stat b{display:block;font-size:26px;color:#F4C46A}
.hs-table{width:100%;border-collapse:collapse;font-size:14px}
.hs-table td,.hs-table th{padding:8px;border-bottom:1px solid #eee;text-align:left;vertical-align:top}
.hs-table th{color:#12A6A0;font-size:12px;text-transform:uppercase}
.hs-tabs{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px}
.hs-tabs .hs-btn{background:#fff;color:#073B46}.hs-tabs .hs-btn.on{background:#073B46;color:#F4C46A}
.hs-scroll{overflow-x:auto}
.hs-link{color:#12A6A0;cursor:pointer;font-weight:600}
.hs .plus{color:#0b8a6e;font-weight:700}.hs .minus{color:#d0543a;font-weight:700}
@media (max-width:600px){.hs{padding:10px}.hs-hero h1{font-size:30px}.hs-hero{min-height:200px}}
`;

const PHOTOS = {
  beach: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=1600&q=70',
  pool: 'https://images.unsplash.com/photo-1571896349842-33c89424de2d?w=1600&q=70',
  palms: 'https://images.unsplash.com/photo-1506953823976-52e1fdc0149a?w=1600&q=70',
  resort: 'https://images.unsplash.com/photo-1540541338287-41700207dee6?w=1600&q=70',
  sunset: 'https://images.unsplash.com/photo-1520483601560-389dff434fdf?w=1600&q=70'
};

let S = null;

// ctx: { server, showToast } of the calling form (client scripts do not see those globals).
function setup(panel, actions, ctx) {
  S = ctx;
  if (!document.getElementById('hs-css')) {
    const st = document.createElement('style');
    st.id = 'hs-css';
    st.textContent = CSS;
    document.head.appendChild(st);
  }
  panel.element.addEventListener('click', async function (ev) {
    const el = ev.target.closest('[data-act]');
    if (!el || !panel.element.contains(el)) return;
    const fn = actions[el.getAttribute('data-act')];
    if (!fn) return;
    ev.preventDefault();
    if (el.tagName === 'BUTTON') el.disabled = true;
    try {
      await fn(el.getAttribute('data-id'), el);
    } catch (err) {
      S.showToast(err.message || String(err), 'error', 4000);
    }
    if (el.isConnected && el.tagName === 'BUTTON') el.disabled = false;
  });
}

function render(panel, html) {
  panel.element.innerHTML = '<div class="hs">' + html + '</div>';
}

function esc(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function img(v) {
  if (!v) return '';
  if (/^https:\/\//.test(v)) return v;
  return S.server.fileUrl('hs.media', [v]);
}

function avatar(m, big) {
  const cls = 'hs-av' + (big ? ' big' : '');
  const act = ' data-act="profile" data-id="' + esc(m.member_id || m.id) + '"';
  if (m.avatar) return '<img class="' + cls + '" src="' + esc(img(m.avatar)) + '"' + act + '>';
  return '<span class="' + cls + '"' + act + '>' + esc(String(m.username || '?').charAt(0).toUpperCase()) + '</span>';
}

function when(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('es-MX', { timeZone: 'America/Mexico_City', dateStyle: 'medium', timeStyle: 'short' });
}

function day(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('es-MX', { timeZone: 'America/Mexico_City', dateStyle: 'long' });
}

function sh(n) {
  return Number(n || 0).toLocaleString('es-MX') + ' SH';
}

function signed(n) {
  return '<span class="' + (n >= 0 ? 'plus' : 'minus') + '">' + (n >= 0 ? '+' : '') + sh(n) + '</span>';
}

function pill(status) {
  const tone = { aprobada: 'ok', activa: 'ok', entregada: 'ok', activo: 'ok', pendiente: 'wait', rechazada: 'bad', suspendido: 'bad', vencida: 'bad' }[status] || '';
  return '<span class="hs-pill ' + tone + '">' + esc(status) + '</span>';
}

// Estado real de una compra temporal: vencida cuando pasó su hora de fin.
function purchaseStatus(p) {
  if (p.status === 'activa' && p.expires_at && new Date(p.expires_at) < new Date()) return 'vencida';
  return p.status;
}

// Lee la foto elegida en un <input type="file"> como data URL (o '' si no hay).
function readFile(input) {
  return new Promise(function (resolve, reject) {
    if (!input || !input.files || !input.files[0]) { resolve(''); return; }
    const f = input.files[0];
    if (f.size > 4 * 1024 * 1024) { reject(new Error('La imagen pesa más de 4 MB.')); return; }
    const r = new FileReader();
    r.onload = function () { resolve(r.result); };
    r.onerror = function () { reject(new Error('No se pudo leer la imagen.')); };
    r.readAsDataURL(f);
  });
}

function call(fn, args) {
  return S.server.callFunction('hs.' + fn, args || []);
}

function errorBox(panel, err) {
  render(panel, '<div class="hs-card"><h3>Ups</h3><p>' + esc(err.message || err) + '</p></div>');
}
