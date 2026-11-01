import { setup, render, esc, img, avatar, when, sh, call, errorBox, PHOTOS } from 'ui';

const actions = {
  daily: async function () {
    const r = await call('claimMission', [1, '', '']);
    showToast('¡+' + r.reward + ' SH acreditados!', 'success');
    await load();
  },
  go: function (name) { app.navigate('Main.' + name); },
  profile: function (id) { app.navigate('Main.Perfil', { memberId: Number(id) }); }
};

async function load() {
  try {
    const d = await call('home');
    const m = d.me;
    let latest = '';
    for (const p of d.latest) {
      latest += '<div class="hs-row" style="margin-bottom:10px">' + avatar(p) + '<div><b>' + esc(p.username) + '</b> <span class="hs-muted">' + when(p.created_at) + '</span><div>' + esc(String(p.body).slice(0, 140)) + '</div></div></div>';
    }
    render(view,
      '<div class="hs-hero" style="background-image:url(' + PHOTOS.beach + ')"><div class="in"><h1>HOT SUMMER</h1>' +
      '<p>Bienvenido al resort, ' + esc(m.username) + '. Relájate, cumple tus misiones y disfruta del paraíso del Team. 🌴</p></div></div>' +
      '<div class="hs-stats"><div class="hs-stat">Tu saldo<b>' + sh(m.balance) + '</b></div><div class="hs-stat">Misiones completadas<b>' + m.missions_done + '</b></div>' +
      '<div class="hs-stat">Integrantes<b>' + d.stats.members + '</b></div><div class="hs-stat">Publicaciones<b>' + d.stats.posts + '</b></div></div>' +
      '<div class="hs-grid"><div class="hs-card"><h3>☀️ Ingreso diario</h3><p class="hs-muted">Reclama 100 SH cada día. Se reinicia a las 00:00, hora de México.</p>' +
      (d.dailyClaimed ? '<span class="hs-pill ok">Ya reclamado hoy</span>' : '<button class="hs-btn sand" data-act="daily">Reclamar +100 SH</button>') + '</div>' +
      '<div class="hs-card"><h3>🐚 Tienda del resort</h3><p class="hs-muted">' + d.stats.items + ' artículos esperan por ti.</p><button class="hs-btn" data-act="go" data-id="Tienda">Ir a la Tienda</button></div>' +
      '<div class="hs-card"><h3>🎯 Misiones</h3><p class="hs-muted">Gana Shells completando roles, dinámicas y promoción.</p><button class="hs-btn" data-act="go" data-id="Misiones">Ver misiones</button></div></div>' +
      '<div class="hs-card"><div class="hs-row" style="justify-content:space-between"><h3>🌊 Lo último en la Comunidad</h3><button class="hs-btn ghost sm" data-act="go" data-id="Comunidad">Ver todo</button></div>' + (latest || '<p class="hs-muted">Aún no hay publicaciones.</p>') + '</div>' +
      '<div class="hs-hero" style="min-height:160px;background-image:url(' + PHOTOS.pool + ')"><div class="in"><p>Piscinas, palmeras y atardeceres infinitos. Solo para el Team.</p></div></div>');
  } catch (err) {
    errorBox(view, err);
  }
}

async function Form_OnLoad(sender, e) {
  setup(view, actions, { server: server, showToast: showToast });
  await load();
}
