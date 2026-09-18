/**
 * STRIKE VECTOR — server game (Express + Socket.io + verifikasi Cap.js)
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

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.get('/shared.js', (_, res) => res.sendFile(path.join(__dirname, 'shared.js')));
app.get('/healthz', (_, res) => res.json({ ok: true, players: players.size }));

const httpServer = http.createServer(app);
const io = new Server(httpServer, { cors: { origin: '*' } });

/* ---------- keadaan match ---------- */
const players = new Map();     // socket.id -> data pemain
const usedTokens = new Set();  // anti-replay token captcha
let scores = { A: 0, B: 0 };
let matchOver = false;

const solids = buildSolids();

/* ---------- verifikasi captcha Cap.js (sesuai spec) ---------- */
async function verifyCap(token) {
  try {
    const res = await fetch(CAP_VERIFY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ secret: CAP_SECRET, response: token }),
    });
    const { success } = await res.json();
    return !!success;
  } catch (e) {
    console.error('[cap] layanan verifikasi tidak terjangkau:', e.message);
    return null; // null = gagal jaringan, bukan token salah
  }
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

/* ---------- raycast otoritatif (damage dihitung di sini) ---------- */
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
      head = oy + dy * t > p.pos.y + RULES.hb.head; // kriteria headshot
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

/* ---------- koneksi socket ---------- */
io.on('connection', (socket) => {
  socket.emit('count', players.size);

  socket.on('game:join', async ({ name, loadout, token } = {}) => {
    if (socket.data.joining || players.has(socket.id)) return;
    if (typeof token !== 'string' || !token) return socket.emit('join:err', { msg: 'Token verifikasi tidak valid.' });
    if (usedTokens.has(token)) return socket.emit('join:err', { msg: 'Token verifikasi sudah dipakai. Selesaikan ulang captcha.' });

    socket.data.joining = true;
    try {
      const ok = await verifyCap(token);
      if (ok === null) return socket.emit('join:err', { msg: 'Layanan verifikasi tidak dapat dihubungi. Coba beberapa saat lagi.' });
      if (!ok) return socket.emit('join:err', { msg: 'Verifikasi bot gagal. Selesaikan ulang captcha.' });
      if (usedTokens.size > 2000) usedTokens.clear();
      usedTokens.add(token); // satu token = satu kali masuk

      const nm = String(name || '').replace(/[^\w \-]/g, '').trim().slice(0, 14)
        || 'PEMAIN-' + Math.floor(100 + Math.random() * 900);
      const primary = PRIMARIES.includes(loadout && loadout.primary) ? loadout.primary : 'rifle';
      const team = pickTeam();
      const pos = spawnPos(team);

      const p = {
        id: socket.id, name: nm, team, primary, weapon: primary,
        pos, yaw: team === 'A' ? Math.PI : 0, pitch: 0,
        hp: RULES.hp, alive: true, kills: 0, deaths: 0,
        crouch: false, moving: false, lastShot: 0, diedAt: 0,
      };
      players.set(socket.id, p);

      socket.emit('join:ok', {
        id: p.id, team, name: nm, primary,
        pos: [pos.x, pos.y, pos.z], yaw: p.yaw,
        players: [...players.values()].map(snapObj),
        scores: { A: scores.A, B: scores.B },
      });
      socket.broadcast.emit('player:join', { id: p.id, n: nm, t: team });
      io.emit('count', players.size);
      console.log(`[+] ${nm} (${team}) bergabung — ${players.size} pemain`);
    } finally { socket.data.joining = false; }
  });

  socket.on('move', (m) => {
    const p = players.get(socket.id);
    if (!p || !p.alive || !m || !Array.isArray(m.p)) return;
    const n = (v, lo, hi) => Math.max(lo, Math.min(hi, +v || 0));
    p.pos.x = n(m.p[0], -MAP.bound, MAP.bound);
    p.pos.y = n(m.p[1], 0, 12);
    p.pos.z = n(m.p[2], -MAP.bound, MAP.bound);
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

    // validasi arah
    let dx = +d[0] || 0, dy = +d[1] || 0, dz = +d[2] || 0;
    const L = Math.hypot(dx, dy, dz);
    if (!isFinite(L) || L < 0.5 || L > 1.5) return;
    dx /= L; dy /= L; dz /= L;

    // anti rapid-fire: interval minimum per senjata (toleransi jitter)
    const now = Date.now();
    if (now - p.lastShot < 60000 / wp.rpm * 0.75) return;
    p.lastShot = now;

    // origin selalu dari posisi server (anti tembak-dari-mana-saja)
    const ox = p.pos.x, oy = p.pos.y + 1.62, oz = p.pos.z;
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
    if (Date.now() - p.diedAt < RULES.respawn * 900) return; // hormati countdown
    p.alive = true; p.hp = RULES.hp;
    p.pos = spawnPos(p.team);
    p.yaw = p.team === 'A' ? Math.PI : 0;
    p.weapon = p.primary;
    socket.emit('respawn:ok', { pos: [p.pos.x, p.pos.y, p.pos.z], yaw: p.yaw, hp: p.hp });
  });

  socket.on('ping', (t) => socket.emit('pong', t));
  socket.on('game:leave', () => leaveGame(socket, 'manual'));
  socket.on('disconnect', () => leaveGame(socket, 'disconnect'));
});

/* ---------- snapshot 20 Hz ke semua klien ---------- */
setInterval(() => {
  const arr = [];
  for (const p of players.values()) arr.push(snapObj(p));
  io.emit('snap', arr);
}, 1000 / RULES.tick);

httpServer.listen(PORT, () => {
  console.log(`STRIKE VECTOR aktif → http://localhost:${PORT}`);
});