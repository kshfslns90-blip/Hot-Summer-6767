import { setup, render, esc, sh, when, pill, readFile, call, errorBox, PHOTOS } from 'ui';

const HOW = { auto: 'Se acredita al instante.', verify: 'Se registra para verificación.', evidence: 'Envía un comprobante (enlace, texto o captura).' };

const actions = {
  claim: async function (id) {
    const box = view.element.querySelector('[data-box="' + id + '"]');
    const text = box ? box.querySelector('textarea').value : '';
    const file = box ? await readFile(box.querySelector('input[type=file]')) : '';
    const r = await call('claimMission', [Number(id), text, file]);
    showToast(r.status === 'aprobada' ? '¡+' + r.reward + ' SH acreditados!' : 'Enviado. Queda pendiente de aprobación.', 'success');
    await load();
  }
};

async function load() {
  try {
    const d = await call('missions');
    let cards = '';
    for (const m of d.missions) {
      let foot;
      if (m.claim && m.claim.status !== 'rechazada') {
        foot = pill(m.claim.status) + ' <span class="hs-muted">Disponible de nuevo mañana a las 00:00 (México)</span>';
      } else if (m.kind === 'auto') {
        foot = '<button class="hs-btn sand" data-act="claim" data-id="' + m.id + '">Reclamar</button>';
      } else {
        foot = '<div data-box="' + m.id + '" style="width:100%"><textarea class="hs-in" rows="2" placeholder="' + (m.kind === 'verify' ? '¿En qué dinámica participaste?' : 'Enlace o descripción del comprobante') + '"></textarea>' +
          (m.kind === 'evidence' ? '<div style="margin:6px 0"><input type="file" accept="image/*"></div>' : '') +
          '<button class="hs-btn" data-act="claim" data-id="' + m.id + '" style="margin-top:6px">' + (m.kind === 'verify' ? 'Registrar participación' : 'Enviar comprobante') + '</button></div>';
      }
      cards += '<div class="hs-card"><div class="hs-row" style="justify-content:space-between"><h3>' + esc(m.name) + '</h3><span class="hs-price">+' + sh(m.reward) + '</span></div>' +
        '<p class="hs-muted">' + esc(m.description) + ' ' + HOW[m.kind] + '</p><div class="hs-row">' + foot + '</div></div>';
    }
    let rows = '';
    for (const h of d.history) {
      rows += '<tr><td>' + when(h.created_at) + '</td><td>' + esc(h.mission_name) + '</td><td>+' + sh(h.reward) + '</td><td>' + pill(h.status) + (h.admin_note ? '<div class="hs-muted">' + esc(h.admin_note) + '</div>' : '') + '</td></tr>';
    }
    render(view,
      '<div class="hs-hero" style="min-height:170px;background-image:url(' + PHOTOS.palms + ')"><div class="in"><h1>Misiones diarias</h1><p>Cada misión una vez al día · reinicio a las 00:00 hora de México · Hoy: ' + esc(d.day) + '</p></div></div>' +
      '<div class="hs-grid">' + cards + '</div>' +
      '<div class="hs-card"><h3>Mis entregas</h3><div class="hs-scroll"><table class="hs-table"><tr><th>Fecha</th><th>Misión</th><th>Recompensa</th><th>Estado</th></tr>' +
      (rows || '<tr><td colspan="4" class="hs-muted">Aún no has enviado misiones.</td></tr>') + '</table></div></div>');
  } catch (err) {
    errorBox(view, err);
  }
}

async function Form_OnLoad(sender, e) {
  setup(view, actions, { server: server, showToast: showToast });
  await load();
}
