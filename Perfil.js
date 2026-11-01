import { setup, render, esc, avatar, sh, signed, when, day, pill, purchaseStatus, readFile, call, errorBox, PHOTOS } from 'ui';

let memberId = null;
let others = [];

const actions = {
  follow: async function () { await call('toggleFollow', [memberId]); await load(); },
  save: async function () {
    const file = await readFile(view.element.querySelector('#hsAv'));
    await call('updateMyProfile', [view.element.querySelector('#hsBio').value, file]);
    showToast('Perfil actualizado', 'success');
    await load();
  },
  profile: async function (id) { memberId = Number(id); await load(); }
};

async function load() {
  try {
    const p = await call('profile', [memberId]);
    if (!others.length) others = await call('members');
    let mov = '';
    for (const v of p.movements) mov += '<tr><td>' + when(v.created_at) + '</td><td>' + esc(v.reason) + '</td><td>' + signed(v.amount) + '</td></tr>';
    let pur = '';
    for (const x of p.purchases) pur += '<tr><td>' + when(x.created_at) + '</td><td>' + esc(x.item_name) + '</td><td>' + sh(x.price) + '</td><td>' + pill(purchaseStatus(x)) + '</td></tr>';
    let team = '';
    for (const o of others) team += '<div style="text-align:center;width:70px">' + avatar(o) + '<div class="hs-muted" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(o.username) + '</div></div>';
    render(view,
      '<div class="hs-hero" style="min-height:150px;background-image:url(' + PHOTOS.beach + ')"><div class="in"></div></div>' +
      '<div class="hs-card"><div class="hs-row" style="align-items:flex-start">' + avatar(p, true) + '<div style="flex:1;min-width:200px"><h2>' + esc(p.username) + '</h2>' +
      '<div class="hs-row"><span class="hs-pill">ID #' + p.id + '</span><span class="hs-pill ok">' + esc(p.team_role) + '</span>' + pill(p.status) + '</div>' +
      '<p class="hs-muted">En el resort desde el ' + day(p.joined_at) + ' · ' + p.followers + ' seguidores · ' + p.following + ' siguiendo · ' + p.posts + ' publicaciones</p>' +
      '<p>' + esc(p.bio) + '</p>' + (p.isMe ? '' : '<button class="hs-btn ' + (p.iFollow ? 'ghost' : 'coral') + '" data-act="follow">' + (p.iFollow ? 'Dejar de seguir' : 'Seguir') + '</button>') + '</div></div></div>' +
      '<div class="hs-stats"><div class="hs-stat">Saldo<b>' + sh(p.balance) + '</b></div><div class="hs-stat">Misiones completadas<b>' + p.missions_done + '</b></div><div class="hs-stat">Shells ganados<b>' + sh(p.earned) + '</b></div><div class="hs-stat">Shells gastados<b>' + sh(p.spent) + '</b></div></div>' +
      (p.isMe ? '<div class="hs-card"><h3>Editar mi perfil</h3><p class="hs-muted">Puedes cambiar tu foto y tu biografía. El nombre, el rol y el saldo los gestiona la administración.</p>' +
        '<textarea id="hsBio" class="hs-in" rows="2" placeholder="Tu biografía">' + esc(p.bio) + '</textarea><div class="hs-row" style="margin-top:8px">Foto de perfil: <input id="hsAv" type="file" accept="image/*"><button class="hs-btn" data-act="save">Guardar</button></div></div>' : '') +
      '<div class="hs-card"><h3>Historial de compras</h3><div class="hs-scroll"><table class="hs-table"><tr><th>Fecha</th><th>Artículo</th><th>Precio</th><th>Estado</th></tr>' + (pur || '<tr><td colspan="4" class="hs-muted">Sin compras.</td></tr>') + '</table></div></div>' +
      '<div class="hs-card"><h3>Movimientos</h3><div class="hs-scroll"><table class="hs-table"><tr><th>Fecha</th><th>Motivo</th><th>Cantidad</th></tr>' + (mov || '<tr><td colspan="3" class="hs-muted">Sin movimientos.</td></tr>') + '</table></div></div>' +
      '<div class="hs-card"><h3>Integrantes del Team</h3><div class="hs-row" style="align-items:flex-start">' + team + '</div></div>');
    view.element.scrollTop = 0;
  } catch (err) {
    errorBox(view, err);
  }
}

async function Form_OnLoad(sender, e) {
  memberId = e.args && e.args.memberId ? e.args.memberId : null;
  setup(view, actions, { server: server, showToast: showToast });
  await load();
}
