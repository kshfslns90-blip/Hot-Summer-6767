import { setup, render, esc, sh, signed, when, call, errorBox, PHOTOS } from 'ui';

const LABELS = { recompensa: '🎯 Recompensa', compra: '🛍️ Compra', ajuste: '🛡️ Ajuste de administración', reembolso: '↩️ Reembolso' };

async function Form_OnLoad(sender, e) {
  setup(view, {}, { server: server, showToast: showToast });
  try {
    const d = await call('wallet');
    const m = d.me;
    let rows = '';
    for (const v of d.movements) {
      rows += '<tr><td>' + when(v.created_at) + '</td><td>' + (LABELS[v.kind] || esc(v.kind)) + '</td><td>' + esc(v.reason) + '</td><td>' + signed(v.amount) + '</td></tr>';
    }
    render(view,
      '<div class="hs-hero" style="min-height:170px;background-image:url(' + PHOTOS.sunset + ')"><div class="in"><h1>Billetera</h1><p>Tus Shells (SH) del resort</p></div></div>' +
      '<div class="hs-stats"><div class="hs-stat">Saldo disponible<b>' + sh(m.balance) + '</b></div><div class="hs-stat">Shells ganados<b>' + sh(m.earned) + '</b></div><div class="hs-stat">Shells gastados<b>' + sh(m.spent) + '</b></div></div>' +
      '<div class="hs-card"><h3>Historial de movimientos</h3><p class="hs-muted">Solo la administración puede ajustar saldos; cada ajuste queda registrado con su motivo.</p><div class="hs-scroll"><table class="hs-table"><tr><th>Fecha</th><th>Tipo</th><th>Motivo</th><th>Cantidad</th></tr>' +
      (rows || '<tr><td colspan="4" class="hs-muted">Aún no hay movimientos.</td></tr>') + '</table></div></div>');
  } catch (err) {
    errorBox(view, err);
  }
}
