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
    radiusFactor: 0.046,   // fraction de la plus petite dimension de l'écran
    radiusMin: 20,
    radiusMax: 38,
  },
  aim: {
    deadzone: 14,          // px avant que le manche virtuel prenne la main
    stickRadius: 30,       // rayon dessiné du manche
    threatRange: 0.62,     // les menaces s'affichent en deçà de cette fraction
  },
  combo: {
    killsPerStep: 8,       // kills nécessaires pour +1 au multiplicateur
    max: 10,
    window: 5,             // secondes sans kill avant que la série retombe
  },
  spawn: {
    hpRampTime: 260,       // les ennemis gagnent +100% de points de vie sur cette durée
  },
  /*
   * Densité. C'est elle, et elle seule, qui porte la montée en difficulté :
   * les ennemis ne vont jamais plus vite, ils arrivent seulement de plus en
   * plus serrés. Chaque palier raccourcit l'intervalle d'un facteur fixe, ce
   * qui donne une progression géométrique — lisible comme un niveau.
   */
  density: {
    levelTime: 10,         // secondes par palier
    baseInterval: 1.25,    // secondes entre deux apparitions au niveau 1
    perLevel: 0.88,        // l'intervalle est multiplié par ça à chaque palier
    // Aucun plancher : la densité monte indéfiniment. Deux garde-fous
    // naturels suffisent — une seule apparition par image (donc 60 par
    // seconde au maximum) et un plafond d'ennemis vivants.
    maxAlive: 260,
  },
  /*
   * Dézoom. Tous les dix paliers, la caméra recule d'un cran : les ennemis
   * paraissent plus petits mais on les voit venir de bien plus loin, ce qui
   * rend la densité croissante tenable. Le recul s'arrête à `min` — au-delà
   * les ennemis deviendraient trop petits pour être lus.
   */
  zoom: {
    everyLevels: 10,
    step: 0.84,
    min: 0.6,
    ease: 1.1,             // vitesse du recul, en fraction par seconde
  },
  particlesMax: 900,
  ringsMax: 40,
};

/*
 * Armes. Elles se cumulent : une fois débloquée, une arme tire en même temps
 * que toutes les précédentes. Les paliers sont donc des montées en puissance,
 * pas des choix — d'où des dégâts unitaires plus modestes qu'à l'unité.
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
    kind: 'beam', beams: [-0.36, 0.36], dps: 42, range: 0.52, pierce: true,
    halfWidth: 4, slack: 5, slackPerPx: 0.03,
    blurb: 'Deux rayons de flanc. Élargit la coupe, ne porte pas loin.',
  },
  {
    id: 'lance', name: 'Lance', unlock: 950, color: '#ff3d81',
    kind: 'beam', beams: [0], dps: 235, range: 1, pierce: false,
    halfWidth: 3, slack: 1, slackPerPx: 0.007,
    blurb: 'Concentre le tir sur la cible la plus proche. Perce les blindés.',
  },
  {
    id: 'orbit', name: 'Orbiteurs', unlock: 2100, color: '#c9a3ff',
    kind: 'orbit', count: 3, dps: 62, range: 0.4, spin: 0.85, orbit: 3.2,
    blurb: 'Trois satellites qui tirent tout seuls, même doigt levé.',
  },
  {
    // Un décalage de PI : le moteur de rayons suffit, l'arme tire à l'opposé.
    id: 'rear', name: 'Revers', unlock: 4200, color: '#6d8bff',
    kind: 'beam', beams: [Math.PI], dps: 95, range: 0.8, pierce: true,
    halfWidth: 4, slack: 6, slackPerPx: 0.028,
    blurb: 'Un rayon dans le dos. Couvre ce que tu ne regardes pas.',
  },
  {
    id: 'chain', name: 'Foudre', unlock: 7000, color: '#e8ff5a',
    kind: 'chain', interval: 0.55, damage: 46, range: 0.34, hops: 4, hopRange: 150,
    blurb: 'Un arc qui saute d\'un ennemi à l\'autre, tout seul.',
  },
  {
    // Orbite large, exprimée en fraction du rayon d'apparition : les mines
    // interceptent loin du noyau, quelle que soit la taille de l'écran.
    id: 'mines', name: 'Mines', unlock: 11000, color: '#ff9505',
    kind: 'mine', count: 5, orbitFactor: 0.36, spin: -0.28,
    radius: 9, damage: 135, blast: 84, respawn: 3.4,
    blurb: 'Cinq mines en orbite lointaine. Elles sautent au contact.',
  },
];

/*
 * Bonus lâchés par les ennemis. On les ramasse en passant un rayon dessus.
 *
 *  - `duration` > 0 : effet temporaire, décompté en haut à gauche
 *  - `duration` 0   : effet immédiat
 *  - `permanent`    : améliore la partie jusqu'à sa fin, et se cumule
 *
 * `weight` pondère le tirage : les améliorations permanentes sont rares.
 */
const BONUSES = {
  beams: {
    name: 'Faisceaux', color: '#7cf7ff', duration: 12, weight: 10,
    blurb: 'Deux rayons de plus sur chaque arme',
  },
  power: {
    name: 'Surcharge', color: '#ff9f1c', duration: 10, weight: 10,
    blurb: 'Dégâts doublés',
  },
  slow: {
    name: 'Ralenti', color: '#9fd8ff', duration: 8, weight: 9,
    blurb: 'Ennemis au ralenti',
  },
  arsenal: {
    name: 'Arsenal', color: '#ffffff', duration: 10, weight: 7,
    blurb: 'Toutes les armes, même verrouillées',
  },
  repair: {
    name: 'Réparation', color: '#5dffa0', duration: 0, weight: 9,
    blurb: 'Noyau réparé',
  },

  /* Améliorations définitives : elles tiennent jusqu'à la fin de la partie. */
  hpUp: {
    name: 'Blindage', color: '#5dffa0', duration: 0, weight: 4,
    permanent: true, short: 'BLINDAGE',
    blurb: '+30 PV maximum, définitif',
  },
  dpsUp: {
    name: 'Amplificateur', color: '#ff5ec4', duration: 0, weight: 5,
    permanent: true, short: 'AMPLI',
    blurb: '+18 % de dégâts, définitif et cumulable',
  },
  orbitUp: {
    name: 'Satellite', color: '#c9a3ff', duration: 0, weight: 4,
    permanent: true, short: 'SATELLITE', max: 3,
    blurb: 'Un orbiteur de plus, définitif',
  },
  magnet: {
    name: 'Aimant', color: '#7cf7ff', duration: 0, weight: 3,
    permanent: true, short: 'AIMANT', max: 1,
    blurb: 'Les bonus viennent à toi, définitif',
  },
};

const BONUS_IDS = Object.keys(BONUSES);
const BONUS_WEIGHT = BONUS_IDS.reduce((sum, id) => sum + BONUSES[id].weight, 0);

/*
 * Paliers de série. Ils donnent son nom et sa couleur au moment, et cette
 * couleur irrigue tout le reste : fond, halos, débris, noyau.
 */
const COMBO_TIERS = [
  { at: 1,  name: '',           color: '#4df3ff' },
  { at: 2,  name: 'CHAÎNE',     color: '#5dffa0' },
  { at: 4,  name: 'SÉRIE',      color: '#ffd23f' },
  { at: 6,  name: 'FURIE',      color: '#ff9f1c' },
  { at: 8,  name: 'DÉCHAÎNÉ',   color: '#ff3d81' },
  // Blanc chaud plutôt que blanc pur : un blanc neutre vide le fond de sa
  // couleur et le rend gris au lieu de le rendre incandescent.
  { at: 10, name: 'SURCHAUFFE', color: '#ffd6ec' },
];

function comboTier(mult) {
  let tier = COMBO_TIERS[0];
  for (const t of COMBO_TIERS) if (mult >= t.at) tier = t;
  return tier;
}

const DROP = {
  chance: 0.06,        // probabilité de lâcher un bonus, par ennemi tué
  tankChance: 0.18,    // les gros sont plus généreux
  life: 9,             // secondes avant disparition
  radius: 13,
  grabSlack: 12,       // marge de ramassage au-delà du rayon du bonus
  repairAmount: 35,
  hpUpAmount: 30,
  dpsUpStep: 0.18,
  magnetPull: 520,     // accélération vers le noyau une fois l'Aimant pris
};

/* À partir de ce palier, chaque mort détone : les séries hautes se mettent
   à réagir en chaîne, et l'écran part en morceaux. */
const DETONATE = { fromTier: 6, damage: 26, radius: 58 };

/*
 * Chiffres de dégâts flottants.
 *
 * Un rayon frappe à chaque image : afficher les 1,8 points d'une image serait
 * illisible. On cumule donc par ennemi et on relâche le total toutes les
 * `tick` secondes, ou aussitôt s'il meurt. Le montant affiché est brut, jamais
 * plafonné aux PV restants : un coup de 400 sur un ennemi qui en a 12 affiche
 * bien 400.
 */
const DAMAGE_TEXT = {
  tick: 0.2,           // regroupement des dégâts continus
  max: 40,             // au-delà, l'écran devient illisible
  life: 0.85,
  rise: 46,            // px parcourus vers le haut sur toute la durée
};

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

  /* Le Rôdeur ne fonce pas : il s'enroule vers le noyau, ce qui le fait
     glisser hors d'un rayon tenu droit. */
  prowler: {
    hp: 44, speed: 62, radius: 12, damage: 12, score: 25,
    color: '#17c3b2', shape: 'pentagon', orient: 'aim', unlock: 50, weight: 6,
    move: 'spiral', swirl: 0.75,
  },

  /* L'Essaim se scinde en trois à sa mort : le tuer trop près du noyau se
     paie comptant. */
  swarm: {
    hp: 60, speed: 40, radius: 16, damage: 14, score: 30,
    color: '#e5484d', shape: 'square', orient: 'spin', unlock: 68, weight: 5,
    splitInto: 'mote', splitCount: 3,
  },
  mote: {
    hp: 12, speed: 96, radius: 7, damage: 5, score: 8,
    color: '#e5484d', shape: 'triangle', orient: 'aim',
    unlock: Infinity, weight: 0,   // jamais tiré au sort, seulement issu d'un Essaim
  },

  /* La Sentinelle s'arrête à distance et bombarde. Ses projectiles sont
     lents et destructibles : on peut les abattre au rayon. */
  sentinel: {
    hp: 70, speed: 46, radius: 14, damage: 10, score: 35,
    color: '#8ecae6', shape: 'chevron', orient: 'aim', unlock: 88, weight: 4,
    move: 'stopper', standRange: 0.36, fireInterval: 2.4,
    shotDamage: 8, shotSpeed: 132, shotRadius: 5,
  },
};

/*
 * Deux dispositions. Tout le reste du jeu — armes, bonus, séries, ennemis —
 * est écrit en coordonnées polaires autour du noyau, si bien qu'il suffit de
 * déplacer ce noyau et de restreindre l'arc pour obtenir un second mode.
 *
 *  - halfArc : le jeu se joue sur l'hémisphère supérieur seulement
 *  - spread  : demi-ouverture du cône d'apparition, en radians
 *  - rate    : multiplicateur de cadence, pour compenser l'arc plus étroit
 */
const MODES = {
  orbite: {
    name: 'Orbite', halfArc: false, spread: Math.PI, rate: 1,
    hpMul: 1, speedMul: 1,
    hint: 'Le noyau au centre, les ennemis de toutes parts.',
  },
  rempart: {
    /*
     * L'arc est deux fois plus étroit, donc un seul balayage couvre en
     * permanence tout le cône de menace. Mesuré : les ennemis mouraient à
     * 300 px et le noyau n'était jamais touché en deux minutes. Doubler la
     * cadence n'y changeait rien — le facteur limitant n'est pas le nombre
     * mais la survie de chacun face à un rayon qui ne les quitte jamais.
     * D'où des ennemis nettement plus coriaces et plus rapides.
     */
    name: 'Rempart', halfArc: true, spread: 1.3, rate: 0.62,
    hpMul: 1.5, speedMul: 1.28,
    hint: 'Le noyau posé en bas, les ennemis descendent du haut.',
  },
};

const MODE_KEY = 'virgule.mode';

function loadMode() {
  try { return localStorage.getItem(MODE_KEY) === 'rempart' ? 'rempart' : 'orbite'; }
  catch (_) { return 'orbite'; }
}

let gameMode = loadMode();

function setGameMode(m) {
  gameMode = m;
  try { localStorage.setItem(MODE_KEY, m); } catch (_) { /* tant pis */ }
  resize();
}

function mode() {
  return MODES[gameMode];
}

/**
 * Distance d'apparition dans une direction donnée.
 *
 * En Orbite on garde un cercle : tous les ennemis parcourent la même course,
 * et l'équilibrage repose dessus. En Rempart, le noyau est en bas, donc ce
 * cercle mesurerait 653 px là où l'écran n'en fait que 664 de haut — les
 * ennemis passaient 50 % de temps en plus à voyager et mouraient bien avant
 * d'être une menace. On les fait donc naître juste au-delà du bord visible,
 * dans leur direction propre.
 */
function spawnDistance(ux, uy) {
  if (!mode().halfArc) return view.spawnRadius;

  const tx = ux > 0 ? (view.w - view.cx) / ux : (ux < 0 ? -view.cx / ux : Infinity);
  const ty = uy > 0 ? (view.h - view.cy) / uy : (uy < 0 ? -view.cy / uy : Infinity);
  return Math.min(tx, ty) + 70;
}

/**
 * Position angulaire d'un emplacement en orbite (satellite ou mine).
 * En Rempart, les emplacements se répartissent sur l'arc supérieur et se
 * balancent doucement, plutôt que de plonger sous le socle.
 */
function slotAngle(i, count, phase) {
  if (!mode().halfArc) return phase + (i / count) * TAU;
  return -Math.PI + ((i + 0.5) / count) * Math.PI + Math.sin(phase) * 0.22;
}

/** En Rempart, le canon ne descend jamais sous l'horizontale. */
function clampAim(a) {
  if (!mode().halfArc) return a;
  if (a <= 0) return a;                        // déjà dans l'hémisphère haut
  return a <= Math.PI / 2 ? -0.04 : -Math.PI + 0.04;
}

/**
 * Angle réel d'un rayon, décalage compris.
 *
 * En Rempart, un rayon qui plongerait sous l'horizon est rabattu au-dessus
 * en miroir. C'est ce qui sauve le Revers : au lieu de tirer dans le socle,
 * il couvre le flanc opposé à celui que l'on vise.
 */
function beamAngleFor(offset) {
  const a = input.angle + offset;
  if (!mode().halfArc) return a;
  const n = Math.atan2(Math.sin(a), Math.cos(a));   // ramené dans (-PI, PI]
  return n > 0 ? -n : n;
}

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
  spawnRadius: 0,       // distance d'apparition, en unités du monde
  baseRadius: 0,        // rayon visible en pixels d'écran, indépendant du recul
  viewRadius: 0,        // idem, pour le décor peint hors du recul
  zoom: 1,              // recul de caméra : 1 = vue rapprochée
  coreRadius: 0,
  scale: 1,             // facteur d'échelle de l'UI selon la taille d'écran
  safe: { top: 0, right: 0, bottom: 0, left: 0 },
};

/*
 * Résolution adaptative. Le jeu est limité par le remplissage de pixels, pas
 * par le calcul : un profil du pire cas passe 89 % du temps en rastérisation.
 * Plutôt que de rogner les effets pour tout le monde, on baisse discrètement
 * la résolution de rendu quand la cadence flanche, et on la remonte dès
 * qu'elle revient. Le canvas garde sa taille CSS : c'est l'affichage qui
 * ré-étire.
 */
/*
 * Deux fausses pistes avant d'arriver ici, et elles méritent d'être notées.
 *
 * Chronométrer update+render ne sert à rien : les appels de dessin partent en
 * file d'attente et sont payés par le compositeur, si bien que le pire cas ne
 * mesure que 2 ms côté JavaScript.
 *
 * Comparer la durée d'image à un seuil ne sert pas davantage : avec la synchro
 * verticale elle vaut 16,7 ms dès qu'on tient les 60 fps, marge confortable ou
 * pas. La résolution descendait au moindre à-coup et ne remontait jamais.
 *
 * Ce qui marche : compter la proportion d'images longues sur une fenêtre. Une
 * cadence saine n'en produit presque aucune, une cadence en souffrance en
 * produit beaucoup — et le signal reste lisible dans les deux sens.
 */
const perf = {
  quality: 1,     // multiplicateur de résolution, 0.6 à 1
  long: 0,        // images dépassant le budget sur la fenêtre en cours
  frames: 0,
  timer: 0,
  clean: 0,       // fenêtres consécutives sans souci
};

const PERF_WINDOW = 2;      // secondes par fenêtre d'observation
const PERF_LONG = 0.021;    // au-delà, l'image a manqué son rendez-vous

function updatePerf(dt) {
  perf.frames++;
  if (dt >= PERF_LONG) perf.long++;
  perf.timer += dt;
  if (perf.timer < PERF_WINDOW) return;

  const ratio = perf.long / Math.max(1, perf.frames);
  perf.timer = 0;
  perf.long = 0;
  perf.frames = 0;

  if (ratio > 0.2 && perf.quality > 0.6) {
    perf.quality = Math.max(0.6, perf.quality - 0.2);
    perf.clean = 0;
    resize();
  } else if (ratio < 0.03) {
    perf.clean++;
    // On ne remonte qu'après trois fenêtres propres d'affilée, pour ne pas
    // faire l'ascenseur entre deux vagues.
    if (perf.clean >= 3 && perf.quality < 1) {
      perf.quality = Math.min(1, perf.quality + 0.2);
      perf.clean = 0;
      resize();
    }
  } else {
    perf.clean = 0;
  }
}

function resize() {
  const dpr = clamp(window.devicePixelRatio || 1, 1, 2) * perf.quality;
  const w = window.innerWidth;
  const h = window.innerHeight;

  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  view.w = w;
  view.h = h;
  view.cx = w / 2;

  const cs0 = getComputedStyle(safeProbe);
  const safeBottom = parseFloat(cs0.paddingBottom) || 0;

  if (mode().halfArc) {
    // Posé en bas, juste au-dessus de la barre d'armes.
    view.cy = h - (safeBottom + 104);
    // Le point visible le plus éloigné est un coin haut.
    view.baseRadius = Math.hypot(w / 2, view.cy) + 60;
  } else {
    view.cy = h / 2;
    // Le coin le plus éloigné du centre, plus une marge.
    view.baseRadius = Math.hypot(w, h) / 2 + 60;
  }
  view.viewRadius = view.baseRadius;
  applyZoom();

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
  buildBgLayer();
  if (!nebula.length) buildNebula();
}

/* ------------------------------------------------------------------ *
 *  Halos
 *
 *  Un dégradé radial coûte cher à reconstruire à chaque image. On en cuit
 *  un par couleur dans un canvas hors écran, une fois pour toutes, puis on
 *  se contente de le redimensionner : c'est ce qui rend les halos gratuits.
 * ------------------------------------------------------------------ */

const spriteCache = new Map();

function blobSprite(color) {
  let sprite = spriteCache.get(color);
  if (sprite) return sprite;

  const size = 128;
  sprite = document.createElement('canvas');
  sprite.width = sprite.height = size;

  const g = sprite.getContext('2d');
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, hexToRgba(color, 1));
  grad.addColorStop(0.28, hexToRgba(color, 0.42));
  grad.addColorStop(0.6, hexToRgba(color, 0.1));
  grad.addColorStop(1, hexToRgba(color, 0));
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);

  spriteCache.set(color, sprite);
  return sprite;
}

/** À n'appeler qu'en composition additive. */
function drawBlobOn(g, x, y, r, color, alpha) {
  if (alpha <= 0.004 || r <= 0) return;
  g.globalAlpha = alpha;
  g.drawImage(blobSprite(color), x - r, y - r, r * 2, r * 2);
}

function drawBlob(x, y, r, color, alpha) {
  drawBlobOn(ctx, x, y, r, color, alpha);
}

/** Halo ponctuel qui enfle et s'éteint : mort, impact, ramassage. */
function addFlash(x, y, r, color, life) {
  if (game.flashes.length >= 26) return;
  game.flashes.push({ x, y, r, color, life, maxLife: life });
}

function updateFlashes(dt) {
  for (let i = game.flashes.length - 1; i >= 0; i--) {
    game.flashes[i].life -= dt;
    if (game.flashes[i].life <= 0) game.flashes.splice(i, 1);
  }
}

function drawFlashes() {
  if (!game.flashes.length) return;
  ctx.globalCompositeOperation = 'lighter';
  for (const f of game.flashes) {
    const t = 1 - f.life / f.maxLife;
    drawBlob(f.x, f.y, f.r * (0.6 + t * 0.9), f.color, (1 - t) * 0.85);
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
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
  // La poussière est aspirée plus vite quand la série monte.
  const rush = 1 + game.intensity * 2.2;
  for (let i = 0; i < stars.length; i++) {
    const s = stars[i];
    s.dist -= s.speed * rush * dt;
    if (s.dist <= view.coreRadius) stars[i] = newStar(0);
  }
}

/*
 * Nébuleuses : quelques taches molles en orbite lente. Elles portent la
 * couleur du palier de série en cours, et se dévoilent à mesure qu'il monte.
 */
let nebula = [];

function buildNebula() {
  nebula = [];
  for (let i = 0; i < 4; i++) {
    nebula.push({
      angle: (i / 4) * TAU + rand(-0.4, 0.4),
      dist: rand(0.25, 0.62),      // fraction du rayon d'apparition
      drift: rand(0.035, 0.1) * (i % 2 ? 1 : -1),
      size: rand(0.42, 0.78),
      phase: Math.random() * TAU,
    });
  }
}

/*
 * Le fond couvre tout l'écran plusieurs fois par image : au plein format il
 * sature le taux de remplissage d'un mobile. Comme il est entièrement flou,
 * on le peint dans un calque au tiers de la résolution qu'on ré-étire —
 * neuf fois moins de pixels, aucune différence visible.
 */
const BG_SCALE = 0.34;
let bgLayer = null;
let bgCtx = null;

function buildBgLayer() {
  bgLayer = document.createElement('canvas');
  bgLayer.width = Math.max(1, Math.round(view.w * BG_SCALE));
  bgLayer.height = Math.max(1, Math.round(view.h * BG_SCALE));
  bgCtx = bgLayer.getContext('2d');
}

function drawBackground(dt) {
  const { w, h, cx, cy } = view;
  const heat = game.intensity;

  const g = bgCtx;
  const k = BG_SCALE;

  // Le noir de fond est peint dans le calque, pas sur le canvas principal :
  // une passe plein écran de moins par image.
  g.globalCompositeOperation = 'source-over';
  g.fillStyle = '#05060c';
  g.fillRect(0, 0, bgLayer.width, bgLayer.height);
  g.globalCompositeOperation = 'lighter';

  // Teinte de fond : bleu profond au repos, virant lentement au violet à
  // mesure que la partie dure — deux parties longues ne se ressemblent pas.
  const base = game.time < 100 ? '#0e2a6b' : '#3a1b6e';
  drawBlobOn(g, cx * k, cy * k, view.viewRadius * 1.1 * k, base, 0.1 + heat * 0.06);

  for (const n of nebula) {
    n.angle += n.drift * dt * (1 + heat * 1.6);
    const r = view.viewRadius * n.dist;
    const x = (cx + Math.cos(n.angle) * r) * k;
    const y = (cy + Math.sin(n.angle) * r) * k;
    const breathe = 1 + Math.sin(game.corePulse * 0.6 + n.phase) * 0.12;
    const size = view.viewRadius * n.size * breathe * k;
    const alpha = 0.05 + heat * 0.17;

    // Fondu enchaîné entre l'ancien palier et le nouveau.
    drawBlobOn(g, x, y, size, game.tierFrom, alpha * (1 - game.tierBlend));
    drawBlobOn(g, x, y, size, game.tierTo, alpha * game.tierBlend);
  }
  g.globalAlpha = 1;

  ctx.globalCompositeOperation = 'source-over';
  ctx.drawImage(bgLayer, 0, 0, w, h);

  drawGrid(heat);
}

/** Grille polaire : anneaux fixes et rayons qui tournent avec l'intensité. */
function drawGrid(heat) {
  const { cx, cy } = view;
  const color = game.tierTo;

  ctx.strokeStyle = hexToRgba(color, 0.05 + heat * 0.07);
  ctx.lineWidth = 1;
  const step = Math.max(70, Math.min(view.w, view.h) / 5);
  const breathe = 1 + Math.sin(game.corePulse * 1.6) * 0.012 * (0.3 + heat);
  for (let r = view.coreRadius + step; r < view.viewRadius; r += step) {
    ctx.beginPath();
    ctx.arc(cx, cy, r * breathe, 0, TAU);
    ctx.stroke();
  }

  if (heat < 0.02) return;

  ctx.strokeStyle = hexToRgba(color, heat * 0.09);
  const spokes = 12;
  const spin = game.corePulse * (0.06 + heat * 0.28);
  for (let i = 0; i < spokes; i++) {
    const a = spin + (i / spokes) * TAU;
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    ctx.beginPath();
    ctx.moveTo(cx + ux * view.coreRadius * 1.6, cy + uy * view.coreRadius * 1.6);
    ctx.lineTo(cx + ux * view.viewRadius, cy + uy * view.viewRadius);
    ctx.stroke();
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
  combo: 0,             // kills enchaînés
  comboTimer: 0,        // temps restant pour prolonger la série
  multiplier: 1,
  level: 1,             // palier de densité courant
  levelFlash: 0,        // éclat de l'indicateur au changement de palier
  intensity: 0,         // 0..1, lissé : pilote le fond et les halos
  tierFrom: '#4df3ff',  // fondu enchaîné entre paliers de série
  tierTo: '#4df3ff',
  tierBlend: 1,
  hp: CFG.core.hpMax,
  hpMax: CFG.core.hpMax,   // le Blindage le fait monter en cours de partie
  perks: {},               // améliorations définitives -> nombre de prises
  unlocked: [true],     // un booléen par arme ; les armes se cumulent
  buffs: {},            // id de bonus -> secondes restantes
  orbitAngle: 0,        // phase de rotation des satellites
  mineAngle: 0,         // phase de rotation des mines
  mines: [],            // une entrée par emplacement : { cooldown }
  shots: [],            // projectiles des Sentinelles
  orbitShots: [],       // tirs des satellites, recalculés à chaque image
  chainTimer: 0,        // compte à rebours du prochain arc de foudre
  chainArcs: [],        // arcs en cours d'affichage
  delayed: [],          // explosions secondaires programmées
  screenFlash: 0,       // éclair plein écran, 0..1
  screenFlashColor: '#ffffff',
  enemies: [],
  pickups: [],
  particles: [],
  damageText: [],       // chiffres de dégâts flottants
  flashes: [],          // halos ponctuels
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
  game.comboTimer = 0;
  game.multiplier = 1;
  game.level = 1;
  game.levelFlash = 0;
  view.zoom = 1;
  applyZoom();
  game.intensity = 0;
  game.tierFrom = game.tierTo = COMBO_TIERS[0].color;
  game.tierBlend = 1;
  game.hp = CFG.core.hpMax;
  game.hpMax = CFG.core.hpMax;
  game.perks = {};
  game.unlocked = WEAPONS.map((w) => w.unlock === 0);
  game.buffs = {};
  game.orbitAngle = 0;
  game.orbitShots.length = 0;
  game.mineAngle = 0;
  game.mines.length = 0;
  game.shots.length = 0;
  game.chainTimer = 0;
  game.chainArcs.length = 0;
  game.delayed.length = 0;
  game.screenFlash = 0;
  game.enemies.length = 0;
  game.pickups.length = 0;
  game.particles.length = 0;
  game.damageText.length = 0;
  game.flashes.length = 0;
  game.rings.length = 0;
  buildNebula();
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

/*
 * Deux façons de viser.
 *
 *  - 'direct' : l'angle va du noyau au doigt. Immédiat, mais le doigt se
 *    place forcément dans la direction visée : il masque ce qu'on regarde.
 *  - 'pouce'  : le doigt pose un manche virtuel là où il touche, et l'angle
 *    va de ce point d'ancrage au doigt. On peut donc jouer pouce calé en bas
 *    de l'écran tout en tirant vers le haut : plus rien ne masque l'action.
 */
const AIM_KEY = 'virgule.aim';

function loadAim() {
  try { return localStorage.getItem(AIM_KEY) === 'direct' ? 'direct' : 'pouce'; }
  catch (_) { return 'pouce'; }
}

let aimMode = loadAim();

function setAimMode(mode) {
  aimMode = mode;
  try { localStorage.setItem(AIM_KEY, mode); } catch (_) { /* tant pis */ }
}

/* Un seul doigt compte : le premier posé. Les suivants sont ignorés
   tant qu'il n'a pas été relevé. */
const input = {
  active: false,
  pointerId: null,
  angle: 0,        // direction visée, en radians
  hasAngle: false, // le canon garde sa dernière orientation même doigt levé
  ox: 0, oy: 0,    // ancrage du manche virtuel
  fx: 0, fy: 0,    // position courante du doigt
};

function updateAngleFrom(e) {
  input.fx = e.clientX;
  input.fy = e.clientY;

  const ax = aimMode === 'pouce' ? input.ox : view.cx;
  const ay = aimMode === 'pouce' ? input.oy : view.cy;
  const dx = e.clientX - ax;
  const dy = e.clientY - ay;

  // Sous le seuil, on garde l'angle précédent : ni saut ni tremblement.
  const min = aimMode === 'pouce' ? CFG.aim.deadzone : 1;
  if (dx * dx + dy * dy < min * min) return;

  input.angle = clampAim(Math.atan2(dy, dx));
  input.hasAngle = true;
}

canvas.addEventListener('pointerdown', (e) => {
  if (input.pointerId !== null) return;
  input.pointerId = e.pointerId;
  input.active = true;
  // Le manche s'ancre là où le doigt se pose, à chaque nouvel appui.
  input.ox = e.clientX;
  input.oy = e.clientY;
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
  lastBoom: -1,
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
  rear:  { freq: 146, detune: 10, type: 'sawtooth', cutoff: 1100, gain: 0.09 },
};

function humStart() {
  if (!audioReady() || audio.hum) return;
  const spec = HUM[leadWeapon().id];       // l'arme de plus haut palier donne le ton
  if (!spec) return;

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
  const big = enemy.def.hp > 60;
  noiseBurst(big ? 0.34 : 0.16, {
    type: 'lowpass', freq: big ? 1500 : 2400, freqTo: big ? 120 : 320,
    gain: big ? 0.3 : 0.16,
  });
  tone(big ? 150 : 420, big ? 0.26 : 0.1, {
    to: big ? 44 : 150, type: 'triangle', gain: big ? 0.22 : 0.1,
  });
}

function sfxCoreHit(damage) {
  noiseBurst(0.4, { type: 'lowpass', freq: 900, freqTo: 70, gain: 0.36 });
  tone(110, 0.3, { to: 38, type: 'sine', gain: 0.34 });
  if (damage >= 20) tone(70, 0.45, { to: 30, type: 'sine', gain: 0.3 });
}

/** Mine : une déflagration franche, plus sèche qu'une mort d'ennemi. */
function sfxMine() {
  noiseBurst(0.45, { type: 'lowpass', freq: 2200, freqTo: 70, gain: 0.34 });
  tone(150, 0.36, { to: 34, type: 'triangle', gain: 0.3 });
  tone(70, 0.5, { to: 28, type: 'sine', gain: 0.24, delay: 0.02 });
}

/** Tir de Sentinelle : un souffle court et sourd, volontairement discret. */
function sfxShot() {
  tone(300, 0.16, { to: 180, type: 'square', gain: 0.07 });
  noiseBurst(0.12, { type: 'bandpass', freq: 900, gain: 0.07, q: 2 });
}

function sfxPickup() {
  [660, 880, 1320].forEach((f, i) => {
    tone(f, 0.14, { type: 'triangle', gain: 0.16, delay: i * 0.055 });
  });
}

function sfxBuffEnd() {
  tone(420, 0.18, { to: 210, type: 'sine', gain: 0.09 });
}

/** Palier de densité franchi : deux notes montantes, discrètes. */
function sfxDensity() {
  tone(392, 0.14, { type: 'triangle', gain: 0.1 });
  tone(587, 0.2, { type: 'triangle', gain: 0.09, delay: 0.08 });
}

function sfxComboBreak() {
  tone(300, 0.26, { to: 110, type: 'triangle', gain: 0.11 });
}

/** Foudre : un crépitement d'autant plus aigu qu'il y a de rebonds. */
function sfxChain(hops) {
  noiseBurst(0.12, { type: 'highpass', freq: 1800, freqTo: 5200, gain: 0.13, q: 0.7 });
  tone(700 + hops * 130, 0.1, { to: 1500 + hops * 200, type: 'square', gain: 0.07 });
}

/** Détonation de zone, bridée : à ×10 il y en a des dizaines par seconde. */
function sfxBoom() {
  if (game.corePulse - audio.lastBoom < 0.07) return;
  audio.lastBoom = game.corePulse;
  noiseBurst(0.26, { type: 'lowpass', freq: 1100, freqTo: 90, gain: 0.2 });
  tone(96, 0.24, { to: 40, type: 'sine', gain: 0.22 });
}

/** Réplique d'une grosse explosion : plus mat, plus lointain. */
function sfxAftershock() {
  noiseBurst(0.2, { type: 'lowpass', freq: 700, freqTo: 70, gain: 0.14 });
}

/** Acquisition définitive : un accord, pas un bip. */
function sfxPerk() {
  [523, 659, 784, 1047].forEach((f, i) => {
    tone(f, 0.5, { type: 'triangle', gain: 0.13, delay: i * 0.045 });
  });
  noiseBurst(0.3, { type: 'highpass', freq: 2400, freqTo: 6000, gain: 0.08 });
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

/** Palier de densité courant, à partir de 1. */
function densityLevel() {
  return 1 + Math.floor(game.time / CFG.density.levelTime);
}

/** Avancement dans le palier courant, de 0 à 1. */
function densityProgress() {
  return (game.time % CFG.density.levelTime) / CFG.density.levelTime;
}

/** Secondes entre deux apparitions au palier donné. Sans plancher. */
function densityInterval(level) {
  const d = CFG.density;
  return d.baseInterval * Math.pow(d.perLevel, level - 1) * mode().rate;
}

/** Recul de caméra visé au palier donné. */
function zoomFor(level) {
  const z = CFG.zoom;
  const steps = Math.floor((level - 1) / z.everyLevels);
  return Math.max(z.min, Math.pow(z.step, steps));
}

/**
 * Recalcule la géométrie qui dépend du recul. `baseRadius` est le rayon
 * visible en pixels d'écran ; le diviser par le zoom donne la distance
 * correspondante dans le monde, donc l'endroit où faire naître les ennemis.
 */
function applyZoom() {
  view.spawnRadius = view.baseRadius / view.zoom;
}

function updateZoom(dt) {
  const target = zoomFor(game.level);
  if (Math.abs(view.zoom - target) < 0.001) {
    if (view.zoom !== target) { view.zoom = target; applyZoom(); }
    return;
  }
  view.zoom += (target - view.zoom) * Math.min(1, dt * CFG.zoom.ease);
  applyZoom();
}

/** Combien de fois plus d'ennemis qu'au niveau 1 : le coefficient affiché. */
function densityFactor(level) {
  return densityInterval(1) / densityInterval(level);
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

/** Un Essaim abattu se disperse en éclats vivants autour de sa position. */
function splitEnemy(parent) {
  const def = ENEMY_TYPES[parent.def.splitInto];
  const hpScale = (1 + game.time / CFG.spawn.hpRampTime) * mode().hpMul;

  for (let i = 0; i < parent.def.splitCount; i++) {
    const a = (i / parent.def.splitCount) * TAU + Math.random();
    const hp = def.hp * hpScale;
    game.enemies.push(makeEnemy(def, {
      x: parent.x + Math.cos(a) * (parent.radius + 6),
      y: parent.y + Math.sin(a) * (parent.radius + 6),
      hp,
      angle: a,
    }));
  }
  shockRingAt(parent.x, parent.y, def.color, parent.radius * 3, 0.3, 2);
}

/** Fabrique commune : `spawnEnemy` et `splitEnemy` produisent le même objet. */
function makeEnemy(def, opts) {
  return {
    def,
    x: opts.x,
    y: opts.y,
    hp: opts.hp,
    hpMax: opts.hp,
    speed: def.speed * mode().speedMul * rand(0.9, 1.12),
    radius: def.radius,
    rot: opts.angle + Math.PI,
    spin: rand(-1.6, 1.6),
    seed: Math.random() * TAU,
    trail: rand(0, 0.055),
    spiralDir: Math.random() < 0.5 ? -1 : 1,
    fireTimer: def.fireInterval ? rand(0.6, def.fireInterval) : 0,
    dmgPending: 0,
    dmgBurst: 0,
    dmgTimer: DAMAGE_TEXT.tick,
    flash: 0,
  };
}

function spawnEnemy() {
  const def = pickEnemyType();
  // En Rempart, un cône centré sur le haut de l'écran ; sinon tout le tour.
  const angle = mode().halfArc
    ? -Math.PI / 2 + rand(-mode().spread, mode().spread)
    : Math.random() * TAU;
  // Les armes se cumulant, les ennemis s'endurcissent pour que la fin de
  // partie garde du mordant. +100 % de PV au bout de 260 s.
  const hp = def.hp * (1 + game.time / CFG.spawn.hpRampTime) * mode().hpMul;

  const ux = Math.cos(angle);
  const uy = Math.sin(angle);
  const d = spawnDistance(ux, uy);

  game.enemies.push(makeEnemy(def, {
    x: view.cx + ux * d,
    y: view.cy + uy * d,
    hp,
    angle,
  }));
}

function killEnemy(enemy) {
  const index = game.enemies.indexOf(enemy);
  if (index < 0) return;        // déjà retiré par une détonation voisine
  game.enemies.splice(index, 1);
  game.kills++;
  game.combo++;

  game.comboTimer = CFG.combo.window;   // chaque kill relance la fenêtre

  const before = game.multiplier;
  game.multiplier = clamp(
    1 + Math.floor(game.combo / CFG.combo.killsPerStep),
    1,
    CFG.combo.max
  );
  game.score += enemy.def.score * game.multiplier;

  const big = enemy.def.hp > 60;
  const size = enemy.radius;
  const tier = comboTier(game.multiplier);
  const heat = game.intensity;

  // Plus la série est chaude, plus la mort est spectaculaire, et la couleur
  // du palier vient se mêler à celle de l'ennemi.
  shards(enemy.x, enemy.y, enemy.def.color,
    Math.round((9 + size * 0.8) * (1 + heat * 0.8)), big ? 1.35 : 1);
  burst(enemy.x, enemy.y, '#ffffff', Math.round(4 + size * 0.35), 0.85);
  embers(enemy.x, enemy.y, enemy.def.color, Math.round(3 + size * 0.4));
  if (heat > 0.15) shards(enemy.x, enemy.y, tier.color, Math.round(4 + heat * 10), 1.5);

  addFlash(enemy.x, enemy.y, size * (big ? 5 : 3.4), '#ffffff', big ? 0.3 : 0.2);
  addFlash(enemy.x, enemy.y, size * (big ? 7 : 5), tier.color, 0.35);
  shockRingAt(enemy.x, enemy.y, enemy.def.color, size * (big ? 4.2 : 2.8), big ? 0.4 : 0.28);

  if (big) {
    // Les gros s'effondrent en deux temps : implosion, puis répliques.
    game.shake = Math.max(game.shake, 8);
    implode(enemy.x, enemy.y, enemy.def.color, 14, size * 2.6);
    screenFlash(tier.color, 0.1 + heat * 0.12);
    for (let i = 1; i <= 2; i++) {
      const ox = enemy.x + rand(-size, size);
      const oy = enemy.y + rand(-size, size);
      later(0.09 * i, () => {
        shards(ox, oy, enemy.def.color, 8, 1.1);
        addFlash(ox, oy, size * 3, '#ffffff', 0.18);
        shockRingAt(ox, oy, tier.color, size * 2.4, 0.24);
        sfxAftershock();
      });
    }
  }

  sfxKill(enemy);
  maybeDropBonus(enemy);
  if (enemy.def.splitInto) splitEnemy(enemy);
  if (game.multiplier >= DETONATE.fromTier) detonate(enemy, tier);

  if (game.multiplier > before) comboTierUp(before);
}

/**
 * Au-delà du palier Furie, chaque mort souffle ses voisins. C'est ce qui fait
 * partir les fins de série en réaction en chaîne.
 */
let detonateDepth = 0;

function detonate(source, tier) {
  // Une détonation qui tue en déclenche une autre : sans borne, une nuée
  // dense ferait exploser la pile d'appels.
  if (detonateDepth >= 3) return;
  detonateDepth++;

  const r = DETONATE.radius;
  const damage = DETONATE.damage * damageMultiplier();

  // Instantané des voisins avant de frapper : les kills en chaîne modifient
  // game.enemies pendant qu'on le parcourrait.
  const near = game.enemies.filter(
    (e) => Math.hypot(e.x - source.x, e.y - source.y) <= r + e.radius);

  for (const e of near) {
    const dist = Math.hypot(e.x - source.x, e.y - source.y) || 1;
    hitEnemy(e, damage, (e.x - source.x) / dist, (e.y - source.y) / dist);
  }
  const touched = near.length;

  shockRingAt(source.x, source.y, tier.color, r, 0.3, 3);
  if (touched) sfxBoom();
  detonateDepth--;
}

/** Franchissement d'un palier : le décor entier change de couleur. */
function comboTierUp(before) {
  const tier = comboTier(game.multiplier);

  if (tier !== comboTier(before)) {
    game.tierFrom = game.tierTo;
    game.tierTo = tier.color;
    game.tierBlend = 0;
    if (tier.name) {
      showBanner(tier.name, `Multiplicateur ×${game.multiplier}`, tier.color);
      screenFlash(tier.color, 0.16 + game.intensity * 0.16);
      game.shake = Math.max(game.shake, 5);
      vibrate([12, 30, 12]);
    }
  }

  shockRing(tier.color, view.coreRadius * 4.2, 0.55, 3);
  addFlash(view.cx, view.cy, view.coreRadius * 5, tier.color, 0.4);
  sfxCombo(game.multiplier);
}

/** La série retombe faute de kill dans la fenêtre. Sans autre punition. */
function breakCombo() {
  if (game.combo === 0) return;
  const had = game.multiplier;
  game.combo = 0;
  game.comboTimer = 0;
  game.multiplier = 1;
  game.tierFrom = game.tierTo;
  game.tierTo = COMBO_TIERS[0].color;
  game.tierBlend = 0;
  if (had > 1) sfxComboBreak();
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

/**
 * Implosion : des éclats convergent vers le point de mort avant que tout
 * parte. Le décalage d'un dixième de seconde suffit à faire « aspirer puis
 * souffler » plutôt que simplement souffler.
 */
function implode(x, y, color, count, radius) {
  for (let i = 0; i < count; i++) {
    const a = Math.random() * TAU;
    const d = radius * rand(0.7, 1.3);
    const v = d / 0.16;
    addParticle({
      x: x + Math.cos(a) * d, y: y + Math.sin(a) * d,
      vx: -Math.cos(a) * v, vy: -Math.sin(a) * v,
      life: 0.16, maxLife: 0.16,
      size: rand(1.2, 2.6), drag: 1, shape: 'streak', color,
    });
  }
}

/** Programme un effet dans `delay` secondes (explosions secondaires). */
function later(delay, fn) {
  if (game.delayed.length >= 40) return;
  game.delayed.push({ t: delay, fn });
}

function updateDelayed(dt) {
  for (let i = game.delayed.length - 1; i >= 0; i--) {
    const d = game.delayed[i];
    d.t -= dt;
    if (d.t > 0) continue;
    game.delayed.splice(i, 1);
    d.fn();
  }
}

/** Éclair plein écran : réservé aux gros moments, sinon il perd son effet. */
function screenFlash(color, strength) {
  game.screenFlash = Math.max(game.screenFlash, strength);
  game.screenFlashColor = color;
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

    const level = densityLevel();
    if (level !== game.level) {
      game.level = level;
      announceDensity(level);
    }

    // Cadence d'apparition, dictée par le palier de densité.
    const interval = densityInterval(level);
    game.spawnTimer -= dt;
    if (game.spawnTimer <= 0) {
      if (game.enemies.length < CFG.density.maxAlive) spawnEnemy();
      game.spawnTimer += interval * rand(0.75, 1.25);
    }

    game.orbitAngle += dt * WEAPONS.find((w) => w.kind === 'orbit').spin;
    game.mineAngle += dt * WEAPONS.find((w) => w.kind === 'mine').spin;
    updateEnemies(dt);
    updateShots(dt);
    fireAll(dt);
    shootDownShots();
    updatePickups(dt);
    updateBuffs(dt);
    updateCombo(dt);
    checkUnlocks();

    progressTimer -= dt;
    if (progressTimer <= 0) {
      progressTimer = 0.25;
      updateWeaponProgress();
    }
  }

  updateZoom(dt);
  updateChainArcs(dt);
  updateDamageText(dt);
  updateDelayed(dt);
  game.screenFlash = Math.max(0, game.screenFlash - dt * 3.2);

  updateParticles(dt);
  updateRings(dt);
  updateStars(dt);
  updateFlashes(dt);

  // L'intensité suit le multiplicateur avec de l'inertie : le décor respire
  // au lieu de sauter d'un palier à l'autre.
  const target = (game.multiplier - 1) / (CFG.combo.max - 1);
  game.intensity += (target - game.intensity) * Math.min(1, dt * 2.2);
  game.tierBlend = Math.min(1, game.tierBlend + dt * 1.5);

  game.levelFlash = Math.max(0, game.levelFlash - dt * 1.6);
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
  const speedMul = game.buffs.slow > 0 ? 0.42 : 1;

  for (let i = game.enemies.length - 1; i >= 0; i--) {
    const e = game.enemies[i];

    const dx = view.cx - e.x;
    const dy = view.cy - e.y;
    const dist = Math.hypot(dx, dy) || 1;

    const ux = dx / dist;
    const uy = dy / dist;
    const v = e.speed * speedMul;

    if (e.def.move === 'spiral') {
      // Composante tangentielle : l'ennemi s'enroule au lieu de foncer, ce
      // qui le fait glisser hors d'un rayon tenu immobile.
      const swirl = e.def.swirl * e.spiralDir;
      e.x += (ux - uy * swirl) * v * dt;
      e.y += (uy + ux * swirl) * v * dt;
    } else if (e.def.move === 'stopper') {
      const stand = view.spawnRadius * e.def.standRange;
      if (dist > stand) {
        e.x += ux * v * dt;
        e.y += uy * v * dt;
      } else {
        // En position : la Sentinelle se contente de bombarder.
        e.fireTimer -= dt;
        if (e.fireTimer <= 0) {
          e.fireTimer = e.def.fireInterval;
          spawnShot(e);
        }
      }
    } else {
      e.x += ux * v * dt;
      e.y += uy * v * dt;
    }

    e.flash = Math.max(0, e.flash - dt * 12);

    if (e.dmgPending > 0) {
      e.dmgTimer -= dt;
      if (e.dmgTimer <= 0) flushDamageText(e, false);
    }

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
  hitCoreBy(enemy.def.damage, enemy.x, enemy.y, enemy.def.color);
}

/** Un ennemi au contact, ou un projectile de Sentinelle : même encaissement. */
function hitCoreBy(damage, x, y, color) {
  game.hp -= damage;
  breakCombo();
  game.shake = Math.min(22, 8 + damage * 0.4);
  game.coreFlash = 1;

  shards(x, y, '#ffffff', 16, 1.4);
  shards(x, y, color, 10, 1.1);
  embers(x, y, '#ff3d81', 8);
  shockRing('#ff3d81', view.coreRadius * 4.6, 0.5, 4);
  addFlash(view.cx, view.cy, view.coreRadius * 5.4, '#ff3d81', 0.45);

  vibrate(damage >= 20 ? 55 : 30);
  sfxCoreHit(damage);

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
  addFlash(view.cx, view.cy, view.spawnRadius * 0.8, '#ffffff', 0.8);
  shockRing('#ffffff', view.spawnRadius * 0.9, 0.7, 6);
  shockRing('#ff3d81', view.spawnRadius * 0.65, 0.9, 3);

  screenFlash('#ff3d81', 0.55);
  vibrate([40, 60, 120]);
  sfxGameOver();

  if (game.score > game.best) {
    game.best = game.score;
    game.newBest = true;
    saveBest(game.best);
  }
}

/** Une arme tire si elle est débloquée, ou si le bonus Arsenal est actif. */
function isArmed(i) {
  return game.unlocked[i] || game.buffs.arsenal > 0;
}

/** L'arme de plus haut palier en service : elle donne le timbre du tir. */
function leadWeapon() {
  for (let i = WEAPONS.length - 1; i >= 0; i--) {
    if (WEAPONS[i].kind === 'beam' && isArmed(i)) return WEAPONS[i];
  }
  return WEAPONS[0];
}

/** Le bonus Faisceaux greffe deux rayons de flanc sur chaque arme. */
function beamOffsets(w) {
  return game.buffs.beams > 0 ? w.beams.concat([-0.68, 0.68]) : w.beams;
}

function damageMultiplier() {
  const amp = 1 + (game.perks.dpsUp || 0) * DROP.dpsUpStep;
  return (game.buffs.power > 0 ? 2 : 1) * amp;
}

function orbiterCount(w) {
  return w.count + (game.perks.orbitUp || 0);
}

/** Toutes les armes en service tirent ensemble. */
function fireAll(dt) {
  game.orbitShots.length = 0;

  for (let i = 0; i < WEAPONS.length; i++) {
    if (!isArmed(i)) continue;
    const w = WEAPONS[i];

    // Satellites et foudre se battent seuls ; les rayons attendent le doigt.
    if (w.kind === 'orbit') fireOrbiters(w, dt);
    else if (w.kind === 'chain') fireChain(w, dt);
    else if (w.kind === 'mine') updateMines(w, dt);
    else if (input.active && input.hasAngle) fireBeams(w, dt);
  }
}

/**
 * La Foudre part du noyau vers l'ennemi le plus proche, puis rebondit de
 * voisin en voisin. Elle frappe par à-coups, pas en continu : c'est ce qui
 * la rend lisible au milieu des rayons.
 */
function fireChain(w, dt) {
  game.chainTimer -= dt;
  if (game.chainTimer > 0) return;
  game.chainTimer += w.interval;

  const damage = w.damage * damageMultiplier();
  const hit = new Set();   // objets déjà touchés par cet arc
  const points = [{ x: view.cx, y: view.cy }];

  let fromX = view.cx;
  let fromY = view.cy;
  let reach = view.spawnRadius * w.range;

  for (let hop = 0; hop < w.hops; hop++) {
    let target = null;
    let best = reach;

    for (const e of game.enemies) {
      if (hit.has(e)) continue;
      const d = Math.hypot(e.x - fromX, e.y - fromY);
      if (d < best) { best = d; target = e; }
    }
    if (!target) break;

    const e = target;
    hit.add(e);
    points.push({ x: e.x, y: e.y });
    fromX = e.x;
    fromY = e.y;
    reach = w.hopRange;      // les rebonds suivants sont plus courts

    addFlash(e.x, e.y, e.radius * 2.6, w.color, 0.18);
  }

  if (points.length < 2) return;

  game.chainArcs.push({ points, life: 0.16, maxLife: 0.16, color: w.color });
  sfxChain(points.length - 1);

  for (const e of hit) hitEnemy(e, damage, 0, -1);
}

/**
 * Les mines occupent des emplacements fixes sur une orbite large qui tourne
 * lentement. Une mine prête saute au contact du premier ennemi qui l'effleure,
 * puis son emplacement se recharge — c'est un champ défensif, pas une arme
 * qu'on dirige.
 */
function updateMines(w, dt) {
  const orbitR = view.spawnRadius * w.orbitFactor;
  if (game.mines.length !== w.count) {
    game.mines = Array.from({ length: w.count }, () => ({ cooldown: 0 }));
  }

  for (let i = 0; i < w.count; i++) {
    const mine = game.mines[i];
    if (mine.cooldown > 0) { mine.cooldown -= dt; continue; }

    const a = slotAngle(i, w.count, game.mineAngle);
    const mx = view.cx + Math.cos(a) * orbitR;
    const my = view.cy + Math.sin(a) * orbitR;

    for (const e of game.enemies) {
      if (Math.hypot(e.x - mx, e.y - my) > w.radius + e.radius) continue;
      mine.cooldown = w.respawn;
      explodeMine(mx, my, w);
      break;
    }
  }
}

function explodeMine(x, y, w) {
  const damage = w.damage * damageMultiplier();

  // Instantané avant de frapper : les morts en chaîne modifient la liste.
  const near = game.enemies.filter(
    (e) => Math.hypot(e.x - x, e.y - y) <= w.blast + e.radius);
  for (const e of near) {
    const d = Math.hypot(e.x - x, e.y - y) || 1;
    hitEnemy(e, damage, (e.x - x) / d, (e.y - y) / d);
  }

  // Le souffle emporte aussi les projectiles qui traînent.
  for (let i = game.shots.length - 1; i >= 0; i--) {
    const sh = game.shots[i];
    if (Math.hypot(sh.x - x, sh.y - y) <= w.blast) game.shots.splice(i, 1);
  }

  shockRingAt(x, y, w.color, w.blast, 0.42, 4);
  addFlash(x, y, w.blast * 1.1, '#ffffff', 0.26);
  addFlash(x, y, w.blast * 1.5, w.color, 0.42);
  shards(x, y, w.color, 26, 1.6);
  burst(x, y, '#ffffff', 18, 1.4);
  embers(x, y, w.color, 12);
  game.shake = Math.max(game.shake, 11);
  screenFlash(w.color, 0.18);
  sfxMine();
}

/* ------------------------------------------------------------------ *
 *  Projectiles ennemis
 * ------------------------------------------------------------------ */

function spawnShot(enemy) {
  const def = enemy.def;
  const dx = view.cx - enemy.x;
  const dy = view.cy - enemy.y;
  const d = Math.hypot(dx, dy) || 1;

  game.shots.push({
    x: enemy.x, y: enemy.y,
    vx: (dx / d) * def.shotSpeed,
    vy: (dy / d) * def.shotSpeed,
    radius: def.shotRadius,
    damage: def.shotDamage,
    color: def.color,
    spin: 0,
  });
  addFlash(enemy.x, enemy.y, enemy.radius * 2, def.color, 0.16);
  sfxShot();
}

function updateShots(dt) {
  for (let i = game.shots.length - 1; i >= 0; i--) {
    const sh = game.shots[i];
    sh.x += sh.vx * dt;
    sh.y += sh.vy * dt;
    sh.spin += dt * 6;

    const dist = Math.hypot(sh.x - view.cx, sh.y - view.cy);
    if (dist < view.coreRadius + sh.radius) {
      game.shots.splice(i, 1);
      hitCoreBy(sh.damage, sh.x, sh.y, sh.color);
      continue;
    }
    // Un projectile qui a dépassé l'écran ne reviendra pas.
    if (dist > view.spawnRadius + 80) game.shots.splice(i, 1);
  }
}

/** Un rayon en service abat-il ce projectile ? */
function shootDownShots() {
  if (!input.active || !input.hasAngle) return;
  for (let i = game.shots.length - 1; i >= 0; i--) {
    const sh = game.shots[i];
    if (!beamTouches(sh.x, sh.y, sh.radius + 6)) continue;
    game.shots.splice(i, 1);
    burst(sh.x, sh.y, sh.color, 10, 1);
    addFlash(sh.x, sh.y, 26, '#ffffff', 0.16);
    sfxHit();
  }
}

function drawShots() {
  if (!game.shots.length) return;

  ctx.globalCompositeOperation = 'lighter';
  for (const sh of game.shots) {
    drawBlob(sh.x, sh.y, sh.radius * 3.2, sh.color, 0.5);
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';

  for (const sh of game.shots) {
    ctx.save();
    ctx.translate(sh.x, sh.y);
    ctx.rotate(sh.spin);
    ctx.beginPath();
    ctx.moveTo(0, -sh.radius);
    ctx.lineTo(sh.radius, 0);
    ctx.lineTo(0, sh.radius);
    ctx.lineTo(-sh.radius, 0);
    ctx.closePath();
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.strokeStyle = sh.color;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }
}

function updateChainArcs(dt) {
  for (let i = game.chainArcs.length - 1; i >= 0; i--) {
    game.chainArcs[i].life -= dt;
    if (game.chainArcs[i].life <= 0) game.chainArcs.splice(i, 1);
  }
}

/**
 * Rayons continus. Chaque faisceau part du bord du noyau selon son décalage
 * angulaire et touche les ennemis dont la distance perpendiculaire à l'axe de
 * tir est inférieure à leur rayon + une tolérance qui grandit avec
 * l'éloignement — viser loin ne doit pas demander une précision au pixel.
 */
function fireBeams(w, dt) {
  const reach = view.spawnRadius * w.range;
  const rate = w.dps * damageMultiplier();
  const damage = rate * dt;
  const burst = rate * DAMAGE_TEXT.tick;

  /*
   * Instantané de la liste. Un rayon qui tue déclenche une détonation, qui
   * retire d'autres ennemis au milieu du tableau : parcourir `game.enemies`
   * par index finissait par lire au-delà de sa nouvelle longueur. Les morts
   * restés dans l'instantané sont sans effet, `hitEnemy` les ignore.
   */
  const list = game.enemies.slice();

  for (const offset of beamOffsets(w)) {
    const angle = beamAngleFor(offset);
    const ux = Math.cos(angle);
    const uy = Math.sin(angle);

    let nearest = null;       // seulement utile aux armes sans perçage
    let nearestAlong = Infinity;

    for (const e of list) {
      if (e.hp <= 0) continue;                  // abattu entre-temps
      const dx = e.x - view.cx;
      const dy = e.y - view.cy;

      const along = dx * ux + dy * uy;          // projection sur l'axe de tir
      if (along <= 0 || along > reach) continue; // derrière le canon, ou hors portée

      const perp = Math.abs(dx * uy - dy * ux);
      if (perp > e.radius + w.halfWidth + w.slack + along * w.slackPerPx) continue;

      if (w.pierce) {
        hitEnemy(e, damage, ux, uy, burst);
      } else if (along < nearestAlong) {
        nearestAlong = along;
        nearest = e;
      }
    }

    if (nearest) hitEnemy(nearest, damage, ux, uy, burst);
  }
}

/**
 * Les satellites tournent autour du noyau et tirent en continu sur l'ennemi
 * le plus proche à leur portée — y compris quand le joueur ne touche rien.
 * Chacun ne tient qu'une cible, ce qui les rend complémentaires du balayage.
 */
function fireOrbiters(w, dt) {
  const reach = view.spawnRadius * w.range;
  const rate = w.dps * damageMultiplier();
  const damage = rate * dt;
  const burst = rate * DAMAGE_TEXT.tick;
  const orbitR = view.coreRadius * w.orbit;

  const count = orbiterCount(w);
  for (let s = 0; s < count; s++) {
    const a = slotAngle(s, count, game.orbitAngle);
    const sx = view.cx + Math.cos(a) * orbitR;
    const sy = view.cy + Math.sin(a) * orbitR;

    let target = null;
    let bestDist = reach;
    for (const e of game.enemies) {
      const d = Math.hypot(e.x - sx, e.y - sy);
      if (d < bestDist) { bestDist = d; target = e; }
    }
    if (!target) continue;

    const e = target;
    game.orbitShots.push({ x1: sx, y1: sy, x2: e.x, y2: e.y, color: w.color });

    const ux = (e.x - sx) / (bestDist || 1);
    const uy = (e.y - sy) / (bestDist || 1);
    hitEnemy(e, damage, ux, uy, burst);
  }
}

/**
 * Applique des dégâts à un ennemi ; `ux/uy` oriente les étincelles d'impact.
 *
 * On travaille sur l'objet, jamais sur un index : une détonation en chaîne
 * retire des ennemis au milieu du tableau, et tout index capturé avant
 * devient faux — c'est ce qui faisait planter la boucle.
 */
function hitEnemy(enemy, damage, ux, uy, burst) {
  if (enemy.hp <= 0) return;   // déjà abattu dans la même image
  enemy.hp -= damage;
  enemy.flash = 1;
  // Cumul brut : ce qui dépasse les PV restants compte quand même.
  enemy.dmgPending += damage;
  // `burst` est la force du coup affichée : pour un rayon, l'équivalent d'un
  // cycle complet. Sans lui, un ennemi pulvérisé en une image n'afficherait
  // que les quelques points de cette image au lieu de la puissance réelle.
  enemy.dmgBurst = Math.max(enemy.dmgBurst || 0, burst === undefined ? damage : burst);

  if (enemy.hp <= 0) {
    flushDamageText(enemy, true);
    killEnemy(enemy);
    return;
  }

  if (sparkCooldown > 0) return;
  sparkCooldown = 0.028;
  sfxHit();
  addFlash(enemy.x, enemy.y, enemy.radius * 2.2, '#ffffff', 0.1);

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

/* ------------------------------------------------------------------ *
 *  Bonus
 * ------------------------------------------------------------------ */

/** Tirage pondéré : les améliorations définitives sont volontairement rares. */
function pickBonusId() {
  let r = Math.random() * BONUS_WEIGHT;
  for (const id of BONUS_IDS) {
    r -= BONUSES[id].weight;
    if (r <= 0) return id;
  }
  return BONUS_IDS[0];
}

function maybeDropBonus(enemy) {
  const chance = enemy.def.hp > 60 ? DROP.tankChance : DROP.chance;
  if (Math.random() > chance) return;

  const id = pickBonusId();
  const def = BONUSES[id];

  // La Réparation ne tombe que si elle sert à quelque chose.
  if (id === 'repair' && game.hp > game.hpMax * 0.85) return;
  // Ni une amélioration déjà poussée à son maximum.
  if (def.max && (game.perks[id] || 0) >= def.max) return;

  const a = Math.random() * TAU;
  game.pickups.push({
    id, x: enemy.x, y: enemy.y,
    vx: Math.cos(a) * 34, vy: Math.sin(a) * 34,
    life: DROP.life, spin: 0,
  });
}

function updatePickups(dt) {
  for (let i = game.pickups.length - 1; i >= 0; i--) {
    const p = game.pickups[i];
    p.life -= dt;
    if (p.life <= 0) { game.pickups.splice(i, 1); continue; }

    // L'Aimant tire les bonus vers le noyau, où ils sont happés d'office.
    if (game.perks.magnet) {
      const dx = view.cx - p.x;
      const dy = view.cy - p.y;
      const d = Math.hypot(dx, dy) || 1;
      p.vx += (dx / d) * DROP.magnetPull * dt;
      p.vy += (dy / d) * DROP.magnetPull * dt;
    }

    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vx *= game.perks.magnet ? 0.99 : 0.965;
    p.vy *= game.perks.magnet ? 0.99 : 0.965;
    p.spin += dt * 1.7;

    // Ramassage : un rayon qui passe dessus, ou le noyau qu'il effleure.
    if (beamTouches(p.x, p.y, DROP.radius + DROP.grabSlack)
        || Math.hypot(p.x - view.cx, p.y - view.cy) < view.coreRadius + DROP.radius) {
      game.pickups.splice(i, 1);
      collectBonus(p);
    }
  }
}

/** Un rayon en service passe-t-il à moins de `slack` du point donné ? */
function beamTouches(x, y, slack) {
  if (!input.active || !input.hasAngle) return false;

  const dx = x - view.cx;
  const dy = y - view.cy;

  for (let i = 0; i < WEAPONS.length; i++) {
    if (!isArmed(i)) continue;
    const w = WEAPONS[i];
    if (w.kind !== 'beam') continue;

    const reach = view.spawnRadius * w.range;
    for (const offset of beamOffsets(w)) {
      const a = beamAngleFor(offset);
      const ux = Math.cos(a);
      const uy = Math.sin(a);
      const along = dx * ux + dy * uy;
      if (along <= 0 || along > reach) continue;
      if (Math.abs(dx * uy - dy * ux) <= slack) return true;
    }
  }
  return false;
}

function collectBonus(pickup) {
  const id = pickup.id;
  const def = BONUSES[id];

  if (def.permanent) {
    game.perks[id] = (game.perks[id] || 0) + 1;
    if (id === 'hpUp') {
      game.hpMax += DROP.hpUpAmount;
      game.hp += DROP.hpUpAmount;   // le blindage arrive déjà rempli
    }
  } else if (id === 'repair') {
    game.hp = Math.min(game.hpMax, game.hp + DROP.repairAmount);
  } else {
    // Ramasser deux fois le même bonus prolonge, sans cumuler l'effet.
    game.buffs[id] = (game.buffs[id] || 0) + def.duration;
  }

  shockRingAt(pickup.x, pickup.y, def.color, 90, 0.45, 3);
  addFlash(pickup.x, pickup.y, 70, def.color, 0.4);
  burst(pickup.x, pickup.y, def.color, 26, 1.3);
  shards(pickup.x, pickup.y, '#ffffff', 10, 1);
  showBanner(def.name, def.blurb, def.color);
  vibrate([10, 25, 10]);

  if (def.permanent) {
    // Une acquisition définitive mérite plus qu'un ramassage ordinaire.
    screenFlash(def.color, 0.22);
    shockRing(def.color, view.spawnRadius * 0.6, 0.7, 3);
    sfxPerk();
  } else {
    sfxPickup();
  }
}

function updateCombo(dt) {
  if (game.combo === 0) return;
  game.comboTimer -= dt;
  if (game.comboTimer <= 0) breakCombo();
}

function updateBuffs(dt) {
  for (const id in game.buffs) {
    game.buffs[id] -= dt;
    if (game.buffs[id] <= 0) {
      delete game.buffs[id];
      sfxBuffEnd();
    }
  }
}

/* ------------------------------------------------------------------ *
 *  Chiffres de dégâts
 * ------------------------------------------------------------------ */

/** Relâche le cumul d'un ennemi sous forme de chiffre flottant. */
function flushDamageText(enemy, killing) {
  // Sur le coup fatal on retient la force du coup plutôt que la fraction
  // réellement consommée : c'est là que le surdégât doit se voir.
  const value = Math.round(killing
    ? Math.max(enemy.dmgPending, enemy.dmgBurst || 0)
    : enemy.dmgPending);
  enemy.dmgPending = 0;
  enemy.dmgBurst = 0;
  enemy.dmgTimer = DAMAGE_TEXT.tick;
  if (value < 1) return;
  if (game.damageText.length >= DAMAGE_TEXT.max) return;

  game.damageText.push({
    x: enemy.x + rand(-enemy.radius * 0.5, enemy.radius * 0.5),
    y: enemy.y - enemy.radius * 0.6,
    drift: rand(-14, 14),
    value,
    killing,
    // Le coup fatal prend la couleur de la série en cours : on repère d'un
    // coup d'œil ce qui a tué, au milieu des dégâts qui grattent.
    color: killing ? game.tierTo : '#ffffff',
    life: killing ? DAMAGE_TEXT.life * 1.25 : DAMAGE_TEXT.life,
    maxLife: killing ? DAMAGE_TEXT.life * 1.25 : DAMAGE_TEXT.life,
  });
}

function updateDamageText(dt) {
  for (let i = game.damageText.length - 1; i >= 0; i--) {
    if ((game.damageText[i].life -= dt) <= 0) game.damageText.splice(i, 1);
  }
}

function drawDamageText() {
  if (!game.damageText.length) return;

  // Divisé par le recul : les chiffres gardent leur taille à l'écran.
  const s = view.scale / view.zoom;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';

  for (const d of game.damageText) {
    const t = 1 - d.life / d.maxLife;
    // Montée qui décélère, puis effacement sur le dernier tiers.
    const y = d.y - (DAMAGE_TEXT.rise / view.zoom) * (1 - (1 - t) * (1 - t));
    const x = d.x + d.drift * t;
    const alpha = t < 0.65 ? 1 : 1 - (t - 0.65) / 0.35;

    // La taille suit l'ampleur du coup, pour que 400 ne se lise pas comme 4.
    const size = Math.round((d.killing ? 14 : 11) * s + Math.min(11, d.value / 26) * s);
    ctx.font = `800 ${size}px ui-sans-serif, system-ui, sans-serif`;
    ctx.globalAlpha = alpha;

    // Contour sombre : lisible sur les rayons comme sur le fond noir.
    ctx.strokeStyle = 'rgba(3,5,12,0.85)';
    ctx.lineWidth = Math.max(3, size * 0.28);
    ctx.strokeText(d.value, x, y);
    ctx.fillStyle = d.color;
    ctx.fillText(d.value, x, y);
  }

  ctx.globalAlpha = 1;
  ctx.textBaseline = 'top';
  ctx.lineJoin = 'miter';
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

/**
 * Trait lumineux : trois passes additives, bien moins coûteux que shadowBlur.
 *
 * `cheap` supprime la passe de halo la plus large. Avec toutes les armes et
 * le bonus Faisceaux, treize rayons traversent l'écran en même temps : cette
 * seule passe, large et pleine longueur, suffisait à faire tomber le pire cas
 * sous les 30 images par seconde.
 */
function glowLine(x1, y1, x2, y2, color, width, cheap) {
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';

  ctx.strokeStyle = color;
  if (!cheap) {
    ctx.globalAlpha = 0.16;
    ctx.lineWidth = width * 4.5;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  }

  ctx.globalAlpha = cheap ? 0.42 : 0.34;
  ctx.lineWidth = width * 2;
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();

  ctx.globalAlpha = 1;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = width;
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();

  ctx.globalCompositeOperation = 'source-over';
}

function render(dt) {
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';

  drawBackground(dt);

  ctx.save();

  // Tremblement d'écran
  if (game.shake > 0.2) {
    ctx.translate(rand(-game.shake, game.shake), rand(-game.shake, game.shake));
  }

  // Recul de caméra, centré sur le noyau : tout ce qui suit est dessiné en
  // unités du monde, et l'angle de visée reste donc inchangé.
  if (view.zoom !== 1) {
    ctx.translate(view.cx, view.cy);
    ctx.scale(view.zoom, view.zoom);
    ctx.translate(-view.cx, -view.cy);
  }

  drawStars();
  drawFlashes();
  drawRings();
  drawParticles();

  if (game.state === STATE.PLAYING || game.state === STATE.PAUSED) {
    drawWeapon();
  }

  drawPickups();
  drawShots();
  drawEnemies();

  drawDamageText();

  if (game.hp > 0) {
    drawCore();
    if (game.state === STATE.PLAYING || game.state === STATE.PAUSED) drawThreatRing();
  }

  ctx.restore();

  drawStick();

  drawHud();
  drawDangerVignette();
  drawScreenFlash();
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

/** Tous les rayons en service, plus les tirs des satellites. */
function drawWeapon() {
  const { cx, cy } = view;
  const flicker = 1 + Math.sin(game.corePulse * 60) * 0.1;
  const firing = input.active && input.hasAngle;

  if (firing) {
    // Au-delà de sept rayons, on allège le halo : c'est invisible à l'œil
    // dans cette densité, et c'est ce qui tient la cadence.
    let count = 0;
    for (let i = 0; i < WEAPONS.length; i++) {
      if (isArmed(i) && WEAPONS[i].kind === 'beam') count += beamOffsets(WEAPONS[i]).length;
    }
    const cheap = count > 7;

    for (let i = 0; i < WEAPONS.length; i++) {
      if (!isArmed(i)) continue;
      const w = WEAPONS[i];
      if (w.kind !== 'beam') continue;

      const reach = view.spawnRadius * w.range;
      for (const offset of beamOffsets(w)) {
        const angle = beamAngleFor(offset);
        const ux = Math.cos(angle);
        const uy = Math.sin(angle);
        glowLine(
          cx + ux * (view.coreRadius - 2), cy + uy * (view.coreRadius - 2),
          cx + ux * reach, cy + uy * reach,
          w.color, w.halfWidth * flicker, cheap
        );
      }
    }

    // Éclat de bouche, une seule fois pour toute la salve.
    const lead = leadWeapon();
    const mx = cx + Math.cos(input.angle) * (view.coreRadius - 2);
    const my = cy + Math.sin(input.angle) * (view.coreRadius - 2);
    const r = 14 * view.scale * flicker;

    ctx.globalCompositeOperation = 'lighter';
    const grad = ctx.createRadialGradient(mx, my, 0, mx, my, r);
    grad.addColorStop(0, 'rgba(255,255,255,0.9)');
    grad.addColorStop(0.4, hexToRgba(lead.color, 0.5));
    grad.addColorStop(1, hexToRgba(lead.color, 0));
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(mx, my, r, 0, TAU);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  }

  drawOrbiters();
  drawMines();
  drawChainArcs();
}

/**
 * Mines : un point vif cerclé quand elles sont armées, un arc de recharge
 * qui se referme quand elles ne le sont pas. On voit donc d'un coup d'œil
 * quel secteur de l'orbite est encore protégé.
 */
function drawMines() {
  const idx = WEAPONS.findIndex((w) => w.kind === 'mine');
  if (!isArmed(idx) || !game.mines.length) return;

  const w = WEAPONS[idx];
  const orbitR = view.spawnRadius * w.orbitFactor;
  const r = w.radius;

  for (let i = 0; i < game.mines.length; i++) {
    const mine = game.mines[i];
    const a = slotAngle(i, game.mines.length, game.mineAngle);
    const x = view.cx + Math.cos(a) * orbitR;
    const y = view.cy + Math.sin(a) * orbitR;

    if (mine.cooldown > 0) {
      const frac = 1 - mine.cooldown / w.respawn;
      ctx.strokeStyle = hexToRgba(w.color, 0.28);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + TAU * frac);
      ctx.stroke();
      continue;
    }

    const pulse = 0.75 + 0.25 * Math.sin(game.corePulse * 4 + i);

    ctx.globalCompositeOperation = 'lighter';
    drawBlob(x, y, r * 3.4, w.color, 0.4 * pulse);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fillStyle = 'rgba(6,8,18,0.8)';
    ctx.fill();
    ctx.strokeStyle = w.color;
    ctx.lineWidth = 2.2;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(x, y, r * 0.36, 0, TAU);
    ctx.fillStyle = '#ffffff';
    ctx.globalAlpha = pulse;
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}

/**
 * Les arcs de foudre : chaque segment est brisé en zigzag, avec un
 * déplacement latéral proportionnel à sa longueur.
 */
function drawChainArcs() {
  if (!game.chainArcs.length) return;

  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (const arc of game.chainArcs) {
    const fade = arc.life / arc.maxLife;

    ctx.beginPath();
    ctx.moveTo(arc.points[0].x, arc.points[0].y);
    for (let i = 1; i < arc.points.length; i++) {
      const a = arc.points[i - 1];
      const b = arc.points[i];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const steps = Math.max(2, Math.round(len / 26));
      const nx = -(b.y - a.y) / (len || 1);
      const ny = (b.x - a.x) / (len || 1);

      for (let k = 1; k <= steps; k++) {
        const t = k / steps;
        const jitter = k === steps ? 0 : rand(-1, 1) * len * 0.09;
        ctx.lineTo(a.x + (b.x - a.x) * t + nx * jitter,
                   a.y + (b.y - a.y) * t + ny * jitter);
      }
    }

    ctx.strokeStyle = hexToRgba(arc.color, 0.3 * fade);
    ctx.lineWidth = 9;
    ctx.stroke();
    ctx.strokeStyle = hexToRgba(arc.color, 0.8 * fade);
    ctx.lineWidth = 3.5;
    ctx.stroke();
    ctx.strokeStyle = `rgba(255,255,255,${fade})`;
    ctx.lineWidth = 1.4;
    ctx.stroke();
  }

  ctx.lineCap = 'butt';
  ctx.lineJoin = 'miter';
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

/** Éclair plein écran, en dernier : il doit passer par-dessus tout. */
function drawScreenFlash() {
  if (game.screenFlash <= 0.03) return;
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = game.screenFlash;
  ctx.fillStyle = game.screenFlashColor;
  ctx.fillRect(0, 0, view.w, view.h);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

function drawOrbiters() {
  const idx = WEAPONS.findIndex((w) => w.kind === 'orbit');
  if (!isArmed(idx)) return;

  const w = WEAPONS[idx];
  const orbitR = view.coreRadius * w.orbit;

  // Traits vers les cibles, calculés pendant le tir.
  for (const shot of game.orbitShots) {
    glowLine(shot.x1, shot.y1, shot.x2, shot.y2, shot.color, 2);
  }

  ctx.globalCompositeOperation = 'lighter';
  const count = orbiterCount(w);
  for (let s = 0; s < count; s++) {
    const a = slotAngle(s, count, game.orbitAngle);
    const x = view.cx + Math.cos(a) * orbitR;
    const y = view.cy + Math.sin(a) * orbitR;
    const r = 5.5 * view.scale;

    const grad = ctx.createRadialGradient(x, y, 0, x, y, r * 2.4);
    grad.addColorStop(0, 'rgba(255,255,255,0.95)');
    grad.addColorStop(0.35, hexToRgba(w.color, 0.75));
    grad.addColorStop(1, hexToRgba(w.color, 0));
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, r * 2.4, 0, TAU);
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
}

/** Bonus au sol : un losange qui tourne, cerclé, clignotant en fin de vie. */
function drawPickups() {
  for (const p of game.pickups) {
    const def = BONUSES[p.id];
    // Les deux dernières secondes, il clignote : à ramasser maintenant.
    if (p.life < 2 && Math.sin(p.life * 22) < -0.2) continue;

    const pulse = 1 + Math.sin(game.corePulse * 5 + p.spin) * 0.08;
    const r = DROP.radius * pulse;

    ctx.globalCompositeOperation = 'lighter';
    const halo = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 2.6);
    halo.addColorStop(0, hexToRgba(def.color, 0.5));
    halo.addColorStop(1, hexToRgba(def.color, 0));
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r * 2.6, 0, TAU);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';

    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.spin);
    ctx.beginPath();
    ctx.moveTo(0, -r); ctx.lineTo(r, 0); ctx.lineTo(0, r); ctx.lineTo(-r, 0);
    ctx.closePath();
    ctx.fillStyle = 'rgba(6,8,18,0.8)';
    ctx.fill();
    ctx.strokeStyle = def.color;
    ctx.lineWidth = 2.2;
    ctx.stroke();
    ctx.restore();

    // Point central : rappel de la couleur, lisible même en petit.
    ctx.fillStyle = def.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 2.6, 0, TAU);
    ctx.fill();
  }
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
    if (e.def.hp > 60 && e.hp < e.hpMax) {
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
  if (shape === 'square') {
    const k = r * 0.78;
    ctx.moveTo(k, k);
    ctx.lineTo(-k, k);
    ctx.lineTo(-k, -k);
    ctx.lineTo(k, -k);
    return;
  }
  if (shape === 'chevron') {
    // Pointe fendue : la Sentinelle se distingue même immobile.
    ctx.moveTo(r, 0);
    ctx.lineTo(-r * 0.55, r * 0.85);
    ctx.lineTo(-r * 0.15, 0);
    ctx.lineTo(-r * 0.55, -r * 0.85);
    return;
  }
  if (shape === 'pentagon') {
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TAU;
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
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
  const hpFrac = game.hp / game.hpMax;

  // Aura, teintée par le palier de série et gonflée par l'intensité.
  ctx.globalCompositeOperation = 'lighter';
  const beat = 1 + Math.sin(game.corePulse * (3 + game.intensity * 6)) * 0.05 * (0.4 + game.intensity);
  const auraR = R * (2.4 + game.intensity * 1.5) * beat;
  drawBlob(cx, cy, auraR, game.tierFrom, 0.3 * (1 - game.tierBlend));
  drawBlob(cx, cy, auraR, game.tierTo, 0.3 * game.tierBlend);
  ctx.globalAlpha = 1;
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

  if (mode().halfArc) drawRampart(R, hpFrac);

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

/*
 * Anneau de menaces : un cran par ennemi, planté à l'angle d'où il vient,
 * d'autant plus long et vif qu'il est proche. Le tout tient dans le disque
 * autour du noyau — la seule zone qu'un doigt ne masque jamais — donc on
 * garde une lecture complète de ce qui approche même écran partiellement
 * caché.
 */
function drawThreatRing() {
  if (!game.enemies.length) return;

  const { cx, cy } = view;
  const inner = view.coreRadius + 14;
  const range = view.spawnRadius * CFG.aim.threatRange;

  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';

  let drawn = 0;
  for (const e of game.enemies) {
    if (drawn >= 30) break;      // au-delà, l'anneau devient illisible
    const dx = e.x - cx;
    const dy = e.y - cy;
    const dist = Math.hypot(dx, dy);
    if (dist > range) continue;
    drawn++;

    // 0 au bord de la zone de veille, 1 au contact.
    const near = clamp(1 - (dist - view.coreRadius) / (range - view.coreRadius), 0, 1);
    const a = Math.atan2(dy, dx);
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    const len = 4 + near * 9;

    ctx.strokeStyle = hexToRgba(e.def.color, 0.25 + near * 0.65);
    ctx.lineWidth = 2 + near * 1.6;
    ctx.beginPath();
    ctx.moveTo(cx + ux * inner, cy + uy * inner);
    ctx.lineTo(cx + ux * (inner + len), cy + uy * (inner + len));
    ctx.stroke();
  }

  ctx.lineCap = 'butt';
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

/** Manche virtuel : ancrage, direction poussée, et le doigt au bout. */
function drawStick() {
  if (aimMode !== 'pouce' || !input.active) return;

  const R = CFG.aim.stickRadius;
  const dx = input.fx - input.ox;
  const dy = input.fy - input.oy;
  const dist = Math.hypot(dx, dy);

  ctx.globalCompositeOperation = 'lighter';

  ctx.strokeStyle = 'rgba(232,246,255,0.22)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(input.ox, input.oy, R, 0, TAU);
  ctx.stroke();

  if (dist > CFG.aim.deadzone) {
    const k = Math.min(1, R / dist);
    const kx = input.ox + dx * k;
    const ky = input.oy + dy * k;

    ctx.strokeStyle = hexToRgba(game.tierTo, 0.5);
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(input.ox, input.oy);
    ctx.lineTo(kx, ky);
    ctx.stroke();

    drawBlob(kx, ky, 14, game.tierTo, 0.5);
  }

  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

/**
 * Socle du mode Rempart : une ligne d'horizon et un empattement sous le
 * noyau. Sans repère au sol, un noyau posé en bas ressemble à un noyau
 * centré qu'on aurait mal cadré.
 */
function drawRampart(R, hpFrac) {
  const { cx, cy } = view;
  const w = view.w / view.zoom;   // le socle barre l'écran quel que soit le recul
  const y = cy + R + 10;
  const tint = hpFrac > 0.34 ? game.tierTo : '#ff3d81';

  // Ligne d'horizon, plus dense près du noyau.
  const grad = ctx.createLinearGradient(cx - w / 2, y, cx + w / 2, y);
  grad.addColorStop(0, hexToRgba(tint, 0));
  grad.addColorStop(0.5, hexToRgba(tint, 0.5));
  grad.addColorStop(1, hexToRgba(tint, 0));
  ctx.strokeStyle = grad;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(cx - w / 2, y);
  ctx.lineTo(cx + w / 2, y);
  ctx.stroke();

  // Empattement : deux jambes obliques jusqu'au sol.
  ctx.strokeStyle = hexToRgba(tint, 0.55);
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.moveTo(cx - R * 0.75, cy + R * 0.55);
  ctx.lineTo(cx - R * 1.5, y);
  ctx.moveTo(cx + R * 0.75, cy + R * 0.55);
  ctx.lineTo(cx + R * 1.5, y);
  ctx.stroke();

  ctx.globalCompositeOperation = 'lighter';
  drawBlob(cx, y, R * 4.5, tint, 0.12 + game.intensity * 0.1);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
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

  drawDensity(s);

  let cursor = 32 + drawCombo(padX, padY + Math.round(32 * s), s);
  cursor += drawPerkChips(padX, padY + Math.round(cursor * s), s);
  drawBuffChips(padX, padY + Math.round(cursor * s), s);

  // Chrono, centré : le coin droit appartient au coupe-son.
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(232,246,255,0.55)';
  ctx.font = `600 ${Math.round(15 * s)}px ui-sans-serif, system-ui, sans-serif`;
  ctx.fillText(formatTime(game.time), view.w / 2, padY + 6);
}

function announceDensity(level) {
  game.levelFlash = 1;
  sfxDensity();
  shockRing('#8ecae6', view.coreRadius * 3, 0.45, 2);

  // Tous les dix paliers la caméra recule : ça mérite d'être annoncé, sinon
  // l'écran qui s'éloigne passe pour un bug d'affichage.
  if (zoomFor(level) < zoomFor(level - 1)) {
    showBanner('ZONE ÉLARGIE', `Niveau ${level} — tu vois venir de plus loin`, '#8ecae6');
    shockRing('#8ecae6', view.viewRadius * 0.8, 0.9, 3);
    sfxUnlock();
  }
}

/**
 * Indicateur de densité, en haut à droite sous le coupe-son.
 *
 * Le niveau donne le repère, le coefficient dit ce qu'il vaut concrètement
 * (×2,4 = deux fois et demie plus d'ennemis qu'au départ), et la barre montre
 * ce qu'il reste avant le palier suivant.
 */
function drawDensity(s) {
  const x = view.w - (18 + Math.max(view.safe.left, view.safe.right));
  const y = view.safe.top + 63;
  const flash = game.levelFlash;
  const color = flash > 0.02 ? '#ffffff' : '#8ecae6';

  ctx.textAlign = 'right';
  ctx.textBaseline = 'alphabetic';

  ctx.globalAlpha = 0.5 + flash * 0.5;
  ctx.fillStyle = 'rgba(232,246,255,0.6)';
  ctx.font = `700 ${Math.round(8.5 * s)}px ui-sans-serif, system-ui, sans-serif`;
  ctx.fillText('DENSITÉ', x, y);

  ctx.globalAlpha = 1;
  ctx.fillStyle = color;
  ctx.font = `800 ${Math.round(16 * s)}px ui-sans-serif, system-ui, sans-serif`;
  const niv = `NIV ${game.level}`;
  ctx.fillText(niv, x, y + 17 * s);

  ctx.fillStyle = hexToRgba('#8ecae6', 0.75);
  ctx.font = `700 ${Math.round(10.5 * s)}px ui-sans-serif, system-ui, sans-serif`;
  // Une décimale tant que c'est utile, puis l'entier : ×46,3 devient illisible
  // et n'apprend rien de plus que ×46.
  const f = densityFactor(game.level);
  ctx.fillText(`×${f < 10 ? f.toFixed(1) : Math.round(f)}`,
    x - ctx.measureText(niv).width - 44 * s, y + 16 * s);

  // Barre d'avancement vers le palier suivant.
  const barW = 62 * s;
  const barY = y + 23 * s;
  ctx.fillStyle = hexToRgba('#8ecae6', 0.16);
  ctx.fillRect(x - barW, barY, barW, 3 * s);
  ctx.fillStyle = hexToRgba(color, 0.85);
  ctx.fillRect(x - barW, barY, barW * densityProgress(), 3 * s);

  ctx.textBaseline = 'top';
}

/**
 * Série en cours : multiplicateur, nom du palier, nombre de kills enchaînés,
 * et une barre qui se vide — le temps qu'il reste pour la prolonger.
 * Renvoie la hauteur occupée, en unités d'échelle.
 */
function drawCombo(x, y, s) {
  if (game.combo === 0) return 4;

  const tier = comboTier(game.multiplier);
  const frac = clamp(game.comboTimer / CFG.combo.window, 0, 1);
  // L'urgence se lit avant même de regarder la barre.
  const urgent = frac < 0.3;
  const blink = urgent ? 0.55 + 0.45 * Math.sin(game.corePulse * 14) : 1;

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  ctx.globalAlpha = blink;
  ctx.fillStyle = tier.color;
  ctx.font = `800 ${Math.round(21 * s)}px ui-sans-serif, system-ui, sans-serif`;
  const mult = `×${game.multiplier}`;
  ctx.fillText(mult, x, y + 17 * s);

  const nameX = x + ctx.measureText(mult).width + 7 * s;
  ctx.font = `700 ${Math.round(11 * s)}px ui-sans-serif, system-ui, sans-serif`;
  if (tier.name) ctx.fillText(tier.name, nameX, y + 16 * s);

  ctx.globalAlpha = 0.6 * blink;
  ctx.font = `600 ${Math.round(10 * s)}px ui-sans-serif, system-ui, sans-serif`;
  ctx.fillText(`${game.combo} enchaînés`, nameX, y + 5 * s);

  // Barre de fenêtre
  const barW = 96 * s;
  const barY = y + 23 * s;
  ctx.globalAlpha = 1;
  ctx.fillStyle = hexToRgba(tier.color, 0.16);
  ctx.fillRect(x, barY, barW, 3 * s);
  ctx.fillStyle = hexToRgba(tier.color, blink);
  ctx.fillRect(x, barY, barW * frac, 3 * s);

  ctx.globalAlpha = 1;
  ctx.textBaseline = 'top';
  return 34;
}

/**
 * Améliorations définitives : pas de barre, elles ne s'épuisent pas. Juste
 * leur nom et, si elles se cumulent, le nombre de prises.
 */
function drawPerkChips(x, y, s) {
  const ids = Object.keys(game.perks);
  if (!ids.length) return 0;

  const h = Math.round(13 * s);
  const gap = Math.round(4 * s);
  let col = x;

  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = `700 ${Math.round(8.5 * s)}px ui-sans-serif, system-ui, sans-serif`;

  for (const id of ids) {
    const def = BONUSES[id];
    const n = game.perks[id];
    const label = n > 1 ? `${def.short} ×${n}` : def.short;
    const w = ctx.measureText(label).width + 13 * s;

    ctx.fillStyle = hexToRgba(def.color, 0.18);
    ctx.fillRect(col, y, w, h);
    ctx.fillStyle = def.color;
    ctx.fillRect(col, y, 2, h);
    ctx.globalAlpha = 0.9;
    ctx.fillText(label, col + 6 * s, y + h / 2 + 0.5);
    ctx.globalAlpha = 1;

    col += w + gap;
  }

  ctx.textBaseline = 'top';
  return 13 + 5;
}

/** Effets en cours, avec leur temps restant sous forme de barre qui fond. */
function drawBuffChips(x, y, s) {
  const h = Math.round(15 * s);
  const gap = Math.round(5 * s);
  let row = 0;

  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = `700 ${Math.round(9.5 * s)}px ui-sans-serif, system-ui, sans-serif`;

  for (const id in game.buffs) {
    const def = BONUSES[id];
    const frac = clamp(game.buffs[id] / def.duration, 0, 1);
    const top = y + row * (h + gap);
    const label = def.name.toUpperCase();
    const wpx = Math.max(ctx.measureText(label).width + 16 * s, 58 * s);

    ctx.fillStyle = hexToRgba(def.color, 0.14);
    ctx.fillRect(x, top, wpx, h);
    ctx.fillStyle = hexToRgba(def.color, 0.32);
    ctx.fillRect(x, top, wpx * frac, h);   // la barre se vide avec le temps

    ctx.fillStyle = def.color;
    ctx.fillRect(x, top, 2, h);
    ctx.fillText(label, x + 7 * s, top + h / 2 + 0.5);
    row++;
  }

  ctx.textBaseline = 'top';
}

function formatTime(t) {
  const m = Math.floor(t / 60);
  const sec = Math.floor(t % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

/** Halo rouge en bord d'écran quand le noyau est en danger. */
function drawDangerVignette() {
  if (game.state !== STATE.PLAYING) return;
  const hpFrac = game.hp / game.hpMax;
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
  fan: '<path d="M4.5 20 8.5 6"/><path d="M17.5 20 13.5 6"/>',
  lance: '<path d="M11 20V9"/><path d="M11 2 7.5 9h7z" fill="currentColor" stroke="none"/>',
  rear: '<path d="M11 2v8"/><path d="M11 20l3.5-7h-7z" fill="currentColor" stroke="none"/>',
  chain: '<path d="M12.5 2 6 11.5h4L8.5 20 16 9.5h-4.5z" fill="currentColor" stroke="none"/>',
  mines: '<circle cx="11" cy="11" r="2.4" fill="currentColor" stroke="none"/>'
       + '<circle cx="11" cy="11" r="8"/>'
       + '<circle cx="11" cy="3" r="1.9" fill="currentColor" stroke="none"/>'
       + '<circle cx="17.9" cy="15" r="1.9" fill="currentColor" stroke="none"/>'
       + '<circle cx="4.1" cy="15" r="1.9" fill="currentColor" stroke="none"/>',
  orbit: '<circle cx="11" cy="11" r="3" fill="currentColor" stroke="none"/>'
       + '<ellipse cx="11" cy="11" rx="9" ry="4.2"/>'
       + '<circle cx="20" cy="11" r="1.7" fill="currentColor" stroke="none"/>'
       + '<circle cx="2" cy="11" r="1.7" fill="currentColor" stroke="none"/>',
};

function weaponGlyph(id) {
  return `<svg class="glyph" width="19" height="19" viewBox="0 0 22 22" aria-hidden="true"
    fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
    ${WEAPON_GLYPHS[id]}</svg>`;
}

/*
 * Les armes se cumulant, la barre n'est plus un sélecteur mais l'état de
 * l'arsenal : ce qui tire s'allume, le reste affiche le score à atteindre.
 */
function renderWeaponBar() {
  weaponBar.innerHTML = WEAPONS.map((w, i) => {
    const open = game.unlocked[i];
    const label = open
      ? `${w.name} — ${w.blurb}`
      : `${w.name}, se débloque à ${w.unlock} points`;
    return `<div class="wpn${open ? ' active' : ''}" data-i="${i}"
      style="--w:${w.color};--w-dim:${hexToRgba(w.color, 0.25)}"
      role="img" aria-label="${label}" title="${label}"
      >${weaponGlyph(w.id)}</div>`;
  }).join('');
  updateWeaponProgress();
}

/*
 * Remplissage des pastilles verrouillées. Le score change à chaque kill mais
 * toucher le DOM à chaque image serait du gaspillage : on rafraîchit à 4 Hz,
 * la transition CSS lisse le reste.
 */
let progressTimer = 0;

function updateWeaponProgress() {
  const chips = weaponBar.children;
  for (let i = 0; i < chips.length; i++) {
    if (game.unlocked[i]) continue;
    const from = i > 0 ? WEAPONS[i - 1].unlock : 0;
    const span = WEAPONS[i].unlock - from;
    const p = clamp((game.score - from) / (span || 1), 0, 1);
    chips[i].style.setProperty('--p', p.toFixed(3));
  }
}

/* ------------------------------------------------------------------ *
 *  Réglage de visée
 * ------------------------------------------------------------------ */

const AIM_OPTIONS = [
  { id: 'pouce', name: 'Pouce', hint: 'Le doigt pose un manche et pousse dans la direction. Rien ne masque l\'écran.' },
  { id: 'direct', name: 'Directe', hint: 'On vise l\'endroit qu\'on touche. Plus immédiat, mais le doigt gêne.' },
];

function modeSelectorHtml() {
  const buttons = Object.keys(MODES).map((id) => `
    <button type="button" class="mode-opt" data-mode="${id}"
      aria-pressed="${gameMode === id}">
      <span>${MODES[id].name}</span><span class="hint-sm">${MODES[id].hint}</span>
    </button>`).join('');
  return `<div class="seg-label">Terrain</div><div class="seg">${buttons}</div>`;
}

function wireModeSelector() {
  panel.querySelectorAll('.mode-opt').forEach((btn) => {
    btn.addEventListener('click', () => {
      setGameMode(btn.dataset.mode);
      panel.querySelectorAll('.mode-opt').forEach((b) => {
        b.setAttribute('aria-pressed', String(b.dataset.mode === gameMode));
      });
      audioInit();
      sfxSwitch();
    });
  });
}

function aimSelectorHtml() {
  const buttons = AIM_OPTIONS.map((o) => `
    <button type="button" class="aim-opt" data-aim="${o.id}"
      aria-pressed="${aimMode === o.id}">
      <span>${o.name}</span><span class="hint-sm">${o.hint}</span>
    </button>`).join('');
  return `<div class="seg-label">Visée</div><div class="seg">${buttons}</div>`;
}

/** À rappeler après chaque écriture d'un panneau contenant le sélecteur. */
function wireAimSelector() {
  panel.querySelectorAll('.aim-opt').forEach((btn) => {
    btn.addEventListener('click', () => {
      setAimMode(btn.dataset.aim);
      panel.querySelectorAll('.aim-opt').forEach((b) => {
        b.setAttribute('aria-pressed', String(b.dataset.aim === aimMode));
      });
      audioInit();
      sfxSwitch();
    });
  });
}

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

/** Bandeau d'annonce, partagé par les déblocages d'armes et les bonus. */
function showBanner(title, sub, color) {
  toast.hidden = false;
  toast.style.setProperty('--t', color);
  toast.innerHTML = `<span class="t-title">${title}</span>`
                  + `<span class="t-sub">${sub}</span>`;

  // Redémarre l'animation même si un bandeau est déjà en cours.
  toast.classList.remove('show');
  void toast.offsetWidth;
  toast.classList.add('show');
}

function announceUnlock(w) {
  showBanner(`${w.name} débloqué`, w.blurb, w.color);
  shockRing(w.color, view.spawnRadius * 0.55, 0.8, 3);
  addFlash(view.cx, view.cy, view.coreRadius * 7, w.color, 0.6);
  screenFlash(w.color, 0.3);
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
      Garde le doigt sur l'écran : le rayon suit ta direction.<br>
      <b>Balaie</b> pour découper tout ce qui approche.<br>
      Les points débloquent des <b>armes qui se cumulent</b>, et les ennemis
      lâchent des <b>bonus</b> à ramasser d'un coup de rayon.
    </div>
    ${modeSelectorHtml()}
    ${aimSelectorHtml()}
    ${game.best > 0 ? `
      <div class="scores">
        <div class="score-block best">
          <div class="label">Record</div>
          <div class="value">${game.best}</div>
        </div>
      </div>` : ''}
    <button type="button" id="btn-primary">Jouer</button>
  `;
  wireModeSelector();
  wireAimSelector();
  document.getElementById('btn-primary').addEventListener('click', startGame);
}

function showPause() {
  overlay.hidden = false;
  weaponBar.hidden = true;
  panel.className = 'panel';
  panel.innerHTML = `
    <div class="title">PAUSE</div>
    <div class="subtitle">partie en cours</div>
    ${aimSelectorHtml()}
    <button type="button" id="btn-primary">Reprendre</button>
  `;
  wireAimSelector();
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

  // Une exception dans une image ne doit pas figer la partie pour de bon :
  // sans ce `finally`, la boucle ne se réarmait jamais et l'écran restait
  // gelé sur la dernière image rendue.
  try {
    update(dt);
    render(dt);
  } catch (err) {
    console.error('image ignorée :', err);
  } finally {
    if (dt > 0) updatePerf(dt);
    requestAnimationFrame(frame);
  }
}

window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 120));

resize();
renderSoundButton();
showMenu();
requestAnimationFrame(frame);

/* Poignée de débogage : permet d'inspecter l'état depuis la console. */
window.VIRGULE = { game, view, input, audio, perf, spawnDistance, densityInterval, zoomFor, MODES, CFG, ENEMY_TYPES, WEAPONS, BONUSES, COMBO_TIERS };
