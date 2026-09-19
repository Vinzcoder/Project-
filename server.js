/**
 * STRIKE VECTOR — server game (Express + Socket.io + verifikasi Cap.js)
 * v1.1 — perbaikan verifikasi captcha, multiplayer penuh, anti-teleport, chat.
 * Jalankan: npm install && node server.js  →  http://localhost:3000
 */
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const { WEAPONS, PRIMARIES, MAP, RULES, buildSolids, rayAABB } = require('./shared');

const PORT = process.env.PORT || 3000;
const CAP_SECRET = process.env.CAP_SECRET || 'sk-rklEjxQyhgoaoo2bLUpgr5CFKAPZiUak1jncBumoQXo';
const CAP_VERIFY_URL = 'https://cap-production-5a17.up.railway.app/siteverify';
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.get('/shared.js', (_, res) => res.sendFile(path.join(__dirname, 'shared.js')));
app.get('/healthz', (_, res) => res.json({ ok: true, players: players.size }));

const httpServer = http.createServer(app);
const io = new Server(httpServer, { cors: { origin: '*' } });

const players = new Map();     // socket.id -> data pemain
const usedTokens = new Set();  // anti-replay token captcha
let scores = { A: 0, B: 0 };
let matchOver = false;

const solids = buildSolids();

/* ---------- FIX #1: verifikasi captcha sekarang robust ----------
   Widget mengirim array token; beberapa versi endpoint siteverify hanya
   menerima string. Kita coba KEDUA bentuknya sebelum menyatakan gagal. */
async function verifyCapTokens(tokens) {
  for (const response of [tokens, tokens[0]]) {
    try {
      const res = await fetch(CAP_VERIFY_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ secret: CAP_SECRET, response }),
      });
      const data = await res.json();
      if (data && data.success) return true;
    } catch (e) {
      console.error('[cap] layanan verifikasi tidak terjangkau:', e.message);
      return null; // gagal jaringan — BUKAN token salah
    }
  }
  return false;
}

/* ---------- util ---------- */
function snapObj(p) {
  return { id: p.id, n: p.name, t: p.team, x: +p.pos.x.toFixed(2), y: +p.pos.y.toFixed(2),
    z: +p.pos.z.toFixed(2), yaw: +p.yaw.toFixed(3), pitch: +p.pitch.toFixed(3), hp: p.hp,
    w: p.weapon, a: p.alive ? 1 : 0, c: p.crouch ? 1 : 0, mv: p.moving ? 1 : 0, k: p.kills, d: p.deaths };
}
function pickTeam() {
  let a = 0, b = 0;
  for (const p of players.values()) p.team === 'A' ? a++ : b++;
  return a <= b ? 'A' : 'B';
}
function spawnPos(team) {
  const s = MAP.spawns[team][Math.floor(Math.random() * MAP.spawns[team].length)];
  return { x: s[0] + (Math.random() - 0.5) * 1.6, y: 0, z: s[1] + (Math.random() - 0.5) * 1.6 };
}

/* ---------- raycast otoritatif (damage dihitung di server) ---------- */
function castRay(ox, oy, oz, dx, dy, dz, excludeId, maxT) {
  let bestT = maxT, hitPlayer = null, head = false;
  for (const s of solids) {
    const t = rayAABB(ox, oy, oz, dx, dy, dz, s.min, s.max);
    if (t !== null && t > 0.001 && t < bestT) { bestT = t; hitPlayer = null; }
  }
  for (const p of players.values()) {
    if (p.id === excludeId || !p.alive) continue;
    const r = RULES.hb.r;
    const min = [p.pos.x - r, p.pos.y, p.pos.z - r];
    const max = [p.pos.x + r, p.pos.y + RULES.hb.h, p.pos.z + r];
    const t = rayAABB(ox, oy, oz, dx, dy, dz, min, max);
    if (t !== null && t > 0.001 && t < bestT) {
      bestT = t; hitPlayer = p;
      head = oy + dy * t > p.pos.y + RULES.hb.head;
    }
  }
  return hitPlayer ? { t: bestT, type: 'player', p: hitPlayer, head }
       : bestT < maxT ? { t: bestT, type: 'map' } : null;
}

function kill(killer, victim, w, head) {
  victim.alive = false; victim.hp = 0; victim.deaths++; victim.diedAt = Date.now();
  if (killer !== victim) { killer.kills++; scores[killer.team]++; }
  io.emit('death', {
    victim: victim.id, vName: victim.name, vTeam: victim.team,
    killer: killer.id, kName: killer.name, kTeam: killer.team,
    w, head, scores: { A: scores.A, B: scores.B },
  });
  if (!matchOver && scores[killer.team] >= MAP.target) {
    matchOver = true;
    io.emit('match:end', { winner: killer.team, scores: { A: scores.A, B: scores.B } });
    setTimeout(() => { scores = { A: 0, B: 0 }; matchOver = false; io.emit('score', scores); }, 6000);
  }
}

function leaveGame(socket, reason) {
  const p = players.get(socket.id);
  if (!p) return;
  players.delete(socket.id);
  io.emit('player:leave', { id: p.id, n: p.name });
  io.emit('count', players.size);
  console.log(`[-] ${p.name} keluar (${reason || 'disconnect'}) — ${players.size} pemain`);
}

/* ---------- koneksi ---------- */
io.on('connection', (socket) => {
  socket.emit('count', players.size);

  socket.on('game:join', async ({ name, loadout, cap } = {}) => {
    if (socket.data.joining || players.has(socket.id)) return;

    // FIX #2: normalisasi token — terima array (hasil getResponse) maupun string
    let tokens = [];
    if (typeof cap === 'string' && cap.length > 8) tokens = [cap];
    else if (Array.isArray(cap)) tokens = cap.filter(t => typeof t === 'string' && t.length > 8).slice(0, 5);
    if (!tokens.length) return socket.emit('join:err', {
      msg: 'Token verifikasi tidak terkirim. Selesaikan captcha lalu klik MASUK MATCH lagi.' });

    const tokenKey = tokens.join('|');
    if (usedTokens.has(tokenKey)) return socket.emit('join:err', {
      msg: 'Token sudah pernah dipakai. Klik MUAT ULANG WIDGET lalu selesaikan captcha baru.' });

    socket.data.joining = true;
    try {
      const ok = await verifyCapTokens(tokens);
      if (ok === null) return socket.emit('join:err', { msg: 'Layanan verifikasi tidak dapat dihubungi. Coba beberapa saat lagi.' });
      if (!ok) return socket.emit('join:err', { msg: 'Verifikasi bot gagal. Klik MUAT ULANG WIDGET lalu selesaikan captcha baru.' });
      if (usedTokens.size > 2000) usedTokens.clear();
      usedTokens.add(tokenKey);

      const nm = String(name || '').replace(/[^\w \-]/g, '').trim().slice(0, 14)
        || 'PEMAIN-' + Math.floor(100 + Math.random() * 900);
      const primary = PRIMARIES.includes(loadout && loadout.primary) ? loadout.primary : 'rifle';
      const team = pickTeam();
      const pos = spawnPos(team);

      const p = {
        id: socket.id, name: nm, team, primary, weapon: primary,
        pos, yaw: team === 'A' ? Math.PI : 0, pitch: 0,
        hp: RULES.hp, alive: true, kills: 0, deaths: 0,
        crouch: false, moving: false, lastShot: 0, lastChat: 0, lastMoveT: 0, diedAt: 0,
      };
      players.set(socket.id, p);

      socket.emit('join:ok', {
        id: p.id, team, name: nm, primary,
        pos: [pos.x, pos.y, pos.z], yaw: p.yaw,
        players: [...players.values()].map(snapObj),
        scores: { A: scores.A, B: scores.B },
      });
      // FIX #3: broadcast state LENGKAP → pemain lain langsung muncul, tanpa nunggu snapshot
      socket.broadcast.emit('player:join', { p: snapObj(p) });
      io.emit('count', players.size);
      console.log(`[+] ${nm} (${team}) bergabung — ${players.size} pemain`);
    } finally { socket.data.joining = false; }
  });

  socket.on('move', (m) => {
    const p = players.get(socket.id);
    if (!p || !p.alive || !m || !Array.isArray(m.p)) return;
    const now = Date.now();
    const n = (v, lo, hi) => Math.max(lo, Math.min(hi, +v || 0));
    let x = n(m.p[0], -MAP.bound, MAP.bound);
    let y = n(m.p[1], 0, 12);
    let z = n(m.p[2], -MAP.bound, MAP.bound);

    // FIX #4: anti-teleport — batasi perpindahan sesuai selang antar paket.
    // lastMoveT = 0 berarti baru spawn/join → paket pertama diterima apa adanya.
    if (p.lastMoveT) {
      const dt = clamp((now - p.lastMoveT) / 1000, 0.05, 1);
      const maxD = 10 * dt + 1;
      const dist = Math.hypot(x - p.pos.x, y - p.pos.y, z - p.pos.z);
      if (dist > maxD) {
        const k = maxD / dist;
        x = p.pos.x + (x - p.pos.x) * k;
        y = p.pos.y + (y - p.pos.y) * k;
        z = p.pos.z + (z - p.pos.z) * k;
      }
    }
    p.pos.x = x; p.pos.y = y; p.pos.z = z;
    p.lastMoveT = now;
    p.yaw = n(m.yaw, -Math.PI * 4, Math.PI * 4);
    p.pitch = n(m.pitch, -1.6, 1.6);
    p.crouch = !!m.crouch;
    p.moving = !!m.moving;
  });

  socket.on('switch', ({ w } = {}) => {
    const p = players.get(socket.id);
    if (!p || !w) return;
    if (w !== p.primary && w !== 'pistol' && w !== 'knife') return;
    p.weapon = w;
  });

  socket.on('shoot', ({ w, d } = {}) => {
    const p = players.get(socket.id);
    if (!p || !p.alive || !WEAPONS[w] || w !== p.weapon || !Array.isArray(d)) return;
    const wp = WEAPONS[w];

    let dx = +d[0] || 0, dy = +d[1] || 0, dz = +d[2] || 0;
    const L = Math.hypot(dx, dy, dz);
    if (!isFinite(L) || L < 0.5 || L > 1.5) return;
    dx /= L; dy /= L; dz /= L;

    const now = Date.now();
    if (now - p.lastShot < 60000 / wp.rpm * 0.75) return; // anti rapid-fire
    p.lastShot = now;

    const ox = p.pos.x, oy = p.pos.y + 1.62, oz = p.pos.z; // origin dari posisi server
    io.emit('shot', { id: p.id, w, o: [+ox.toFixed(2), +oy.toFixed(2), +oz.toFixed(2)], d: [dx, dy, dz] });

    const hit = castRay(ox, oy, oz, dx, dy, dz, p.id, wp.range);
    if (!hit || hit.type !== 'player') return;
    const victim = hit.p;
    if (victim.team === p.team) return; // tanpa friendly-fire

    const dmg = Math.round(wp.dmg * (hit.head ? wp.head : 1));
    victim.hp -= dmg;
    io.to(victim.id).emit('dmg', { from: p.id, fromPos: [ox, oy, oz], dmg, hp: Math.max(0, victim.hp) });
    io.to(p.id).emit('hit', { dmg, head: hit.head });
    if (victim.hp <= 0 && victim.alive) kill(p, victim, w, hit.head);
  });

  socket.on('respawn', () => {
    const p = players.get(socket.id);
    if (!p || p.alive) return;
    if (Date.now() - p.diedAt < RULES.respawn * 900) return;
    p.alive = true; p.hp = RULES.hp;
    p.pos = spawnPos(p.team);
    p.yaw = p.team === 'A' ? Math.PI : 0;
    p.pitch = 0;
    p.weapon = p.primary;
    p.lastMoveT = 0; // teleport spawn sah → paket move pertama diterima langsung
    socket.emit('respawn:ok', { pos: [p.pos.x, p.pos.y, p.pos.z], yaw: p.yaw, hp: p.hp });
  });

  // FIX #5: chat multiplayer (sanitasi + rate-limit 2 pesaan/detik)
  socket.on('chat', ({ msg } = {}) => {
    const p = players.get(socket.id);
    if (!p) return;
    const now = Date.now();
    if (now - p.lastChat < 500) return;
    p.lastChat = now;
    const m = String(msg || '').replace(/[^\w \.,!?\-:()]/g, '').trim().slice(0, 80);
    if (!m) return;
    io.emit('chat', { n: p.name, t: p.team, m });
  });

  socket.on('ping', (t) => socket.emit('pong', t));
  socket.on('game:leave', () => leaveGame(socket, 'manual'));
  socket.on('disconnect', () => leaveGame(socket, 'disconnect'));
});

/* ---------- snapshot 20 Hz ---------- */
setInterval(() => {
  const arr = [];
  for (const p of players.values()) arr.push(snapObj(p));
  io.emit('snap', arr);
}, 1000 / RULES.tick);

httpServer.listen(PORT, () => console.log(`STRIKE VECTOR aktif → http://localhost:${PORT}`));
