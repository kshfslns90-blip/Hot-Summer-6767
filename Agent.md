# Agent notes

HOT SUMMER: resort/tienda/red social privada del Team (español). Sign-in on, registro abierto.
- Cada form = un Panel `view`; el código genera HTML con client-script `ui` (CSS, setup(view, actions, {server, showToast}) con clics data-act).
- Toda la lógica y permisos en server-script `hs.js`; ayudantes privados en el objeto H. Admin: contraseña (hash SHA-256 propio, sin crypto) desbloquea 8 h por usuario en admin_sessions.
- Misiones por día de México; rechazo libera el día. Compras con request_key anti-duplicado; rechazo reembolsa.
- Probado: Inicio (ingreso diario). Pendiente de probar a fondo Comunidad, Tienda, Admin tras arreglo de `server` en ui.
