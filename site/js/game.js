// Bus Jam: rendering, animation, input, UI. Rules live in core.js.
// Layout (world units, -z is up the screen): rider track at the top, parking row in the middle, diagonal jam below.
import * as THREE from './lib/three.module.min.js';
import * as C from './core.js';
import { LEVELS } from './levels.js';

const $ = id => document.getElementById(id);
// track
const TM = -8.7, TA = 1.9, TR = 1.95, TTOP = -14.6, TBW = 2.05, LANES = [-0.8, -0.4, 0, 0.4, 0.8], ROW = 0.36;
const MOUTH = [0, TM + TBW / 2 + 0.05];
// parking
const SPOT_W = 1.25, SPOT_N = -7.0, SPOT_S = -4.2, ROAD_Z = -3.65, PS = 0.95;
// jam
const JAM_TOP = -2.3, JAM_W = 11.8, THETA = Math.PI / 4;
const SPEED = 16, WALK = 9, STAGGER = 0.04;
const CHARCOAL = '#2f3542';

// ---------------- save ----------------
const SAVE_KEY = 'busjam:v2';
let save = { unlocked: 1, stars: {}, sound: true, last: 0 };
try { Object.assign(save, JSON.parse(localStorage.getItem(SAVE_KEY) || '{}')); } catch (e) {}
const persist = () => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) {} };

// ---------------- sound ----------------
const Sound = (() => {
  let ctx = null, master = null, lastBoard = 0;
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
    go() { tone(90, 230, 0.3, 'sawtooth', 0.1); tone(180, 440, 0.24, 'triangle', 0.1); },
    honk() { tone(370, 360, 0.12, 'square', 0.1); tone(370, 360, 0.16, 'square', 0.1, 0.15); },
    board(n) { const c = ensure(); if (!c || c.currentTime - lastBoard < 0.05) return; lastBoard = c.currentTime; tone(520 + (n % 10) * 45, 700 + (n % 10) * 50, 0.07, 'triangle', 0.12); },
    full() { [660, 880, 1100].forEach((f, i) => tone(f, f * 1.02, 0.14, 'triangle', 0.16, i * 0.07)); },
    depart() { noise(0.45, 300, 1200, 0.1); },
    reveal() { tone(600, 1200, 0.15, 'sine', 0.12); },
    shuffle() { noise(0.5, 400, 3000, 0.18); [500, 700, 900, 1200].forEach((f, i) => tone(f, f, 0.08, 'sine', 0.1, i * 0.06)); },
    win() { [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, f, 0.22, 'triangle', 0.18, i * 0.1)); },
    stuck() { tone(300, 180, 0.4, 'sine', 0.18); },
    click() { tone(800, 600, 0.05, 'sine', 0.08); },
  };
})();

// ---------------- three.js setup ----------------
const canvas = $('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
const scene = new THREE.Scene(); scene.background = new THREE.Color('#dfe3e9');
const camera = new THREE.OrthographicCamera(-5, 5, 5, -5, 0.1, 200);
scene.add(new THREE.HemisphereLight(0xffffff, 0x8a96a8, 1.75));
const sun = new THREE.DirectionalLight(0xffffff, 1.9); sun.position.set(-7, 18, 4); sun.target.position.set(0, 0, -3); sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -15, right: 15, top: 16, bottom: -16, near: 1, far: 50 }); sun.shadow.bias = -0.0012;
scene.add(sun, sun.target);

const matCache = {};
const lam = (hex, extra) => { const k = hex + (extra ? JSON.stringify(extra) : ''); return matCache[k] ||= new THREE.MeshLambertMaterial(Object.assign({ color: hex }, extra || {})); };
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const tmpM = new THREE.Matrix4(), tmpM2 = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpS = new THREE.Vector3(), tmpP = new THREE.Vector3(), tmpC = new THREE.Color(), YAX = new THREE.Vector3(0, 1, 0);
const ease = t => t < 0 ? 0 : t > 1 ? 1 : t * t * (3 - 2 * t);

function canvasTex(w, h, draw) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; }

// ---------------- instanced vehicles ----------------
const unitBox = new THREE.BoxGeometry(1, 1, 1);
const arrowShape = new THREE.Shape(); arrowShape.moveTo(0, 0.34); arrowShape.lineTo(0.24, 0.06); arrowShape.lineTo(0.1, 0.06); arrowShape.lineTo(0.1, -0.3); arrowShape.lineTo(-0.1, -0.3); arrowShape.lineTo(-0.1, 0.06); arrowShape.lineTo(-0.24, 0.06); arrowShape.closePath();
const arrowGeo = new THREE.ShapeGeometry(arrowShape).rotateX(-Math.PI / 2);
const qTex = canvasTex(64, 64, (x, w, h) => { x.fillStyle = '#ffffff'; x.font = '900 56px -apple-system, Arial, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('?', w / 2, h / 2 + 3); });
const IM = {};
function mkIM(name, geo, mat, n, shadow) { const m = new THREE.InstancedMesh(geo, mat, n); m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.frustumCulled = false; m.castShadow = !!shadow; m.count = 0; scene.add(m); IM[name] = m; m.userData.n = 0; return m; }
mkIM('body', unitBox, new THREE.MeshLambertMaterial({ color: 0xffffff }), 120, true);
mkIM('roof', unitBox, new THREE.MeshLambertMaterial({ color: 0xffffff }), 120, false);
mkIM('glass', unitBox, lam('#1f2a3d'), 400, false);
mkIM('wheel', new THREE.CylinderGeometry(0.15, 0.15, 0.1, 10).rotateZ(Math.PI / 2), lam('#20242c'), 760, false);
mkIM('arrow', arrowGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }), 120, false);
mkIM('q', new THREE.PlaneGeometry(0.62, 0.62).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: qTex, transparent: true, alphaTest: 0.3, depthWrite: false }), 120, false);
for (const k of ['body', 'roof']) for (let i = 0; i < 120; i++) IM[k].setColorAt(i, tmpC.set('#ffffff'));
const partM = (x, y, z, sx, sy, sz) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion(), new THREE.Vector3(sx, sy, sz));
const MODELS = {};
function model(len, seats) {
  const key = len + ':' + seats; if (MODELS[key]) return MODELS[key];
  const Lm = len * 0.94 - 0.14, W = 0.8; const parts = [];
  const H = seats >= 24 ? 0.92 : len >= 3 ? 0.62 : 0.56;
  parts.push(['body', partM(0, 0.12 + H / 2, 0, W, H, Lm)]);
  parts.push(['roof', partM(0, 0.12 + H + 0.02, 0, W - 0.08, 0.05, Lm - 0.08)]);
  const bands = seats >= 24 ? [0.12 + H - 0.17, 0.12 + H * 0.45] : [0.12 + H - 0.17];
  for (const y of bands) parts.push(['glass', partM(0, y, 0.05, W + 0.02, 0.16, Lm - 0.32)]);
  parts.push(['glass', partM(0, 0.12 + H - (seats >= 24 ? 0.32 : 0.2), -Lm / 2 - 0.005, W - 0.14, seats >= 24 ? 0.44 : 0.22, 0.03)]);
  const ax = len >= 3 ? [-Lm / 2 + 0.36, Lm / 2 - 0.36, Lm / 2 - 0.7] : [-Lm / 2 + 0.32, Lm / 2 - 0.32];
  for (const z of ax) for (const s of [-1, 1]) parts.push(['wheel', partM(s * (W / 2 - 0.03), 0.15, z, 1, 1, 1)]);
  const roofY = 0.12 + H + 0.055, as = len >= 3 ? 1.35 : 1.05;
  const arrow = partM(0, roofY, 0, as, 1, as); const arrowM = partM(0, roofY, -Lm * 0.2, 0.8, 1, 0.8);
  const q = partM(0, roofY + 0.003, Lm * 0.24, 1, 1, 1);
  return (MODELS[key] = { Lm, parts, arrow, arrowM, q, H });
}

// ---------------- people (instanced) ----------------
const MAXP = 420;
const peopleBody = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.13, 0.16, 3, 8), new THREE.MeshLambertMaterial({ color: 0xffffff }), MAXP);
const peopleHead = new THREE.InstancedMesh(new THREE.SphereGeometry(0.115, 10, 8), new THREE.MeshLambertMaterial({ color: 0xffffff }), MAXP);
for (const m of [peopleBody, peopleHead]) { m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.frustumCulled = false; m.castShadow = true; m.count = 0; for (let i = 0; i < MAXP; i++) m.setColorAt(i, tmpC.set('#ffffff')); scene.add(m); }
const headColors = C.COLORS.map(h => new THREE.Color(h).lerp(new THREE.Color('#ffffff'), 0.18));

// dust puffs
const MAXD = 260;
const dustMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.12, 0), new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.75, depthWrite: false }), MAXD);
dustMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); dustMesh.frustumCulled = false; dustMesh.count = 0; scene.add(dustMesh);
let dust = [];

// ---------------- track geometry ----------------
const ARC = Math.PI * TR / 2, SIDE_LEN = TA + ARC + (TM - TR - TTOP);
function trackPoint(s, side, off = 0) { // side -1 left, +1 right; off = lateral offset (+ = outside of the U)
  let x, z, nx, nz;
  if (s <= TA) { x = side * s; z = TM; nx = 0; nz = 1; }
  else if (s <= TA + ARC) { const f = (s - TA) / TR; x = side * (TA + TR * Math.sin(f)); z = TM - TR + TR * Math.cos(f); nx = side * Math.sin(f); nz = Math.cos(f); }
  else { x = side * (TA + TR); z = TM - TR - (s - TA - ARC); nx = side; nz = 0; }
  return [x + nx * off, z + nz * off];
}
const SLOTS = [];
for (let k = 0; ; k++) { const s = 0.2 + k * ROW; if (s > SIDE_LEN + 0.2) break; for (const li of [2, 3, 1, 4, 0]) for (const side of [-1, 1]) SLOTS.push(trackPoint(s, side, LANES[li])); }
const QVIS = SLOTS.length; const ARM_END = [[-(TA + TR), TTOP - 1.2], [TA + TR, TTOP - 1.2]];

// ---------------- static world ----------------
let world = null;
function buildWorld(lv, CS, lotCenter) {
  if (world) { scene.remove(world); world.traverse(o => { if (o.geometry && o.userData.own) o.geometry.dispose(); }); }
  world = new THREE.Group(); scene.add(world);
  const own = m => { m.userData.own = true; return m; };
  const plane = (w, d, mat, x, z, y = 0) => { const m = own(new THREE.Mesh(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), mat)); m.position.set(x, y, z); m.receiveShadow = true; world.add(m); return m; };
  // ground with a grid
  const gridTex = canvasTex(128, 128, (x, w, h) => { x.fillStyle = '#e4e7ec'; x.fillRect(0, 0, w, h); x.strokeStyle = '#d0d5dd'; x.lineWidth = 4; x.strokeRect(0, 0, w, h); });
  gridTex.wrapS = gridTex.wrapT = THREE.RepeatWrapping; gridTex.repeat.set(40, 40);
  plane(60, 60, new THREE.MeshLambertMaterial({ map: gridTex }), 0, 0, -0.01);
  // asphalt band with parking row + road
  plane(13, SPOT_S - SPOT_N + 1.5, lam('#5b616c'), 0, (SPOT_N + SPOT_S) / 2 + 0.35, 0.002);
  const curb = (w, d, x, z, h = 0.08, c = '#f4f6f9') => { const m = own(new THREE.Mesh(box(w, h, d), lam(c))); m.position.set(x, h / 2, z); m.receiveShadow = true; m.castShadow = true; world.add(m); return m; };
  curb(13, 0.12, 0, ROAD_Z + 0.68);
  curb(13, 0.1, 0, SPOT_N - 0.4, 0.06);
  for (let i = 0; i < 8; i++) {
    const x = (i - 3.5) * SPOT_W; const vip = i === 0;
    const m = own(new THREE.Mesh(box(SPOT_W - 0.16, 0.012, SPOT_S - SPOT_N - 0.1), lam(vip ? '#e9b949' : '#6c737f'))); m.position.set(x, 0.006, (SPOT_N + SPOT_S) / 2); m.receiveShadow = true; world.add(m);
    const edge = own(new THREE.Mesh(box(SPOT_W - 0.06, 0.008, SPOT_S - SPOT_N), lam(vip ? '#f7d774' : '#8a919c'))); edge.position.set(x, 0.003, (SPOT_N + SPOT_S) / 2); world.add(edge);
  }
  const vipTex = canvasTex(128, 64, (x, w, h) => { x.fillStyle = '#b07d10'; x.font = '900 46px -apple-system, Arial, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('VIP', w / 2, h / 2 + 2); });
  const vip = own(new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.45).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: vipTex, transparent: true }))); vip.position.set(-3.5 * SPOT_W, 0.02, SPOT_S - 0.45); vip.rotation.y = 0; world.add(vip);
  // chute from the track mouth to the parking row
  plane(0.7, SPOT_N - MOUTH[1] + 0.4, lam('#eef1f5'), 0, (SPOT_N + MOUTH[1]) / 2 - 0.2, 0.004);
  // rider track: floor ribbon + white walls
  const ribbon = (offA, offB, y, mat, h = 0) => {
    const pos = [], idx = []; const N = 80;
    for (const side of [-1, 1]) {
      const base = pos.length / 3;
      for (let i = 0; i <= N; i++) { const s = (SIDE_LEN + 1.5) * i / N; const a = trackPoint(s, side, offA), b = trackPoint(s, side, offB); pos.push(a[0], y, a[1], b[0], y, b[1]); }
      for (let i = 0; i < N; i++) { const a = base + i * 2; side < 0 ? idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3) : idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    const m = own(new THREE.Mesh(g, mat)); m.receiveShadow = true; world.add(m); return m;
  };
  ribbon(-TBW / 2, TBW / 2, 0.01, lam('#f1f3f6', { side: THREE.DoubleSide }));
  const segs = [];
  for (const off of [-TBW / 2 - 0.06, TBW / 2 + 0.06]) for (const side of [-1, 1]) for (let s = 0; s < SIDE_LEN + 1.5; s += 0.3) {
    if (off > 0 && s < 0.45) continue; // opening at the mouth, where riders leave the track
    const a = trackPoint(s, side, off), b = trackPoint(s + 0.3, side, off); segs.push([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, Math.atan2(b[0] - a[0], b[1] - a[1]), Math.hypot(b[0] - a[0], b[1] - a[1]) + 0.04]);
  }
  const walls = own(new THREE.InstancedMesh(new THREE.BoxGeometry(0.13, 0.26, 1), lam('#ffffff'), segs.length)); walls.castShadow = true; walls.receiveShadow = true;
  segs.forEach(([x, z, r, l], i) => { tmpQ.setFromAxisAngle(YAX, r); walls.setMatrixAt(i, tmpM.compose(tmpP.set(x, 0.13, z), tmpQ, tmpS.set(1, 1, l))); });
  world.add(walls);
  // gap in the inner (bottom) wall at the mouth is where riders leave: mark it
  const gate = own(new THREE.Mesh(box(0.8, 0.04, 0.16), lam('#ffd23f'))); gate.position.set(0, 0.03, MOUTH[1] - 0.02); world.add(gate);
  // island inside the U
  const isl = own(new THREE.Mesh(new THREE.BoxGeometry(2 * (TA + TR - TBW / 2 - 0.2), 0.14, TM - TBW / 2 - 0.2 - (TTOP - 1)), lam('#d3d8e0'))); isl.position.set(0, 0.07, (TM - TBW / 2 - 0.2 + TTOP - 1) / 2); isl.receiveShadow = true; world.add(isl);
  // lamp posts and shrubs
  const poleM = lam('#8b95a5'), headM = lam('#5f6b7c'), bulbM = new THREE.MeshBasicMaterial({ color: '#fff6c8' });
  const lamp = (x, z, dir) => { const g = new THREE.Group(); const p = own(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 1.6, 8), poleM)); p.position.y = 0.8; p.castShadow = true;
    const arm = own(new THREE.Mesh(box(0.55, 0.06, 0.08), headM)); arm.position.set(dir * 0.25, 1.58, 0); const hd = own(new THREE.Mesh(box(0.26, 0.08, 0.16), headM)); hd.position.set(dir * 0.5, 1.55, 0);
    const b = own(new THREE.Mesh(box(0.2, 0.02, 0.1), bulbM)); b.position.set(dir * 0.5, 1.5, 0); g.add(p, arm, hd, b); g.position.set(x, 0, z); world.add(g); };
  lamp(-5.9, -7.6, 1); lamp(5.9, -7.6, -1); lamp(-6.0, 1.5, 1); lamp(6.0, 1.5, -1);
  const shrubG = own(new THREE.IcosahedronGeometry(0.34, 1)), shrubM = lam('#7cc243'), potM = lam('#c9ced6');
  const shrub = (x, z) => { const pot = own(new THREE.Mesh(box(0.56, 0.18, 0.56), potM)); pot.position.set(x, 0.09, z); const s = new THREE.Mesh(shrubG, shrubM); s.position.set(x, 0.42, z); s.castShadow = true; world.add(pot, s); };
  shrub(-6.1, -6.0); shrub(6.1, -6.0); shrub(-6.1, -9.6); shrub(6.1, -9.6); shrub(-6.2, 5); shrub(6.2, 5);
  // faint outline of the jam area
  const jw = lv.w + 0.6, jh = lv.h + 0.6; const pad = own(new THREE.Mesh(new THREE.PlaneGeometry(jw, jh).rotateX(-Math.PI / 2), lam('#d7dbe2')));
  pad.scale.setScalar(CS); pad.position.set(lotCenter[0], 0.001, lotCenter[1]); pad.rotation.y = THETA; pad.receiveShadow = true; world.add(pad);
}

// spot badges (seats left)
const badges = [];
for (let i = 0; i < 8; i++) {
  const c = document.createElement('canvas'); c.width = 128; c.height = 72; const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false })); sp.scale.set(1.1, 0.62, 1); sp.position.set((i - 3.5) * SPOT_W, 0.4, SPOT_S + 0.3); sp.renderOrder = 10; sp.visible = false; scene.add(sp);
  badges.push({ sp, c, t, txt: '' });
}
function setBadge(i, n, color) {
  const b = badges[i]; if (n === null) { b.sp.visible = false; b.txt = ''; return; }
  const key = n + color; b.sp.visible = true; if (b.txt === key) return; b.txt = key;
  const x = b.c.getContext('2d'); x.clearRect(0, 0, 128, 72);
  x.fillStyle = 'rgba(0,0,0,.25)'; x.beginPath(); x.roundRect(8, 10, 112, 58, 16); x.fill();
  x.fillStyle = color; x.beginPath(); x.roundRect(8, 4, 112, 58, 16); x.fill();
  x.strokeStyle = 'rgba(255,255,255,.9)'; x.lineWidth = 4; x.stroke();
  x.fillStyle = '#fff'; x.font = '900 40px -apple-system, Arial, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(String(n), 64, 35); b.t.needsUpdate = true;
}

// ---------------- game state ----------------
let levelIdx = 0, state = null, undoStack = [], mode = 'title';
let CS = 0.7; const lotFrame = new THREE.Object3D(); let lotInv = new THREE.Matrix4();
let V = [];             // vehicle visuals
let people = [];        // riders still waiting, in queue order
let walkers = [];
let sched = [];
let now = 0;
let spotFreeAt = new Array(8).fill(0), gateFreeAt = 0;
let pendingCheck = false, revealed = [];

const sx = i => (i - 3.5) * SPOT_W;
const cellLocal = v => { const [dx, dy] = C.DIRS[v.dir]; const lv = state.level; return [v.x + 0.5 - lv.w / 2 - dx * (v.len - 1) / 2, v.y + 0.5 - lv.h / 2 - dy * (v.len - 1) / 2]; };
const toWorld = (lx, lz) => { tmpP.set(lx, 0, lz).applyMatrix4(lotFrame.matrixWorld); return [tmpP.x, tmpP.z]; };
const headingOf = (dx, dz) => Math.atan2(-dx, -dz);
const parkZ = vid => SPOT_N + 0.12 + model(state.level.vehicles[vid].len, state.level.vehicles[vid].seats).Lm * PS / 2;
const at = (t, fn) => { sched.push({ t, fn }); };
const vColor = vid => (state.level.vehicles[vid].m && !revealed[vid]) ? CHARCOAL : C.COLORS[state.colors[vid]];

function fillet(pts, r) {
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
// path: straight out along the arrow, around the outside of the jam to its top corner, then up the road into the spot
function exitPath(vid, spot) {
  const lv = state.level, v = lv.vehicles[vid]; const c = cellLocal(v);
  const xL = -lv.w / 2 - 0.9, xR = lv.w / 2 + 0.9, zT = -lv.h / 2 - 0.9, zB = lv.h / 2 + 0.9, Wr = xR - xL, Hr = zB - zT, P = 2 * (Wr + Hr);
  let E; if (v.dir === 'N') E = [c[0], zT]; else if (v.dir === 'S') E = [c[0], zB]; else if (v.dir === 'E') E = [xR, c[1]]; else E = [xL, c[1]];
  const sOf = ([x, z]) => Math.abs(z - zT) < 1e-6 ? x - xL : Math.abs(x - xR) < 1e-6 ? Wr + (z - zT) : Math.abs(z - zB) < 1e-6 ? Wr + Hr + (xR - x) : 2 * Wr + Hr + (zB - z);
  const corners = [[xL, zT, 0], [xR, zT, Wr], [xR, zB, Wr + Hr], [xL, zB, 2 * Wr + Hr]];
  // the corner nearest the parking row (smallest world z) is where vehicles leave the jam area
  let gate = corners[0], gz = 1e9; for (const k of corners) { const w = toWorld(k[0], k[1]); if (w[1] < gz) { gz = w[1]; gate = k; } }
  const sE = sOf(E), sT = gate[2]; const d1 = ((sT - sE) % P + P) % P, d2 = P - d1; const cw = d1 <= d2;
  const local = [c, E];
  const list = corners.map(([x, z, s]) => ({ x, z, d: cw ? ((s - sE) % P + P) % P : ((sE - s) % P + P) % P })).filter(k => k.d > 1e-6 && k.d < (cw ? d1 : d2) + 1e-6).sort((a, b) => a.d - b.d);
  for (const k of list) local.push([k.x, k.z]);
  const pts = local.map(p => toWorld(p[0], p[1]));
  const lotPart = pts.length;
  const tx = sx(spot); pts.push([tx * 0.5 + pts[pts.length - 1][0] * 0.5, ROAD_Z]); pts.push([tx, ROAD_Z - 0.3]); pts.push([tx, parkZ(vid)]);
  const clean = [pts[0]]; for (const p of pts.slice(1)) { const q = clean[clean.length - 1]; if (Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-4) clean.push(p); }
  const path = mkPath(fillet(clean, 0.6));
  // distance at which the vehicle leaves the jam area (starts growing to parking size)
  const lp = mkPath(clean.slice(0, Math.min(clean.length, lotPart))); path.growFrom = Math.min(path.len - 0.5, lp.len); return path;
}

// ---------------- scene sync ----------------
function syncScene(pop) {
  walkers = []; sched = []; spotFreeAt.fill(0); gateFreeAt = 0; dust = [];
  const lv = state.level; const old = V; V = [];
  lv.vehicles.forEach((v, i) => {
    const vis = { vid: i, mode: 'gone', x: 0, z: 0, rot: 0, s: CS, readyAt: 0, lastBoard: 0, filled: 0, bump: -9, pop: pop ? now + Math.random() * 0.15 : -9, dustT: 0, flash: -9 };
    V[i] = vis;
    if (state.inLot[i]) { const [lx, lz] = cellLocal(v); const [dx, dy] = C.DIRS[v.dir]; [vis.x, vis.z] = toWorld(lx, lz); vis.rot = headingOf(dx, dy) + THETA; vis.mode = 'lot'; }
  });
  for (let k = 0; k < 8; k++) setBadge(k, null);
  state.parked.forEach((p, k) => {
    if (!p) return; const vis = V[p.vid]; vis.mode = 'parked'; vis.filled = p.filled; vis.spot = k; vis.x = sx(k); vis.z = parkZ(p.vid); vis.rot = 0; vis.s = PS;
    setBadge(k, C.seatsOf(state, p.vid) - p.filled, C.COLORS[state.colors[p.vid]]);
  });
  updateReveals(false);
  const rest = state.queue.slice(state.qi);
  people = rest.map((c, k) => { const sl = k < QVIS ? SLOTS[k] : ARM_END[k % 2]; return { pid: state.qi + k, color: c, x: sl[0], z: sl[1], s: pop ? 0.01 : 1, born: now + (pop ? Math.min(k, QVIS) * 0.003 : 0) }; });
  updateHud();
}
function updateReveals(anim) {
  const g = C.grid(state);
  state.level.vehicles.forEach((v, i) => {
    if (!v.m || revealed[i]) return;
    if (!state.inLot[i] || C.firstBlocker(state, i, g) === -1) { revealed[i] = true; if (anim && V[i]) { V[i].pop = now; Sound.reveal(); } }
  });
}

// ---------------- events from rules -> animation ----------------
function playEvents(events) {
  for (const e of events) {
    const vis = V[e.vid];
    if (e.type === 'exit') {
      const path = exitPath(e.vid, e.spot); const start = Math.max(now, spotFreeAt[e.spot]); const T = path.len / SPEED + 0.3;
      spotFreeAt[e.spot] = Infinity; vis.readyAt = start + T; vis.lastBoard = vis.readyAt; vis.spot = e.spot; vis.mode = 'waitDrive'; vis.filled = 0;
      at(start, () => { vis.mode = 'drive'; vis.path = path; vis.t0 = now; vis.T = T; Sound.go(); });
      at(start + T, () => { vis.mode = 'parked'; vis.x = sx(e.spot); vis.z = parkZ(e.vid); vis.rot = 0; vis.s = PS; vis.squash = now; setBadge(e.spot, C.seatsOf(state, e.vid) - vis.filled, C.COLORS[state.colors[e.vid]]); });
    } else if (e.type === 'board') {
      const door = [sx(e.spot), SPOT_N + 0.05]; const mid = [sx(e.spot) * 0.85, SPOT_N - 0.35];
      const dist = Math.hypot(mid[0] - MOUTH[0], mid[1] - MOUTH[1]) + Math.hypot(door[0] - mid[0], door[1] - mid[1]); const T = 0.25 + dist / WALK;
      const t = Math.max(now, gateFreeAt, vis.readyAt - T + 0.1); gateFreeAt = t + STAGGER;
      vis.lastBoard = Math.max(vis.lastBoard, t + T);
      const n = e.filled, seats = C.seatsOf(state, e.vid), color = C.COLORS[e.color];
      at(t, () => {
        const i = people.findIndex(p => p.pid === e.pid); const p = i >= 0 ? people.splice(i, 1)[0] : { pid: e.pid, color: e.color, x: MOUTH[0], z: MOUTH[1], s: 1 };
        walkers.push({ p, pts: [[p.x, p.z], [MOUTH[0], MOUTH[1] - 0.05], mid, door], t0: now, T });
        updateHud();
      });
      at(t + T, () => { walkers = walkers.filter(w => w.p.pid !== e.pid); vis.filled = Math.max(vis.filled, n); vis.squash = now; if (vis.mode === 'parked') setBadge(e.spot, seats - vis.filled, color); Sound.board(n); });
    } else if (e.type === 'depart') {
      const t0 = Math.max(vis.readyAt, vis.lastBoard) + 0.15;
      at(t0, () => { vis.mode = 'depart'; vis.t0 = now; vis.spot = e.spot; setBadge(e.spot, null); Sound.full(); });
      at(t0 + 0.12, () => Sound.depart());
      spotFreeAt[e.spot] = t0 + 0.55;
    }
  }
}
function isIdle() { return sched.length === 0 && walkers.length === 0 && !V.some(v => v && (v.mode === 'drive' || v.mode === 'depart' || v.mode === 'waitDrive')); }

// ---------------- per-frame update ----------------
function spawnDust(x, z, rot, s) {
  if (dust.length >= MAXD) dust.shift();
  const bx = Math.sin(rot) * 0.9 * s, bz = Math.cos(rot) * 0.9 * s; // behind the vehicle (forward is -z rotated)
  dust.push({ x: x + bx + (Math.random() - 0.5) * 0.3 * s, z: z + bz + (Math.random() - 0.5) * 0.3 * s, t0: now, life: 0.55 + Math.random() * 0.35, r: 0.6 + Math.random() * 0.8 });
}
function update(dt) {
  now += dt;
  if (sched.length) { sched.sort((a, b) => a.t - b.t); while (sched.length && sched[0].t <= now) sched.shift().fn(); }
  const cnt = { body: 0, roof: 0, glass: 0, wheel: 0, arrow: 0, q: 0 };
  for (const vis of V) {
    if (!vis || vis.mode === 'gone') continue;
    const v = state.level.vehicles[vis.vid]; const md = model(v.len, v.seats);
    let x = vis.x, z = vis.z, rot = vis.rot, s = vis.s;
    if (vis.mode === 'drive') {
      const k = Math.min(1, (now - vis.t0) / vis.T); const d = vis.path.len * (k < 0.3 ? k * k / 0.6 : k < 0.85 ? 0.15 + (k - 0.3) : 0.7 + 0.15 * (1 - Math.pow(1 - (k - 0.85) / 0.15, 2))) / 0.85;
      const [px, pz, tx, tz] = samplePath(vis.path, d); x = px; z = pz; if (Math.hypot(tx, tz) > 1e-6) rot = headingOf(tx, tz);
      s = CS + (PS - CS) * ease((d - vis.path.growFrom) / Math.max(0.5, vis.path.len - vis.path.growFrom));
      vis.x = x; vis.z = z; vis.rot = rot; vis.s = s;
      if (now - vis.dustT > 0.028 && k < 0.92) { vis.dustT = now; spawnDust(x, z, rot, s); }
    } else if (vis.mode === 'depart') {
      const t = now - vis.t0, x0 = sx(vis.spot), z0 = parkZ(vis.vid), z1 = ROAD_Z;
      s = PS;
      if (t < 0.5) { const k = ease(t / 0.5); x = x0; z = z0 + (z1 - z0) * k; rot = 0; }
      else { const k = (t - 0.5) / 0.9; rot = -Math.PI / 2 * ease((t - 0.5) / 0.22); x = x0 + (k * k * 0.5 + k * 0.5) * 16; z = z1; if (now - vis.dustT > 0.03) { vis.dustT = now; spawnDust(x, z, rot, s); } if (k >= 1) { vis.mode = 'gone'; continue; } }
    } else if (vis.mode === 'waitDrive') { /* stays in the lot until its spot clears */ }
    else if (vis.mode === 'lot') {
      const bk = (now - vis.bump) / 0.24;
      if (bk >= 0 && bk < 1) { const off = Math.sin(Math.PI * bk) * 0.22 * CS; x -= Math.sin(rot) * off; z -= Math.cos(rot) * off; }
    }
    let sy = 1, sxz = 1;
    const pk = (now - vis.pop) / 0.35; if (pk >= 0 && pk < 1) { const p = 1 + Math.sin(pk * Math.PI) * 0.3; sxz = p; sy = p; }
    const sq = (now - (vis.squash || -9)) / 0.16; if (sq >= 0 && sq < 1) { sy *= 1 - Math.sin(sq * Math.PI) * 0.09; sxz *= 1 + Math.sin(sq * Math.PI) * 0.04; }
    const fl = (now - vis.flash) / 0.35; if (fl >= 0 && fl < 1) sxz *= 1 + Math.sin(fl * Math.PI * 3) * 0.07 * (1 - fl);
    tmpQ.setFromAxisAngle(YAX, rot); tmpS.set(s * sxz, s * sy, s * sxz); tmpP.set(x, 0, z); tmpM.compose(tmpP, tmpQ, tmpS);
    const col = vColor(vis.vid);
    for (const [name, pm] of md.parts) {
      const m = IM[name], i = cnt[name]++; if (i >= m.instanceMatrix.count) continue;
      tmpM2.multiplyMatrices(tmpM, pm); m.setMatrixAt(i, tmpM2);
      if (name === 'body') m.setColorAt(i, tmpC.set(col)); else if (name === 'roof') m.setColorAt(i, tmpC.set(col).lerp(WHITE, 0.14));
    }
    const hidden = v.m && !revealed[vis.vid];
    if (vis.mode === 'lot' || vis.mode === 'waitDrive' || (vis.mode === 'drive' && now - vis.t0 < vis.T * 0.6)) {
      tmpM2.multiplyMatrices(tmpM, hidden ? md.arrowM : md.arrow); IM.arrow.setMatrixAt(cnt.arrow++, tmpM2);
      if (hidden) { tmpM2.multiplyMatrices(tmpM, md.q); IM.q.setMatrixAt(cnt.q++, tmpM2); }
    }
  }
  for (const k in cnt) { const m = IM[k]; m.count = cnt[k]; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }

  // riders
  let n = 0; const lerpK = 1 - Math.exp(-dt * 10);
  const lim = Math.min(people.length, QVIS + 40);
  for (let k = 0; k < lim; k++) {
    const p = people[k]; const tgt = k < QVIS ? SLOTS[k] : ARM_END[k % 2];
    const dx = tgt[0] - p.x, dz = tgt[1] - p.z; const moving = dx * dx + dz * dz > 0.0004; p.x += dx * lerpK; p.z += dz * lerpK;
    if (p.s < 1 && now > p.born) p.s = Math.min(1, p.s + dt * 6);
    if (k >= QVIS || n >= MAXP) continue;
    const bob = moving ? Math.abs(Math.sin(now * 14 + p.pid)) * 0.05 : 0;
    setPerson(n++, p.x, bob, p.z, p.color, p.s);
  }
  for (const w of walkers) {
    const k = Math.min(1, (now - w.t0) / w.T); const segs = w.pts; let L = 0; const ls = []; for (let i = 1; i < segs.length; i++) { const l = Math.hypot(segs[i][0] - segs[i - 1][0], segs[i][1] - segs[i - 1][1]); ls.push(l); L += l; }
    let d = L * k, i = 0; while (i < ls.length - 1 && d > ls[i]) { d -= ls[i]; i++; } const f = ls[i] ? Math.min(1, d / ls[i]) : 1;
    const x = segs[i][0] + (segs[i + 1][0] - segs[i][0]) * f, z = segs[i][1] + (segs[i + 1][1] - segs[i][1]) * f;
    const bob = Math.abs(Math.sin(now * 16 + w.p.pid)) * 0.06; const s = k > 0.9 ? 0.4 + (1 - k) * 6 : 1;
    if (n < MAXP) setPerson(n++, x, bob, z, w.p.color, s);
  }
  peopleBody.count = n; peopleHead.count = n;
  for (const m of [peopleBody, peopleHead]) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }

  // dust
  let dn = 0; dust = dust.filter(p => now - p.t0 < p.life);
  for (const p of dust) { const k = (now - p.t0) / p.life; const sc = p.r * (0.6 + k * 1.4) * (1 - k * k); tmpS.set(sc, sc, sc); tmpP.set(p.x, 0.08 + k * 0.25, p.z); tmpQ.identity(); tmpM.compose(tmpP, tmpQ, tmpS); dustMesh.setMatrixAt(dn++, tmpM); }
  dustMesh.count = dn; dustMesh.instanceMatrix.needsUpdate = true;

  if (pendingCheck && isIdle()) { pendingCheck = false; checkEnd(); }
}
const WHITE = new THREE.Color('#ffffff');
function setPerson(i, x, y, z, color, s) {
  tmpQ.identity(); tmpS.set(s, s, s); tmpP.set(x, 0.24 * s + y, z); tmpM.compose(tmpP, tmpQ, tmpS); peopleBody.setMatrixAt(i, tmpM);
  tmpP.set(x, 0.52 * s + y, z); tmpM.compose(tmpP, tmpQ, tmpS); peopleHead.setMatrixAt(i, tmpM);
  peopleBody.setColorAt(i, tmpC.set(C.COLORS[color])); peopleHead.setColorAt(i, headColors[color]);
}

// ---------------- camera fit ----------------
let jamBottom = 9;
function fitCamera() {
  const w = window.innerWidth, h = window.innerHeight; renderer.setSize(w, h, false);
  const hudTop = ($('hud').classList.contains('hidden') ? 60 : $('hud').getBoundingClientRect().bottom + 2);
  const barTop = $('bar').classList.contains('hidden') ? h - 30 : $('bar').getBoundingClientRect().top - 4;
  const top = Math.max(hudTop, 50), bottom = Math.max(30, h - barTop);
  const a = THREE.MathUtils.degToRad(54);
  const zMin = TTOP + 0.6, zMax = jamBottom + 0.3, cz = (zMin + zMax) / 2;
  camera.position.set(0, Math.sin(a) * 60, cz + Math.cos(a) * 60); camera.lookAt(0, 0, cz); camera.updateMatrixWorld();
  const xs = [], ys = []; const inv = camera.matrixWorldInverse; const xm = 5.5;
  for (const x of [-xm, xm]) for (const y of [0, 0.8]) for (const z of [zMin, zMax]) { const p = new THREE.Vector3(x, y, z).applyMatrix4(inv); xs.push(p.x); ys.push(p.y); }
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const availH = h - top - bottom; const s = Math.max((maxX - minX) / w, (maxY - minY) / availH);
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, yc = top + availH / 2;
  camera.left = cx - w / 2 * s; camera.right = cx + w / 2 * s; camera.top = cy + yc * s; camera.bottom = cy - (h - yc) * s;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', () => fitCamera());

// ---------------- input ----------------
const ray = new THREE.Raycaster(); const ndc = new THREE.Vector2();
let downAt = null;
canvas.addEventListener('pointerdown', e => { downAt = { x: e.clientX, y: e.clientY }; Sound.unlock(); });
canvas.addEventListener('pointerup', e => { if (!downAt) return; const d = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y); downAt = null; if (d < 18 && mode === 'play') onTap(e.clientX, e.clientY); });
function pickVehicle(x, y) {
  const r = canvas.getBoundingClientRect(); ndc.set((x - r.left) / r.width * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  // test heights through the vehicle body: pick the vehicle whose footprint the ray passes over, nearest the camera
  const lv = state.level; let best = -1, bestT = 1e9;
  for (const yh of [0.55 * CS, 0.25 * CS]) {
    const p = new THREE.Vector3(); if (!ray.ray.intersectPlane(new THREE.Plane(YAX, -yh), p)) continue;
    const l = p.clone().applyMatrix4(lotInv); const cx = l.x + lv.w / 2, cy = l.z + lv.h / 2; const g = C.grid(state);
    const ix = Math.floor(cx), iy = Math.floor(cy);
    if (ix >= 0 && iy >= 0 && ix < lv.w && iy < lv.h) { const id = g[iy * lv.w + ix]; if (id >= 0) { const t = ray.ray.origin.distanceTo(p); if (t < bestT) { bestT = t; best = id; } } }
  }
  if (best >= 0) return best;
  // forgiving: nearest cell centre within 0.8 cells
  const p = new THREE.Vector3(); if (!ray.ray.intersectPlane(new THREE.Plane(YAX, -0.3 * CS), p)) return -1;
  const l = p.applyMatrix4(lotInv); let bd = 0.8;
  lv.vehicles.forEach((v, i) => { if (!state.inLot[i]) return; for (const [cx, cy] of C.cellsOf(v)) { const dd = Math.hypot(cx + 0.5 - lv.w / 2 - l.x, cy + 0.5 - lv.h / 2 - l.z); if (dd < bd) { bd = dd; best = i; } } });
  return best;
}
function onTap(x, y) { const vid = pickVehicle(x, y); if (vid >= 0) tapVehicle(vid); }
function tapVehicle(vid) {
  if (mode !== 'play' || !state.inLot[vid]) return { ok: false, reason: 'gone' };
  const snap = C.snapshot(state);
  const r = C.tap(state, vid);
  if (!r.ok) {
    if (r.reason === 'blocked') { V[vid].bump = now; Sound.honk(); if (r.blocker >= 0 && V[r.blocker]) V[r.blocker].flash = now + 0.1; }
    else if (r.reason === 'full') { Sound.honk(); toast('All 8 spots are full'); }
    return r;
  }
  undoStack.push(snap); if (undoStack.length > 300) undoStack.shift();
  hideHint(); playEvents(r.events); updateReveals(true); afterMove();
  return r;
}
function afterMove() { hideOverlay(); pendingCheck = true; updateHud(); }

// ---------------- boosters ----------------
function doShuffle() {
  if (mode !== 'play' || C.isWon(state)) return; Sound.unlock();
  undoStack.push(C.snapshot(state));
  const ev = C.shuffle(state, (Math.random() * 1e9) | 0);
  Sound.shuffle(); syncScene(true); playEvents(ev); afterMove(); toast('Shuffled!');
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
      $('win-text').textContent = `${state.moves} buses moved` + (state.boosters ? ` · ${state.boosters} booster${state.boosters > 1 ? 's' : ''} used` : ' · no boosters!') + (st < 3 ? ' (finish without Shuffle or Sort for 3 stars)' : '');
      $('win-next').classList.toggle('hidden', levelIdx >= LEVELS.length - 1);
      show('win');
    }, 450);
    return;
  }
  if (C.isStuck(state)) { $('stuck').classList.remove('hidden'); $('btn-shuffle').classList.add('pulse'); Sound.stuck(); }
}
function hideOverlay() { $('stuck').classList.add('hidden'); $('btn-shuffle').classList.remove('pulse'); }

function setupLevel(i) {
  state = C.newState(LEVELS[i]); undoStack = []; revealed = [];
  const lv = state.level; CS = Math.min(0.8, JAM_W * Math.SQRT2 / (lv.w + lv.h + 1.8));
  const half = (lv.w + lv.h) / 2 * CS / Math.SQRT2; const center = [0, JAM_TOP + half + 0.9 * CS]; jamBottom = center[1] + half + 0.6;
  lotFrame.position.set(center[0], 0, center[1]); lotFrame.rotation.set(0, THETA, 0); lotFrame.scale.setScalar(CS); lotFrame.updateMatrixWorld(true); lotInv = lotFrame.matrixWorld.clone().invert();
  buildWorld(lv, CS, center); syncScene(false);
}
function startLevel(i) {
  levelIdx = i; save.last = i; persist(); mode = 'play';
  hideOverlay(); show(null); $('hud').classList.remove('hidden'); $('bar').classList.remove('hidden');
  setupLevel(i); fitCamera();
  const hints = ['Tap a bus with a clear path to drive it to a spot. Matching riders hop on.', 'Full buses leave and free their spot. All 8 spots are yours, VIP too.', 'Stuck? Shuffle is free, unlimited, and always makes it solvable.'];
  if (i < hints.length) showHint(hints[i]); else hideHint();
  pendingCheck = true;
}
function updateHud() {
  if (!state) return;
  $('hud-level').textContent = 'Level ' + (levelIdx + 1);
  const left = state.inLot.filter(Boolean).length; $('hud-moves').textContent = left + ' buses left';
  $('hud-people').textContent = (state.queue.length - state.qi) + ' riders';
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

document.addEventListener('gesturestart', e => e.preventDefault());
document.addEventListener('dblclick', e => e.preventDefault());
document.addEventListener('touchmove', e => { if (!e.target.closest('#lv-grid')) e.preventDefault(); }, { passive: false });

function showTitle() { mode = 'title'; setupLevel(Math.min(LEVELS.length - 1, 20)); show('title'); fitCamera(); }

let last = performance.now(), speed = 1;
function frame(t) { const dt = Math.min(0.05 * speed, (t - last) / 1000 * speed); last = t; update(dt); renderer.render(scene, camera); requestAnimationFrame(frame); }
showTitle(); requestAnimationFrame(frame);

if ('serviceWorker' in navigator && location.protocol !== 'file:') window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));

// test / debug hooks
window.BusJam = {
  get state() { return state; }, get mode() { return mode; }, levels: LEVELS, core: C,
  startLevel, tapVehicle, doShuffle, doSort, doUndo, doRestart, isIdle: () => isIdle(), openLevels,
  save: () => JSON.parse(localStorage.getItem(SAVE_KEY) || '{}'),
  screenOf(vid) { const v = state.level.vehicles[vid]; const [lx, lz] = cellLocal(v); const [x, z] = toWorld(lx, lz); const p = new THREE.Vector3(x, 0.45 * CS, z).project(camera); return { x: (p.x + 1) / 2 * window.innerWidth, y: (1 - p.y) / 2 * window.innerHeight }; },
  pick: (x, y) => pickVehicle(x, y),
  setSpeed: k => { speed = k; },
  solve: (fromCurrent) => C.solve(state.level, 400000, fromCurrent ? state : undefined),
  visiblePeople: () => peopleBody.count, waitingRiders: () => people.length, walking: () => walkers.length,
  info: () => ({ vehicles: state.level.vehicles.length, riders: state.queue.length, drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles }),
};
