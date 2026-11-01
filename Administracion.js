import { setup, render, esc, img, sh, signed, when, pill, purchaseStatus, call, errorBox } from 'ui';

let tab = 'stats';
let d = null;
const TABS = { stats: 'Estadísticas', users: 'Usuarios', shells: 'Shells', missions: 'Misiones', shop: 'Tienda', community: 'Comunidad' };

function find(list, id) { return list.filter(function (x) { return String(x.id) === String(id); })[0]; }
function table(head, rows) {
  return '<div class="hs-scroll"><table class="hs-table"><tr><th>' + head.join('</th><th>') + '</th></tr>' + (rows || '<tr><td class="hs-muted" colspan="' + head.length + '">Nada por aquí.</td></tr>') + '</table></div>';
}
function btn(act, id, text, cls) { return '<button class="hs-btn sm ' + (cls || '') + '" data-act="' + act + '" data-id="' + id + '">' + text + '</button> '; }
async function ask(text, value) {
  const v = await showPrompt(text, value == null ? '' : String(value), 'Administración');
  if (v === null) throw new Error('Cancelado');
  return v;
}
async function run(fn, args, msg) { await call(fn, args); showToast(msg || 'Guardado', 'success'); await load(); }

const actions = {
  unlock: async function () { await call('adminUnlock', [view.element.querySelector('#hsPw').value]); await load(); },
  lock: async function () { await call('adminLock'); await load(); },
  chpw: async function () { await run('adminChangePassword', [await ask('Contraseña actual:'), await ask('Nueva contraseña (mínimo 6 caracteres):')], 'Contraseña cambiada'); },
  tab: async function (t) { tab = t; await load(); },
  detail: async function (id) {
    const x = await call('adminMemberDetail', [Number(id)]);
    let h = '';
    for (const v of x.movements) h += when(v.created_at) + ' · ' + (v.amount > 0 ? '+' : '') + v.amount + ' SH · ' + v.reason + '\n';
    showMessage(x.member.username + ' — saldo ' + sh(x.member.balance) + ', ganados ' + sh(x.member.earned) + ', gastados ' + sh(x.member.spent) +
      ', misiones ' + x.member.missions_done + ', compras ' + x.purchases.length + '\n\n' + (h || 'Sin movimientos.'), 'Historial');
  },
  editm: async function (id) {
    const m = find(d.members, id);
    await run('adminUpdateMember', [m.id, await ask('Nombre de usuario:', m.username), await ask('Rol en el Team:', m.team_role), await ask('Biografía:', m.bio)]);
  },
  status: async function (id) {
    const m = find(d.members, id);
    const next = m.status === 'activo' ? 'suspendido' : 'activo';
    if (!(await showConfirm('¿Cambiar a "' + next + '" la cuenta de ' + m.username + '?', 'Acceso'))) return;
    await run('adminSetStatus', [m.id, next]);
  },
  delm: async function (id) {
    const m = find(d.members, id);
    if (!(await showConfirm('¿Eliminar para siempre la cuenta de ' + m.username + ' y todo su contenido?', 'Eliminar cuenta'))) return;
    await run('adminDeleteMember', [m.id], 'Cuenta eliminada');
  },
  adjust: async function () {
    const q = function (s) { return view.element.querySelector(s).value; };
    await run('adminAdjust', [Number(q('#hsMem')), Number(q('#hsAmt')), q('#hsWhy')], 'Ajuste registrado');
  },
  setbal: async function (id) {
    const m = find(d.members, id);
    await run('adminSetBalance', [m.id, Number(await ask('Saldo correcto de ' + m.username + ':', m.balance)), await ask('Motivo de la corrección:')]);
  },
  okc: async function (id) { await run('adminReviewClaim', [Number(id), true, ''], 'Aprobada y acreditada'); },
  noc: async function (id) { await run('adminReviewClaim', [Number(id), false, await ask('Motivo del rechazo:')], 'Rechazada'); },
  editmi: async function (id) {
    const m = id ? find(d.missions, id) : { name: '', description: '', reward: 100, kind: 'evidence', active: 1, sort: 99 };
    await run('adminSaveMission', [{ id: m.id, name: await ask('Nombre de la misión:', m.name), description: await ask('Descripción:', m.description),
      reward: Number(await ask('Recompensa (SH):', m.reward)), kind: await ask('Tipo: auto (al instante), verify (verificación) o evidence (comprobante):', m.kind), active: m.active, sort: m.sort }]);
  },
  togmi: async function (id) { const m = find(d.missions, id); m.active = m.active ? 0 : 1; await run('adminSaveMission', [m]); },
  editit: async function (id) {
    const it = id ? find(d.items, id) : { name: '', description: '', image: '', price: 100, duration_label: 'Permanente', duration_hours: 0, needs_review: 0, active: 1, sort: 99 };
    const box = view.element.querySelector('#hsItemImg');
    const file = box && box.files[0] ? await new Promise(function (ok) { const r = new FileReader(); r.onload = function () { ok(r.result); }; r.readAsDataURL(box.files[0]); }) : '';
    await run('adminSaveItem', [{ id: it.id, name: await ask('Nombre del artículo:', it.name), description: await ask('Descripción:', it.description),
      image: file ? it.image : await ask('Imagen (dirección https; o elige una foto arriba antes de editar):', it.image), price: Number(await ask('Precio (SH):', it.price)),
      duration_label: await ask('Duración (texto):', it.duration_label), duration_hours: Number(await ask('Horas de vigencia (0 = sin vencimiento):', it.duration_hours)),
      needs_review: (await ask('¿Requiere aprobación? (si/no)', it.needs_review ? 'si' : 'no')).toLowerCase().indexOf('s') === 0, active: it.active, sort: it.sort }, file]);
  },
  togit: async function (id) { const it = find(d.items, id); it.active = it.active ? 0 : 1; await run('adminSaveItem', [it, '']); },
  delit: async function (id) { if (await showConfirm('¿Eliminar este artículo?', 'Tienda')) await run('adminDeleteItem', [Number(id)], 'Eliminado'); },
  okp: async function (id) { await run('adminReviewPurchase', [Number(id), true, ''], 'Solicitud aprobada'); },
  nop: async function (id) { await run('adminReviewPurchase', [Number(id), false, await ask('Motivo del rechazo (se reembolsan los Shells):')], 'Rechazada y reembolsada'); },
  rrem: async function (id) { await run('adminResolveReport', [Number(id), 'remove'], 'Contenido eliminado'); },
  rdis: async function (id) { await run('adminResolveReport', [Number(id), 'dismiss'], 'Reporte descartado'); },
  hide: async function (id) { const p = find(d.posts, id); await run('adminHidePost', [p.id, !p.hidden]); },
  delp: async function (id) { if (await showConfirm('¿Eliminar la publicación?', 'Moderación')) await run('deletePost', [Number(id)], 'Eliminada'); },
  delc: async function (id) { if (await showConfirm('¿Eliminar el comentario?', 'Moderación')) await run('deleteComment', [Number(id)], 'Eliminado'); }
};

function section() {
  let r = '';
  if (tab === 'stats') {
    const s = d.stats;
    for (const a of d.recent) r += '<tr><td>' + when(a.created_at) + '</td><td>' + esc(a.type) + '</td><td>' + esc(a.username) + '</td><td>' + esc(a.text) + (a.amount != null ? ' ' + signed(a.amount) : '') + '</td></tr>';
    return '<div class="hs-stats"><div class="hs-stat">Usuarios registrados<b>' + s.registered + '</b></div><div class="hs-stat">Activos (7 días)<b>' + s.active7 + '</b></div>' +
      '<div class="hs-stat">Shells en circulación<b>' + sh(s.circulating) + '</b></div><div class="hs-stat">Compras<b>' + s.purchases + '</b></div><div class="hs-stat">Misiones completadas<b>' + s.missions + '</b></div>' +
      '<div class="hs-stat">Publicaciones<b>' + s.posts + '</b></div><div class="hs-stat">Comentarios<b>' + s.comments + '</b></div>' +
      '<div class="hs-stat">Pendientes<b>' + (s.pendingClaims + s.pendingPurchases + s.pendingReports) + '</b>' + s.pendingClaims + ' entregas · ' + s.pendingPurchases + ' solicitudes · ' + s.pendingReports + ' reportes</div></div>' +
      '<div class="hs-card"><h3>Actividad reciente</h3>' + table(['Fecha', 'Tipo', 'Integrante', 'Detalle'], r) + '</div>';
  }
  if (tab === 'users') {
    for (const m of d.members) r += '<tr><td>#' + m.id + '</td><td><b>' + esc(m.username) + '</b><div class="hs-muted">' + esc(m.email) + '</div></td><td>' + esc(m.team_role) + '</td><td>' + sh(m.balance) + '</td><td>' + m.missions_done + '</td><td>' + pill(m.status) + '</td><td>' +
      btn('detail', m.id, 'Historial', 'ghost') + btn('editm', m.id, 'Editar') + btn('status', m.id, m.status === 'activo' ? 'Suspender' : 'Reactivar', 'sand') + btn('delm', m.id, 'Eliminar', 'coral') + '</td></tr>';
    return '<div class="hs-card"><h3>Usuarios y perfiles</h3>' + table(['ID', 'Usuario', 'Rol', 'Saldo', 'Misiones', 'Estado', ''], r) + '</div>';
  }
  if (tab === 'shells') {
    let opts = '';
    for (const m of d.members) {
      opts += '<option value="' + m.id + '">' + esc(m.username) + ' (' + sh(m.balance) + ')</option>';
      r += '<tr><td>' + esc(m.username) + '</td><td>' + sh(m.balance) + '</td><td>' + btn('setbal', m.id, 'Corregir saldo', 'ghost') + '</td></tr>';
    }
    let mv = '';
    for (const v of d.movements) mv += '<tr><td>' + when(v.created_at) + '</td><td>' + esc(v.username) + '</td><td>' + esc(v.reason) + '</td><td>' + signed(v.amount) + '</td></tr>';
    return '<div class="hs-card"><h3>Agregar o retirar Shells</h3><div class="hs-row"><select id="hsMem" class="hs-in" style="width:auto">' + opts + '</select>' +
      '<input id="hsAmt" class="hs-in" type="number" placeholder="Cantidad (negativa retira)" style="width:200px"><input id="hsWhy" class="hs-in" placeholder="Motivo del ajuste" style="flex:1;min-width:180px">' +
      '<button class="hs-btn" data-act="adjust">Registrar ajuste</button></div></div>' +
      '<div class="hs-card"><h3>Saldos</h3>' + table(['Integrante', 'Saldo', ''], r) + '</div><div class="hs-card"><h3>Movimientos</h3>' + table(['Fecha', 'Integrante', 'Motivo', 'Cantidad'], mv) + '</div>';
  }
  if (tab === 'missions') {
    for (const c of d.claims) r += '<tr><td>' + when(c.created_at) + '</td><td>' + esc(c.username) + '</td><td>' + esc(c.mission_name) + ' (+' + c.reward + ')</td><td>' + esc(c.evidence_text) +
      (c.evidence_image ? '<br><a href="' + esc(img(c.evidence_image)) + '" target="_blank"><img src="' + esc(img(c.evidence_image)) + '" style="max-width:140px;border-radius:8px"></a>' : '') + '</td><td>' + pill(c.status) + '</td><td>' +
      (c.status === 'pendiente' ? btn('okc', c.id, 'Aprobar') + btn('noc', c.id, 'Rechazar', 'coral') : esc(c.admin_note)) + '</td></tr>';
    let ms = '';
    for (const m of d.missions) ms += '<tr><td>' + esc(m.name) + '</td><td>+' + sh(m.reward) + '</td><td>' + esc(m.kind) + '</td><td>' + (m.active ? pill('activa') : pill('inactiva')) + '</td><td>' + btn('editmi', m.id, 'Editar') + btn('togmi', m.id, m.active ? 'Desactivar' : 'Activar', 'ghost') + '</td></tr>';
    return '<div class="hs-card"><h3>Comprobantes y entregas</h3>' + table(['Fecha', 'Integrante', 'Misión', 'Comprobante', 'Estado', ''], r) + '</div>' +
      '<div class="hs-card"><div class="hs-row" style="justify-content:space-between"><h3>Misiones</h3>' + btn('editmi', '', '+ Nueva misión', 'sand') + '</div>' + table(['Misión', 'Recompensa', 'Tipo', 'Estado', ''], ms) + '</div>';
  }
  if (tab === 'shop') {
    for (const p of d.purchases) r += '<tr><td>' + when(p.created_at) + '</td><td>' + esc(p.username) + '</td><td>' + esc(p.item_name) + (p.note ? '<div class="hs-muted">' + esc(p.note) + '</div>' : '') + '</td><td>' + sh(p.price) + '</td><td>' + pill(purchaseStatus(p)) +
      (p.expires_at ? '<div class="hs-muted">Vence ' + when(p.expires_at) + '</div>' : '') + '</td><td>' + (p.status === 'pendiente' ? btn('okp', p.id, 'Aprobar') + btn('nop', p.id, 'Rechazar', 'coral') : esc(p.admin_note)) + '</td></tr>';
    let its = '';
    for (const it of d.items) its += '<tr><td>' + (it.image ? '<img src="' + esc(img(it.image)) + '" style="width:60px;height:40px;object-fit:cover;border-radius:6px">' : '') + '</td><td>' + esc(it.name) + '</td><td>' + sh(it.price) + '</td><td>' + esc(it.duration_label) +
      (it.duration_hours ? ' (' + it.duration_hours + ' h)' : '') + '</td><td>' + (it.needs_review ? 'Sí' : 'No') + '</td><td>' + (it.active ? pill('activa') : pill('inactiva')) + '</td><td>' + btn('editit', it.id, 'Editar') + btn('togit', it.id, it.active ? 'Desactivar' : 'Activar', 'ghost') + btn('delit', it.id, 'Eliminar', 'coral') + '</td></tr>';
    return '<div class="hs-card"><h3>Compras y solicitudes</h3>' + table(['Fecha', 'Integrante', 'Artículo', 'Precio', 'Estado', ''], r) + '</div>' +
      '<div class="hs-card"><div class="hs-row" style="justify-content:space-between"><h3>Artículos</h3><span class="hs-row">Foto para el próximo artículo que edites: <input id="hsItemImg" type="file" accept="image/*">' + btn('editit', '', '+ Nuevo artículo', 'sand') + '</span></div>' +
      table(['', 'Artículo', 'Precio', 'Duración', 'Aprobación', 'Estado', ''], its) + '</div>';
  }
  for (const x of d.reports) r += '<tr><td>' + when(x.created_at) + '</td><td>' + esc(x.reporter) + '</td><td>' + (x.target_type === 'post' ? 'Publicación' : 'Comentario') + ' de ' + esc(x.author || '—') + '<div class="hs-muted">' + esc(x.content == null ? '(ya eliminado)' : x.content) + '</div></td><td>' + esc(x.reason) + '</td><td>' + pill(x.status) + '</td><td>' +
    (x.status === 'pendiente' ? btn('rrem', x.id, 'Eliminar contenido', 'coral') + btn('rdis', x.id, 'Descartar', 'ghost') : '') + '</td></tr>';
  let ps = '';
  for (const p of d.posts) ps += '<tr><td>' + when(p.created_at) + '</td><td>' + esc(p.username) + '</td><td>' + esc(String(p.body).slice(0, 120)) + (p.image ? ' 📷' : '') + '</td><td>' + (p.hidden ? pill('oculta') : pill('activa')) + '</td><td>' + btn('hide', p.id, p.hidden ? 'Mostrar' : 'Ocultar', 'ghost') + btn('delp', p.id, 'Eliminar', 'coral') + '</td></tr>';
  let cs = '';
  for (const c of d.comments) cs += '<tr><td>' + when(c.created_at) + '</td><td>' + esc(c.username) + '</td><td>' + esc(c.body) + '</td><td>' + btn('delc', c.id, 'Eliminar', 'coral') + '</td></tr>';
  return '<div class="hs-card"><h3>Reportes</h3>' + table(['Fecha', 'Reporta', 'Contenido', 'Motivo', 'Estado', ''], r) + '</div>' +
    '<div class="hs-card"><h3>Publicaciones</h3>' + table(['Fecha', 'Autor', 'Texto', 'Estado', ''], ps) + '</div><div class="hs-card"><h3>Comentarios</h3>' + table(['Fecha', 'Autor', 'Comentario', ''], cs) + '</div>';
}

async function load() {
  try {
    if (!(await call('adminStatus'))) {
      render(view, '<div class="hs-card" style="max-width:420px;margin:40px auto;text-align:center"><h2>🔒 Administración</h2><p class="hs-muted">Esta zona está protegida. Escribe la contraseña de administración.</p>' +
        '<input id="hsPw" type="password" class="hs-in" placeholder="Contraseña"><div style="margin-top:12px"><button class="hs-btn" data-act="unlock">Entrar</button></div></div>');
      const pw = view.element.querySelector('#hsPw');
      pw.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') view.element.querySelector('[data-act=unlock]').click(); });
      pw.focus();
      return;
    }
    d = await call('adminData', [tab]);
    let tabs = '';
    for (const k in TABS) tabs += '<button class="hs-btn sm ' + (k === tab ? 'on' : '') + '" data-act="tab" data-id="' + k + '">' + TABS[k] + '</button>';
    render(view, '<div class="hs-row" style="justify-content:space-between"><h1>Administración</h1><span>' + btn('chpw', '', 'Cambiar contraseña', 'ghost') + btn('lock', '', 'Bloquear', 'sand') + '</span></div>' +
      '<div class="hs-tabs">' + tabs + '</div>' + section());
  } catch (err) {
    if (err.message !== 'Cancelado') errorBox(view, err);
  }
}

async function Form_OnLoad(sender, e) {
  setup(view, actions, { server: server, showToast: showToast });
  await load();
}
