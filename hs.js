// HOT SUMMER: todas las reglas del resort viven aquí, en el servidor.
// Las funciones de nivel superior son las que llaman los formularios; los ayudantes
// privados están dentro del objeto H para que nadie pueda llamarlos desde fuera.

const H = {
  now: function () { return new Date().toISOString(); },

  // Fecha del día en México (el reinicio de misiones es a las 00:00 hora de México).
  mexDay: function () {
    try {
      return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
    } catch (e) {
      return new Date(Date.now() - 6 * 3600000).toISOString().slice(0, 10);
    }
  },

  fail: function (msg, status) { const e = new Error(msg); e.status = status || 400; throw e; },

  text: function (v, max, name) {
    const s = String(v == null ? '' : v).trim();
    if (s.length > max) H.fail(name + ' es demasiado largo (máximo ' + max + ' caracteres).');
    return s;
  },

  int: function (v, name) {
    const n = Number(v);
    if (!Number.isFinite(n) || Math.floor(n) !== n) H.fail(name + ' debe ser un número entero.');
    return n;
  },

  // El integrante del usuario que llama; se crea la primera vez.
  member: async function (allowSuspended) {
    if (!user) H.fail('Inicia sesión para continuar.', 401);
    let rows = await dbQuery('SELECT * FROM members WHERE user_id = ?', [user.id]);
    if (!rows.length) {
      const name = (user.name || String(user.email || '').split('@')[0] || 'Integrante').slice(0, 40);
      await dbRun('INSERT OR IGNORE INTO members (user_id, username, joined_at, last_seen) VALUES (?, ?, ?, ?)', [user.id, name, H.now(), H.now()]);
      rows = await dbQuery('SELECT * FROM members WHERE user_id = ?', [user.id]);
    } else {
      await dbRun('UPDATE members SET last_seen = ? WHERE id = ?', [H.now(), rows[0].id]);
    }
    const m = rows[0];
    if (m.status !== 'activo' && !allowSuspended) H.fail('Tu cuenta está suspendida. Habla con la administración.', 403);
    return m;
  },

  isAdmin: async function () {
    if (!user) return false;
    const rows = await dbQuery('SELECT expires_at FROM admin_sessions WHERE user_id = ?', [user.id]);
    return rows.length > 0 && rows[0].expires_at > H.now();
  },

  admin: async function () {
    if (!(await H.isAdmin())) H.fail('Necesitas desbloquear Administración con la contraseña.', 403);
  },

  // Movimiento de Shells: siempre con fecha, cantidad y motivo.
  move: async function (memberId, amount, kind, reason, byAdmin) {
    await dbRun('INSERT INTO movements (member_id, amount, kind, reason, created_at, by_admin) VALUES (?, ?, ?, ?, ?, ?)',
      [memberId, amount, kind, reason, H.now(), byAdmin ? 1 : 0]);
  },

  credit: async function (memberId, amount, kind, reason, byAdmin) {
    await dbRun('UPDATE members SET balance = balance + ?, earned = earned + ? WHERE id = ?', [amount, amount, memberId]);
    await H.move(memberId, amount, kind, reason, byAdmin);
  },

  // SHA-256 con sal; la contraseña nunca se guarda en claro.
  hash: async function (pw) {
    const bytes = Array.from(new TextEncoder().encode('hot-summer::' + pw));
    const K = [];
    const Hs = [];
    let n = 2;
    while (K.length < 64) {
      let prime = true;
      for (let d = 2; d * d <= n; d++) if (n % d === 0) { prime = false; break; }
      if (prime) {
        if (Hs.length < 8) Hs.push((Math.pow(n, 1 / 2) % 1) * 4294967296 | 0);
        K.push((Math.pow(n, 1 / 3) % 1) * 4294967296 | 0);
      }
      n++;
    }
    const len = bytes.length * 8;
    bytes.push(0x80);
    while (bytes.length % 64 !== 56) bytes.push(0);
    for (let i = 7; i >= 0; i--) bytes.push(i > 3 ? 0 : (len >>> (i * 8)) & 255);
    const rot = function (x, r) { return (x >>> r) | (x << (32 - r)); };
    for (let o = 0; o < bytes.length; o += 64) {
      const w = [];
      for (let i = 0; i < 64; i++) {
        if (i < 16) w[i] = (bytes[o + i * 4] << 24) | (bytes[o + i * 4 + 1] << 16) | (bytes[o + i * 4 + 2] << 8) | bytes[o + i * 4 + 3];
        else {
          const s0 = rot(w[i - 15], 7) ^ rot(w[i - 15], 18) ^ (w[i - 15] >>> 3);
          const s1 = rot(w[i - 2], 17) ^ rot(w[i - 2], 19) ^ (w[i - 2] >>> 10);
          w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
        }
      }
      let a = Hs[0], b = Hs[1], c = Hs[2], d = Hs[3], e = Hs[4], f = Hs[5], g = Hs[6], h = Hs[7];
      for (let i = 0; i < 64; i++) {
        const t1 = (h + (rot(e, 6) ^ rot(e, 11) ^ rot(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0;
        const t2 = ((rot(a, 2) ^ rot(a, 13) ^ rot(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      Hs[0] = (Hs[0] + a) | 0; Hs[1] = (Hs[1] + b) | 0; Hs[2] = (Hs[2] + c) | 0; Hs[3] = (Hs[3] + d) | 0;
      Hs[4] = (Hs[4] + e) | 0; Hs[5] = (Hs[5] + f) | 0; Hs[6] = (Hs[6] + g) | 0; Hs[7] = (Hs[7] + h) | 0;
    }
    return Hs.map(function (x) { return (x >>> 0).toString(16).padStart(8, '0'); }).join('');
  },

  // Hash de la contraseña inicial "RyoKA26"; se reemplaza al cambiarla desde el panel.
  DEFAULT_HASH: 'ba2f3eb89b70d910bc2ee086b734b80afd7fe77d1cdf7e3c05669b870721aa76',

  saveImage: async function (dataUrl) {
    if (!dataUrl) return '';
    const m = /^data:image\/(png|jpeg|jpg|gif|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl));
    if (!m) H.fail('La imagen debe ser PNG, JPG, GIF o WEBP.');
    const bytes = Buffer.from(m[2], 'base64');
    if (bytes.length > 4 * 1024 * 1024) H.fail('La imagen pesa más de 4 MB.');
    const name = Date.now().toString(36) + Math.random().toString(36).slice(2, 10) + '.' + (m[1] === 'jpeg' ? 'jpg' : m[1]);
    await files.write('uploads/' + name, bytes);
    return name;
  },

  pub: function (m) {
    return { id: m.id, username: m.username, avatar: m.avatar, team_role: m.team_role, bio: m.bio, balance: m.balance,
      earned: m.earned, spent: m.spent, missions_done: m.missions_done, status: m.status, joined_at: m.joined_at };
  }
};

// ---------- Cuenta ----------

async function me() {
  const m = await H.member(true);
  const out = H.pub(m);
  out.isAdmin = await H.isAdmin();
  out.today = H.mexDay();
  return out;
}

async function home() {
  const m = await H.member();
  const day = H.mexDay();
  const claimed = await dbQuery("SELECT 1 FROM mission_claims WHERE member_id = ? AND mission_id = 1 AND day = ?", [m.id, day]);
  const stats = (await dbQuery("SELECT (SELECT count(*) FROM members WHERE status = 'activo') AS members, (SELECT count(*) FROM posts WHERE hidden = 0) AS posts, (SELECT count(*) FROM shop_items WHERE active = 1) AS items"))[0];
  const latest = await dbQuery("SELECT p.id, p.body, p.image, p.created_at, m.username, m.avatar FROM posts p JOIN members m ON m.id = p.member_id WHERE p.hidden = 0 ORDER BY p.created_at DESC LIMIT 3");
  return { me: H.pub(m), dailyClaimed: claimed.length > 0, stats: stats, latest: latest };
}

async function updateMyProfile(bio, avatarData) {
  const m = await H.member();
  const b = H.text(bio, 300, 'La biografía');
  if (avatarData) {
    const name = await H.saveImage(avatarData);
    await dbRun('UPDATE members SET avatar = ? WHERE id = ?', [name, m.id]);
  }
  await dbRun('UPDATE members SET bio = ? WHERE id = ?', [b, m.id]);
  return true;
}

// Imagen guardada (fotos de perfil, publicaciones, comprobantes); solo para integrantes con sesión.
async function media(name) {
  if (!user) H.fail('Inicia sesión.', 401);
  if (!/^[a-z0-9]+\.(png|jpg|gif|webp)$/.test(String(name))) H.fail('Archivo no válido.', 404);
  return files.send('uploads/' + name, { inline: true });
}

// ---------- Perfiles ----------

async function members() {
  await H.member();
  return dbQuery("SELECT id, username, avatar, team_role FROM members WHERE status = 'activo' ORDER BY username");
}

async function profile(memberId) {
  const me_ = await H.member();
  const id = memberId ? H.int(memberId, 'El perfil') : me_.id;
  const rows = await dbQuery('SELECT * FROM members WHERE id = ?', [id]);
  if (!rows.length) H.fail('Ese perfil no existe.', 404);
  const p = H.pub(rows[0]);
  p.isMe = id === me_.id;
  p.followers = (await dbQuery('SELECT count(*) AS n FROM follows WHERE followed_id = ?', [id]))[0].n;
  p.following = (await dbQuery('SELECT count(*) AS n FROM follows WHERE follower_id = ?', [id]))[0].n;
  p.iFollow = (await dbQuery('SELECT 1 FROM follows WHERE follower_id = ? AND followed_id = ?', [me_.id, id])).length > 0;
  p.purchases = await dbQuery('SELECT id, item_name, price, status, duration_label, created_at, expires_at FROM purchases WHERE member_id = ? ORDER BY created_at DESC LIMIT 50', [id]);
  p.movements = await dbQuery('SELECT amount, kind, reason, created_at FROM movements WHERE member_id = ? ORDER BY created_at DESC, id DESC LIMIT 50', [id]);
  p.posts = (await dbQuery('SELECT count(*) AS n FROM posts WHERE member_id = ? AND hidden = 0', [id]))[0].n;
  return p;
}

async function toggleFollow(memberId) {
  const m = await H.member();
  const id = H.int(memberId, 'El perfil');
  if (id === m.id) H.fail('No puedes seguirte a ti mismo.');
  if (!(await dbQuery('SELECT 1 FROM members WHERE id = ?', [id])).length) H.fail('Ese perfil no existe.', 404);
  const r = await dbRun('DELETE FROM follows WHERE follower_id = ? AND followed_id = ?', [m.id, id]);
  if (r.changes) return false;
  await dbRun('INSERT OR IGNORE INTO follows (follower_id, followed_id, created_at) VALUES (?, ?, ?)', [m.id, id, H.now()]);
  return true;
}

// ---------- Comunidad ----------

async function feed(onlyFollowing) {
  const m = await H.member();
  let where = 'p.hidden = 0';
  if (onlyFollowing) where += ' AND (p.member_id = :me OR p.member_id IN (SELECT followed_id FROM follows WHERE follower_id = :me))';
  const posts = await dbQuery('SELECT p.id, p.member_id, p.body, p.image, p.created_at, p.updated_at, a.username, a.avatar, a.team_role, ' +
    '(SELECT count(*) FROM likes l WHERE l.post_id = p.id) AS likes, ' +
    '(SELECT count(*) FROM likes l WHERE l.post_id = p.id AND l.member_id = :me) AS liked ' +
    'FROM posts p JOIN members a ON a.id = p.member_id WHERE ' + where + ' ORDER BY p.created_at DESC, p.id DESC LIMIT 100', { me: m.id });
  if (posts.length) {
    const ids = posts.map(function (p) { return p.id; });
    const comments = await dbQuery('SELECT c.id, c.post_id, c.member_id, c.body, c.created_at, a.username, a.avatar FROM comments c JOIN members a ON a.id = c.member_id WHERE c.post_id IN (' + ids.map(function () { return '?'; }).join(',') + ') ORDER BY c.created_at', ids);
    for (const p of posts) {
      p.mine = p.member_id === m.id;
      p.comments = comments.filter(function (c) { return c.post_id === p.id; }).map(function (c) { c.mine = c.member_id === m.id; return c; });
    }
  }
  return { me: H.pub(m), isAdmin: await H.isAdmin(), posts: posts };
}

async function createPost(body, imageData) {
  const m = await H.member();
  const b = H.text(body, 2000, 'La publicación');
  if (!b && !imageData) H.fail('Escribe algo o agrega una foto.');
  const img = await H.saveImage(imageData);
  const r = await dbRun('INSERT INTO posts (member_id, body, image, created_at) VALUES (?, ?, ?, ?)', [m.id, b, img, H.now()]);
  return r.lastInsertRowid;
}

async function editPost(postId, body) {
  const m = await H.member();
  const b = H.text(body, 2000, 'La publicación');
  const r = await dbRun('UPDATE posts SET body = ?, updated_at = ? WHERE id = ? AND member_id = ?', [b, H.now(), H.int(postId, 'La publicación'), m.id]);
  if (!r.changes) H.fail('Solo puedes editar tus propias publicaciones.', 403);
  return true;
}

async function deletePost(postId) {
  const m = await H.member();
  const id = H.int(postId, 'La publicación');
  const own = (await dbQuery('SELECT 1 FROM posts WHERE id = ? AND member_id = ?', [id, m.id])).length > 0;
  if (!own && !(await H.isAdmin())) H.fail('Solo puedes eliminar tus propias publicaciones.', 403);
  await dbRun('DELETE FROM comments WHERE post_id = ?', [id]);
  await dbRun('DELETE FROM likes WHERE post_id = ?', [id]);
  await dbRun('DELETE FROM posts WHERE id = ?', [id]);
  return true;
}

async function toggleLike(postId) {
  const m = await H.member();
  const id = H.int(postId, 'La publicación');
  if (!(await dbQuery('SELECT 1 FROM posts WHERE id = ? AND hidden = 0', [id])).length) H.fail('La publicación ya no existe.', 404);
  const r = await dbRun('DELETE FROM likes WHERE post_id = ? AND member_id = ?', [id, m.id]);
  if (r.changes) return false;
  await dbRun('INSERT OR IGNORE INTO likes (post_id, member_id) VALUES (?, ?)', [id, m.id]);
  return true;
}

async function addComment(postId, body) {
  const m = await H.member();
  const id = H.int(postId, 'La publicación');
  const b = H.text(body, 500, 'El comentario');
  if (!b) H.fail('Escribe un comentario.');
  if (!(await dbQuery('SELECT 1 FROM posts WHERE id = ? AND hidden = 0', [id])).length) H.fail('La publicación ya no existe.', 404);
  await dbRun('INSERT INTO comments (post_id, member_id, body, created_at) VALUES (?, ?, ?, ?)', [id, m.id, b, H.now()]);
  return true;
}

async function deleteComment(commentId) {
  const m = await H.member();
  const id = H.int(commentId, 'El comentario');
  const own = (await dbQuery('SELECT 1 FROM comments WHERE id = ? AND member_id = ?', [id, m.id])).length > 0;
  if (!own && !(await H.isAdmin())) H.fail('Solo puedes eliminar tus propios comentarios.', 403);
  await dbRun('DELETE FROM comments WHERE id = ?', [id]);
  return true;
}

async function report(targetType, targetId, reason) {
  const m = await H.member();
  if (targetType !== 'post' && targetType !== 'comment') H.fail('Tipo de reporte no válido.');
  const id = H.int(targetId, 'El contenido');
  const table = targetType === 'post' ? 'posts' : 'comments';
  if (!(await dbQuery('SELECT 1 FROM ' + table + ' WHERE id = ?', [id])).length) H.fail('Ese contenido ya no existe.', 404);
  await dbRun('INSERT INTO reports (reporter_id, target_type, target_id, reason, created_at) VALUES (?, ?, ?, ?, ?)',
    [m.id, targetType, id, H.text(reason, 300, 'El motivo'), H.now()]);
  return true;
}

// ---------- Tienda ----------

async function shop() {
  const m = await H.member();
  const items = await dbQuery('SELECT id, name, description, image, price, duration_label, duration_hours, needs_review FROM shop_items WHERE active = 1 ORDER BY sort, id');
  const mine = await dbQuery('SELECT id, item_name, price, status, duration_label, created_at, expires_at, note, admin_note FROM purchases WHERE member_id = ? ORDER BY created_at DESC LIMIT 30', [m.id]);
  return { me: H.pub(m), items: items, purchases: mine, now: H.now() };
}

// requestKey lo genera el navegador una vez por compra: si el clic llega dos veces, se cobra una sola.
async function buy(itemId, requestKey, note) {
  const m = await H.member();
  const key = H.text(requestKey, 64, 'La clave de compra');
  if (key.length < 8) H.fail('Compra no válida.');
  const done = await dbQuery('SELECT id, status FROM purchases WHERE request_key = ?', [key]);
  if (done.length) return { id: done[0].id, status: done[0].status, duplicate: true };
  const rows = await dbQuery('SELECT * FROM shop_items WHERE id = ? AND active = 1', [H.int(itemId, 'El artículo')]);
  if (!rows.length) H.fail('Ese artículo ya no está disponible.', 404);
  const it = rows[0];
  const n = H.text(note, 300, 'La nota');
  const r = await dbRun('UPDATE members SET balance = balance - ?, spent = spent + ? WHERE id = ? AND balance >= ?', [it.price, it.price, m.id, it.price]);
  if (!r.changes) H.fail('No tienes suficientes Shells: necesitas ' + it.price + ' SH y tienes ' + m.balance + ' SH.');
  const now = H.now();
  const status = it.needs_review ? 'pendiente' : (it.duration_hours > 0 ? 'activa' : 'entregada');
  const expires = !it.needs_review && it.duration_hours > 0 ? new Date(Date.now() + it.duration_hours * 3600000).toISOString() : null;
  let ins;
  try {
    ins = await dbRun('INSERT INTO purchases (member_id, item_id, item_name, price, duration_label, duration_hours, status, note, request_key, created_at, starts_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [m.id, it.id, it.name, it.price, it.duration_label, it.duration_hours, status, n, key, now, it.needs_review ? null : now, expires]);
  } catch (e) {
    // Otra petición con la misma clave ganó la carrera: devolvemos el cobro.
    await dbRun('UPDATE members SET balance = balance + ?, spent = spent - ? WHERE id = ?', [it.price, it.price, m.id]);
    const again = await dbQuery('SELECT id, status FROM purchases WHERE request_key = ?', [key]);
    if (again.length) return { id: again[0].id, status: again[0].status, duplicate: true };
    throw e;
  }
  await H.move(m.id, -it.price, 'compra', 'Compra: ' + it.name + (it.needs_review ? ' (pendiente de aprobación)' : ''));
  return { id: ins.lastInsertRowid, status: status };
}

// ---------- Misiones ----------

async function missions() {
  const m = await H.member();
  const day = H.mexDay();
  const list = await dbQuery('SELECT id, name, description, reward, kind FROM missions WHERE active = 1 ORDER BY sort, id');
  const claims = await dbQuery('SELECT id, mission_id, status, reward, created_at, admin_note FROM mission_claims WHERE member_id = ? AND day = ?', [m.id, day]);
  for (const x of list) {
    x.claim = claims.filter(function (c) { return c.mission_id === x.id; })[0] || null;
  }
  const history = await dbQuery("SELECT mission_name, day, status, reward, created_at, admin_note FROM mission_claims WHERE member_id = ? ORDER BY created_at DESC LIMIT 30", [m.id]);
  return { me: H.pub(m), day: day, missions: list, history: history };
}

async function claimMission(missionId, evidenceText, imageData) {
  const m = await H.member();
  const rows = await dbQuery('SELECT * FROM missions WHERE id = ? AND active = 1', [H.int(missionId, 'La misión')]);
  if (!rows.length) H.fail('Esa misión no está disponible.', 404);
  const ms = rows[0];
  const day = H.mexDay();
  const txt = H.text(evidenceText, 1000, 'El comprobante');
  if (ms.kind === 'evidence' && !txt && !imageData) H.fail('Agrega un comprobante: un enlace, una descripción o una captura.');
  if ((await dbQuery('SELECT 1 FROM mission_claims WHERE member_id = ? AND mission_id = ? AND day = ?', [m.id, ms.id, day])).length) {
    H.fail('Ya registraste esta misión hoy. Se reinicia a las 00:00 (hora de México).');
  }
  const img = ms.kind === 'auto' ? '' : await H.saveImage(imageData);
  const status = ms.kind === 'auto' ? 'aprobada' : 'pendiente';
  try {
    await dbRun('INSERT INTO mission_claims (member_id, mission_id, mission_name, day, status, reward, evidence_text, evidence_image, created_at, reviewed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [m.id, ms.id, ms.name, day, status, ms.reward, txt, img, H.now(), status === 'aprobada' ? H.now() : null]);
  } catch (e) {
    H.fail('Ya registraste esta misión hoy.');
  }
  if (status === 'aprobada') {
    await H.credit(m.id, ms.reward, 'recompensa', 'Misión: ' + ms.name);
    await dbRun('UPDATE members SET missions_done = missions_done + 1 WHERE id = ?', [m.id]);
  }
  return { status: status, reward: ms.reward };
}

// ---------- Billetera ----------

async function wallet() {
  const m = await H.member();
  const movements = await dbQuery('SELECT amount, kind, reason, created_at, by_admin FROM movements WHERE member_id = ? ORDER BY created_at DESC, id DESC LIMIT 200', [m.id]);
  return { me: H.pub(m), movements: movements };
}

// ---------- Administración ----------

async function adminUnlock(password) {
  const m = await H.member(true);
  const failKey = 'fail:' + user.id;
  const f = await dbQuery('SELECT value FROM settings WHERE key = ?', [failKey]);
  const info = f.length ? JSON.parse(f[0].value) : { n: 0, t: 0 };
  if (info.n >= 5 && Date.now() - info.t < 15 * 60000) H.fail('Demasiados intentos. Espera 15 minutos.', 429);
  const stored = await dbQuery("SELECT value FROM settings WHERE key = 'admin_password'");
  const expected = stored.length ? stored[0].value : H.DEFAULT_HASH;
  if ((await H.hash(String(password || ''))) !== expected) {
    const next = { n: (Date.now() - info.t < 15 * 60000 ? info.n : 0) + 1, t: Date.now() };
    await dbRun('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [failKey, JSON.stringify(next)]);
    H.fail('Contraseña incorrecta.', 403);
  }
  await dbRun('DELETE FROM settings WHERE key = ?', [failKey]);
  const exp = new Date(Date.now() + 8 * 3600000).toISOString();
  await dbRun('INSERT INTO admin_sessions (user_id, expires_at) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET expires_at = excluded.expires_at', [user.id, exp]);
  console.log('Administración desbloqueada por ' + m.username);
  return true;
}

async function adminLock() {
  if (user) await dbRun('DELETE FROM admin_sessions WHERE user_id = ?', [user.id]);
  return true;
}

async function adminStatus() {
  return H.isAdmin();
}

async function adminChangePassword(current, next) {
  await H.admin();
  const stored = await dbQuery("SELECT value FROM settings WHERE key = 'admin_password'");
  const expected = stored.length ? stored[0].value : H.DEFAULT_HASH;
  if ((await H.hash(String(current || ''))) !== expected) H.fail('La contraseña actual no es correcta.', 403);
  const n = String(next || '');
  if (n.length < 6) H.fail('La nueva contraseña debe tener al menos 6 caracteres.');
  await dbRun("INSERT INTO settings (key, value) VALUES ('admin_password', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [await H.hash(n)]);
  return true;
}

async function adminData(section) {
  await H.admin();
  const out = { section: section };
  if (section === 'stats') {
    out.stats = (await dbQuery("SELECT (SELECT count(*) FROM members) AS registered, " +
      "(SELECT count(*) FROM members WHERE status = 'activo' AND last_seen >= :week) AS active7, " +
      "(SELECT coalesce(sum(balance), 0) FROM members) AS circulating, " +
      "(SELECT count(*) FROM purchases) AS purchases, (SELECT count(*) FROM purchases WHERE status = 'pendiente') AS pendingPurchases, " +
      "(SELECT count(*) FROM mission_claims WHERE status = 'aprobada') AS missions, (SELECT count(*) FROM mission_claims WHERE status = 'pendiente') AS pendingClaims, " +
      "(SELECT count(*) FROM posts) AS posts, (SELECT count(*) FROM comments) AS comments, (SELECT count(*) FROM reports WHERE status = 'pendiente') AS pendingReports",
      { week: new Date(Date.now() - 7 * 86400000).toISOString() }))[0];
    out.recent = await dbQuery("SELECT 'movimiento' AS type, m.username, v.reason AS text, v.amount, v.created_at FROM movements v JOIN members m ON m.id = v.member_id " +
      "UNION ALL SELECT 'publicación', m.username, substr(p.body, 1, 80), NULL, p.created_at FROM posts p JOIN members m ON m.id = p.member_id ORDER BY created_at DESC LIMIT 15");
  } else if (section === 'users') {
    out.members = await dbQuery('SELECT m.*, u.email, u.role AS app_role, u.active AS user_active FROM members m LEFT JOIN users u ON u.id = m.user_id ORDER BY m.username');
  } else if (section === 'shells') {
    out.members = await dbQuery('SELECT id, username, balance FROM members ORDER BY username');
    out.movements = await dbQuery('SELECT v.*, m.username FROM movements v JOIN members m ON m.id = v.member_id ORDER BY v.created_at DESC, v.id DESC LIMIT 200');
  } else if (section === 'missions') {
    out.missions = await dbQuery('SELECT * FROM missions ORDER BY sort, id');
    out.claims = await dbQuery("SELECT c.*, m.username FROM mission_claims c JOIN members m ON m.id = c.member_id ORDER BY CASE c.status WHEN 'pendiente' THEN 0 ELSE 1 END, c.created_at DESC LIMIT 150");
  } else if (section === 'shop') {
    out.items = await dbQuery('SELECT * FROM shop_items ORDER BY sort, id');
    out.purchases = await dbQuery("SELECT p.*, m.username FROM purchases p JOIN members m ON m.id = p.member_id ORDER BY CASE p.status WHEN 'pendiente' THEN 0 ELSE 1 END, p.created_at DESC LIMIT 200");
  } else if (section === 'community') {
    out.reports = await dbQuery("SELECT r.*, m.username AS reporter, " +
      "CASE r.target_type WHEN 'post' THEN (SELECT body FROM posts WHERE id = r.target_id) ELSE (SELECT body FROM comments WHERE id = r.target_id) END AS content, " +
      "CASE r.target_type WHEN 'post' THEN (SELECT a.username FROM posts x JOIN members a ON a.id = x.member_id WHERE x.id = r.target_id) ELSE (SELECT a.username FROM comments x JOIN members a ON a.id = x.member_id WHERE x.id = r.target_id) END AS author " +
      "FROM reports r JOIN members m ON m.id = r.reporter_id ORDER BY CASE r.status WHEN 'pendiente' THEN 0 ELSE 1 END, r.created_at DESC LIMIT 100");
    out.posts = await dbQuery('SELECT p.id, p.body, p.image, p.hidden, p.created_at, m.username, (SELECT count(*) FROM comments c WHERE c.post_id = p.id) AS comments FROM posts p JOIN members m ON m.id = p.member_id ORDER BY p.created_at DESC LIMIT 100');
    out.comments = await dbQuery('SELECT c.id, c.body, c.created_at, m.username, c.post_id FROM comments c JOIN members m ON m.id = c.member_id ORDER BY c.created_at DESC LIMIT 100');
  } else {
    H.fail('Sección desconocida.');
  }
  return out;
}

async function adminMemberDetail(memberId) {
  await H.admin();
  const id = H.int(memberId, 'El integrante');
  const rows = await dbQuery('SELECT * FROM members WHERE id = ?', [id]);
  if (!rows.length) H.fail('Ese integrante no existe.', 404);
  return {
    member: rows[0],
    movements: await dbQuery('SELECT * FROM movements WHERE member_id = ? ORDER BY created_at DESC, id DESC LIMIT 100', [id]),
    purchases: await dbQuery('SELECT * FROM purchases WHERE member_id = ? ORDER BY created_at DESC LIMIT 100', [id]),
    claims: await dbQuery('SELECT * FROM mission_claims WHERE member_id = ? ORDER BY created_at DESC LIMIT 100', [id])
  };
}

async function adminUpdateMember(memberId, username, teamRole, bio) {
  await H.admin();
  const u = H.text(username, 40, 'El nombre');
  if (!u) H.fail('El nombre no puede quedar vacío.');
  const r = await dbRun('UPDATE members SET username = ?, team_role = ?, bio = ? WHERE id = ?',
    [u, H.text(teamRole, 60, 'El rol'), H.text(bio, 300, 'La biografía'), H.int(memberId, 'El integrante')]);
  if (!r.changes) H.fail('Ese integrante no existe.', 404);
  return true;
}

// Suspender también cierra el acceso de la cuenta; nunca a un Administrator de la plataforma.
async function adminSetStatus(memberId, status) {
  await H.admin();
  if (status !== 'activo' && status !== 'suspendido') H.fail('Estado no válido.');
  const rows = await dbQuery('SELECT m.user_id, u.role FROM members m LEFT JOIN users u ON u.id = m.user_id WHERE m.id = ?', [H.int(memberId, 'El integrante')]);
  if (!rows.length) H.fail('Ese integrante no existe.', 404);
  if (rows[0].user_id === user.id) H.fail('No puedes suspender tu propia cuenta.');
  await dbRun('UPDATE members SET status = ? WHERE id = ?', [status, memberId]);
  if (rows[0].role !== 'Administrator') {
    await dbRun('UPDATE users SET active = ? WHERE id = ?', [status === 'activo' ? 1 : 0, rows[0].user_id]);
    if (status !== 'activo') await dbRun('DELETE FROM sessions WHERE userId = ?', [rows[0].user_id]).catch(function () {});
  }
  return true;
}

async function adminDeleteMember(memberId) {
  await H.admin();
  const id = H.int(memberId, 'El integrante');
  const rows = await dbQuery('SELECT m.user_id, u.role FROM members m LEFT JOIN users u ON u.id = m.user_id WHERE m.id = ?', [id]);
  if (!rows.length) H.fail('Ese integrante no existe.', 404);
  if (rows[0].user_id === user.id) H.fail('No puedes eliminar tu propia cuenta.');
  if (rows[0].role === 'Administrator') H.fail('Esa cuenta es Administrator de la aplicación; gestiónala en la página Users.');
  await dbRun('DELETE FROM likes WHERE member_id = ? OR post_id IN (SELECT id FROM posts WHERE member_id = ?)', [id, id]);
  await dbRun('DELETE FROM comments WHERE member_id = ? OR post_id IN (SELECT id FROM posts WHERE member_id = ?)', [id, id]);
  await dbRun('DELETE FROM posts WHERE member_id = ?', [id]);
  await dbRun('DELETE FROM follows WHERE follower_id = ? OR followed_id = ?', [id, id]);
  for (const t of ['movements', 'purchases', 'mission_claims']) await dbRun('DELETE FROM ' + t + ' WHERE member_id = ?', [id]);
  await dbRun('DELETE FROM reports WHERE reporter_id = ?', [id]);
  await dbRun('DELETE FROM members WHERE id = ?', [id]);
  await dbRun('DELETE FROM sessions WHERE userId = ?', [rows[0].user_id]).catch(function () {});
  await dbRun('DELETE FROM users WHERE id = ?', [rows[0].user_id]);
  return true;
}

// Ajuste de Shells: cantidad positiva agrega, negativa retira; siempre con motivo.
async function adminAdjust(memberId, amount, reason) {
  await H.admin();
  const id = H.int(memberId, 'El integrante');
  const a = H.int(amount, 'La cantidad');
  const why = H.text(reason, 200, 'El motivo');
  if (!a) H.fail('La cantidad no puede ser cero.');
  if (!why) H.fail('Escribe el motivo del ajuste.');
  const rows = await dbQuery('SELECT balance FROM members WHERE id = ?', [id]);
  if (!rows.length) H.fail('Ese integrante no existe.', 404);
  if (rows[0].balance + a < 0) H.fail('El saldo no puede quedar negativo (saldo actual ' + rows[0].balance + ' SH).');
  if (a > 0) await dbRun('UPDATE members SET balance = balance + ?, earned = earned + ? WHERE id = ?', [a, a, id]);
  else await dbRun('UPDATE members SET balance = balance + ? WHERE id = ?', [a, id]);
  await H.move(id, a, 'ajuste', 'Ajuste de administración: ' + why, true);
  return true;
}

async function adminSetBalance(memberId, value, reason) {
  await H.admin();
  const id = H.int(memberId, 'El integrante');
  const v = H.int(value, 'El saldo');
  if (v < 0) H.fail('El saldo no puede ser negativo.');
  const rows = await dbQuery('SELECT balance FROM members WHERE id = ?', [id]);
  if (!rows.length) H.fail('Ese integrante no existe.', 404);
  const diff = v - rows[0].balance;
  if (!diff) return true;
  const why = H.text(reason, 200, 'El motivo');
  if (!why) H.fail('Escribe el motivo de la corrección.');
  await dbRun('UPDATE members SET balance = ? WHERE id = ?', [v, id]);
  await H.move(id, diff, 'ajuste', 'Corrección de saldo: ' + why, true);
  return true;
}

async function adminReviewClaim(claimId, approve, note) {
  await H.admin();
  const id = H.int(claimId, 'La entrega');
  const rows = await dbQuery("SELECT * FROM mission_claims WHERE id = ? AND status = 'pendiente'", [id]);
  if (!rows.length) H.fail('Esa entrega ya fue revisada.');
  const c = rows[0];
  const n = H.text(note, 300, 'La nota');
  if (approve) {
    const r = await dbRun("UPDATE mission_claims SET status = 'aprobada', reviewed_at = ?, admin_note = ? WHERE id = ? AND status = 'pendiente'", [H.now(), n, id]);
    if (!r.changes) H.fail('Esa entrega ya fue revisada.');
    await H.credit(c.member_id, c.reward, 'recompensa', 'Misión aprobada: ' + c.mission_name + ' (' + c.day + ')');
    await dbRun('UPDATE members SET missions_done = missions_done + 1 WHERE id = ?', [c.member_id]);
  } else {
    // Rechazada: libera el día para que el integrante pueda volver a enviarla.
    await dbRun("UPDATE mission_claims SET status = 'rechazada', reviewed_at = ?, admin_note = ?, day = day || '#r' || id WHERE id = ? AND status = 'pendiente'", [H.now(), n, id]);
  }
  return true;
}

async function adminSaveMission(m) {
  await H.admin();
  const name = H.text(m && m.name, 80, 'El nombre');
  if (!name) H.fail('La misión necesita un nombre.');
  const reward = H.int(m.reward, 'La recompensa');
  if (reward < 0) H.fail('La recompensa no puede ser negativa.');
  if (['auto', 'verify', 'evidence'].indexOf(m.kind) < 0) H.fail('Tipo de misión no válido.');
  const vals = [name, H.text(m.description, 300, 'La descripción'), reward, m.kind, m.active ? 1 : 0, H.int(m.sort || 0, 'El orden')];
  if (m.id) await dbRun('UPDATE missions SET name = ?, description = ?, reward = ?, kind = ?, active = ?, sort = ? WHERE id = ?', vals.concat([H.int(m.id, 'La misión')]));
  else await dbRun('INSERT INTO missions (name, description, reward, kind, active, sort) VALUES (?, ?, ?, ?, ?, ?)', vals);
  return true;
}

async function adminSaveItem(it, imageData) {
  await H.admin();
  const name = H.text(it && it.name, 80, 'El nombre');
  if (!name) H.fail('El artículo necesita un nombre.');
  const price = H.int(it.price, 'El precio');
  const hours = H.int(it.duration_hours || 0, 'Las horas');
  if (price < 0 || hours < 0) H.fail('El precio y las horas no pueden ser negativos.');
  let image = H.text(it.image, 500, 'La imagen');
  if (image && !/^https:\/\//.test(image) && !/^[a-z0-9]+\.(png|jpg|gif|webp)$/.test(image)) H.fail('La imagen debe ser una dirección https o una foto subida.');
  if (imageData) image = await H.saveImage(imageData);
  const vals = [name, H.text(it.description, 500, 'La descripción'), image, price, H.text(it.duration_label, 40, 'La duración'), hours, it.needs_review ? 1 : 0, it.active ? 1 : 0, H.int(it.sort || 0, 'El orden')];
  if (it.id) await dbRun('UPDATE shop_items SET name = ?, description = ?, image = ?, price = ?, duration_label = ?, duration_hours = ?, needs_review = ?, active = ?, sort = ? WHERE id = ?', vals.concat([H.int(it.id, 'El artículo')]));
  else await dbRun('INSERT INTO shop_items (name, description, image, price, duration_label, duration_hours, needs_review, active, sort) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', vals);
  return true;
}

async function adminDeleteItem(itemId) {
  await H.admin();
  await dbRun('DELETE FROM shop_items WHERE id = ?', [H.int(itemId, 'El artículo')]);
  return true;
}

// Aprobar inicia la duración; rechazar devuelve los Shells.
async function adminReviewPurchase(purchaseId, approve, note) {
  await H.admin();
  const id = H.int(purchaseId, 'La compra');
  const rows = await dbQuery("SELECT * FROM purchases WHERE id = ? AND status = 'pendiente'", [id]);
  if (!rows.length) H.fail('Esa solicitud ya fue revisada.');
  const p = rows[0];
  const now = H.now();
  const n = H.text(note, 300, 'La nota');
  if (approve) {
    const exp = p.duration_hours > 0 ? new Date(Date.now() + p.duration_hours * 3600000).toISOString() : null;
    await dbRun("UPDATE purchases SET status = ?, starts_at = ?, expires_at = ?, reviewed_at = ?, admin_note = ? WHERE id = ? AND status = 'pendiente'",
      [exp ? 'activa' : 'entregada', now, exp, now, n, id]);
  } else {
    const r = await dbRun("UPDATE purchases SET status = 'rechazada', reviewed_at = ?, admin_note = ? WHERE id = ? AND status = 'pendiente'", [now, n, id]);
    if (r.changes) {
      await dbRun('UPDATE members SET balance = balance + ?, spent = spent - ? WHERE id = ?', [p.price, p.price, p.member_id]);
      await H.move(p.member_id, p.price, 'reembolso', 'Reembolso: solicitud rechazada de ' + p.item_name, true);
    }
  }
  return true;
}

async function adminResolveReport(reportId, action) {
  await H.admin();
  const id = H.int(reportId, 'El reporte');
  const rows = await dbQuery('SELECT * FROM reports WHERE id = ?', [id]);
  if (!rows.length) H.fail('Ese reporte no existe.', 404);
  const r = rows[0];
  if (action === 'remove') {
    if (r.target_type === 'post') {
      await dbRun('DELETE FROM comments WHERE post_id = ?', [r.target_id]);
      await dbRun('DELETE FROM likes WHERE post_id = ?', [r.target_id]);
      await dbRun('DELETE FROM posts WHERE id = ?', [r.target_id]);
    } else {
      await dbRun('DELETE FROM comments WHERE id = ?', [r.target_id]);
    }
    await dbRun("UPDATE reports SET status = 'contenido eliminado', resolved_at = ? WHERE target_type = ? AND target_id = ?", [H.now(), r.target_type, r.target_id]);
  } else {
    await dbRun("UPDATE reports SET status = 'descartado', resolved_at = ? WHERE id = ?", [H.now(), id]);
  }
  return true;
}

async function adminHidePost(postId, hidden) {
  await H.admin();
  await dbRun('UPDATE posts SET hidden = ? WHERE id = ?', [hidden ? 1 : 0, H.int(postId, 'La publicación')]);
  return true;
}

async function test() {
  return { day: H.mexDay() };
}
