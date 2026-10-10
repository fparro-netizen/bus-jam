// Bus Jam: rendering, animation, input, UI. Rules live in core.js.
import * as THREE from './lib/three.module.min.js';
import * as C from './core.js';
import { LEVELS } from './levels.js';

const $ = id => document.getElementById(id);
const SPOT_W = 1.15, SPOT_S = -1.6, SPOT_N = -6.0, NOSE_Z = -5.72, RING = 0.8;
const GATE = [0, -6.55], QROWS = [-6.55, -7.3, -8.05], QX = 4.7, QSPACE = 0.5;
const SPEED = 15, WALK = 7;

// ---------------- save ----------------
const SAVE_KEY = 'busjam:v1';
let save = { unlocked: 1, stars: {}, sound: true, last: 0 };
try { Object.assign(save, JSON.parse(localStorage.getItem(SAVE_KEY) || '{}')); } catch (e) {}
const persist = () => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) {} };

// ---------------- sound ----------------
const Sound = (() => {
  let ctx = null, master = null;
  function ensure() {
    if (!save.sound) return null;
    if (!ctx) { const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null; ctx = new AC(); master = ctx.createGain(); master.gain.value = 0.5; master.connect(ctx.destination); }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  function tone(f0, f1, dur, type = 'sine', vol = 0.3, delay = 0) {
    const c = ensure(); if (!c) return; const t = c.currentTime + delay;
    const o = c.createOscillator(), g = c.createGain(); o.type = type;
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.02);
  }
  function noise(dur, f0, f1, vol = 0.25, delay = 0) {
    const c = ensure(); if (!c) return; const t = c.currentTime + delay;
    const b = c.createBuffer(1, Math.floor(c.sampleRate * dur), c.sampleRate); const d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const s = c.createBufferSource(); s.buffer = b; const f = c.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.2;
    f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(master); s.start(t);
  }
  return {
    unlock: ensure,
    go() { tone(90, 220, 0.32, 'sawtooth', 0.12); tone(180, 420, 0.25, 'triangle', 0.12); },
    honk() { tone(370, 360, 0.12, 'square', 0.12); tone(370, 360, 0.16, 'square', 0.12, 0.15); },
    board(n) { tone(520 + n * 60, 700 + n * 70, 0.09, 'triangle', 0.16); },
    full() { [660, 880, 1100].forEach((f, i) => tone(f, f * 1.02, 0.14, 'triangle', 0.18, i * 0.07)); },
    depart() { noise(0.45, 300, 1200, 0.12); },
    shuffle() { noise(0.5, 400, 3000, 0.2); [500, 700, 900, 1200].forEach((f, i) => tone(f, f, 0.08, 'sine', 0.12, i * 0.06)); },
    win() { [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, f, 0.22, 'triangle', 0.2, i * 0.1)); },
    stuck() { tone(300, 180, 0.4, 'sine', 0.2); },
    click() { tone(800, 600, 0.05, 'sine', 0.1); },
  };
})();

// ---------------- three.js setup ----------------
const canvas = $('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene(); scene.background = new THREE.Color('#7cc36b');
const camera = new THREE.OrthographicCamera(-5, 5, 5, -5, 0.1, 200);
scene.add(new THREE.HemisphereLight(0xffffff, 0x6b7f99, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 2.1); sun.position.set(-6, 14, 7); sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024); Object.assign(sun.shadow.camera, { left: -10, right: 10, top: 12, bottom: -12, near: 1, far: 40 }); sun.shadow.bias = -0.0015;
scene.add(sun, sun.target);

const matCache = {};
const lam = (hex, extra) => { const k = hex + (extra ? JSON.stringify(extra) : ''); return matCache[k] ||= new THREE.MeshLambertMaterial(Object.assign({ color: hex }, extra || {})); };
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const GEO = { wheel: new THREE.CylinderGeometry(0.14, 0.14, 0.09, 14).rotateZ(Math.PI / 2), stud: new THREE.SphereGeometry(0.075, 10, 8), light: box(0.12, 0.07, 0.03) };
const arrowShape = new THREE.Shape(); arrowShape.moveTo(0, 0.3); arrowShape.lineTo(0.2, 0.05); arrowShape.lineTo(0.08, 0.05); arrowShape.lineTo(0.08, -0.25); arrowShape.lineTo(-0.08, -0.25); arrowShape.lineTo(-0.08, 0.05); arrowShape.lineTo(-0.2, 0.05); arrowShape.closePath();
GEO.arrow = new THREE.ShapeGeometry(arrowShape).rotateX(-Math.PI / 2);
const M = { glass: lam('#22324d'), roof: lam('#f4f7fb'), tire: lam('#1f2430'), studEmpty: lam('#3b4658'), studFull: lam('#ffffff'), arrow: lam('#ffffff'), arrowDark: lam('#1e293b'), head: lam('#ffd7b0'), lightF: lam('#fff3b0'), lightR: lam('#ff4d4d') };
const lighter = (hex, k = 0.35) => '#' + new THREE.Color(hex).lerp(new THREE.Color('#ffffff'), k).getHexString();

function makeVehicle(v, colorIdx) {
  const g = new THREE.Group(); const body = new THREE.Group(); g.add(body);
  const Lm = v.len * 0.94 - 0.14, W = 0.74; const col = C.COLORS[colorIdx];
  const colorParts = []; const add = (geo, mat, x, y, z, shadow = true) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); if (shadow) m.castShadow = true; body.add(m); return m; };
  const studs = []; let roofY;
  if (v.len === 2) {
    colorParts.push(add(box(W, 0.32, Lm), lam(col), 0, 0.28, 0));
    add(box(W * 0.84, 0.24, Lm * 0.56), M.glass, 0, 0.56, 0.06);
    colorParts.push(add(box(W * 0.86, 0.05, Lm * 0.58), lam(col), 0, 0.69, 0.06, false)); roofY = 0.72;
  } else {
    const dd = v.seats >= 10; const H = dd ? 0.98 : 0.6;
    colorParts.push(add(box(W, H, Lm), lam(col), 0, 0.12 + H / 2, 0));
    const bands = dd ? [0.12 + H - 0.2, 0.12 + H / 2 - 0.08] : [0.12 + H - 0.19];
    for (const y of bands) add(box(W + 0.02, 0.17, Lm - 0.34), M.glass, 0, y, 0.06, false);
    add(box(W - 0.12, dd ? 0.5 : 0.24, 0.04), M.glass, 0, 0.12 + H - (dd ? 0.36 : 0.2), -Lm / 2 - 0.01, false);
    colorParts.push(add(box(W - 0.06, 0.04, Lm - 0.1), lam(col), 0, 0.12 + H + 0.02, 0, false)); roofY = 0.12 + H + 0.05;
    colorParts.push(add(box(W + 0.03, 0.08, Lm + 0.02), lam(lighter(col)), 0, 0.2, 0, false));
  }
  for (const s of [-1, 1]) { add(GEO.light, M.lightF, s * 0.24, 0.3, -Lm / 2 - 0.01, false); add(GEO.light, M.lightR, s * 0.26, 0.3, Lm / 2 + 0.01, false); }
  const axles = v.len >= 4 ? [-Lm / 2 + 0.38, Lm / 2 - 0.38, Lm / 2 - 0.75] : [-Lm / 2 + 0.32, Lm / 2 - 0.32];
  for (const z of axles) for (const s of [-1, 1]) add(GEO.wheel, M.tire, s * (W / 2 - 0.02), 0.14, z, false);
  const lum = new THREE.Color(col).getHSL({}).l, darkArrow = ['#facc15', '#22c55e', '#14b8c4', '#f97316'].includes(col);
  const arrow = add(GEO.arrow, darkArrow ? M.arrowDark : M.arrow, 0, roofY + 0.005, 0, false); arrow.scale.setScalar(v.len === 2 ? 1 : 1.25);
  // seat studs on the roof, two columns
  const rows = v.seats / 2, span = v.len === 2 ? Lm * 0.45 : Lm - 0.4;
  for (let r = 0; r < rows; r++) for (const s of [-1, 1]) {
    const z = rows === 1 ? 0 : -span / 2 + span * r / (rows - 1) + (v.len === 2 ? 0.06 : 0);
    const m = add(GEO.stud, M.studEmpty, s * 0.17, roofY + 0.02, z, false); m.visible = false; studs.push(m);
  }
  g.userData = { colorParts, studs, arrow, Lm };
  return g;
}

function makeCone() {
  const g = new THREE.Group();
  const base = new THREE.Mesh(box(0.62, 0.06, 0.62), lam('#f97316')); base.position.y = 0.03; base.castShadow = true;
  const cone = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.62, 16), lam('#f97316')); cone.position.y = 0.37; cone.castShadow = true;
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.135, 0.165, 0.11, 16), lam('#ffffff')); band.position.y = 0.4;
  g.add(base, cone, band); return g;
}

// people: instanced bodies + heads
const MAXP = 140;
const peopleBody = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.1, 0.16, 4, 8), new THREE.MeshLambertMaterial({ color: 0xffffff }), MAXP);
const peopleHead = new THREE.InstancedMesh(new THREE.SphereGeometry(0.085, 10, 8), M.head, MAXP);
peopleBody.castShadow = true; peopleBody.instanceMatrix.setUsage(THREE.DynamicDrawUsage); peopleHead.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
peopleBody.frustumCulled = false; peopleHead.frustumCulled = false;
for (let i = 0; i < MAXP; i++) peopleBody.setColorAt(i, new THREE.Color('#ffffff'));
scene.add(peopleBody, peopleHead);

// queue path
const QPTS = [[GATE[0], QROWS[0]], [-QX, QROWS[0]], [-QX, QROWS[1]], [QX, QROWS[1]], [QX, QROWS[2]], [-QX, QROWS[2]]];
const QCUM = [0]; for (let i = 1; i < QPTS.length; i++) QCUM.push(QCUM[i - 1] + Math.hypot(QPTS[i][0] - QPTS[i - 1][0], QPTS[i][1] - QPTS[i - 1][1]));
const QLEN = QCUM[QCUM.length - 1]; const QVIS = Math.floor(QLEN / QSPACE) + 1;
function qPoint(d) {
  if (d >= QLEN) return [QPTS[QPTS.length - 1][0] + (d - QLEN), QPTS[QPTS.length - 1][1]];
  let i = 1; while (QCUM[i] < d) i++;
  const t = (d - QCUM[i - 1]) / (QCUM[i] - QCUM[i - 1]); return [QPTS[i - 1][0] + (QPTS[i][0] - QPTS[i - 1][0]) * t, QPTS[i - 1][1] + (QPTS[i][1] - QPTS[i - 1][1]) * t];
}

// ---------------- static world (rebuilt per level size) ----------------
let world = null;
function buildWorld(lv) {
  if (world) { scene.remove(world); world.traverse(o => { if (o.geometry && !Object.values(GEO).includes(o.geometry)) o.geometry.dispose(); }); }
  world = new THREE.Group(); scene.add(world);
  const x0 = -lv.w / 2, xL = x0 - RING, xR = x0 + lv.w + RING, zT = -RING, zB = lv.h + RING;
  const plane = (w, d, color, x, z, y = 0) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), lam(color)); m.position.set(x, y, z); m.receiveShadow = true; world.add(m); return m; };
  plane(60, 60, '#7cc36b', 0, 0, -0.01);
  // roads
  plane(xR - xL + 1.2, zB - zT + 1.2, '#59606b', (xL + xR) / 2, (zT + zB) / 2, 0);
  plane(12.4, 1.3, '#59606b', 0, zT, 0.001);
  // lot
  plane(lv.w + 0.1, lv.h + 0.1, '#6b7380', 0, lv.h / 2, 0.002);
  const lines = []; for (let x = 0; x <= lv.w; x++) lines.push(x0 + x, 0.004, 0, x0 + x, 0.004, lv.h); for (let z = 0; z <= lv.h; z++) lines.push(x0, 0.004, z, x0 + lv.w, 0.004, z);
  const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
  world.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.16 })));
  // lot curb
  const curbM = lam('#d9dee6'); const curb = (w, d, x, z) => { const m = new THREE.Mesh(box(w, 0.06, d), curbM); m.position.set(x, 0.03, z); m.receiveShadow = true; world.add(m); };
  // dashed centre line on ring road
  const dashM = lam('#f5d042'); const dash = (x, z, rot) => { const m = new THREE.Mesh(box(0.32, 0.01, 0.06), dashM); m.position.set(x, 0.006, z); m.rotation.y = rot; world.add(m); };
  for (let z = 0.3; z < lv.h; z += 0.7) { dash(xL, z, Math.PI / 2); dash(xR, z, Math.PI / 2); }
  for (let x = xL + 0.4; x < xR - 0.2; x += 0.7) dash(x, zB, 0);
  // parking spots
  plane(8 * SPOT_W + 0.4, SPOT_S - SPOT_N + 0.1, '#4d545e', 0, (SPOT_S + SPOT_N) / 2, 0.003);
  const lineM = lam('#ffffff');
  for (let i = 0; i <= 8; i++) { const m = new THREE.Mesh(box(0.06, 0.012, SPOT_S - SPOT_N - 0.3), lineM); m.position.set((i - 4) * SPOT_W, 0.007, (SPOT_S + SPOT_N) / 2 - 0.15); world.add(m); }
  curb(8 * SPOT_W + 0.5, 0.12, 0, SPOT_N - 0.06);
  for (let i = 0; i < 8; i++) { const m = new THREE.Mesh(new THREE.CircleGeometry(0.16, 16).rotateX(-Math.PI / 2), lam('#6b7380')); m.position.set((i - 3.5) * SPOT_W, 0.008, SPOT_N + 0.5); world.add(m); }
  // plaza + queue path
  plane(12.4, 3.4, '#efe3c8', 0, -7.6, 0.002);
  const pathM = lam('#f9f3e3');
  const seg = (a, b) => { const len = Math.hypot(b[0] - a[0], b[1] - a[1]) + 0.36; const m = new THREE.Mesh(box(len, 0.012, 0.36), pathM); m.position.set((a[0] + b[0]) / 2, 0.006, (a[1] + b[1]) / 2); m.rotation.y = -Math.atan2(b[1] - a[1], b[0] - a[0]); m.receiveShadow = true; world.add(m); };
  for (let i = 1; i < QPTS.length; i++) seg(QPTS[i - 1], QPTS[i]);
  const postM = lam('#c0a060'); const ropeM = lam('#d94b4b');
  for (const z of [(QROWS[0] + QROWS[1]) / 2, (QROWS[1] + QROWS[2]) / 2]) {
    for (let x = -QX + (z > QROWS[1] ? 0.6 : 0); x <= QX - (z < QROWS[1] ? 0.6 : 0); x += 1.25) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.32, 8), postM); p.position.set(x, 0.16, z); world.add(p); }
    const r = new THREE.Mesh(box(2 * QX - 0.6, 0.03, 0.03), ropeM); r.position.set(z > QROWS[1] ? 0.3 : -0.3, 0.28, z); world.add(r);
  }
  // gate sign
  const sign = new THREE.Mesh(box(0.9, 0.08, 0.3), lam('#2b6cb0')); sign.position.set(GATE[0] + 0.9, 0.05, GATE[1] + 0.45); world.add(sign);
  // trees
  const trunkG = new THREE.CylinderGeometry(0.07, 0.09, 0.4, 8), leafG = new THREE.IcosahedronGeometry(0.42, 1);
  const leafM = lam('#3f9b4a'), leafM2 = lam('#57b35a'), trunkM = lam('#8a5a33');
  const R = C.rng(lv.w * 31 + lv.h);
  const spots = [];
  for (let z = -8.5; z < zB + 3; z += 1.1) for (const s of [-1, 1]) spots.push([s * (Math.max(xR + 1.3, 6.6) + R() * 0.8), z + R() * 0.4]);
  for (const [x, z] of spots) {
    if (z > -8.3 && z < SPOT_S && Math.abs(x) < 6.6) continue;
    const t = new THREE.Group(); const tr = new THREE.Mesh(trunkG, trunkM); tr.position.y = 0.2; const lf = new THREE.Mesh(leafG, R() < 0.5 ? leafM : leafM2); lf.position.y = 0.62; lf.castShadow = true; lf.scale.setScalar(0.8 + R() * 0.5);
    t.add(tr, lf); t.position.set(x, 0, z); world.add(t);
  }
  return { x0, xL, xR, zT, zB };
}

// ---------------- game state ----------------
let L = null;           // layout for current level
let levelIdx = 0, state = null, undoStack = [], mode = 'title';
let V = [];             // vehicle visuals
let cones = [];
let people = [];        // visual people still in line, in order
let walkers = [];
let sched = [];
let now = 0;
let spotFreeAt = new Array(8).fill(0), gateFreeAt = 0;
let pendingCheck = false, overlayShown = false;

const sx = i => (i - 3.5) * SPOT_W;
const cellCenter = v => { const [dx, dy] = C.DIRS[v.dir]; return [L.x0 + v.x + 0.5 - dx * (v.len - 1) / 2, v.y + 0.5 - dy * (v.len - 1) / 2]; };
const headingOf = (dx, dz) => Math.atan2(-dx, -dz);
const parkZ = vis => NOSE_Z + vis.g.userData.Lm / 2;
const at = (t, fn) => { sched.push({ t, fn }); };

function fillet(pts, r = 0.55) {
  if (pts.length < 3) return pts;
  const out = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const A = pts[i - 1], B = pts[i], Cc = pts[i + 1];
    const la = Math.hypot(A[0] - B[0], A[1] - B[1]), lc = Math.hypot(Cc[0] - B[0], Cc[1] - B[1]);
    if (la < 1e-6 || lc < 1e-6) continue;
    const rr = Math.min(r, la / 2, lc / 2);
    const P1 = [B[0] + (A[0] - B[0]) / la * rr, B[1] + (A[1] - B[1]) / la * rr], P2 = [B[0] + (Cc[0] - B[0]) / lc * rr, B[1] + (Cc[1] - B[1]) / lc * rr];
    for (let k = 0; k <= 6; k++) { const t = k / 6, u = 1 - t; out.push([u * u * P1[0] + 2 * u * t * B[0] + t * t * P2[0], u * u * P1[1] + 2 * u * t * B[1] + t * t * P2[1]]); }
  }
  out.push(pts[pts.length - 1]); return out;
}
function mkPath(pts) { const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])); return { pts, cum, len: cum[cum.length - 1] }; }
function samplePath(p, d) {
  d = Math.max(0, Math.min(p.len, d)); let i = 1; while (i < p.pts.length - 1 && p.cum[i] < d) i++;
  const a = p.pts[i - 1], b = p.pts[i], seg = p.cum[i] - p.cum[i - 1] || 1, t = (d - p.cum[i - 1]) / seg;
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, b[0] - a[0], b[1] - a[1]];
}
function exitPath(vid, spot) {
  const v = state.level.vehicles[vid]; const [dx, dy] = C.DIRS[v.dir]; const c = cellCenter(v);
  const { xL, xR, zT, zB } = L; const Wr = xR - xL, Hr = zB - zT, P = 2 * (Wr + Hr);
  let E;
  if (v.dir === 'N') E = [c[0], zT]; else if (v.dir === 'S') E = [c[0], zB]; else if (v.dir === 'E') E = [xR, c[1]]; else E = [xL, c[1]];
  const sOf = ([x, z]) => Math.abs(z - zT) < 1e-6 ? x - xL : Math.abs(x - xR) < 1e-6 ? Wr + (z - zT) : Math.abs(z - zB) < 1e-6 ? Wr + Hr + (xR - x) : 2 * Wr + Hr + (zB - z);
  const tx = sx(spot), T = [Math.max(xL, Math.min(xR, tx)), zT];
  const sE = sOf(E), sT = sOf(T); const corners = [[xL, zT, 0], [xR, zT, Wr], [xR, zB, Wr + Hr], [xL, zB, 2 * Wr + Hr]];
  const d1 = ((sT - sE) % P + P) % P, d2 = P - d1; const pts = [c, E];
  // leaving north: always turn toward the spot along the top road
  const cw = v.dir === 'N' ? tx >= E[0] : d1 <= d2;
  const list = corners.map(([x, z, s]) => ({ x, z, d: cw ? ((s - sE) % P + P) % P : ((sE - s) % P + P) % P })).filter(k => k.d > 1e-6 && k.d < (cw ? d1 : d2) - 1e-6).sort((a, b) => a.d - b.d);
  for (const k of list) pts.push([k.x, k.z]);
  pts.push(T); if (Math.abs(T[0] - tx) > 1e-6) pts.push([tx, zT]);
  pts.push([tx, zT - 0.6]); pts.push([tx, parkZ(V[vid])]);
  const clean = [pts[0]]; for (const p of pts.slice(1)) { const q = clean[clean.length - 1]; if (Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-4) clean.push(p); }
  return mkPath(fillet(clean));
}

// ---------------- scene sync ----------------
function clearDynamic() {
  V.forEach(o => o && o.g.parent && scene.remove(o.g)); V = [];
  cones.forEach(c => scene.remove(c)); cones = [];
  people = []; walkers = []; sched = []; spotFreeAt.fill(0); gateFreeAt = 0;
}
function syncScene(pop) {
  clearDynamic();
  const lv = state.level;
  for (const [x, y] of lv.blockers) { const c = makeCone(); c.position.set(L.x0 + x + 0.5, 0, y + 0.5); scene.add(c); cones.push(c); }
  lv.vehicles.forEach((v, i) => {
    const g = makeVehicle(v, state.colors[i]); const vis = { g, vid: i, mode: 'gone', readyAt: 0, lastBoard: 0, filled: 0, bump: -9, pop: pop ? now : -9 };
    V[i] = vis; g.userData.vid = i;
    if (state.inLot[i]) { const [cx, cz] = cellCenter(v); const [dx, dy] = C.DIRS[v.dir]; g.position.set(cx, 0, cz); g.rotation.y = headingOf(dx, dy); vis.mode = 'lot'; scene.add(g); }
  });
  state.parked.forEach((p, k) => {
    if (!p) return; const vis = V[p.vid]; vis.mode = 'parked'; vis.filled = p.filled;
    vis.g.position.set(sx(k), 0, parkZ(vis)); vis.g.rotation.y = 0; vis.g.userData.arrow.visible = false;
    vis.g.userData.studs.forEach((m, j) => { m.visible = true; m.material = j < p.filled ? M.studFull : M.studEmpty; }); scene.add(vis.g);
  });
  const rest = state.queue.slice(state.qi);
  people = rest.map((c, k) => { const [x, z] = qPoint(k * QSPACE); return { pid: state.qi + k, color: c, x, z: pop ? z - 0.0 : z, y: 0, s: pop ? 0.01 : 1, delay: pop ? k * 0.012 : 0, born: now }; });
  updateHud();
}

// ---------------- events from rules -> animation ----------------
function playEvents(events) {
  for (const e of events) {
    const vis = V[e.vid];
    if (e.type === 'exit') {
      const path = exitPath(e.vid, e.spot); const start = Math.max(now, spotFreeAt[e.spot]); const T = path.len / SPEED + 0.25;
      spotFreeAt[e.spot] = Infinity; vis.readyAt = start + T; vis.lastBoard = vis.readyAt; vis.spot = e.spot;
      vis.mode = 'waitDrive';
      at(start, () => { vis.mode = 'drive'; vis.path = path; vis.t0 = now; vis.T = T; Sound.go(); });
      at(start + T, () => { vis.mode = 'parked'; vis.g.userData.arrow.visible = false; vis.g.userData.studs.forEach(m => { m.visible = true; }); vis.g.position.set(sx(e.spot), 0, parkZ(vis)); vis.g.rotation.y = 0; });
    } else if (e.type === 'board') {
      const t = Math.max(now, gateFreeAt, vis.readyAt - 0.35); gateFreeAt = t + 0.085;
      const door = [sx(e.spot), SPOT_N + 0.12]; const dist = Math.hypot(door[0] - GATE[0], door[1] - GATE[1]); const T = 0.18 + dist / WALK;
      vis.lastBoard = Math.max(vis.lastBoard, t + T);
      const n = e.filled;
      at(t, () => {
        const i = people.findIndex(p => p.pid === e.pid); const p = i >= 0 ? people.splice(i, 1)[0] : { pid: e.pid, color: e.color, x: GATE[0], z: GATE[1], y: 0, s: 1 };
        walkers.push({ p, x0: p.x, z0: p.z, x1: door[0], z1: door[1], t0: now, T });
        updateHud();
      });
      at(t + T, () => { walkers = walkers.filter(w => w.p.pid !== e.pid); const st = vis.g.userData.studs[n - 1]; if (st) { st.material = M.studFull; st.visible = true; } vis.filled = n; vis.squash = now; Sound.board(n % 8); });
    } else if (e.type === 'depart') {
      const t0 = Math.max(vis.readyAt, vis.lastBoard) + 0.15;
      spotFreeAt[e.spot] = Infinity;
      at(t0, () => { vis.mode = 'depart'; vis.t0 = now; vis.spot = e.spot; Sound.full(); });
      at(t0 + 0.12, () => Sound.depart());
      at(t0 + 0.5, () => { spotFreeAt[e.spot] = 0; });
      // a later exit into this spot may already have been scheduled with Infinity: rescheduled via spotFreeAt check in update
      spotFreeAt[e.spot] = t0 + 0.5;
    }
  }
}

function isIdle() { return sched.length === 0 && walkers.length === 0 && !V.some(v => v && (v.mode === 'drive' || v.mode === 'depart' || v.mode === 'waitDrive')); }

// ---------------- per-frame update ----------------
const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpS = new THREE.Vector3(), tmpP = new THREE.Vector3(), tmpC = new THREE.Color();
const ease = t => t < 0 ? 0 : t > 1 ? 1 : t * t * (3 - 2 * t);
function update(dt) {
  now += dt;
  // run due scheduled actions in time order
  if (sched.length) { sched.sort((a, b) => a.t - b.t); while (sched.length && sched[0].t <= now) sched.shift().fn(); }
  for (const vis of V) {
    if (!vis) continue; const g = vis.g;
    if (vis.mode === 'drive') {
      const k = Math.min(1, (now - vis.t0) / vis.T); const d = vis.path.len * (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);
      const [x, z, tx, tz] = samplePath(vis.path, d); g.position.set(x, 0, z);
      if (Math.hypot(tx, tz) > 1e-6) g.rotation.y = headingOf(tx, tz);
    } else if (vis.mode === 'depart') {
      const t = now - vis.t0, x0 = sx(vis.spot), z0 = parkZ(vis), z1 = L.zT;
      if (t < 0.5) { const k = ease(t / 0.5); g.position.set(x0, 0, z0 + (z1 - z0) * k); g.rotation.y = 0; }
      else { const k = (t - 0.5) / 0.9; const turn = Math.min(1, (t - 0.5) / 0.22); g.rotation.y = -Math.PI / 2 * ease(turn); g.position.set(x0 + (k * k * 0.5 + k * 0.5) * 16, 0, z1); if (k >= 1) { vis.mode = 'gone'; scene.remove(g); } }
    }
    // bump when blocked
    const bk = (now - vis.bump) / 0.24;
    if (vis.mode === 'lot') {
      const v = state.level.vehicles[vis.vid]; const [cx, cz] = cellCenter(v); const [dx, dy] = C.DIRS[v.dir];
      const off = bk >= 0 && bk < 1 ? Math.sin(Math.PI * bk) * 0.2 : 0; g.position.set(cx + dx * off, 0, cz + dy * off);
    }
    const pk = (now - vis.pop) / 0.4; const sq = (now - (vis.squash || -9)) / 0.18;
    let sy = 1, sxz = 1;
    if (pk >= 0 && pk < 1) { const s = 1 + Math.sin(pk * Math.PI) * 0.25; sxz = s; sy = s; }
    if (sq >= 0 && sq < 1) { sy *= 1 - Math.sin(sq * Math.PI) * 0.08; sxz *= 1 + Math.sin(sq * Math.PI) * 0.04; }
    const fl = (now - (vis.flash || -9)) / 0.35; if (fl >= 0 && fl < 1) { const s = 1 + Math.sin(fl * Math.PI * 3) * 0.06 * (1 - fl); sxz *= s; }
    g.children[0].scale.set(sxz, sy, sxz);
  }
  // people in line glide to their place
  let n = 0; const vis = Math.min(people.length, QVIS);
  const lerpK = 1 - Math.exp(-dt * 9);
  for (let k = 0; k < people.length; k++) {
    const p = people[k]; const [tx, tz] = qPoint(k * QSPACE);
    const moving = Math.hypot(tx - p.x, tz - p.z) > 0.02; p.x += (tx - p.x) * lerpK; p.z += (tz - p.z) * lerpK;
    if (p.s < 1) p.s = Math.min(1, p.s + dt * 5 * (now - p.born > p.delay ? 1 : 0));
    if (k >= vis) continue;
    const bob = moving ? Math.abs(Math.sin(now * 14 + p.pid)) * 0.05 : Math.abs(Math.sin(now * 2 + p.pid * 0.7)) * 0.012;
    setPerson(n++, p.x, bob, p.z, p.color, p.s);
  }
  for (const w of walkers) {
    const k = Math.min(1, (now - w.t0) / w.T); const x = w.x0 + (w.x1 - w.x0) * k, z = w.z0 + (w.z1 - w.z0) * k;
    const bob = Math.abs(Math.sin(now * 16 + w.p.pid)) * 0.06; const s = k > 0.85 ? (1 - k) / 0.15 * 0.7 + 0.3 : 1;
    if (n < MAXP) setPerson(n++, x, bob, z, w.p.color, s);
  }
  peopleBody.count = n; peopleHead.count = n;
  peopleBody.instanceMatrix.needsUpdate = true; peopleHead.instanceMatrix.needsUpdate = true; if (peopleBody.instanceColor) peopleBody.instanceColor.needsUpdate = true;

  if (pendingCheck && isIdle()) { pendingCheck = false; checkEnd(); }
}
function setPerson(i, x, y, z, color, s) {
  s *= 1.45; tmpS.set(s, s, s); tmpP.set(x, 0.19 * s + y, z); tmpM.compose(tmpP, tmpQ, tmpS); peopleBody.setMatrixAt(i, tmpM);
  tmpP.set(x, 0.4 * s + y, z); tmpM.compose(tmpP, tmpQ, tmpS); peopleHead.setMatrixAt(i, tmpM);
  peopleBody.setColorAt(i, tmpC.set(C.COLORS[color]));
}

// ---------------- camera fit ----------------
function fitCamera() {
  const w = window.innerWidth, h = window.innerHeight; renderer.setSize(w, h, false);
  const cs = getComputedStyle(document.documentElement);
  const st = parseFloat(cs.getPropertyValue('--st')) || 0;
  const hudTop = ($('hud').getBoundingClientRect().bottom || (st + 52)) + 6;
  const barTop = $('bar').classList.contains('hidden') ? h - 90 : $('bar').getBoundingClientRect().top - 6;
  const top = Math.max(hudTop, 60), bottom = Math.max(70, h - barTop);
  const a = THREE.MathUtils.degToRad(50);
  const zMin = QROWS[2] - 0.5, zMax = (L ? L.zB : 9.8) + 0.8, cz = (zMin + zMax) / 2;
  camera.position.set(0, Math.sin(a) * 50, cz + Math.cos(a) * 50); camera.lookAt(0, 0, cz); camera.updateMatrixWorld();
  const xs = [], ys = []; const inv = camera.matrixWorldInverse; const xm = Math.max(5.15, L ? L.xR + 0.55 : 5);
  for (const x of [-xm, xm]) for (const y of [0, 1.1]) for (const z of [zMin, zMax]) { const p = new THREE.Vector3(x, y, z).applyMatrix4(inv); xs.push(p.x); ys.push(p.y); }
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const availH = h - top - bottom; const s = Math.max((maxX - minX) / w, (maxY - minY) / availH);
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, yc = top + availH / 2;
  camera.left = cx - w / 2 * s; camera.right = cx + w / 2 * s; camera.top = cy + yc * s; camera.bottom = cy - (h - yc) * s;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', () => { fitCamera(); });

// ---------------- input ----------------
const ray = new THREE.Raycaster(); const ndc = new THREE.Vector2();
let downAt = null;
canvas.addEventListener('pointerdown', e => { downAt = { x: e.clientX, y: e.clientY, t: performance.now() }; Sound.unlock(); });
canvas.addEventListener('pointerup', e => {
  if (!downAt) return; const d = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y); downAt = null;
  if (d < 18 && mode === 'play') onTap(e.clientX, e.clientY);
});
function pickVehicle(x, y) {
  const r = canvas.getBoundingClientRect(); ndc.set((x - r.left) / r.width * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const objs = V.filter(v => v && v.mode === 'lot').map(v => v.g);
  const hit = ray.intersectObjects(objs, true)[0];
  if (hit) { let o = hit.object; while (o && o.userData.vid === undefined) o = o.parent; if (o) return o.userData.vid; }
  // forgiving: nearest lot vehicle on the ground plane
  const pl = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.3); const p = new THREE.Vector3(); if (!ray.ray.intersectPlane(pl, p)) return -1;
  let best = -1, bd = 0.5;
  V.forEach(v => { if (!v || v.mode !== 'lot') return; for (const [cx, cy] of C.cellsOf(state.level.vehicles[v.vid])) { const dd = Math.hypot(L.x0 + cx + 0.5 - p.x, cy + 0.5 - p.z); if (dd < bd) { bd = dd; best = v.vid; } } });
  return best;
}
function onTap(x, y) {
  const vid = pickVehicle(x, y); if (vid < 0) return;
  tapVehicle(vid);
}
function tapVehicle(vid) {
  if (mode !== 'play' || !state.inLot[vid]) return { ok: false, reason: 'gone' };
  const snap = C.snapshot(state);
  const r = C.tap(state, vid);
  if (!r.ok) {
    if (r.reason === 'blocked') { V[vid].bump = now; Sound.honk(); if (r.blocker >= 0 && V[r.blocker]) V[r.blocker].flash = now + 0.1; else { const v = state.level.vehicles[vid]; } }
    else if (r.reason === 'full') { Sound.honk(); toast('All 8 spots are full'); }
    return r;
  }
  undoStack.push(snap); if (undoStack.length > 200) undoStack.shift();
  hideHint();
  playEvents(r.events); afterMove();
  return r;
}
function afterMove() { hideOverlay(); pendingCheck = true; updateHud(); }

// ---------------- boosters ----------------
function doShuffle() {
  if (mode !== 'play') return; Sound.unlock();
  if (C.isWon(state)) return;
  undoStack.push(C.snapshot(state));
  const ev = C.shuffle(state, (Math.random() * 1e9) | 0);
  Sound.shuffle(); syncScene(true);
  // passengers that now match parked buses board right away
  playEvents(ev); afterMove(); toast('Shuffled!');
}
function doSort() {
  if (mode !== 'play') return; Sound.unlock();
  if (!C.canSort(state)) { toast('Nobody in line fits a parked bus yet'); return; }
  undoStack.push(C.snapshot(state));
  const ev = C.sortQueue(state); Sound.shuffle(); syncScene(false); playEvents(ev); afterMove(); toast('Sorted the line');
}
function doUndo() {
  if (mode !== 'play') return; Sound.click();
  const snap = undoStack.pop(); if (!snap) { toast('Nothing to undo'); return; }
  C.restore(state, snap); state.undos++; syncScene(false); afterMove();
}
function doRestart() { if (mode !== 'play' && mode !== 'won') return; Sound.click(); startLevel(levelIdx); }

// ---------------- flow ----------------
function starsFor(s) { return s.boosters === 0 ? 3 : s.boosters <= 2 ? 2 : 1; }
function checkEnd() {
  if (C.isWon(state)) {
    mode = 'won'; const st = starsFor(state);
    save.stars[levelIdx] = Math.max(save.stars[levelIdx] || 0, st); save.unlocked = Math.max(save.unlocked, Math.min(LEVELS.length, levelIdx + 2)); save.last = Math.min(LEVELS.length - 1, levelIdx + 1); persist();
    Sound.win();
    setTimeout(() => {
      $('win-stars').innerHTML = [1, 2, 3].map(i => `<span class="${i <= st ? 'on' : 'off'}">&#9733;</span>`).join('');
      $('win-text').textContent = `${state.moves} moves` + (state.boosters ? ` · ${state.boosters} booster${state.boosters > 1 ? 's' : ''} used` : ' · no boosters!') + (st < 3 ? ' (finish without Shuffle or Sort for 3 stars)' : '');
      $('win-next').classList.toggle('hidden', levelIdx >= LEVELS.length - 1);
      show('win');
    }, 450);
    return;
  }
  if (C.isStuck(state)) { overlayShown = true; $('stuck').classList.remove('hidden'); $('btn-shuffle').classList.add('pulse'); Sound.stuck(); }
}
function hideOverlay() { overlayShown = false; $('stuck').classList.add('hidden'); $('btn-shuffle').classList.remove('pulse'); }

function startLevel(i) {
  levelIdx = i; save.last = i; persist();
  state = C.newState(LEVELS[i]); undoStack = []; mode = 'play';
  L = buildWorld(state.level); hideOverlay(); show(null);
  $('hud').classList.remove('hidden'); $('bar').classList.remove('hidden');
  syncScene(false); fitCamera();
  const hints = ['Tap a vehicle whose arrow path is clear. It parks and picks up matching passengers.', 'Full buses leave and free their spot. All 8 spots are yours.', 'Stuck? Shuffle is free, unlimited, and always makes it solvable.'];
  if (i < hints.length) showHint(hints[i]); else hideHint();
  pendingCheck = true;
}
function updateHud() {
  if (!state) return;
  $('hud-level').textContent = 'Level ' + (levelIdx + 1);
  $('hud-moves').textContent = 'Moves ' + state.moves;
  const waiting = state.queue.length - state.qi; $('hud-people').textContent = waiting + ' waiting';
  $('btn-undo').disabled = undoStack.length === 0;
}
let toastT = 0;
function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.remove('hidden'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.add('hidden'), 1500); }
function showHint(m) { $('hint').textContent = m; $('hint').classList.remove('hidden'); }
function hideHint() { $('hint').classList.add('hidden'); }
function show(id) {
  for (const s of ['title', 'levels', 'win']) $(s).classList.toggle('hidden', s !== id);
  if (id === 'title' || id === 'levels') { $('hud').classList.add('hidden'); $('bar').classList.add('hidden'); hideOverlay(); hideHint(); }
}
function openLevels() {
  mode = 'menu'; show('levels'); const g = $('lv-grid'); g.innerHTML = '';
  let total = 0;
  LEVELS.forEach((_, i) => {
    const b = document.createElement('button'); const st = save.stars[i] || 0; total += st; const locked = i >= save.unlocked;
    b.className = 'lv' + (locked ? ' locked' : '') + (i === save.last ? ' cur' : '');
    b.innerHTML = `${locked ? '&#128274;' : i + 1}<span class="s">${locked ? '' : '&#9733;'.repeat(st) + '<span style="opacity:.25">' + '&#9733;'.repeat(3 - st) + '</span>'}</span>`;
    b.dataset.level = i;
    if (!locked) b.onclick = () => { Sound.click(); startLevel(i); };
    g.appendChild(b);
  });
  $('stars-total').textContent = '★ ' + total + ' / ' + LEVELS.length * 3;
}
function updateSoundBtn() { $('btn-sound').innerHTML = save.sound ? '&#128266;' : '&#128263;'; }

$('btn-play').onclick = () => { Sound.unlock(); startLevel(Math.min(save.last || 0, save.unlocked - 1)); };
$('btn-levels').onclick = () => { Sound.unlock(); openLevels(); };
$('lv-back').onclick = () => { mode = 'title'; show('title'); };
$('btn-menu').onclick = () => { Sound.click(); openLevels(); };
$('btn-sound').onclick = () => { save.sound = !save.sound; persist(); updateSoundBtn(); if (save.sound) Sound.click(); };
$('btn-undo').onclick = doUndo; $('btn-shuffle').onclick = doShuffle; $('btn-sort').onclick = doSort; $('btn-restart').onclick = doRestart;
$('stuck-shuffle').onclick = doShuffle; $('stuck-undo').onclick = doUndo; $('stuck-restart').onclick = doRestart;
$('win-next').onclick = () => { Sound.click(); startLevel(Math.min(LEVELS.length - 1, levelIdx + 1)); };
$('win-replay').onclick = () => { Sound.click(); startLevel(levelIdx); };
$('win-levels').onclick = () => { Sound.click(); openLevels(); };
updateSoundBtn();

// no pinch zoom / bounce on iOS
document.addEventListener('gesturestart', e => e.preventDefault());
document.addEventListener('dblclick', e => e.preventDefault());
document.addEventListener('touchmove', e => { if (!e.target.closest('#lv-grid')) e.preventDefault(); }, { passive: false });

// ---------------- title backdrop: a demo lot ----------------
function showTitle() {
  mode = 'title';
  state = C.newState(LEVELS[Math.min(LEVELS.length - 1, 22)]); L = buildWorld(state.level); syncScene(false);
  show('title'); fitCamera();
}

// ---------------- loop ----------------
let last = performance.now();
function frame(t) {
  const dt = Math.min(0.05, (t - last) / 1000); last = t;
  update(dt); renderer.render(scene, camera); requestAnimationFrame(frame);
}
showTitle(); requestAnimationFrame(frame);

if ('serviceWorker' in navigator && location.protocol !== 'file:') { window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {})); }

// test / debug hooks
window.BusJam = {
  get state() { return state; }, get mode() { return mode; }, levels: LEVELS, core: C,
  startLevel, tapVehicle, doShuffle, doSort, doUndo, doRestart, isIdle: () => isIdle(), openLevels,
  save: () => JSON.parse(localStorage.getItem(SAVE_KEY) || '{}'),
  screenOf(vid) { const v = state.level.vehicles[vid]; const [x, z] = cellCenter(v); const p = new THREE.Vector3(x, 0.5, z).project(camera); return { x: (p.x + 1) / 2 * window.innerWidth, y: (1 - p.y) / 2 * window.innerHeight }; },
  solve: (fromCurrent) => C.solve(state.level, 400000, fromCurrent ? state : undefined),
  visiblePeople: () => peopleBody.count,
};
