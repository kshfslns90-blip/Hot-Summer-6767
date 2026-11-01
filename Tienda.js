import { setup, render, esc, img, sh, when, pill, purchaseStatus, call, errorBox, PHOTOS } from 'ui';

let data = null;

const actions = {
  buy: async function (id) {
    const it = data.items.filter(function (x) { return String(x.id) === id; })[0];
    if (data.me.balance < it.price) {
      showMessage('Necesitas ' + sh(it.price) + ' y tienes ' + sh(data.me.balance) + '. ¡Completa misiones para ganar más!', 'Shells insuficientes');
      return;
    }
    let note = '';
    if (it.needs_review) {
      note = await showPrompt('Describe tu solicitud para la administración (opcional):', '', it.name);
      if (note === null) return;
    } else if (!(await showConfirm('¿Comprar "' + it.name + '" por ' + sh(it.price) + '?', 'Confirmar compra'))) {
      return;
    }
    // Una clave por compra: si el clic se repite, el servidor no cobra dos veces.
    const key = Date.now().toString(36) + Math.random().toString(36).slice(2);
    const r = await call('buy', [it.id, key, note]);
    showToast(r.status === 'pendiente' ? 'Solicitud enviada: queda pendiente de aprobación.' : '¡Compra realizada!', 'success');
    await load();
  }
};

async function load() {
  try {
    data = await call('shop');
    let cards = '';
    for (const it of data.items) {
      cards += '<div class="hs-card item">' + (it.image ? '<img src="' + esc(img(it.image)) + '" alt="">' : '') +
        '<div class="b"><h3>' + esc(it.name) + '</h3><div class="hs-muted">' + esc(it.description) + '</div>' +
        '<div class="hs-row"><span class="hs-pill">⏳ ' + esc(it.duration_label) + '</span>' + (it.needs_review ? '<span class="hs-pill wait">Requiere aprobación</span>' : '') + '</div>' +
        '<div class="hs-row" style="justify-content:space-between;margin-top:auto"><span class="hs-price">' + sh(it.price) + '</span>' +
        '<button class="hs-btn coral" data-act="buy" data-id="' + it.id + '">Comprar</button></div></div></div>';
    }
    let rows = '';
    for (const p of data.purchases) {
      rows += '<tr><td>' + when(p.created_at) + '</td><td>' + esc(p.item_name) + (p.note ? '<div class="hs-muted">' + esc(p.note) + '</div>' : '') + '</td><td>' + sh(p.price) + '</td><td>' + pill(purchaseStatus(p)) +
        (p.expires_at ? '<div class="hs-muted">Vence: ' + when(p.expires_at) + '</div>' : '') + (p.admin_note ? '<div class="hs-muted">' + esc(p.admin_note) + '</div>' : '') + '</td></tr>';
    }
    render(view,
      '<div class="hs-hero" style="min-height:170px;background-image:url(' + PHOTOS.resort + ')"><div class="in"><h1>Tienda</h1><p>Boutique del resort · Tu saldo: ' + sh(data.me.balance) + '</p></div></div>' +
      '<div class="hs-grid">' + (cards || '<p class="hs-muted">No hay artículos disponibles.</p>') + '</div>' +
      '<div class="hs-card"><h3>Mis compras</h3><div class="hs-scroll"><table class="hs-table"><tr><th>Fecha</th><th>Artículo</th><th>Precio</th><th>Estado</th></tr>' +
      (rows || '<tr><td colspan="4" class="hs-muted">Aún no has comprado nada.</td></tr>') + '</table></div></div>');
  } catch (err) {
    errorBox(view, err);
  }
}

async function Form_OnLoad(sender, e) {
  setup(view, actions, { server: server, showToast: showToast });
  await load();
}
