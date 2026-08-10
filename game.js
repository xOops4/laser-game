'use strict';

/*
 * VIRGULE — défense de noyau au laser, pensé pour le tactile.
 * Canvas 2D pur, aucune dépendance.
 *
 * Le doigt donne un angle : le rayon part du noyau et balaie l'écran.
 * Il traverse tout ce qui est aligné et inflige des dégâts par seconde.
 */

/* ------------------------------------------------------------------ *
 *  Réglages
 * ------------------------------------------------------------------ */

const CFG = {
  core: {
    hpMax: 120,
    radiusFactor: 0.075,   // fraction de la plus petite dimension de l'écran
    radiusMin: 26,
    radiusMax: 58,
  },
  combo: {
    killsPerStep: 8,       // kills nécessaires pour +1 au multiplicateur
    max: 10,
  },
  spawn: {
    startInterval: 1.25,   // secondes entre deux apparitions au début
    endInterval: 0.45,     // ... et une fois la difficulté au maximum
    rampTime: 180,         // secondes pour atteindre le maximum
    speedRampTime: 280,    // les ennemis gagnent +100% de vitesse sur cette durée
  },
  particlesMax: 900,
  ringsMax: 40,
};

/*
 * Armes. La première est disponible d'emblée, les suivantes se débloquent
 * au score indiqué, dans la partie en cours. Chacune a un vrai défaut :
 * le choix doit dépendre de ce qui arrive à l'écran.
 *
 *  - beams   : décalages angulaires des rayons, en radians
 *  - dps     : dégâts par seconde et par rayon
 *  - range   : portée, en fraction du rayon d'apparition
 *  - pierce  : false = seule la cible la plus proche encaisse
 *  - slack   : tolérance de visée, fixe puis proportionnelle à la distance
 */
const WEAPONS = [
  {
    id: 'ray', name: 'Rayon', unlock: 0, color: '#4df3ff',
    kind: 'beam', beams: [0], dps: 115, range: 1, pierce: true,
    halfWidth: 5, slack: 4, slackPerPx: 0.022,
    blurb: 'Polyvalent. Traverse tout ce qui est aligné.',
  },
  {
    id: 'fan', name: 'Éventail', unlock: 350, color: '#5dffa0',
    kind: 'beam', beams: [-0.34, 0, 0.34], dps: 58, range: 0.5, pierce: true,
    halfWidth: 4, slack: 5, slackPerPx: 0.03,
    blurb: 'Trois rayons courts. Nettoie les nuées, impuissant au loin.',
  },
  {
    id: 'lance', name: 'Lance', unlock: 950, color: '#ff3d81',
    kind: 'beam', beams: [0], dps: 340, range: 1, pierce: false,
    halfWidth: 3, slack: 1, slackPerPx: 0.007,
    blurb: 'Une seule cible, dégâts énormes. Visée exigeante.',
  },
  {
    id: 'wave', name: 'Onde', unlock: 2100, color: '#c9a3ff',
    kind: 'wave', interval: 1.05, pulseDamage: 52, radiusFactor: 0.42,
    blurb: 'Impulsions circulaires. Ignore la visée, ne porte pas loin.',
  },
];

/* Types d'ennemis. `unlock` = secondes avant qu'il puisse apparaître. */
const ENEMY_TYPES = {
  grunt: {
    hp: 30, speed: 42, radius: 13, damage: 10, score: 10,
    color: '#ff6a3d', shape: 'triangle', orient: 'aim', unlock: 0, weight: 10,
  },
  darter: {
    hp: 16, speed: 84, radius: 9, damage: 6, score: 15,
    color: '#ffd23f', shape: 'diamond', orient: 'aim', unlock: 20, weight: 7,
  },
  tank: {
    hp: 135, speed: 24, radius: 22, damage: 22, score: 40,
    color: '#b06cff', shape: 'hex', orient: 'spin', unlock: 42, weight: 4,
  },
};

const BEST_KEY = 'virgule.best';

/* ------------------------------------------------------------------ *
 *  Utilitaires
 * ------------------------------------------------------------------ */

const TAU = Math.PI * 2;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);

/** '#rrggbb' + alpha -> 'rgba(r,g,b,a)'. */
function hexToRgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/* ------------------------------------------------------------------ *
 *  Canvas et mise à l'échelle
 * ------------------------------------------------------------------ */

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d', { alpha: false });
const overlay = document.getElementById('overlay');
const panel = document.getElementById('panel');
const safeProbe = document.getElementById('safe-probe');
const weaponBar = document.getElementById('weapons');
const toast = document.getElementById('toast');
const soundBtn = document.getElementById('sound');

/* Toutes les coordonnées du jeu sont en pixels CSS ; le DPR est absorbé
   par une transformation appliquée une fois pour toutes au resize. */
const view = {
  w: 0, h: 0,           // taille en px CSS
  cx: 0, cy: 0,         // centre
  spawnRadius: 0,       // les ennemis naissent juste hors champ
  coreRadius: 0,
  scale: 1,             // facteur d'échelle de l'UI selon la taille d'écran
  safe: { top: 0, right: 0, bottom: 0, left: 0 },
};

function resize() {
  const dpr = clamp(window.devicePixelRatio || 1, 1, 2);
  const w = window.innerWidth;
  const h = window.innerHeight;

  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  view.w = w;
  view.h = h;
  view.cx = w / 2;
  view.cy = h / 2;
  // Le coin le plus éloigné du centre, plus une marge : rien n'apparaît à l'écran.
  view.spawnRadius = Math.hypot(w, h) / 2 + 60;
  view.coreRadius = clamp(
    Math.min(w, h) * CFG.core.radiusFactor,
    CFG.core.radiusMin,
    CFG.core.radiusMax
  );
  view.scale = clamp(Math.min(w, h) / 400, 0.85, 1.6);

  const cs = getComputedStyle(safeProbe);
  view.safe = {
    top: parseFloat(cs.paddingTop) || 0,
    right: parseFloat(cs.paddingRight) || 0,
    bottom: parseFloat(cs.paddingBottom) || 0,
    left: parseFloat(cs.paddingLeft) || 0,
  };

  buildStarfield();
}

/* ------------------------------------------------------------------ *
 *  Décor de fond
 * ------------------------------------------------------------------ */

let stars = [];

function buildStarfield() {
  const count = Math.round((view.w * view.h) / 11000);
  stars = new Array(count);
  for (let i = 0; i < count; i++) stars[i] = newStar(rand(0, 1));
}

/** Poussière aspirée par le noyau. `t` place l'étoile sur sa course (0 = bord). */
function newStar(t) {
  const angle = Math.random() * TAU;
  return {
    angle,
    dist: lerp(view.spawnRadius, view.coreRadius, t),
    speed: rand(4, 22),          // parallaxe : les proches filent plus vite
    r: rand(0.4, 1.6),
    a: rand(0.08, 0.42),
    phase: Math.random() * TAU,
  };
}

function updateStars(dt) {
  for (let i = 0; i < stars.length; i++) {
    const s = stars[i];
    s.dist -= s.speed * dt;
    if (s.dist <= view.coreRadius) stars[i] = newStar(0);
  }
}

/* ------------------------------------------------------------------ *
 *  État de la partie
 * ------------------------------------------------------------------ */

const STATE = { MENU: 'menu', PLAYING: 'playing', PAUSED: 'paused', OVER: 'over' };

const game = {
  state: STATE.MENU,
  time: 0,              // secondes écoulées dans la partie en cours
  score: 0,
  best: loadBest(),
  kills: 0,
  combo: 0,             // kills consécutifs sans encaisser
  multiplier: 1,
  hp: CFG.core.hpMax,
  weapon: 0,            // index dans WEAPONS
  unlocked: [true],     // un booléen par arme
  waveTimer: 0,         // compte à rebours de la prochaine impulsion de l'Onde
  enemies: [],
  particles: [],
  rings: [],            // ondes de choc en cours d'expansion
  spawnTimer: 0,
  shake: 0,
  coreFlash: 0,         // éclat blanc quand le noyau prend un coup
  corePulse: 0,
  overTimer: 0,         // délai avant l'écran de fin, le temps de voir l'explosion
  newBest: false,
};

function loadBest() {
  try {
    const v = parseInt(localStorage.getItem(BEST_KEY) || '0', 10);
    return Number.isFinite(v) && v > 0 ? v : 0;
  } catch (_) {
    return 0; // localStorage bloqué (mode privé, iframe sandboxée) : on joue sans record.
  }
}

function saveBest(v) {
  try { localStorage.setItem(BEST_KEY, String(v)); } catch (_) { /* tant pis */ }
}

function resetGame() {
  game.time = 0;
  game.score = 0;
  game.kills = 0;
  game.combo = 0;
  game.multiplier = 1;
  game.hp = CFG.core.hpMax;
  game.weapon = 0;
  game.unlocked = WEAPONS.map((w) => w.unlock === 0);
  game.waveTimer = 0;
  game.enemies.length = 0;
  game.particles.length = 0;
  game.rings.length = 0;
  game.spawnTimer = 0.6;
  game.shake = 0;
  game.coreFlash = 0;
  game.corePulse = 0;
  game.overTimer = 0;
  game.newBest = false;
}

/* ------------------------------------------------------------------ *
 *  Entrée tactile / souris
 * ------------------------------------------------------------------ */

/* Un seul doigt compte : le premier posé. Les suivants sont ignorés
   tant qu'il n'a pas été relevé. */
const input = {
  active: false,
  pointerId: null,
  angle: 0,        // direction visée, en radians
  hasAngle: false, // le canon garde sa dernière orientation même doigt levé
};

function updateAngleFrom(e) {
  const dx = e.clientX - view.cx;
  const dy = e.clientY - view.cy;
  // Pile au centre : on garde l'angle précédent plutôt que de faire sauter le canon.
  if (dx * dx + dy * dy < 1) return;
  input.angle = Math.atan2(dy, dx);
  input.hasAngle = true;
}

canvas.addEventListener('pointerdown', (e) => {
  if (input.pointerId !== null) return;
  input.pointerId = e.pointerId;
  input.active = true;
  updateAngleFrom(e);
  audioInit();          // premier geste utilisateur : iOS n'autorise que là
  audioResume();
  if (game.state === STATE.PLAYING) humStart();
  if (canvas.setPointerCapture) {
    try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
  }
  e.preventDefault();
}, { passive: false });

canvas.addEventListener('pointermove', (e) => {
  if (e.pointerId !== input.pointerId) return;
  updateAngleFrom(e);
  e.preventDefault();
}, { passive: false });

function releasePointer(e) {
  if (e.pointerId !== input.pointerId) return;
  input.pointerId = null;
  input.active = false;
  humStop();
}
canvas.addEventListener('pointerup', releasePointer);
canvas.addEventListener('pointercancel', releasePointer);

/* Filet de sécurité : un doigt relevé hors du canvas ne doit pas laisser
   le laser bloqué en position allumée. */
window.addEventListener('blur', () => {
  input.pointerId = null;
  input.active = false;
  humStop();
});

/* Mise en pause automatique quand l'onglet passe en arrière-plan. */
document.addEventListener('visibilitychange', () => {
  if (document.hidden && game.state === STATE.PLAYING) {
    game.state = STATE.PAUSED;
    input.pointerId = null;
    input.active = false;
    humStop();
    showPause();
  } else if (!document.hidden) {
    audioResume();
  }
});

/* ------------------------------------------------------------------ *
 *  Son
 *
 *  Tout est synthétisé à la volée : oscillateurs et bruit blanc filtré,
 *  aucun fichier à charger. Le contexte ne peut naître que dans un geste
 *  utilisateur (iOS l'exige), d'où l'initialisation au premier appui.
 * ------------------------------------------------------------------ */

const SOUND_KEY = 'virgule.sound';

const audio = {
  ctx: null,
  master: null,
  noise: null,      // buffer de bruit blanc réutilisé par tous les impacts
  hum: null,        // { osc1, osc2, gain, filter } du bourdonnement de tir
  on: loadSound(),
  lastHit: -1,      // horodatages pour brider les sons en rafale
  lastKill: -1,
};

function loadSound() {
  try { return localStorage.getItem(SOUND_KEY) !== 'off'; } catch (_) { return true; }
}

function audioInit() {
  if (audio.ctx) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;

  audio.ctx = new AC();
  audio.master = audio.ctx.createGain();
  audio.master.gain.value = audio.on ? 0.34 : 0;
  audio.master.connect(audio.ctx.destination);

  const len = Math.floor(audio.ctx.sampleRate * 0.4);
  const buf = audio.ctx.createBuffer(1, len, audio.ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  audio.noise = buf;
}

/** Le contexte se suspend tout seul en arrière-plan : on le réveille. */
function audioResume() {
  if (audio.ctx && audio.ctx.state === 'suspended') audio.ctx.resume();
}

function audioReady() {
  return audio.ctx && audio.on;
}

/** Note simple, avec glissando optionnel vers `to`. */
function tone(freq, dur, opts) {
  if (!audioReady()) return;
  const o = opts || {};
  const t = audio.ctx.currentTime + (o.delay || 0);

  const osc = audio.ctx.createOscillator();
  const gain = audio.ctx.createGain();
  osc.type = o.type || 'sine';
  osc.frequency.setValueAtTime(freq, t);
  if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + dur);

  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(o.gain || 0.3, t + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);

  osc.connect(gain).connect(audio.master);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

/** Souffle de bruit filtré : impacts, explosions, chocs. */
function noiseBurst(dur, opts) {
  if (!audioReady()) return;
  const o = opts || {};
  const t = audio.ctx.currentTime + (o.delay || 0);

  const src = audio.ctx.createBufferSource();
  src.buffer = audio.noise;

  const filter = audio.ctx.createBiquadFilter();
  filter.type = o.type || 'bandpass';
  filter.frequency.setValueAtTime(o.freq || 1200, t);
  if (o.freqTo) filter.frequency.exponentialRampToValueAtTime(o.freqTo, t + dur);
  filter.Q.value = o.q || 1;

  const gain = audio.ctx.createGain();
  gain.gain.setValueAtTime(o.gain || 0.3, t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);

  src.connect(filter).connect(gain).connect(audio.master);
  src.start(t);
  src.stop(t + dur + 0.02);
}

/* Timbre du bourdonnement, par arme. */
const HUM = {
  ray:   { freq: 128, detune: 7,  type: 'sawtooth', cutoff: 900,  gain: 0.09 },
  fan:   { freq: 88,  detune: 13, type: 'square',   cutoff: 700,  gain: 0.08 },
  lance: { freq: 196, detune: 4,  type: 'sawtooth', cutoff: 1500, gain: 0.10 },
};

function humStart() {
  if (!audioReady() || audio.hum) return;
  const spec = HUM[currentWeapon().id];
  if (!spec) return;                       // l'Onde n'a pas de tir continu

  const t = audio.ctx.currentTime;
  const filter = audio.ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = spec.cutoff;

  const gain = audio.ctx.createGain();
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(spec.gain, t + 0.04);

  const osc1 = audio.ctx.createOscillator();
  const osc2 = audio.ctx.createOscillator();
  osc1.type = osc2.type = spec.type;
  osc1.frequency.value = spec.freq;
  osc2.frequency.value = spec.freq;
  osc2.detune.value = spec.detune;

  osc1.connect(filter);
  osc2.connect(filter);
  filter.connect(gain).connect(audio.master);
  osc1.start(t);
  osc2.start(t);

  audio.hum = { osc1, osc2, gain };
}

function humStop() {
  if (!audio.hum) return;
  const { osc1, osc2, gain } = audio.hum;
  audio.hum = null;

  const t = audio.ctx.currentTime;
  gain.gain.cancelScheduledValues(t);
  gain.gain.setValueAtTime(Math.max(gain.gain.value, 0.0001), t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
  osc1.stop(t + 0.09);
  osc2.stop(t + 0.09);
}

/* Effets ponctuels. Les rafales sont bridées pour ne pas saturer la sortie. */

function sfxHit() {
  if (game.corePulse - audio.lastHit < 0.045) return;
  audio.lastHit = game.corePulse;
  noiseBurst(0.045, { freq: 2600, q: 3, gain: 0.06 });
}

function sfxKill(enemy) {
  if (game.corePulse - audio.lastKill < 0.035) return;
  audio.lastKill = game.corePulse;
  const big = enemy.hpMax > 60;
  noiseBurst(big ? 0.34 : 0.16, {
    type: 'lowpass', freq: big ? 1500 : 2400, freqTo: big ? 120 : 320,
    gain: big ? 0.3 : 0.16,
  });
  tone(big ? 150 : 420, big ? 0.26 : 0.1, {
    to: big ? 44 : 150, type: 'triangle', gain: big ? 0.22 : 0.1,
  });
}

function sfxCoreHit(enemy) {
  noiseBurst(0.4, { type: 'lowpass', freq: 900, freqTo: 70, gain: 0.36 });
  tone(110, 0.3, { to: 38, type: 'sine', gain: 0.34 });
  if (enemy.def.damage >= 20) tone(70, 0.45, { to: 30, type: 'sine', gain: 0.3 });
}

function sfxWave() {
  noiseBurst(0.42, { type: 'lowpass', freq: 700, freqTo: 90, gain: 0.24 });
  tone(180, 0.36, { to: 60, type: 'sine', gain: 0.24 });
}

function sfxCombo(mult) {
  const base = 520 * Math.pow(1.06, mult);
  tone(base, 0.1, { type: 'triangle', gain: 0.14 });
  tone(base * 1.5, 0.12, { type: 'triangle', gain: 0.1, delay: 0.06 });
}

function sfxUnlock() {
  [0, 0.09, 0.18].forEach((d, i) => {
    tone(440 * Math.pow(1.26, i), 0.24, {
      type: 'triangle', gain: 0.2, delay: d,
    });
  });
}

function sfxSwitch() {
  tone(880, 0.05, { type: 'square', gain: 0.08 });
}

function sfxGameOver() {
  humStop();
  noiseBurst(1.1, { type: 'lowpass', freq: 1800, freqTo: 60, gain: 0.34 });
  tone(320, 1.2, { to: 40, type: 'sawtooth', gain: 0.26 });
  tone(160, 1.3, { to: 30, type: 'sine', gain: 0.22, delay: 0.05 });
}

function setSound(on) {
  audio.on = on;
  try { localStorage.setItem(SOUND_KEY, on ? 'on' : 'off'); } catch (_) { /* tant pis */ }
  if (audio.master) {
    audio.master.gain.setTargetAtTime(on ? 0.34 : 0, audio.ctx.currentTime, 0.02);
  }
  if (!on) humStop();
  renderSoundButton();
}

/* ------------------------------------------------------------------ *
 *  Vibration
 * ------------------------------------------------------------------ */

function vibrate(ms) {
  if (navigator.vibrate) {
    try { navigator.vibrate(ms); } catch (_) { /* ignoré sur iOS */ }
  }
}

/* ------------------------------------------------------------------ *
 *  Ennemis
 * ------------------------------------------------------------------ */

function difficulty() {
  return clamp(game.time / CFG.spawn.rampTime, 0, 1);
}

function pickEnemyType() {
  const t = game.time;
  let total = 0;
  const pool = [];
  for (const key in ENEMY_TYPES) {
    const def = ENEMY_TYPES[key];
    if (t < def.unlock) continue;
    // Un type fraîchement débloqué monte doucement en fréquence.
    const ramp = clamp((t - def.unlock) / 20, 0.25, 1);
    const w = def.weight * ramp;
    total += w;
    pool.push({ def, acc: total });
  }
  const r = Math.random() * total;
  for (const entry of pool) {
    if (r <= entry.acc) return entry.def;
  }
  return ENEMY_TYPES.grunt;
}

function spawnEnemy() {
  const def = pickEnemyType();
  const angle = Math.random() * TAU;
  const speedMul = 1 + game.time / CFG.spawn.speedRampTime;

  game.enemies.push({
    def,
    x: view.cx + Math.cos(angle) * view.spawnRadius,
    y: view.cy + Math.sin(angle) * view.spawnRadius,
    hp: def.hp,
    hpMax: def.hp,
    speed: def.speed * speedMul * rand(0.9, 1.12),
    radius: def.radius,
    rot: angle + Math.PI,
    spin: rand(-1.6, 1.6),
    seed: Math.random() * TAU,
    trail: rand(0, 0.055),
    flash: 0,
  });
}

function killEnemy(enemy, index) {
  game.enemies.splice(index, 1);
  game.kills++;
  game.combo++;

  const before = game.multiplier;
  game.multiplier = clamp(
    1 + Math.floor(game.combo / CFG.combo.killsPerStep),
    1,
    CFG.combo.max
  );
  game.score += enemy.def.score * game.multiplier;

  const big = enemy.hpMax > 60;
  const size = enemy.radius;

  shards(enemy.x, enemy.y, enemy.def.color, Math.round(9 + size * 0.8), big ? 1.35 : 1);
  burst(enemy.x, enemy.y, '#ffffff', Math.round(4 + size * 0.35), 0.85);
  embers(enemy.x, enemy.y, enemy.def.color, Math.round(3 + size * 0.4));
  shockRingAt(enemy.x, enemy.y, enemy.def.color, size * (big ? 4.2 : 2.8), big ? 0.4 : 0.28);

  if (big) game.shake = Math.max(game.shake, 6);
  sfxKill(enemy);

  // Palier de combo franchi : anneau doré et petit carillon.
  if (game.multiplier > before) {
    shockRing('#ffd23f', view.coreRadius * 3.4, 0.5, 2);
    sfxCombo(game.multiplier);
  }
}

/* ------------------------------------------------------------------ *
 *  Particules
 * ------------------------------------------------------------------ */

/**
 * Une particule = position, vitesse, durée de vie, et une forme parmi deux :
 * `dot` (carré) ou `streak` (segment orienté par la vitesse). Le second coûte
 * plus cher à dessiner, on le réserve aux explosions.
 */
function addParticle(p) {
  if (game.particles.length >= CFG.particlesMax) return;
  game.particles.push(p);
}

/** Gerbe d'étincelles omnidirectionnelle. */
function burst(x, y, color, count, spread) {
  const speed = spread || 1;
  for (let i = 0; i < count; i++) {
    const a = Math.random() * TAU;
    const v = rand(40, 260) * speed;
    addParticle({
      x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
      life: rand(0.25, 0.7), maxLife: 0.7,
      size: rand(1.2, 3.2), drag: 0.94, shape: 'dot', color,
    });
  }
}

/** Éclats rapides et allongés : le corps de l'ennemi qui part en morceaux. */
function shards(x, y, color, count, speed) {
  for (let i = 0; i < count; i++) {
    const a = Math.random() * TAU;
    const v = rand(120, 460) * (speed || 1);
    addParticle({
      x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
      life: rand(0.3, 0.75), maxLife: 0.75,
      size: rand(1.4, 2.6), drag: 0.955, shape: 'streak', color,
    });
  }
}

/** Braises lentes qui s'attardent après l'explosion. */
function embers(x, y, color, count) {
  for (let i = 0; i < count; i++) {
    const a = Math.random() * TAU;
    const v = rand(10, 70);
    addParticle({
      x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
      life: rand(0.6, 1.4), maxLife: 1.4,
      size: rand(1, 2.2), drag: 0.985, shape: 'dot', color,
    });
  }
}

/** Anneau de choc. Tous les événements marquants en émettent un. */
function shockRing(color, max, life, width) {
  if (game.rings.length >= CFG.ringsMax) return;
  game.rings.push({
    r0: view.coreRadius, max, life, maxLife: life,
    color, width: width || 3, x: view.cx, y: view.cy,
  });
}

/** Variante centrée ailleurs que sur le noyau (mort d'un ennemi). */
function shockRingAt(x, y, color, max, life, width) {
  if (game.rings.length >= CFG.ringsMax) return;
  game.rings.push({
    r0: 2, max, life, maxLife: life, color, width: width || 2, x, y,
  });
}

function updateParticles(dt) {
  const list = game.particles;
  for (let i = list.length - 1; i >= 0; i--) {
    const p = list[i];
    p.life -= dt;
    if (p.life <= 0) { list.splice(i, 1); continue; }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vx *= p.drag;   // friction : les étincelles retombent vite
    p.vy *= p.drag;
  }
}

function updateRings(dt) {
  for (let i = game.rings.length - 1; i >= 0; i--) {
    const ring = game.rings[i];
    ring.life -= dt;
    if (ring.life <= 0) game.rings.splice(i, 1);
  }
}

/* ------------------------------------------------------------------ *
 *  Boucle de mise à jour
 * ------------------------------------------------------------------ */

let sparkCooldown = 0;

function update(dt) {
  game.corePulse += dt;

  if (game.state === STATE.PLAYING) {
    game.time += dt;

    // Cadence d'apparition, de plus en plus rapide.
    const interval = lerp(CFG.spawn.startInterval, CFG.spawn.endInterval, difficulty());
    game.spawnTimer -= dt;
    if (game.spawnTimer <= 0) {
      spawnEnemy();
      game.spawnTimer += interval * rand(0.75, 1.25);
    }

    updateEnemies(dt);
    if (input.active) fireWeapon(dt);
    checkUnlocks();
  }

  updateParticles(dt);
  updateRings(dt);
  updateStars(dt);

  game.shake = Math.max(0, game.shake - dt * 42);
  game.coreFlash = Math.max(0, game.coreFlash - dt * 4);
  sparkCooldown = Math.max(0, sparkCooldown - dt);

  if (game.state === STATE.OVER && game.overTimer > 0) {
    game.overTimer -= dt;
    if (game.overTimer <= 0) showGameOver();
  }
}

function updateEnemies(dt) {
  const contactBase = view.coreRadius;
  const trails = game.enemies.length <= 45;

  for (let i = game.enemies.length - 1; i >= 0; i--) {
    const e = game.enemies[i];

    const dx = view.cx - e.x;
    const dy = view.cy - e.y;
    const dist = Math.hypot(dx, dy) || 1;

    e.x += (dx / dist) * e.speed * dt;
    e.y += (dy / dist) * e.speed * dt;
    e.flash = Math.max(0, e.flash - dt * 12);

    // Traînée de réacteur. Coupée quand l'écran se remplit, pour tenir le budget.
    if (trails) {
      e.trail -= dt;
      if (e.trail <= 0) {
        e.trail = 0.055;
        addParticle({
          x: e.x - (dx / dist) * e.radius * 0.8 + rand(-2, 2),
          y: e.y - (dy / dist) * e.radius * 0.8 + rand(-2, 2),
          vx: -(dx / dist) * 18, vy: -(dy / dist) * 18,
          life: rand(0.18, 0.4), maxLife: 0.4,
          size: rand(0.9, 1.9), drag: 0.94, shape: 'dot', color: e.def.color,
        });
      }
    }

    if (e.def.orient === 'aim') {
      // Nez pointé vers le noyau, avec un léger roulis pour que ça vive.
      e.rot = Math.atan2(dy, dx) + Math.sin(game.corePulse * 3 + e.seed) * 0.12;
    } else {
      e.rot += e.spin * dt;
    }

    if (dist < contactBase + e.radius) {
      game.enemies.splice(i, 1);
      hitCore(e);
    }
  }
}

function hitCore(enemy) {
  game.hp -= enemy.def.damage;
  game.combo = 0;
  game.multiplier = 1;
  game.shake = Math.min(22, 8 + enemy.def.damage * 0.4);
  game.coreFlash = 1;

  shards(enemy.x, enemy.y, '#ffffff', 16, 1.4);
  shards(enemy.x, enemy.y, enemy.def.color, 10, 1.1);
  embers(enemy.x, enemy.y, '#ff3d81', 8);
  shockRing('#ff3d81', view.coreRadius * 4.6, 0.5, 4);

  vibrate(enemy.def.damage >= 20 ? 55 : 30);
  sfxCoreHit(enemy);

  if (game.hp <= 0) {
    game.hp = 0;
    endGame();
  }
}

function endGame() {
  game.state = STATE.OVER;
  game.overTimer = 0.85;
  game.shake = 30;
  input.active = false;
  input.pointerId = null;

  shards(view.cx, view.cy, '#4df3ff', 90, 2.6);
  shards(view.cx, view.cy, '#ff3d81', 60, 1.9);
  burst(view.cx, view.cy, '#ffffff', 50, 2.2);
  embers(view.cx, view.cy, '#4df3ff', 40);
  shockRing('#ffffff', view.spawnRadius * 0.9, 0.7, 6);
  shockRing('#ff3d81', view.spawnRadius * 0.65, 0.9, 3);

  vibrate([40, 60, 120]);
  sfxGameOver();

  if (game.score > game.best) {
    game.best = game.score;
    game.newBest = true;
    saveBest(game.best);
  }
}

function currentWeapon() {
  return WEAPONS[game.weapon];
}

function fireWeapon(dt) {
  const w = currentWeapon();
  if (w.kind === 'wave') fireWave(w, dt);
  else if (input.hasAngle) fireBeams(w, dt);
}

/**
 * Rayons continus. Chaque faisceau part du bord du noyau selon son décalage
 * angulaire et touche les ennemis dont la distance perpendiculaire à l'axe de
 * tir est inférieure à leur rayon + une tolérance qui grandit avec
 * l'éloignement — viser loin ne doit pas demander une précision au pixel.
 */
function fireBeams(w, dt) {
  const reach = view.spawnRadius * w.range;
  const damage = w.dps * dt;

  for (const offset of w.beams) {
    const angle = input.angle + offset;
    const ux = Math.cos(angle);
    const uy = Math.sin(angle);

    let nearest = -1;         // seulement utile aux armes sans perçage
    let nearestAlong = Infinity;

    for (let i = game.enemies.length - 1; i >= 0; i--) {
      const e = game.enemies[i];
      const dx = e.x - view.cx;
      const dy = e.y - view.cy;

      const along = dx * ux + dy * uy;          // projection sur l'axe de tir
      if (along <= 0 || along > reach) continue; // derrière le canon, ou hors portée

      const perp = Math.abs(dx * uy - dy * ux);
      if (perp > e.radius + w.halfWidth + w.slack + along * w.slackPerPx) continue;

      if (w.pierce) {
        hitEnemy(e, i, damage, ux, uy);
      } else if (along < nearestAlong) {
        nearestAlong = along;
        nearest = i;
      }
    }

    if (nearest >= 0) hitEnemy(game.enemies[nearest], nearest, damage, ux, uy);
  }
}

/**
 * L'Onde ne vise pas : elle libère une impulsion circulaire à intervalle fixe
 * tant que le doigt reste posé, et frappe tout ce qui est à portée du noyau.
 */
function fireWave(w, dt) {
  const radius = view.spawnRadius * w.radiusFactor;

  game.waveTimer -= dt;
  if (game.waveTimer > 0) return;
  game.waveTimer += w.interval;

  shockRing(w.color, radius, 0.45, 4);
  game.shake = Math.max(game.shake, 5);
  sfxWave();

  // Poussière soulevée le long du front de l'onde.
  for (let i = 0; i < 22; i++) {
    const a = Math.random() * TAU;
    const v = rand(160, 320);
    addParticle({
      x: view.cx + Math.cos(a) * view.coreRadius,
      y: view.cy + Math.sin(a) * view.coreRadius,
      vx: Math.cos(a) * v, vy: Math.sin(a) * v,
      life: rand(0.25, 0.45), maxLife: 0.45,
      size: rand(1, 2.4), drag: 0.93, shape: 'streak', color: w.color,
    });
  }

  for (let i = game.enemies.length - 1; i >= 0; i--) {
    const e = game.enemies[i];
    const dist = Math.hypot(e.x - view.cx, e.y - view.cy);
    if (dist > radius + e.radius) continue;

    const ux = (e.x - view.cx) / (dist || 1);
    const uy = (e.y - view.cy) / (dist || 1);
    hitEnemy(e, i, w.pulseDamage, ux, uy);
  }
}

/** Applique des dégâts à un ennemi ; `ux/uy` oriente les étincelles d'impact. */
function hitEnemy(enemy, index, damage, ux, uy) {
  enemy.hp -= damage;
  enemy.flash = 1;

  if (enemy.hp <= 0) {
    killEnemy(enemy, index);
    return;
  }

  if (sparkCooldown > 0) return;
  sparkCooldown = 0.028;
  sfxHit();

  // Les étincelles giclent à contresens du tir, depuis le point d'impact.
  const ix = enemy.x - ux * enemy.radius;
  const iy = enemy.y - uy * enemy.radius;
  for (let i = 0; i < 3; i++) {
    const a = Math.atan2(-uy, -ux) + rand(-0.9, 0.9);
    const v = rand(90, 300);
    addParticle({
      x: ix, y: iy, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
      life: rand(0.12, 0.3), maxLife: 0.3,
      size: rand(1, 2.4), drag: 0.9, shape: 'streak',
      color: i === 0 ? '#ffffff' : enemy.def.color,
    });
  }
}

/** Débloque les armes dont le palier de score vient d'être franchi. */
function checkUnlocks() {
  for (let i = 0; i < WEAPONS.length; i++) {
    if (game.unlocked[i] || game.score < WEAPONS[i].unlock) continue;
    game.unlocked[i] = true;
    announceUnlock(WEAPONS[i]);
    renderWeaponBar();
  }
}

/* ------------------------------------------------------------------ *
 *  Rendu
 * ------------------------------------------------------------------ */

/** Trait lumineux : trois passes additives, bien moins coûteux que shadowBlur. */
function glowLine(x1, y1, x2, y2, color, width) {
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';

  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.16;
  ctx.lineWidth = width * 4.5;
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();

  ctx.globalAlpha = 0.34;
  ctx.lineWidth = width * 2;
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();

  ctx.globalAlpha = 1;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = width;
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();

  ctx.globalCompositeOperation = 'source-over';
}

function render() {
  const { w, h } = view;

  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';

  // Fond
  ctx.fillStyle = '#05060c';
  ctx.fillRect(0, 0, w, h);

  ctx.save();

  // Tremblement d'écran
  if (game.shake > 0.2) {
    ctx.translate(rand(-game.shake, game.shake), rand(-game.shake, game.shake));
  }

  drawStars();
  drawArena();
  drawRings();
  drawParticles();

  if (game.state === STATE.PLAYING || game.state === STATE.PAUSED) {
    drawWeapon();
  }

  drawEnemies();

  if (game.hp > 0) drawCore();

  ctx.restore();

  drawHud();
  drawDangerVignette();
}

function drawStars() {
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = '#9fdcff';
  const t = game.corePulse;

  for (let i = 0; i < stars.length; i++) {
    const s = stars[i];
    // Fond au repos près du bord, s'estompe en approchant du noyau.
    const fade = clamp((s.dist - view.coreRadius) / (view.coreRadius * 2), 0, 1);
    ctx.globalAlpha = s.a * fade * (0.65 + 0.35 * Math.sin(t * 1.4 + s.phase));
    ctx.fillRect(
      view.cx + Math.cos(s.angle) * s.dist,
      view.cy + Math.sin(s.angle) * s.dist,
      s.r, s.r
    );
  }

  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

/** Anneaux concentriques discrets : repère visuel de la distance au noyau. */
function drawArena() {
  const { cx, cy } = view;
  ctx.strokeStyle = 'rgba(77,243,255,0.06)';
  ctx.lineWidth = 1;
  const step = Math.max(70, Math.min(view.w, view.h) / 5);
  for (let r = view.coreRadius + step; r < view.spawnRadius; r += step) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, TAU);
    ctx.stroke();
  }
}

function drawWeapon() {
  const w = currentWeapon();

  // L'Onde ne dessine rien en continu : ses impulsions vivent dans game.rings.
  if (w.kind !== 'beam') return;
  if (!input.active || !input.hasAngle) return;

  const { cx, cy } = view;
  const flicker = 1 + Math.sin(game.corePulse * 60) * 0.1;
  const reach = view.spawnRadius * w.range;

  for (const offset of w.beams) {
    const angle = input.angle + offset;
    const ux = Math.cos(angle);
    const uy = Math.sin(angle);

    const x1 = cx + ux * (view.coreRadius - 2);
    const y1 = cy + uy * (view.coreRadius - 2);
    glowLine(x1, y1, cx + ux * reach, cy + uy * reach, w.color, w.halfWidth * flicker);
  }

  // Éclat de bouche, une seule fois même pour l'Éventail.
  const mx = cx + Math.cos(input.angle) * (view.coreRadius - 2);
  const my = cy + Math.sin(input.angle) * (view.coreRadius - 2);
  const r = 12 * view.scale * flicker;

  ctx.globalCompositeOperation = 'lighter';
  const grad = ctx.createRadialGradient(mx, my, 0, mx, my, r);
  grad.addColorStop(0, 'rgba(255,255,255,0.9)');
  grad.addColorStop(0.4, hexToRgba(w.color, 0.5));
  grad.addColorStop(1, hexToRgba(w.color, 0));
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(mx, my, r, 0, TAU);
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
}

/** Anneaux de choc : impulsions de l'Onde, morts, paliers de combo, impacts. */
function drawRings() {
  if (!game.rings.length) return;

  ctx.globalCompositeOperation = 'lighter';
  for (const ring of game.rings) {
    const t = 1 - ring.life / ring.maxLife;
    const r = lerp(ring.r0, ring.max, t * (2 - t));   // décélère en fin de course
    const alpha = (1 - t) * 0.9;

    ctx.strokeStyle = hexToRgba(ring.color, alpha * 0.3);
    ctx.lineWidth = ring.width * 4;
    ctx.beginPath();
    ctx.arc(ring.x, ring.y, r, 0, TAU);
    ctx.stroke();

    ctx.strokeStyle = hexToRgba(ring.color, alpha);
    ctx.lineWidth = ring.width;
    ctx.beginPath();
    ctx.arc(ring.x, ring.y, r, 0, TAU);
    ctx.stroke();
  }
  ctx.globalCompositeOperation = 'source-over';
}

function drawEnemies() {
  for (const e of game.enemies) {
    const color = e.flash > 0.05 ? '#ffffff' : e.def.color;

    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.rotate(e.rot);

    ctx.beginPath();
    traceShape(e.def.shape, e.radius);
    ctx.closePath();

    ctx.fillStyle = 'rgba(6,8,18,0.72)';
    ctx.fill();

    // Halo
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.3;
    ctx.strokeStyle = color;
    ctx.lineWidth = 6;
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    ctx.strokeStyle = color;
    ctx.lineWidth = 2.2;
    ctx.stroke();

    ctx.restore();

    // Jauge de vie, seulement pour les gros qui demandent plusieurs passages.
    if (e.hpMax > 60 && e.hp < e.hpMax) {
      const frac = e.hp / e.hpMax;
      ctx.strokeStyle = e.def.color;
      ctx.globalAlpha = 0.85;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.radius + 7, -Math.PI / 2, -Math.PI / 2 + TAU * frac);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }
}

function traceShape(shape, r) {
  if (shape === 'triangle') {
    ctx.moveTo(r, 0);
    ctx.lineTo(-r * 0.7, r * 0.75);
    ctx.lineTo(-r * 0.7, -r * 0.75);
    return;
  }
  if (shape === 'diamond') {
    ctx.moveTo(r, 0);
    ctx.lineTo(0, r * 0.7);
    ctx.lineTo(-r, 0);
    ctx.lineTo(0, -r * 0.7);
    return;
  }
  // hexagone
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
}

function drawCore() {
  const { cx, cy } = view;
  const R = view.coreRadius;
  const pulse = 1 + Math.sin(game.corePulse * 2.2) * 0.03;
  const hpFrac = game.hp / CFG.core.hpMax;

  // Aura
  ctx.globalCompositeOperation = 'lighter';
  const aura = ctx.createRadialGradient(cx, cy, R * 0.4, cx, cy, R * 2.4);
  aura.addColorStop(0, 'rgba(77,243,255,0.30)');
  aura.addColorStop(1, 'rgba(77,243,255,0)');
  ctx.fillStyle = aura;
  ctx.beginPath();
  ctx.arc(cx, cy, R * 2.4, 0, TAU);
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';

  // Corps
  ctx.beginPath();
  ctx.arc(cx, cy, R * pulse, 0, TAU);
  ctx.fillStyle = '#070b18';
  ctx.fill();
  ctx.strokeStyle = game.coreFlash > 0.1 ? '#ffffff' : '#4df3ff';
  ctx.lineWidth = 2.5;
  ctx.stroke();

  // Cœur interne, qui s'assombrit avec les dégâts
  ctx.globalCompositeOperation = 'lighter';
  const inner = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 0.72);
  inner.addColorStop(0, `rgba(255,255,255,${0.35 + 0.5 * hpFrac})`);
  inner.addColorStop(1, 'rgba(77,243,255,0)');
  ctx.fillStyle = inner;
  ctx.beginPath();
  ctx.arc(cx, cy, R * 0.72, 0, TAU);
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';

  // Anneau de points de vie
  const ringR = R + 8;
  ctx.lineWidth = 4;
  ctx.strokeStyle = 'rgba(255,255,255,0.09)';
  ctx.beginPath();
  ctx.arc(cx, cy, ringR, 0, TAU);
  ctx.stroke();

  ctx.strokeStyle = hpFrac > 0.5 ? '#4df3ff' : hpFrac > 0.25 ? '#ffd23f' : '#ff3d81';
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(cx, cy, ringR, -Math.PI / 2, -Math.PI / 2 + TAU * hpFrac);
  ctx.stroke();
  ctx.lineCap = 'butt';
}

function drawParticles() {
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';

  for (const p of game.particles) {
    ctx.globalAlpha = clamp(p.life / p.maxLife, 0, 1);

    if (p.shape === 'streak') {
      // La traîne suit la vitesse : plus la particule file, plus elle s'étire.
      ctx.strokeStyle = p.color;
      ctx.lineWidth = p.size;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - p.vx * 0.022, p.y - p.vy * 0.022);
      ctx.stroke();
    } else {
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
  }

  ctx.globalAlpha = 1;
  ctx.lineCap = 'butt';
  ctx.globalCompositeOperation = 'source-over';
}

function drawHud() {
  if (game.state === STATE.MENU) return;

  const s = view.scale;
  const padX = 18 + Math.max(view.safe.left, view.safe.right);
  const padY = 16 + view.safe.top;

  ctx.textBaseline = 'top';

  // Score
  ctx.textAlign = 'left';
  ctx.fillStyle = '#ffffff';
  ctx.font = `700 ${Math.round(28 * s)}px ui-sans-serif, system-ui, sans-serif`;
  ctx.fillText(String(game.score), padX, padY);

  // Multiplicateur
  if (game.multiplier > 1) {
    ctx.fillStyle = '#ffd23f';
    ctx.font = `700 ${Math.round(15 * s)}px ui-sans-serif, system-ui, sans-serif`;
    ctx.fillText(`×${game.multiplier}`, padX, padY + Math.round(32 * s));
  }

  // Chrono, centré : le coin droit appartient au coupe-son.
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(232,246,255,0.55)';
  ctx.font = `600 ${Math.round(15 * s)}px ui-sans-serif, system-ui, sans-serif`;
  ctx.fillText(formatTime(game.time), view.w / 2, padY + 6);
}

function formatTime(t) {
  const m = Math.floor(t / 60);
  const sec = Math.floor(t % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

/** Halo rouge en bord d'écran quand le noyau est en danger. */
function drawDangerVignette() {
  if (game.state !== STATE.PLAYING) return;
  const hpFrac = game.hp / CFG.core.hpMax;
  if (hpFrac > 0.34) return;

  const intensity = (0.34 - hpFrac) / 0.34;
  const beat = 0.55 + 0.45 * Math.sin(game.corePulse * 5);
  const { w, h, cx, cy } = view;
  const grad = ctx.createRadialGradient(cx, cy, Math.min(w, h) * 0.28, cx, cy, Math.max(w, h) * 0.72);
  grad.addColorStop(0, 'rgba(255,61,129,0)');
  grad.addColorStop(1, `rgba(255,61,129,${0.42 * intensity * beat})`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
}

/* ------------------------------------------------------------------ *
 *  Barre d'armes
 * ------------------------------------------------------------------ */

/* Pictogrammes : chaque arme se reconnaît à sa silhouette, pas à son nom. */
const WEAPON_GLYPHS = {
  ray: '<path d="M11 20V4"/>',
  fan: '<path d="M11 20V7"/><path d="M4 20 8.5 8"/><path d="M18 20 13.5 8"/>',
  lance: '<path d="M11 20V9"/><path d="M11 2 7.5 9h7z" fill="currentColor" stroke="none"/>',
  wave: '<circle cx="11" cy="12" r="2.5" fill="currentColor" stroke="none"/>'
      + '<path d="M4.5 12a6.5 6.5 0 0 1 13 0"/><path d="M1.5 13.5a9.5 9.5 0 0 1 19 0"/>',
};

function weaponGlyph(id) {
  return `<svg class="glyph" width="22" height="22" viewBox="0 0 22 22" aria-hidden="true"
    fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
    ${WEAPON_GLYPHS[id]}</svg>`;
}

function renderWeaponBar() {
  weaponBar.innerHTML = WEAPONS.map((w, i) => {
    const open = game.unlocked[i];
    // Une arme verrouillée affiche son palier : elle devient un objectif.
    const label = open ? w.name : w.unlock;
    return `<button type="button" class="wpn${i === game.weapon ? ' active' : ''}"
      data-i="${i}" ${open ? '' : 'disabled'}
      style="--w:${w.color};--w-dim:${hexToRgba(w.color, 0.25)}"
      aria-label="${open ? w.name + ' — ' + w.blurb : w.name + ', se débloque à ' + w.unlock + ' points'}"
      >${weaponGlyph(w.id)}<span>${label}</span></button>`;
  }).join('');
}

weaponBar.addEventListener('click', (e) => {
  const btn = e.target.closest('.wpn');
  if (!btn || btn.disabled) return;

  const i = Number(btn.dataset.i);
  if (i === game.weapon) return;

  game.weapon = i;
  game.waveTimer = 0;   // l'Onde frappe dès qu'on la sélectionne
  renderWeaponBar();
  vibrate(12);
  audioInit();
  sfxSwitch();
});

function renderSoundButton() {
  const waves = audio.on
    ? '<path d="M11.5 7a4.5 4.5 0 0 1 0 6"/><path d="M14 4.5a8 8 0 0 1 0 11"/>'
    : '<path d="M12.5 7 17 13"/><path d="M17 7l-4.5 6"/>';
  soundBtn.classList.toggle('on', audio.on);
  soundBtn.setAttribute('aria-pressed', String(audio.on));
  soundBtn.setAttribute('aria-label', audio.on ? 'Couper le son' : 'Activer le son');
  soundBtn.innerHTML = `<svg width="19" height="19" viewBox="0 0 20 20" aria-hidden="true"
    fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"
    stroke-linejoin="round"><path d="M3 7.5h2.5L9 4.5v11L5.5 12.5H3z"
    fill="currentColor" stroke="none"/>${waves}</svg>`;
}

soundBtn.addEventListener('click', () => {
  audioInit();
  audioResume();
  setSound(!audio.on);
  if (audio.on) sfxSwitch();
});

function announceUnlock(w) {
  toast.hidden = false;
  toast.style.setProperty('--t', w.color);
  toast.innerHTML = `<span class="t-title">${w.name} débloqué</span>`
                  + `<span class="t-sub">${w.blurb}</span>`;

  // Redémarre l'animation même si un toast est déjà en cours.
  toast.classList.remove('show');
  void toast.offsetWidth;
  toast.classList.add('show');

  shockRing(w.color, view.spawnRadius * 0.55, 0.8, 3);
  burst(view.cx, view.cy, w.color, 40, 1.6);
  vibrate([15, 40, 15]);
  sfxUnlock();
}

/* ------------------------------------------------------------------ *
 *  Écrans (overlay HTML)
 * ------------------------------------------------------------------ */

function showMenu() {
  game.state = STATE.MENU;
  overlay.hidden = false;
  weaponBar.hidden = true;
  panel.className = 'panel';
  panel.innerHTML = `
    <div class="title">VIRGULE</div>
    <div class="subtitle">défends le noyau</div>
    <div class="hint">
      Garde le doigt sur l'écran : le rayon suit ta position.<br>
      <b>Balaie</b> pour découper tout ce qui approche.<br>
      Les points débloquent de <b>nouvelles armes</b> en cours de partie.
    </div>
    ${game.best > 0 ? `
      <div class="scores">
        <div class="score-block best">
          <div class="label">Record</div>
          <div class="value">${game.best}</div>
        </div>
      </div>` : ''}
    <button type="button" id="btn-primary">Jouer</button>
  `;
  document.getElementById('btn-primary').addEventListener('click', startGame);
}

function showPause() {
  overlay.hidden = false;
  weaponBar.hidden = true;
  panel.className = 'panel';
  panel.innerHTML = `
    <div class="title">PAUSE</div>
    <div class="subtitle">partie en cours</div>
    <button type="button" id="btn-primary">Reprendre</button>
  `;
  document.getElementById('btn-primary').addEventListener('click', () => {
    overlay.hidden = true;
    weaponBar.hidden = false;
    game.state = STATE.PLAYING;
  });
}

function showGameOver() {
  overlay.hidden = false;
  weaponBar.hidden = true;
  toast.hidden = true;
  panel.className = 'panel gameover';
  panel.innerHTML = `
    <div class="title" style="font-size:clamp(26px,8vw,48px)">NOYAU PERDU</div>
    <div class="subtitle">${game.newBest ? 'nouveau record' : 'fin de partie'}</div>
    <div class="scores">
      <div class="score-block">
        <div class="label">Score</div>
        <div class="value ${game.newBest ? 'new-best' : ''}">${game.score}</div>
      </div>
      <div class="score-block best">
        <div class="label">Record</div>
        <div class="value">${game.best}</div>
      </div>
    </div>
    <div class="stats">
      ${game.kills} ennemis détruits · ${formatTime(game.time)} de survie<br>
      ${game.unlocked.filter(Boolean).length} / ${WEAPONS.length} armes débloquées
    </div>
    <button type="button" id="btn-primary">Rejouer</button>
  `;
  document.getElementById('btn-primary').addEventListener('click', startGame);
}

function startGame() {
  resetGame();
  overlay.hidden = true;
  toast.hidden = true;
  toast.classList.remove('show');
  weaponBar.hidden = false;
  renderWeaponBar();
  game.state = STATE.PLAYING;
  input.hasAngle = false;
  input.active = false;
  input.pointerId = null;
}

/* ------------------------------------------------------------------ *
 *  Boucle principale
 * ------------------------------------------------------------------ */

let lastTime = 0;

function frame(now) {
  // Premier appel, ou retour d'arrière-plan : on borne le pas de temps
  // pour éviter qu'un ennemi traverse l'écran d'un coup.
  const dt = lastTime ? Math.min((now - lastTime) / 1000, 0.05) : 0;
  lastTime = now;

  update(dt);
  render();

  requestAnimationFrame(frame);
}

window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 120));

resize();
renderSoundButton();
showMenu();
requestAnimationFrame(frame);

/* Poignée de débogage : permet d'inspecter l'état depuis la console. */
window.VIRGULE = { game, view, input, audio, CFG, ENEMY_TYPES, WEAPONS };
