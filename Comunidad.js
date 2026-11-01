import { setup, render, esc, img, avatar, when, readFile, call, errorBox } from 'ui';

let following = false;

const actions = {
  post: async function () {
    const file = await readFile(view.element.querySelector('#hsFile'));
    await call('createPost', [view.element.querySelector('#hsBody').value, file]);
    showToast('Publicado', 'success');
    await load();
  },
  tab: async function (v) { following = v === '1'; await load(); },
  like: async function (id) { await call('toggleLike', [Number(id)]); await load(); },
  comment: async function (id) {
    const input = view.element.querySelector('[data-c="' + id + '"]');
    await call('addComment', [Number(id), input.value]);
    await load();
  },
  edit: async function (id, el) {
    const t = await showPrompt('Edita tu publicación:', el.getAttribute('data-body'), 'Editar');
    if (t === null) return;
    await call('editPost', [Number(id), t]);
    await load();
  },
  del: async function (id) {
    if (!(await showConfirm('¿Eliminar esta publicación?', 'Eliminar'))) return;
    await call('deletePost', [Number(id)]);
    await load();
  },
  delc: async function (id) {
    if (!(await showConfirm('¿Eliminar este comentario?', 'Eliminar'))) return;
    await call('deleteComment', [Number(id)]);
    await load();
  },
  rep: async function (id, el) {
    const why = await showPrompt('¿Por qué lo reportas?', '', 'Reportar');
    if (why === null) return;
    await call('report', [el.getAttribute('data-t'), Number(id), why]);
    showToast('Reporte enviado a la administración', 'success');
  },
  profile: function (id) { app.navigate('Main.Perfil', { memberId: Number(id) }); }
};

async function load() {
  try {
    const d = await call('feed', [following]);
    let html = '<div class="hs-card"><div class="hs-row">' + avatar(d.me) + '<b>¿Qué hay de nuevo en el resort, ' + esc(d.me.username) + '?</b></div>' +
      '<textarea id="hsBody" class="hs-in" rows="3" style="margin-top:10px" placeholder="Escribe algo para el Team..."></textarea>' +
      '<div class="hs-row" style="justify-content:space-between;margin-top:8px"><input id="hsFile" type="file" accept="image/*"><button class="hs-btn coral" data-act="post">Publicar</button></div></div>' +
      '<div class="hs-tabs"><button class="hs-btn sm ' + (following ? '' : 'on') + '" data-act="tab" data-id="0">Todo el Team</button><button class="hs-btn sm ' + (following ? 'on' : '') + '" data-act="tab" data-id="1">Siguiendo</button></div>';
    for (const p of d.posts) {
      let coms = '';
      for (const c of p.comments) {
        coms += '<div class="hs-com"><span class="hs-link" data-act="profile" data-id="' + c.member_id + '">' + esc(c.username) + '</span> ' + esc(c.body) +
          ' <span class="hs-muted">· ' + when(c.created_at) + '</span> ' +
          (c.mine || d.isAdmin ? '<span class="hs-link" data-act="delc" data-id="' + c.id + '">Eliminar</span> ' : '') +
          (c.mine ? '' : '<span class="hs-link" data-act="rep" data-t="comment" data-id="' + c.id + '">Reportar</span>') + '</div>';
      }
      html += '<div class="hs-card hs-post"><div class="hs-row">' + avatar(p) + '<div><span class="hs-link" data-act="profile" data-id="' + p.member_id + '">' + esc(p.username) + '</span> <span class="hs-pill">' + esc(p.team_role) + '</span>' +
        '<div class="hs-muted">' + when(p.created_at) + (p.updated_at ? ' · editado' : '') + '</div></div></div>' +
        (p.body ? '<p style="white-space:pre-wrap">' + esc(p.body) + '</p>' : '') + (p.image ? '<img class="ph" src="' + esc(img(p.image)) + '">' : '') +
        '<div class="hs-row" style="margin-top:10px"><button class="hs-btn sm ' + (p.liked ? 'coral' : 'ghost') + '" data-act="like" data-id="' + p.id + '">❤ ' + p.likes + '</button>' +
        (p.mine ? '<button class="hs-btn sm ghost" data-act="edit" data-id="' + p.id + '" data-body="' + esc(p.body) + '">Editar</button>' : '') +
        (p.mine || d.isAdmin ? '<button class="hs-btn sm ghost" data-act="del" data-id="' + p.id + '">Eliminar</button>' : '') +
        (p.mine ? '' : '<button class="hs-btn sm ghost" data-act="rep" data-t="post" data-id="' + p.id + '">Reportar</button>') + '</div>' + coms +
        '<div class="hs-row" style="margin-top:8px;flex-wrap:nowrap"><input class="hs-in" data-c="' + p.id + '" placeholder="Escribe un comentario..."><button class="hs-btn sm" data-act="comment" data-id="' + p.id + '">Comentar</button></div></div>';
    }
    if (!d.posts.length) html += '<div class="hs-card hs-muted">Aún no hay publicaciones aquí. ¡Sé el primero!</div>';
    render(view, '<h1>Comunidad</h1>' + html);
  } catch (err) {
    errorBox(view, err);
  }
}

async function Form_OnLoad(sender, e) {
  setup(view, actions, { server: server, showToast: showToast });
  await load();
}
