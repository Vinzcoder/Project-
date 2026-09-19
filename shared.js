/* shared.js — sumber kebenaran tunggal: peta, senjata, aturan, raycast.
   Dipakai oleh server.js (Node) dan index.html (browser). Tidak berubah dari v1.0. */

const WEAPONS = {
  rifle:  { key:'rifle',  name:'VEKTOR-77',    slot:1, desc:'Rifle serbu serbaguna. Recoil terkontrol, presisi di jarak menengah.',
            dmg:30,  head:4,   rpm:600, mag:30, reserve:90,  reload:2.3, spread:0.014, adsSpread:0.004,  kick:1.5, range:300, auto:true,  adsFov:60, tracer:0xffd27a },
  smg:    { key:'smg',    name:'WASP-9',       slot:1, desc:'SMG cepat untuk duel jarak dekat. Spread besar saat hip-fire.',
            dmg:23,  head:3.2, rpm:850, mag:35, reserve:140, reload:1.9, spread:0.028, adsSpread:0.011,  kick:0.9, range:200, auto:true,  adsFov:64, tracer:0xffd27a },
  sniper: { key:'sniper', name:'LONGBOW .338', slot:1, desc:'Bolt-action satu-tembakan-satu-bunuh. Wajib bidik lewat scope.',
            dmg:115, head:2,   rpm:42,  mag:5,  reserve:25,  reload:3.4, spread:0.08,  adsSpread:0.0006, kick:4.2, range:400, auto:false, adsFov:24, scoped:true, tracer:0xfff1c9 },
  pistol: { key:'pistol', name:'P-9 COMPACT',  slot:2, desc:'Sidearm andalan. Akurat, cepat, cadangan amunisi melimpah.',
            dmg:27,  head:4,   rpm:430, mag:12, reserve:72,  reload:1.6, spread:0.02,  adsSpread:0.008,  kick:1.1, range:150, auto:false, adsFov:66, tracer:0xffd27a },
  knife:  { key:'knife',  name:'PISAU TEMPUR', slot:3, desc:'Dua tikaman untuk satu lawan. Senyap dan memalukan bagi korban.',
            dmg:58,  head:1.5, rpm:110, mag:0,  reserve:0,   reload:0,   spread:0,     adsSpread:0,      kick:0.4, range:2.3, auto:false, melee:true },
};

const PRIMARIES = ['rifle', 'smg', 'sniper'];

const MAP = {
  name: 'HANGAR-07', mode: 'TEAM DEATHMATCH', target: 25,
  bound: 30, wallH: 7,
  boxes: [
    { x: 0,   z: 0,    y: 0,   w: 5,   h: 1.1, d: 5,   c: 0x59616b, m: 'crate' },
    { x: -7.5,z: 0,    y: 0,   w: 1.6, h: 3.4, d: 10,  c: 0x3a4149, m: 'wall'  },
    { x: 7.5, z: 0,    y: 0,   w: 1.6, h: 3.4, d: 10,  c: 0x3a4149, m: 'wall'  },
    { x: -16, z: -9,   y: 0,   w: 2.6, h: 1.1, d: 2.6, c: 0x6f5d3f, m: 'crate' },
    { x: -16, z: -9,   y: 1.1, w: 2.1, h: 1.05,d: 2.1, c: 0x7c6844, m: 'crate' },
    { x: 16,  z: -9,   y: 0,   w: 2.6, h: 1.1, d: 2.6, c: 0x6f5d3f, m: 'crate' },
    { x: 16,  z: -9,   y: 1.1, w: 2.1, h: 1.05,d: 2.1, c: 0x7c6844, m: 'crate' },
    { x: -16, z: 9,    y: 0,   w: 2.6, h: 1.1, d: 2.6, c: 0x6f5d3f, m: 'crate' },
    { x: -16, z: 9,    y: 1.1, w: 2.1, h: 1.05,d: 2.1, c: 0x7c6844, m: 'crate' },
    { x: 16,  z: 9,    y: 0,   w: 2.6, h: 1.1, d: 2.6, c: 0x6f5d3f, m: 'crate' },
    { x: 16,  z: 9,    y: 1.1, w: 2.1, h: 1.05,d: 2.1, c: 0x7c6844, m: 'crate' },
    { x: -24, z: 3,    y: 0,   w: 1.5, h: 3.6, d: 14,  c: 0x3a4149, m: 'wall'  },
    { x: 24,  z: -3,   y: 0,   w: 1.5, h: 3.6, d: 14,  c: 0x3a4149, m: 'wall'  },
    { x: -10, z: 16,   y: 0,   w: 2,   h: 5,   d: 2,   c: 0x454d56, m: 'wall'  },
    { x: 10,  z: 16,   y: 0,   w: 2,   h: 5,   d: 2,   c: 0x454d56, m: 'wall'  },
    { x: -10, z: -16,  y: 0,   w: 2,   h: 5,   d: 2,   c: 0x454d56, m: 'wall'  },
    { x: 10,  z: -16,  y: 0,   w: 2,   h: 5,   d: 2,   c: 0x454d56, m: 'wall'  },
    { x: 0,   z: -22.5,y: 0,   w: 13,  h: 2.2, d: 1.2, c: 0x3a4149, m: 'wall'  },
    { x: 0,   z: 22.5, y: 0,   w: 13,  h: 2.2, d: 1.2, c: 0x3a4149, m: 'wall'  },
    { x: -22, z: -18,  y: 0,   w: 2.4, h: 1.1, d: 2.4, c: 0x6f5d3f, m: 'crate' },
    { x: 22,  z: 18,   y: 0,   w: 2.4, h: 1.1, d: 2.4, c: 0x6f5d3f, m: 'crate' },
  ],
  spawns: {
    A: [[-9,-26.5],[-4.5,-26.5],[0,-27],[4.5,-26.5],[9,-26.5]],
    B: [[-9, 26.5],[-4.5, 26.5],[0, 27],[4.5, 26.5],[9, 26.5]],
  },
};

const RULES = { tick: 20, respawn: 4, hp: 100, hb: { r: 0.35, h: 1.8, head: 1.5 } };

/* Ray vs AABB (slab method) → t jarak masuk, atau null. */
function rayAABB(ox, oy, oz, dx, dy, dz, min, max) {
  let tmin = 0, tmax = Infinity;
  const o = [ox, oy, oz], d = [dx, dy, dz];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) { if (o[i] < min[i] || o[i] > max[i]) return null; continue; }
    let t1 = (min[i] - o[i]) / d[i], t2 = (max[i] - o[i]) / d[i];
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  return tmin;
}

function buildSolids() {
  const s = MAP.boxes.map(b => ({
    min: [b.x - b.w / 2, b.y, b.z - b.d / 2],
    max: [b.x + b.w / 2, b.y + b.h, b.z + b.d / 2],
  }));
  const B = 31.5, H = MAP.wallH;
  s.push(
    { min: [-33, 0, -33], max: [33, H, -B] },
    { min: [-33, 0, B],   max: [33, H, 33] },
    { min: [-33, 0, -33], max: [-B, H, 33] },
    { min: [B, 0, -33],   max: [33, H, 33] },
  );
  return s;
}

if (typeof module !== 'undefined') module.exports = { WEAPONS, PRIMARIES, MAP, RULES, rayAABB, buildSolids };
