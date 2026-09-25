/**
 * NEON RUNNER — mobile horizontal scroll shooter
 * Tap = shoot · Swipe up = jump
 */

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

const overlay = document.getElementById("overlay");
const gameover = document.getElementById("gameover");
const hud = document.getElementById("hud");
const hint = document.getElementById("hint");
const scoreEl = document.getElementById("score");
const distEl = document.getElementById("dist");
const hpEl = document.getElementById("hp");
const finalScore = document.getElementById("finalScore");
const finalDist = document.getElementById("finalDist");

const STATE = { MENU: "menu", PLAY: "play", OVER: "over" };
let state = STATE.MENU;

const assets = {
  player: { run: [], jump: [], idle: [], face: { run: [], jump: [], idle: [] } },
  gun: null,
  gunPivot: { x: 2, y: 23 },
  gunNative: { w: 60, h: 46, srcW: 130, srcH: 154, pivotSrcX: 70, pivotSrcY: 76, barrelLen: 55 },
  walker: { run: null },
  drone: [],
  bosses: { titan: [], helldrone: [], spikecore: [] },
  bg: {},
  fx: { shot: [], boom: [] },
};

const game = {
  scroll: 0,
  speed: 220,
  score: 0,
  distance: 0,
  time: 0,
  shake: 0,
  spawnTimer: 0,
  obstacleTimer: 1.5,
  rain: [],
  hitFlash: 0,
  hitLabel: "",
  nextBossAt: 200,
  bossIndex: 0,
  bossWarn: 0,
  bossIntro: "",
};

/** Каталог боссов. Очередь и дистанция — в settings. */
const BOSS_DEFS = {
  helldrone: {
    id: "helldrone",
    name: "HELLDRONE",
    title: "ШТУРМОВОЙ ДРОН",
    color: "#ff5a1f",
    baseHp: 75,
  },
  titan: {
    id: "titan",
    name: "TITAN-07",
    title: "ШТУРМОВОЙ МЕХ",
    color: "#ff2bd6",
    baseHp: 85,
  },
  spikecore: {
    id: "spikecore",
    name: "SPIKE-CORE",
    title: "ШИПОВОЕ ЯДРО",
    color: "#c0ff3e",
    baseHp: 95,
  },
};

const SETTINGS_KEY = "neonRunnerBossSettings_v3";
const settings = {
  bossEvery: 200,
  bossOrder: ["spikecore", "helldrone", "titan"],
};

function getBossRoster() {
  return settings.bossOrder.map((id) => BOSS_DEFS[id]).filter(Boolean);
}

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (typeof data.bossEvery === "number" && data.bossEvery > 0) {
      settings.bossEvery = data.bossEvery;
    }
    if (Array.isArray(data.bossOrder) && data.bossOrder.length) {
      const valid = data.bossOrder.filter((id) => BOSS_DEFS[id]);
      const missing = Object.keys(BOSS_DEFS).filter((id) => !valid.includes(id));
      settings.bossOrder = [...valid, ...missing];
    }
  } catch (_) {
    /* ignore */
  }
}

function saveSettings() {
  try {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({
        bossEvery: settings.bossEvery,
        bossOrder: settings.bossOrder,
      })
    );
  } catch (_) {
    /* ignore */
  }
}

function syncSettingsUI() {
  const everyEl = document.getElementById("bossEvery");
  if (everyEl) everyEl.value = String(settings.bossEvery);
  renderBossOrderUI();
}

function renderBossOrderUI() {
  const list = document.getElementById("bossOrderList");
  if (!list) return;
  list.innerHTML = "";
  settings.bossOrder.forEach((id, i) => {
    const def = BOSS_DEFS[id];
    if (!def) return;
    const row = document.createElement("div");
    row.className = "boss-order-item";
    row.innerHTML = `
      <span class="idx">${i + 1}.</span>
      <span class="name" style="color:${def.color}">${def.name}</span>
      <span class="moves">
        <button type="button" data-move="up" data-i="${i}" aria-label="выше">↑</button>
        <button type="button" data-move="down" data-i="${i}" aria-label="ниже">↓</button>
      </span>`;
    list.appendChild(row);
  });
}

function initSettingsUI() {
  loadSettings();
  const panel = document.getElementById("settings");
  const debug = new URLSearchParams(location.search).has("debug");
  if (!debug) {
    if (panel) panel.classList.add("hidden");
    return;
  }
  if (panel) panel.classList.remove("hidden");
  syncSettingsUI();
  const everyEl = document.getElementById("bossEvery");
  if (everyEl) {
    everyEl.addEventListener("change", () => {
      settings.bossEvery = Math.max(50, Number(everyEl.value) || 100);
      saveSettings();
    });
  }
  const list = document.getElementById("bossOrderList");
  if (list) {
    list.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-move]");
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      const i = Number(btn.dataset.i);
      const dir = btn.dataset.move === "up" ? -1 : 1;
      const j = i + dir;
      if (j < 0 || j >= settings.bossOrder.length) return;
      const tmp = settings.bossOrder[i];
      settings.bossOrder[i] = settings.bossOrder[j];
      settings.bossOrder[j] = tmp;
      saveSettings();
      renderBossOrderUI();
    });
  }
}

const POWER = {
  spread: { id: "spread", label: "SPREAD", color: "#ff2bd6", dur: 9 },
  autofire: { id: "autofire", label: "AUTO", color: "#2de2e6", dur: 8 },
  shield: { id: "shield", label: "SHIELD", color: "#7af7ff", dur: 7 },
  heal: { id: "heal", label: "+HP", color: "#5dff8a", dur: 0 },
};

const player = {
  x: 0,
  y: 0,
  w: 90,
  h: 106,
  vy: 0,
  onGround: true,
  hp: 3,
  maxHp: 3,
  invuln: 0,
  shootTimer: 0,
  anim: "run",
  frame: 0,
  frameT: 0,
  shootFlash: 0,
  aimAngle: 0,
  aimTarget: 0,
  lastAimX: 0,
  lastAimY: 0,
  slideT: 0,
  slideFrame: 0,
  power: { spread: 0, autofire: 0, shield: 0 },
};

/** @type {Array} */
let bullets = [];
/** @type {Array} */
let rockets = [];
/** @type {Array} */
let enemies = [];
/** @type {Array} */
let obstacles = [];
/** @type {Array} */
let pickups = [];
/** @type {Array} */
let particles = [];
/** @type {Array} */
let floats = [];
/** @type {object|null} */
let boss = null;
/** @type {Array} */
let hazards = [];

const GROUND_RATIO = 0.82;
const GRAVITY = 2200;
const JUMP_V = -920;
const SWIPE_MIN = 24;
const SLIDE_DUR = 0.62;
/** Кадры бега, где ноги вместе (цикл 0–14). */
const SLIDE_LEG_FRAMES = [0, 14];

function nearestSlideFrame(frame) {
  let best = SLIDE_LEG_FRAMES[0];
  let bestD = 99;
  const len = 15;
  for (const f of SLIDE_LEG_FRAMES) {
    const d = Math.min(Math.abs(frame - f), len - Math.abs(frame - f));
    if (d < bestD) {
      bestD = d;
      best = f;
    }
  }
  return best;
}

function groundY() {
  return lh() * GROUND_RATIO;
}

/** Линия, на которой стоят ноги (чуть ниже неонового бордюра, на асфальте). */
function standY() {
  return groundY() + 10;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(src));
    img.src = src;
  });
}

async function loadSequence(dir, prefix, count, pad = 3) {
  const list = [];
  for (let i = 0; i < count; i++) {
    const n = String(i).padStart(pad, "0");
    list.push(await loadImage(`${dir}/${prefix}${n}.png`));
  }
  return list;
}

/** Кадры frame_01.png … frame_NN.png */
async function loadNumberedFrames(dir, count) {
  const list = [];
  for (let i = 1; i <= count; i++) {
    const n = String(i).padStart(2, "0");
    list.push(await loadImage(`${dir}/frame_${n}.png`));
  }
  return list;
}

/** Make near-black pixels transparent (enemy sheets). */
function chromaKey(img, threshold = 18) {
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  const g = c.getContext("2d");
  g.drawImage(img, 0, 0);
  const data = g.getImageData(0, 0, c.width, c.height);
  const d = data.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i] < threshold && d[i + 1] < threshold && d[i + 2] < threshold) {
      d[i + 3] = 0;
    }
  }
  g.putImageData(data, 0, 0);
  return c;
}

/** Слой лица/головы (рисуется поверх пушки). */
function cropFace(img) {
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  const g = c.getContext("2d");
  // только голова — тот же размер холста, чтобы совпало с телом
  const sx = 16;
  const sy = 0;
  const sw = 62;
  const sh = 72;
  g.drawImage(img, sx, sy, sw, sh, sx, sy, sw, sh);
  return c;
}

/** Убрать только ствол пушки со спрайта (лицо/голова остаются). */
function stripBuiltinGun(img) {
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  const g = c.getContext("2d");
  g.drawImage(img, 0, 0);
  // только область ствола справа, без головы
  const x0 = Math.floor(img.width * 0.54);
  const y0 = Math.floor(img.height * 0.34);
  const y1 = Math.floor(img.height * 0.64);
  g.clearRect(x0, y0, img.width - x0, y1 - y0);
  return c;
}

/** Вырезать только ствол (без лица). */
function cropGun(img) {
  // MarkRun 130x154: ствол ~ (68,53)-(125,97), лицо левее/выше
  const sx = 68;
  const sy = 53;
  const sw = 60;
  const sh = 46;
  const c = document.createElement("canvas");
  c.width = sw;
  c.height = sh;
  const g = c.getContext("2d");
  g.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
  // шарнир у основания ствола (в кропе)
  assets.gunPivot = { x: 70 - sx, y: 76 - sy }; // ~ (2, 23)
  assets.gunNative = {
    w: sw,
    h: sh,
    srcW: img.width,
    srcH: img.height,
    pivotSrcX: 70,
    pivotSrcY: 76,
    barrelLen: 55,
  };
  return c;
}

function mapFrames(list, fn) {
  return list.map(fn);
}

async function loadAll() {
  const [
    run,
    jump,
    idle,
    walkerRun,
    d1,
    d2,
    d3,
    d4,
    bg1,
    bg2,
    bg3,
    skyA,
    skyB,
    buildings,
    near,
    shot1,
    shot2,
    shot3,
    boom1,
    boom2,
    boom3,
    boom4,
    boom5,
    boom6,
    titanFrames,
    helldroneFrames,
    spikecoreFrames,
  ] = await Promise.all([
    loadSequence("assets/player/run", "MarkRun_", 15),
    loadSequence("assets/player/jump", "JumpMark_", 15),
    loadSequence("assets/player/idle", "IdleMark_", 15),
    loadImage("assets/enemies/walker/Enemy1_run.png"),
    loadImage("assets/enemies/drone/drone-1.png"),
    loadImage("assets/enemies/drone/drone-2.png"),
    loadImage("assets/enemies/drone/drone-3.png"),
    loadImage("assets/enemies/drone/drone-4.png"),
    loadImage("assets/bg/bg-1.png"),
    loadImage("assets/bg/bg-2.png"),
    loadImage("assets/bg/bg-3.png"),
    loadImage("assets/bg/skyline-a.png"),
    loadImage("assets/bg/skyline-b.png"),
    loadImage("assets/bg/buildings-bg.png"),
    loadImage("assets/bg/near-buildings-bg.png"),
    loadImage("assets/fx/shot-1.png"),
    loadImage("assets/fx/shot-2.png"),
    loadImage("assets/fx/shot-3.png"),
    loadImage("assets/fx/enemy-explosion-1.png"),
    loadImage("assets/fx/enemy-explosion-2.png"),
    loadImage("assets/fx/enemy-explosion-3.png"),
    loadImage("assets/fx/enemy-explosion-4.png"),
    loadImage("assets/fx/enemy-explosion-5.png"),
    loadImage("assets/fx/enemy-explosion-6.png"),
    loadNumberedFrames("assets/bosses/titan", 10),
    loadNumberedFrames("assets/bosses/helldrone", 8),
    loadNumberedFrames("assets/bosses/spikecore", 7),
  ]);

  assets.player.face.run = mapFrames(run, cropFace);
  assets.player.face.jump = mapFrames(jump, cropFace);
  assets.player.face.idle = mapFrames(idle, cropFace);
  assets.player.run = mapFrames(run, stripBuiltinGun);
  assets.player.jump = mapFrames(jump, stripBuiltinGun);
  assets.player.idle = mapFrames(idle, stripBuiltinGun);
  assets.gun = cropGun(run[0]);
  assets.walker.run = chromaKey(walkerRun);
  assets.drone = [d1, d2, d3, d4];
  assets.bosses.titan = titanFrames.map((img) => chromaKey(img, 14));
  assets.bosses.helldrone = helldroneFrames.map((img) => chromaKey(img, 14));
  assets.bosses.spikecore = spikecoreFrames.map((img) => chromaKey(img, 14));
  assets.bg = { bg1, bg2, bg3, skyA, skyB, buildings, near };
  assets.fx.shot = [shot1, shot2, shot3];
  assets.fx.boom = [boom1, boom2, boom3, boom4, boom5, boom6];
}

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.floor(window.innerWidth * dpr);
  canvas.height = Math.floor(window.innerHeight * dpr);
  canvas.style.width = `${window.innerWidth}px`;
  canvas.style.height = `${window.innerHeight}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  // logical size for gameplay uses CSS pixels
  canvas._lw = window.innerWidth;
  canvas._lh = window.innerHeight;
}

function lw() {
  return canvas._lw || window.innerWidth;
}
function lh() {
  return canvas._lh || window.innerHeight;
}

function resetGame() {
  game.scroll = 0;
  game.speed = 220;
  game.score = 0;
  game.distance = 0;
  game.time = 0;
  game.shake = 0;
  game.spawnTimer = 0.8;
  game.obstacleTimer = 2.2;
  game.hitFlash = 0;
  game.hitLabel = "";
  game.nextBossAt = settings.bossEvery;
  game.bossIndex = 0;
  game.bossWarn = 0;
  game.bossIntro = "";
  bullets = [];
  rockets = [];
  enemies = [];
  obstacles = [];
  pickups = [];
  particles = [];
  floats = [];
  boss = null;
  hazards = [];
  player.x = lw() * 0.18;
  player.y = standY() - player.h;
  player.vy = 0;
  player.onGround = true;
  player.hp = player.maxHp;
  player.invuln = 0;
  player.shootTimer = 0;
  player.anim = "run";
  player.frame = 0;
  player.frameT = 0;
  player.shootFlash = 0;
  player.aimAngle = 0;
  player.aimTarget = 0;
  player.lastAimX = player.x + 400;
  player.lastAimY = player.y + player.h * 0.4;
  player.slideT = 0;
  player.slideFrame = 0;
  player.power = { spread: 0, autofire: 0, shield: 0 };
  initRain();
  updateHud();
}

function initRain() {
  game.rain = [];
  const n = Math.floor(lw() / 8);
  for (let i = 0; i < n; i++) {
    game.rain.push({
      x: Math.random() * lw(),
      y: Math.random() * lh(),
      len: 8 + Math.random() * 14,
      spd: 420 + Math.random() * 380,
    });
  }
}

function updateHud() {
  scoreEl.textContent = String(game.score);
  distEl.textContent = String(Math.floor(game.distance));
  hpEl.innerHTML = "";
  for (let i = 0; i < player.maxHp; i++) {
    const pip = document.createElement("div");
    pip.className = "pip" + (i < player.hp ? "" : " empty");
    hpEl.appendChild(pip);
  }
  const buffs = document.getElementById("buffs");
  if (buffs) {
    buffs.innerHTML = "";
    for (const key of ["shield", "spread", "autofire"]) {
      const t = player.power[key];
      if (t > 0.05) {
        const def = POWER[key];
        const el = document.createElement("div");
        el.className = "buff";
        el.style.color = def.color;
        el.textContent = `${def.label} ${Math.ceil(t)}`;
        buffs.appendChild(el);
      }
    }
  }
}

function jump() {
  if (!player.onGround || state !== STATE.PLAY) return;
  if (player.slideT > 0) return;
  player.vy = JUMP_V;
  player.onGround = false;
  player.anim = "jump";
  // пропускаем кадры «приседания» — сразу полёт
  player.frame = 4;
  player.frameT = 0;
}

function slide() {
  if (state !== STATE.PLAY) return;
  if (!player.onGround || player.slideT > 0) return;
  player.slideT = SLIDE_DUR;
  player.vy = 0;
  player.anim = "run";
  // берём ближайший кадр бега с ногами вместе
  player.slideFrame = nearestSlideFrame(player.frame);
  player.frame = player.slideFrame;
  player.frameT = 0;
  for (let i = 0; i < 8; i++) {
    particles.push({
      x: player.x + player.w * 0.3,
      y: player.y + player.h - 4,
      vx: -40 - Math.random() * 120,
      vy: -20 - Math.random() * 60,
      life: 0.25 + Math.random() * 0.2,
      color: ["#2de2e6", "#ff2bd6", "#888"][i % 3],
      size: 2 + Math.random() * 2,
    });
  }
}

/** Угол наклона при подкате: плавно из бега влёжа / подъём. */
function slideTilt() {
  if (player.slideT > 0) {
    const u = 1 - player.slideT / SLIDE_DUR;
    const ease = (x) => 1 - (1 - Math.min(1, Math.max(0, x))) ** 2;
    if (u < 0.28) return (-Math.PI / 2) * ease(u / 0.28);
    if (u > 0.78) return (-Math.PI / 2) * (1 - ease((u - 0.78) / 0.22));
    return -Math.PI / 2;
  }
  return 0;
}

/** Параметры отрисовки подката — поворот вокруг центра (без уезда вперёд). */
function getSlideDrawPose() {
  const tilt = slideTilt();
  const t = Math.abs(tilt) / (Math.PI / 2);
  const cx = player.x + player.w * 0.5;
  const cyUpright = player.y + player.h * 0.5;
  // влёжа чуть опускаем центр, чтобы лежать на земле, X не смещаем
  const cyProne = player.y + player.h - player.w * 0.5;
  return {
    tilt,
    t,
    pivotX: cx,
    pivotY: cyUpright + (cyProne - cyUpright) * t,
    ox: -player.w * 0.5,
    oy: -player.h * 0.5,
  };
}

/** Точка на спрайте игрока → мир с учётом наклона подката. */
function playerLocalToWorld(ox, oy) {
  const tilt = slideTilt();
  if (Math.abs(tilt) < 0.08) {
    return { x: player.x + ox, y: player.y + oy };
  }
  const pose = getSlideDrawPose();
  // локально относительно центра спрайта
  const lx = ox - player.w * 0.5;
  const ly = oy - player.h * 0.5;
  const c = Math.cos(pose.tilt);
  const s = Math.sin(pose.tilt);
  return {
    x: pose.pivotX + lx * c - ly * s,
    y: pose.pivotY + lx * s + ly * c,
  };
}

/** Точка основания ствола — шарнир пушки (не голова). */
function getGunPivot() {
  const sx = player.w / assets.gunNative.srcW;
  const sy = player.h / assets.gunNative.srcH;
  const ox = assets.gunNative.pivotSrcX * sx;
  const oy = assets.gunNative.pivotSrcY * sy;
  return playerLocalToWorld(ox, oy);
}

/** Дуло = шарнир + длина ствола в направлении aimAngle (мир). */
function getMuzzle() {
  const p = getGunPivot();
  const sx = player.w / assets.gunNative.srcW;
  const barrel = assets.gunNative.barrelLen * sx;
  return {
    x: p.x + Math.cos(player.aimAngle) * barrel,
    y: p.y + Math.sin(player.aimAngle) * barrel,
  };
}

function shoot(aimX, aimY) {
  if (state !== STATE.PLAY || player.shootTimer > 0) return;
  player.shootTimer = player.power.autofire > 0 ? 0.1 : 0.18;
  player.shootFlash = 0.1;

  const pivot = getGunPivot();
  const tx = aimX ?? (player.lastAimX || pivot.x + 200);
  const ty = aimY ?? (player.lastAimY || pivot.y);
  player.lastAimX = tx;
  player.lastAimY = ty;

  let dx = tx - pivot.x;
  let dy = ty - pivot.y;
  let ang = Math.atan2(dy, dx);
  ang = Math.max(-1.2, Math.min(1.2, ang));
  player.aimTarget = ang;
  player.aimAngle = ang;

  const { x: muzzleX, y: muzzleY } = getMuzzle();
  const speed = 780;
  const angles = player.power.spread > 0 ? [ang - 0.28, ang, ang + 0.28] : [ang];

  for (const a of angles) {
    const c = Math.cos(a);
    const s = Math.sin(a);
    bullets.push({
      x: muzzleX + c * 8,
      y: muzzleY + s * 8,
      vx: c * speed,
      vy: s * speed,
      angle: a,
      life: 1.2,
      w: 22,
      h: 10,
      friendly: true,
    });
  }
  const c0 = Math.cos(ang);
  const s0 = Math.sin(ang);
  for (let i = 0; i < 5; i++) {
    particles.push({
      x: muzzleX,
      y: muzzleY,
      vx: c0 * (90 + Math.random() * 100) + (Math.random() - 0.5) * 40,
      vy: s0 * (90 + Math.random() * 100) + (Math.random() - 0.5) * 40,
      life: 0.18 + Math.random() * 0.12,
      color: Math.random() > 0.5 ? "#2de2e6" : "#ff2bd6",
      size: 2 + Math.random() * 2,
    });
  }
}

/* ---------- Input: tap / swipe ---------- */
const touch = {
  x: 0,
  y: 0,
  aimX: 0,
  aimY: 0,
  t: 0,
  active: false,
  gestured: false,
  didAutofire: false,
  suppressMouseUntil: 0,
  pointerType: "",
};

function isStaleMouse(e) {
  return (
    (e.type === "mousedown" || e.type === "mousemove" || e.type === "mouseup") &&
    performance.now() < touch.suppressMouseUntil
  );
}

function clearPointerState() {
  touch.active = false;
  touch.gestured = false;
  touch.didAutofire = false;
}

function onPointerDown(e) {
  if (isStaleMouse(e)) return;
  if (e.cancelable) e.preventDefault();
  const p = e.touches ? e.touches[0] : e;
  touch.x = p.clientX;
  touch.y = p.clientY;
  touch.aimX = p.clientX;
  touch.aimY = p.clientY;
  touch.t = performance.now();
  touch.active = true;
  touch.gestured = false;
  touch.didAutofire = false;
  touch.pointerType = e.touches ? "touch" : "mouse";
  // тап впереди героя — новое направление (палец слева только «держит» огонь)
  if (state === STATE.PLAY && p.clientX > player.x + player.w * 0.4) {
    player.lastAimX = p.clientX;
    player.lastAimY = p.clientY;
  }
}

function trySwipeGesture(clientX, clientY) {
  if (!touch.active || touch.gestured || state !== STATE.PLAY) return false;
  const dy = clientY - touch.y;
  const dx = clientX - touch.x;
  if (Math.abs(dy) <= Math.abs(dx) * 0.7) return false;
  if (dy < -SWIPE_MIN) {
    touch.gestured = true;
    jump();
    return true;
  }
  if (dy > SWIPE_MIN) {
    touch.gestured = true;
    slide();
    return true;
  }
  return false;
}

function updateAimFromPointer(clientX, clientY) {
  touch.aimX = clientX;
  touch.aimY = clientY;
  // тянем прицел, только если палец в зоне стрельбы впереди
  if (clientX > player.x + player.w * 0.4) {
    player.lastAimX = clientX;
    player.lastAimY = clientY;
  }
}

function onPointerMove(e) {
  if (!touch.active) return;
  if (isStaleMouse(e)) return;
  if (e.cancelable) e.preventDefault();
  const p = e.touches ? e.touches[0] : e;
  updateAimFromPointer(p.clientX, p.clientY);
  trySwipeGesture(p.clientX, p.clientY);
}

function onPointerUp(e) {
  if (isStaleMouse(e)) {
    clearPointerState();
    return;
  }
  if (!touch.active) return;
  const p = e.changedTouches ? e.changedTouches[0] : e;
  const dx = p.clientX - touch.x;
  const dy = p.clientY - touch.y;
  const dt = performance.now() - touch.t;
  const alreadyGestured = touch.gestured;
  const didAutofire = touch.didAutofire;
  const fromTouch = Boolean(e.changedTouches) || touch.pointerType === "touch";

  clearPointerState();
  if (fromTouch) {
    // блокируем «призрачные» mouse-события после тача
    touch.suppressMouseUntil = performance.now() + 700;
  }

  if (state !== STATE.PLAY) return;

  if (!alreadyGestured && dy < -SWIPE_MIN && Math.abs(dy) > Math.abs(dx) * 0.7) {
    jump();
    return;
  }
  if (!alreadyGestured && dy > SWIPE_MIN && Math.abs(dy) > Math.abs(dx) * 0.7) {
    slide();
    return;
  }
  // одиночный выстрел только если не было автоогня / жеста
  if (!alreadyGestured && !didAutofire && dt < 280 && Math.hypot(dx, dy) < 28) {
    player.lastAimX = p.clientX;
    player.lastAimY = p.clientY;
    shoot(p.clientX, p.clientY);
  }
}

function onPointerCancel() {
  clearPointerState();
  touch.suppressMouseUntil = performance.now() + 700;
}

canvas.addEventListener("touchstart", onPointerDown, { passive: false });
canvas.addEventListener("touchmove", onPointerMove, { passive: false });
canvas.addEventListener("touchend", onPointerUp, { passive: false });
canvas.addEventListener("touchcancel", onPointerCancel, { passive: false });
canvas.addEventListener("mousedown", onPointerDown);
canvas.addEventListener("mousemove", onPointerMove);
canvas.addEventListener("mouseup", onPointerUp);
window.addEventListener("mouseup", () => clearPointerState());
window.addEventListener("blur", () => clearPointerState());

window.addEventListener("keydown", (e) => {
  if (e.repeat) return; // не зажимать клавишу = очередь выстрелов
  if (e.code === "Space" || e.code === "ArrowUp" || e.code === "KeyW") {
    e.preventDefault();
    jump();
  }
  if (e.code === "ArrowDown" || e.code === "KeyS" || e.code === "KeyC" || e.code === "ControlLeft") {
    e.preventDefault();
    slide();
  }
  if (e.code === "KeyJ" || e.code === "KeyX" || e.code === "KeyF") {
    shoot(player.x + 400, player.y + player.h * 0.4);
  }
});

document.getElementById("startBtn").addEventListener("click", () => {
  overlay.classList.add("hidden");
  overlay.setAttribute("aria-hidden", "true");
  gameover.classList.add("hidden");
  gameover.setAttribute("aria-hidden", "true");
  hud.classList.remove("hidden");
  hint.classList.remove("hidden");
  saveSettings();
  resetGame();
  state = STATE.PLAY;
});

document.getElementById("restartBtn").addEventListener("click", () => {
  gameover.classList.add("hidden");
  gameover.setAttribute("aria-hidden", "true");
  hud.classList.remove("hidden");
  hint.classList.remove("hidden");
  resetGame();
  state = STATE.PLAY;
});

/* ---------- Spawning ---------- */
function rectsOverlap(ax, ay, aw, ah, bx, by, bw, bh, margin = 0) {
  return (
    ax - margin < bx + bw &&
    ax + aw + margin > bx &&
    ay - margin < by + bh &&
    ay + ah + margin > by
  );
}

function spawnBlockedByObstacle(x, y, w, h, margin = 36) {
  return obstacles.some((o) =>
    rectsOverlap(x, y, w, h, o.x, o.y, o.w, o.h, margin)
  );
}

function spawnBlockedByEnemy(x, w, margin = 140) {
  return enemies.some(
    (e) => !e.dead && Math.abs(e.x + e.w * 0.5 - (x + w * 0.5)) < margin
  );
}

function spawnEnemy() {
  // не спавним поверх уже близкого врага
  const nearest = enemies.reduce((m, e) => (!e.dead && e.x > m ? e.x : m), 0);
  if (nearest > lw() - 160) return;

  const roll = Math.random();
  const sY = standY();
  const x = lw() + 60;

  if (roll < 0.65) {
    const h = 92;
    const w = 100;
    const y = sY - h;
    // пешие не появляются внутри/на препятствии
    if (spawnBlockedByObstacle(x, y, w, h, 48)) return;
    enemies.push({
      type: "walker",
      x,
      y,
      w,
      h,
      hp: 2,
      vx: 0,
      frame: 0,
      frameT: 0,
      frames: 8,
      grounded: true,
      shootT: 0.8 + Math.random() * 1.2,
      dead: false,
      deadT: 0,
    });
  } else {
    const h = 58;
    const w = 62;
    const hover = 100 + Math.random() * 50;
    const y = sY - h - hover;
    // дроны тоже не клипуются в высокие объекты
    if (spawnBlockedByObstacle(x, y, w, h, 20)) return;
    enemies.push({
      type: "drone",
      x,
      y,
      baseY: y,
      w,
      h,
      hp: 2,
      vx: -30,
      bob: Math.random() * Math.PI * 2,
      frame: 0,
      frameT: 0,
      frames: 4,
      grounded: false,
      shootT: 1.0 + Math.random() * 1.4,
      dead: false,
      deadT: 0,
    });
  }
}

function spawnObstacle() {
  const sY = standY();
  const x = lw() + 80;

  const roll = Math.random();
  let kind;
  let w;
  let h;
  if (roll < 0.34) {
    kind = "crate";
    w = 72 + Math.random() * 28;
    h = 56 + Math.floor(Math.random() * 16);
  } else if (roll < 0.67) {
    kind = "wire";
    w = 110 + Math.random() * 50;
    h = 38 + Math.floor(Math.random() * 10);
  } else {
    kind = "burner";
    w = 88 + Math.random() * 36;
    h = 64 + Math.floor(Math.random() * 22);
  }

  const y = sY - h;
  if (spawnBlockedByEnemy(x, w, 150)) return;
  if (spawnBlockedByObstacle(x, y, w, h, 40)) return;

  obstacles.push({
    x,
    y,
    w,
    h,
    kind,
    phase: Math.random() * Math.PI * 2,
  });
}

function obstacleHitLabel(kind) {
  if (kind === "crate") return "ЯЩИК!";
  if (kind === "wire") return "ПРОВОЛОКА!";
  if (kind === "burner") return "ОГОНЬ!";
  return "ПРЕПЯТСТВИЕ!";
}

function feetOverlapX(o, inset = 22) {
  const left = player.x + inset;
  const right = player.x + player.w - inset;
  return left < o.x + o.w && right > o.x;
}

/** Приземление сверху на крышку препятствия. */
function tryLandOnObstacle(o, prevBottom) {
  if (!feetOverlapX(o)) return false;
  if (player.vy < 0) return false; // только при падении / стоя
  const top = o.y;
  const feet = player.y + player.h;
  // ноги пересекли верхнюю грань сверху
  if (prevBottom <= top + 10 && feet >= top) {
    player.y = top - player.h;
    player.vy = 0;
    return true;
  }
  return false;
}

/** Удар в бок / лоб — не сверху. */
function hitObstacleSide(o, prevBottom) {
  // подкат — проскальзываем сквозь препятствие
  if (player.slideT > 0) return false;
  if (!aabb(playerHitbox(), { x: o.x + 4, y: o.y + 8, w: o.w - 8, h: o.h - 8 })) {
    return false;
  }
  // если приземляемся сверху в этом кадре — не урон
  if (player.vy >= 0 && prevBottom <= o.y + 12) return false;
  // если уже стоим на крышке
  const feet = player.y + player.h;
  if (Math.abs(feet - o.y) <= 6 && feetOverlapX(o) && player.vy >= 0) return false;
  return true;
}

function hurtPlayer(amount = 1, reason = "УРОН") {
  if (player.invuln > 0) return;
  if (player.power.shield > 0) {
    player.power.shield = Math.max(0, player.power.shield - 2);
    player.invuln = 0.7;
    game.shake = 8;
    floats.push({
      x: player.x + player.w * 0.5,
      y: player.y,
      text: "ЩИТ!",
      life: 0.8,
      color: "#7af7ff",
      size: 16,
    });
    updateHud();
    return;
  }
  player.hp -= amount;
  player.invuln = 1.4;
  game.shake = 16;
  game.hitFlash = 0.55;
  game.hitLabel = reason;
  floats.push({
    x: player.x + player.w * 0.5,
    y: player.y,
    text: reason,
    life: 1.0,
    color: "#ff4d6d",
    size: 16,
  });
  updateHud();
  if (player.hp <= 0) {
    endGame();
  }
}

function playerHitbox() {
  // подкат — низкий хитбокс (уклонение от пуль / лазера)
  if (player.slideT > 0) {
    return {
      x: player.x + 20,
      y: player.y + player.h - 34,
      w: player.w - 36,
      h: 28,
    };
  }
  return {
    x: player.x + 28,
    y: player.y + 28,
    w: player.w - 52,
    h: player.h - 36,
  };
}

function enemyHitbox(e) {
  if (e.type === "drone") {
    return { x: e.x + 8, y: e.y + 8, w: e.w - 16, h: e.h - 16 };
  }
  return { x: e.x + 14, y: e.y + 12, w: e.w - 28, h: e.h - 16 };
}

function endGame() {
  state = STATE.OVER;
  finalScore.textContent = String(game.score);
  finalDist.textContent = String(Math.floor(game.distance));
  gameover.classList.remove("hidden");
  gameover.setAttribute("aria-hidden", "false");
  hint.classList.add("hidden");
}

function killEnemy(e) {
  if (e.dead) return;
  e.dead = true;
  e.deadT = 0.45;
  const pts = e.type === "drone" ? 100 : 75;
  game.score += pts;
  updateHud();
  for (let i = 0; i < 12; i++) {
    particles.push({
      x: e.x + e.w / 2,
      y: e.y + e.h / 2,
      vx: (Math.random() - 0.5) * 260,
      vy: (Math.random() - 0.8) * 220,
      life: 0.35 + Math.random() * 0.3,
      color: ["#2de2e6", "#ff2bd6", "#ffb347", "#fff"][i % 4],
      size: 2 + Math.random() * 3,
    });
  }
  floats.push({
    x: e.x + e.w / 2,
    y: e.y,
    text: `+${pts}`,
    life: 0.8,
    color: "#2de2e6",
    size: 14,
  });
  if (Math.random() < 0.3) {
    spawnPickupAt(e.x + e.w * 0.5, e.y + e.h * 0.3);
  }
}

function spawnPickupAt(x, y, forcedType) {
  let type = forcedType;
  if (!type) {
    const roll = Math.random();
    if (roll < 0.35) type = "spread";
    else if (roll < 0.7) type = "autofire";
    else if (roll < 0.9) type = "shield";
    else type = "heal";
  }
  pickups.push({
    type,
    x: x - 16,
    y,
    w: 32,
    h: 32,
    bob: Math.random() * Math.PI * 2,
    baseY: y,
    life: 12,
  });
}

function applyPickup(type) {
  const def = POWER[type];
  if (!def) return;
  if (type === "heal") {
    player.hp = Math.min(player.maxHp, player.hp + 1);
    floats.push({
      x: player.x + player.w * 0.5,
      y: player.y,
      text: "+HP",
      life: 0.9,
      color: def.color,
      size: 16,
    });
  } else {
    player.power[type] = Math.max(player.power[type], def.dur);
    floats.push({
      x: player.x + player.w * 0.5,
      y: player.y,
      text: def.label,
      life: 0.9,
      color: def.color,
      size: 15,
    });
  }
  updateHud();
}

function fireWalkerShot(e) {
  const cx = player.x + player.w * 0.5;
  const cy = player.y + player.h * 0.45;
  const sx = e.x + 10;
  const sy = e.y + e.h * 0.4;
  let dx = cx - sx;
  let dy = cy - sy;
  const len = Math.hypot(dx, dy) || 1;
  dx /= len;
  dy /= len;
  // быстрее скролла, иначе пуля «стоит» на экране
  const speed = Math.max(560, game.speed + 320);
  bullets.push({
    x: sx,
    y: sy,
    vx: dx * speed,
    vy: dy * speed,
    angle: Math.atan2(dy, dx),
    life: 2.2,
    w: 14,
    h: 14,
    enemy: true,
    orb: true,
  });
}

function fireDroneRocket(e) {
  const sx = e.x + e.w * 0.3;
  const sy = e.y + e.h * 0.6;
  // дуга в мировых координатах (скролл применяется в update)
  rockets.push({
    x: sx,
    y: sy,
    vx: -140 - Math.random() * 60,
    vy: -280 - Math.random() * 80,
    grav: 520,
    w: 22,
    h: 22,
    hp: 1,
    life: 5,
    spin: 0,
  });
}

function destroyRocket(r, scored) {
  r.life = 0;
  r.hp = 0;
  const palette =
    r.look === "saw"
      ? ["#c0ff3e", "#ff5a1f", "#fff", "#ffcc00"]
      : ["#ffb347", "#ff4d6d", "#fff"];
  for (let i = 0; i < 10; i++) {
    particles.push({
      x: r.x + r.w / 2,
      y: r.y + r.h / 2,
      vx: (Math.random() - 0.5) * 200,
      vy: (Math.random() - 0.5) * 200,
      life: 0.3 + Math.random() * 0.2,
      color: palette[i % palette.length],
      size: 2 + Math.random() * 3,
    });
  }
  if (scored) {
    const pts = r.look === "saw" ? 60 : 40;
    game.score += pts;
    floats.push({
      x: r.x,
      y: r.y,
      text: `+${pts}`,
      life: 0.7,
      color: r.look === "saw" ? "#c0ff3e" : "#ffb347",
      size: 13,
    });
    updateHud();
  }
}

/* ---------- Bosses ---------- */
function bossHpForIndex(index, def) {
  return Math.round(def.baseHp + index * 28);
}

function beginBossWarning() {
  if (boss || game.bossWarn > 0) return;
  const roster = getBossRoster();
  const def = roster[game.bossIndex % roster.length];
  game.bossWarn = 2.4;
  game.bossIntro = def.name;
  // расчистить поле перед боссом
  for (const e of enemies) {
    if (!e.dead) {
      e.dead = true;
      e.deadT = 0.2;
    }
  }
  floats.push({
    x: lw() * 0.5,
    y: lh() * 0.3,
    text: "WARNING",
    life: 2.2,
    color: "#ff4d6d",
    size: 28,
  });
}

function spawnBoss() {
  const roster = getBossRoster();
  const def = roster[game.bossIndex % roster.length];
  const hp = bossHpForIndex(game.bossIndex, def);
  const sY = standY();
  let w;
  let h;
  let y;
  let grounded = false;

  if (def.id === "titan") {
    w = 240;
    h = 200;
    y = sY - h;
    grounded = true;
  } else if (def.id === "helldrone") {
    w = 150;
    h = 118;
    y = sY - h - 130;
  } else {
    w = 120;
    h = 120;
    y = sY - h - 100;
  }

  const frames = assets.bosses[def.id] || [];
  boss = {
    id: def.id,
    name: def.name,
    title: def.title,
    color: def.color,
    x: lw() + 40,
    y,
    baseY: y,
    w,
    h,
    hp,
    maxHp: hp,
    grounded,
    bob: 0,
    phase: 0,
    attackT: 1.2,
    pattern: 0,
    laserT: 0,
    laserActive: 0,
    laserY: 0,
    laserDrone: null,
    flash: 0,
    dead: false,
    deadT: 0,
    frame: 0,
    frameT: 0,
    frames: frames.length || 1,
  };
  game.shake = 12;
  floats.push({
    x: lw() * 0.5,
    y: lh() * 0.36,
    text: def.name,
    life: 1.6,
    color: def.color,
    size: 22,
  });
}

function bossHitbox() {
  if (!boss || boss.dead) return { x: 0, y: 0, w: 0, h: 0 };
  const inset = boss.id === "titan" ? 18 : 14;
  return {
    x: boss.x + inset,
    y: boss.y + inset * 0.6,
    w: boss.w - inset * 2,
    h: boss.h - inset * 1.2,
  };
}

function fireEnemyOrb(sx, sy, angle, speed, size = 14) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  bullets.push({
    x: sx,
    y: sy,
    vx: c * speed,
    vy: s * speed,
    angle,
    life: 2.4,
    w: size,
    h: size,
    enemy: true,
    orb: true,
  });
}

function fireBossVolley(spread = 0.35, count = 5, speedMul = 1) {
  if (!boss) return;
  const sx = boss.x + 16;
  const sy = boss.y + boss.h * 0.45;
  const cx = player.x + player.w * 0.5;
  const cy = player.y + player.h * 0.45;
  const base = Math.atan2(cy - sy, cx - sx);
  const speed = Math.max(520, game.speed + 280) * speedMul;
  const mid = (count - 1) / 2;
  for (let i = 0; i < count; i++) {
    fireEnemyOrb(sx, sy, base + (i - mid) * spread, speed, 15);
  }
}

/** Helldrone: самонаводящиеся сбиваемые пилы по широкой дуге. */
function fireHelldroneSaws(n = 3) {
  if (!boss) return;
  for (let i = 0; i < n; i++) {
    const t = n <= 1 ? 0.5 : i / (n - 1);
    // широкий разброс стартовых углов: вверх-влево → вниз-влево
    const launchAng = -Math.PI * 0.72 + t * Math.PI * 0.95;
    const speed = 200 + i * 25;
    rockets.push({
      x: boss.x + boss.w * 0.2,
      y: boss.y + boss.h * 0.45,
      vx: Math.cos(launchAng) * speed,
      vy: Math.sin(launchAng) * speed,
      grav: 0,
      w: 42,
      h: 42,
      hp: 2,
      life: 5.2,
      spin: Math.random() * Math.PI,
      look: "saw",
      home: true,
      homeDelay: 0.45 + i * 0.15,
      homeStr: 2.4,
      maxSpeed: 210,
      screenSpace: true,
      flash: 0,
    });
  }
}

function fireBossMortars(n = 3, look = "rocket") {
  if (!boss) return;
  const isDrone = look === "drone";
  for (let i = 0; i < n; i++) {
    rockets.push({
      x: boss.x + boss.w * 0.2,
      y: boss.y + boss.h * 0.3,
      vx: -100 - Math.random() * 80 - i * 20,
      vy: -320 - Math.random() * 100,
      grav: 540,
      w: isDrone ? 36 : 24,
      h: isDrone ? 34 : 24,
      hp: 1,
      life: 5,
      spin: 0,
      frame: Math.floor(Math.random() * 4),
      look,
    });
  }
}

/** Веер сбиваемых ракет (TITAN). */
function fireBossRocketFan(count = 5, spread = 0.24) {
  if (!boss) return;
  const sx = boss.x + 12;
  const sy = boss.y + boss.h * 0.42;
  const cx = player.x + player.w * 0.5;
  const cy = player.y + player.h * 0.45;
  const base = Math.atan2(cy - sy, cx - sx);
  const mid = (count - 1) / 2;
  // экранная скорость без доп. скролла — иначе улетают мгновенно
  const speed = 210;
  for (let i = 0; i < count; i++) {
    const ang = base + (i - mid) * spread;
    rockets.push({
      x: sx - 8,
      y: sy - 8,
      vx: Math.cos(ang) * speed,
      vy: Math.sin(ang) * speed,
      grav: 20,
      w: 26,
      h: 26,
      hp: 1,
      life: 4.5,
      spin: 0,
      screenSpace: true,
    });
  }
}

function plantMine() {
  if (!boss) return;
  const sY = standY();
  const w = 56;
  const h = 32;
  hazards.push({
    type: "mine",
    x: boss.x - 40,
    y: sY - h,
    w,
    h,
    vx: 0,
    life: 9,
    age: 0,
    armT: 0.85,
    armed: false,
    hits: 0,
    flash: 0,
    stageColor: "#ffcc00",
    color: boss.color || "#ff2bd6",
  });
  floats.push({
    x: boss.x - 12,
    y: sY - 52,
    text: "⚠ MINE",
    life: 1.1,
    color: "#ffcc00",
    size: 16,
  });
}

function explodeMine(h, fromShot = false) {
  h.life = 0;
  game.shake = Math.max(game.shake, fromShot ? 10 : 14);
  const cx = h.x + h.w / 2;
  const cy = h.y + h.h / 2;
  for (let i = 0; i < 18; i++) {
    particles.push({
      x: cx,
      y: cy,
      vx: (Math.random() - 0.5) * 320,
      vy: -80 - Math.random() * 220,
      life: 0.35 + Math.random() * 0.3,
      color: ["#ff4d6d", "#ffb347", "#fff", "#5dff8a"][i % 4],
      size: 2 + Math.random() * 4,
    });
  }
  if (fromShot) {
    game.score += 60;
    floats.push({
      x: cx,
      y: cy - 20,
      text: "+60",
      life: 0.8,
      color: "#5dff8a",
      size: 14,
    });
    updateHud();
  }
}

/** Попадания по мине: 1 зелёная → 2 жёлтая → 3 красная и взрыв. */
function hitMine(h) {
  if (h.life <= 0) return;
  h.hits = (h.hits || 0) + 1;
  h.flash = 0.18;
  if (h.hits === 1) {
    h.stageColor = "#5dff8a";
    h.armed = true;
  } else if (h.hits === 2) {
    h.stageColor = "#ffcc00";
  } else {
    h.stageColor = "#ff3355";
    explodeMine(h, true);
  }
}

function startBossLaser() {
  if (!boss) return;
  // Helldrone сбрасывает лазер-дрон вниз → предупреждение → луч
  boss.laserDrone = {
    x: boss.x + boss.w * 0.42,
    y: boss.y + boss.h * 0.72,
    w: 44,
    h: 38,
    vx: -55,
    phase: "drop", // drop → warn → fire
    t: 0.6,
    laserY: boss.y + boss.h,
    frame: 0,
    frameT: 0,
    flash: 0,
  };
  boss.laserT = 0;
  boss.laserActive = 0;
}

function updateLaserDrone(dt) {
  if (!boss || !boss.laserDrone) return;
  const d = boss.laserDrone;
  const targetY = player.y + player.h * 0.45;

  d.frameT += dt;
  if (d.frameT >= 0.07) {
    d.frameT = 0;
    d.frame = (d.frame + 1) % Math.max(1, assets.drone.length || 1);
  }
  if (d.flash > 0) d.flash -= dt;

  if (d.phase === "drop") {
    d.t -= dt;
    d.vy = (d.vy || 0) + 520 * dt;
    d.y += d.vy * dt;
    d.x += d.vx * dt;
    d.laserY = d.y + d.h * 0.55;
    const reached = d.laserY >= targetY - 8 || d.y > standY() - 50;
    if (reached || d.t <= 0) {
      d.phase = "warn";
      d.t = 0.6;
      d.laserY = Math.min(targetY, standY() - 36);
      d.y = d.laserY - d.h * 0.55;
      d.flash = 0.2;
      d.vy = 0;
    }
  } else if (d.phase === "warn") {
    d.t -= dt;
    // первую половину следит, затем фиксирует высоту — окно на прыжок/подкат
    if (d.t > 0.28) {
      d.laserY += (targetY - d.laserY) * Math.min(1, 3.2 * dt);
    }
    d.y = d.laserY - d.h * 0.55;
    d.x += Math.sin(game.time * 10) * 10 * dt;
    if (d.t <= 0) {
      d.phase = "fire";
      d.t = 0.18; // короткий импульс — не «стена на полсекунды»
      d.flash = 0.25;
      game.shake = Math.max(game.shake, 10);
    }
  } else if (d.phase === "fire") {
    d.t -= dt;
    const beam = {
      x: 0,
      y: d.laserY - 8,
      w: d.x + d.w * 0.35,
      h: 16,
    };
    if (aabb(playerHitbox(), beam)) hurtPlayer(1, "ЛАЗЕР!");
    if (d.t <= 0) boss.laserDrone = null;
  }
}

function drawLaserDrone() {
  if (!boss || !boss.laserDrone) return;
  const d = boss.laserDrone;
  const cx = d.x + d.w * 0.5;
  const cy = d.y + d.h * 0.5;

  ctx.save();

  // трос от Helldrone к дрону на сбросе
  if (d.phase === "drop") {
    ctx.strokeStyle = "rgba(255, 90, 40, 0.45)";
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 5]);
    ctx.beginPath();
    ctx.moveTo(boss.x + boss.w * 0.5, boss.y + boss.h * 0.75);
    ctx.lineTo(cx, cy);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // дрон
  const frames = assets.drone || [];
  const img = frames.length ? frames[d.frame % frames.length] : null;
  ctx.shadowColor = "#ff5a1f";
  ctx.shadowBlur = 16 + (d.flash > 0 ? 18 : 0);
  if (img) {
    ctx.drawImage(img, d.x, d.y, d.w, d.h);
  } else {
    ctx.fillStyle = "#2a1010";
    ctx.beginPath();
    ctx.ellipse(cx, cy, d.w * 0.42, d.h * 0.36, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#ff5a1f";
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // дуло / оптика
  ctx.fillStyle = d.phase === "fire" ? "#fff" : "#ff8844";
  ctx.beginPath();
  ctx.arc(d.x + 6, cy, d.phase === "warn" ? 5 : 3.5, 0, Math.PI * 2);
  ctx.fill();

  if (d.phase === "warn") {
    // укороченный предупреждающий луч + вспышки
    const len = 110 + Math.sin(game.time * 28) * 18;
    const pulse = 0.45 + Math.sin(game.time * 22) * 0.35;
    ctx.strokeStyle = `rgba(255, 90, 70, ${pulse})`;
    ctx.lineWidth = 3;
    ctx.setLineDash([6, 5]);
    ctx.beginPath();
    ctx.moveTo(d.x + 4, d.laserY);
    ctx.lineTo(d.x + 4 - len, d.laserY);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = `rgba(255, 120, 80, ${0.25 + pulse * 0.35})`;
    ctx.fillRect(d.x + 4 - len, d.laserY - 5, len, 10);
    ctx.fillStyle = `rgba(255, 240, 200, ${0.55 * pulse})`;
    ctx.fillRect(d.x + 4 - len * 0.35, d.laserY - 2, len * 0.35, 4);
    // вспышка у дула
    ctx.fillStyle = `rgba(255, 220, 180, ${0.5 + pulse * 0.5})`;
    ctx.beginPath();
    ctx.arc(d.x + 4, d.laserY, 8 + pulse * 6, 0, Math.PI * 2);
    ctx.fill();
  }

  if (d.phase === "fire") {
    const alpha = Math.min(1, 0.45 + d.t * 4);
    const beamW = d.x + 8;
    ctx.fillStyle = `rgba(255, 50, 70, ${0.5 * alpha})`;
    ctx.shadowColor = "#ff3355";
    ctx.shadowBlur = 28;
    ctx.fillRect(0, d.laserY - 8, beamW, 16);
    ctx.fillStyle = `rgba(255, 210, 210, ${0.9 * alpha})`;
    ctx.fillRect(0, d.laserY - 2.5, beamW, 5);
    ctx.fillStyle = `rgba(255, 255, 255, ${0.75 * alpha})`;
    ctx.beginPath();
    ctx.arc(d.x + 4, d.laserY, 10, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.shadowBlur = 0;
  ctx.restore();
}

function fireBossNeedles() {
  if (!boss) return;
  const speed = Math.max(640, game.speed + 360);
  const ys = [
    standY() - 40,
    standY() - 90,
    standY() - 140,
  ];
  for (const yy of ys) {
    fireEnemyOrb(boss.x + 10, yy, Math.PI, speed, 12);
  }
}

function fireBossArc(count = 7) {
  if (!boss) return;
  const sx = boss.x + boss.w * 0.3;
  const sy = boss.y + boss.h * 0.5;
  const speed = Math.max(480, game.speed + 260);
  // полукруг влево к игроку
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    const ang = -Math.PI * 0.75 + t * Math.PI * 0.9;
    fireEnemyOrb(sx, sy, ang, speed, 13);
  }
}

function bossAttack() {
  if (!boss || boss.dead) return;
  if (boss.id === "titan") {
    const p = boss.pattern % 3;
    if (p === 0) fireBossRocketFan(5, 0.24);
    else if (p === 1) plantMine();
    else fireBossMortars(3, "drone");
    boss.attackT = 1.35;
  } else if (boss.id === "helldrone") {
    const p = boss.pattern % 3;
    if (p === 0) fireBossMortars(4);
    else if (p === 1) {
      startBossLaser();
      boss.attackT = 0.9; // пауза после дрона-лазера
      boss.pattern++;
      return;
    } else fireHelldroneSaws(3);
    boss.attackT = 1.5;
  } else {
    const p = boss.pattern % 3;
    if (p === 0) fireBossArc(8);
    else if (p === 1) fireBossNeedles();
    else fireBossVolley(0.4, 4, 0.95);
    boss.attackT = 1.25;
  }
  boss.pattern++;
}

function killBoss() {
  if (!boss || boss.dead) return;
  boss.dead = true;
  boss.deadT = 1.1;
  boss.laserT = 0;
  boss.laserActive = 0;
  boss.laserDrone = null;
  const pts = 800 + game.bossIndex * 200;
  game.score += pts;
  game.shake = 22;
  updateHud();
  for (let i = 0; i < 36; i++) {
    particles.push({
      x: boss.x + boss.w * 0.5,
      y: boss.y + boss.h * 0.5,
      vx: (Math.random() - 0.5) * 420,
      vy: (Math.random() - 0.8) * 380,
      life: 0.5 + Math.random() * 0.5,
      color: [boss.color, "#fff", "#ffb347", "#ff2bd6"][i % 4],
      size: 3 + Math.random() * 4,
    });
  }
  floats.push({
    x: boss.x + boss.w * 0.5,
    y: boss.y,
    text: `+${pts}`,
    life: 1.4,
    color: boss.color,
    size: 24,
  });
  // гарантированные награды
  spawnPickupAt(boss.x + 20, boss.y + 30, "heal");
  spawnPickupAt(boss.x + boss.w * 0.5, boss.y + 10);
  spawnPickupAt(boss.x + boss.w - 20, boss.y + 40);
  game.bossIndex++;
  game.nextBossAt += settings.bossEvery;
  game.spawnTimer = 2.0;
  game.obstacleTimer = 2.5;
  hazards = [];
}

function hurtBoss(amount = 1) {
  if (!boss || boss.dead) return;
  boss.hp -= amount;
  boss.flash = 0.12;
  if (boss.hp <= 0) killBoss();
}

function updateBoss(dt) {
  if (game.bossWarn > 0) {
    game.bossWarn -= dt;
    if (game.bossWarn <= 0) spawnBoss();
  }

  if (!boss) return;

  if (boss.dead) {
    boss.deadT -= dt;
    boss.x += 40 * dt;
    boss.y += 30 * dt;
    if (boss.deadT <= 0) boss = null;
    return;
  }

  // держим босса на экране (не уезжает со скроллом)
  const anchorX = lw() * 0.7;
  boss.x += (anchorX - boss.x) * Math.min(1, 2.4 * dt);
  boss.bob += dt * 2.4;
  if (!boss.grounded) {
    boss.y = boss.baseY + Math.sin(boss.bob) * 18;
  }
  if (boss.flash > 0) boss.flash -= dt;

  // анимация спрайта
  const animSpd = boss.flash > 0 ? 0.05 : 0.09;
  boss.frameT += dt;
  if (boss.frameT >= animSpd) {
    boss.frameT = 0;
    boss.frame = (boss.frame + 1) % Math.max(1, boss.frames);
  }

  // лазер-дрон Helldrone: сброс → предупреждение → луч
  updateLaserDrone(dt);

  // атаки паузятся, пока висит лазер-дрон
  if (!boss.laserDrone) {
    boss.attackT -= dt;
    if (boss.attackT <= 0) bossAttack();
  }

  if (aabb(playerHitbox(), bossHitbox())) {
    hurtPlayer(1, boss.name + "!");
  }
}

function updateHazards(dt) {
  for (const h of hazards) {
    h.age = (h.age || 0) + dt;
    h.life -= dt;

    if (h.type === "mine") {
      // мина едет со скроллом мира
      h.x -= game.speed * dt;
      if (h.flash > 0) h.flash -= dt;
      if (!h.armed) {
        h.armT -= dt;
        if (h.armT <= 0) h.armed = true;
      } else if (aabb(playerHitbox(), { x: h.x + 2, y: h.y, w: h.w - 4, h: h.h + 6 })) {
        explodeMine(h, false);
        hurtPlayer(1, "МИНА!");
      } else if (h.life < 0.15) {
        explodeMine(h, false);
      }
      continue;
    }

    h.x += (h.vx || 0) * dt;
  }
  hazards = hazards.filter((h) => h.life > 0 && h.x > -100);
}

function drawHazards() {
  for (const h of hazards) {
    if (h.type !== "mine") continue;
    const accent = h.stageColor || "#ffcc00";
    const blink = !h.armed || Math.sin(h.age * 12) > -0.2 || h.flash > 0;
    const pulse = 0.65 + Math.sin(h.age * 8) * 0.35;
    const cx = h.x + h.w / 2;
    const cy = h.y + h.h * 0.55;
    const sY = standY();
    ctx.save();

    ctx.fillStyle = accent;
    ctx.globalAlpha = 0.85;
    ctx.fillRect(h.x - 10, sY - 10, h.w + 20, 10);
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#111";
    for (let x = h.x - 10; x < h.x + h.w + 10; x += 12) {
      ctx.beginPath();
      ctx.moveTo(x, sY - 10);
      ctx.lineTo(x + 6, sY - 10);
      ctx.lineTo(x + 2, sY);
      ctx.lineTo(x - 4, sY);
      ctx.closePath();
      ctx.fill();
    }

    ctx.strokeStyle = blink ? accent : "#888";
    ctx.globalAlpha = 0.35 + pulse * 0.35;
    ctx.lineWidth = 3;
    ctx.shadowColor = accent;
    ctx.shadowBlur = 18;
    ctx.beginPath();
    ctx.arc(cx, cy, 22 + pulse * 10, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;

    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.ellipse(cx, sY - 2, h.w * 0.6, 5, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.shadowColor = accent;
    ctx.shadowBlur = blink ? 22 : 10;
    if (h.flash > 0) ctx.globalAlpha = 0.55;
    const body = ctx.createRadialGradient(cx - 4, cy - 4, 2, cx, cy, h.w * 0.55);
    body.addColorStop(0, "#4a4a58");
    body.addColorStop(0.55, "#1a1a24");
    body.addColorStop(1, "#0a0a10");
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.ellipse(cx, cy, h.w * 0.48, h.h * 0.45, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = accent;
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.save();
    ctx.beginPath();
    ctx.ellipse(cx, cy, h.w * 0.42, h.h * 0.38, 0, 0, Math.PI * 2);
    ctx.clip();
    for (let i = -2; i < 6; i++) {
      ctx.fillStyle = i % 2 === 0 ? accent : "#111";
      ctx.fillRect(h.x - 8 + i * 14, cy - 5, 10, 10);
    }
    ctx.restore();

    ctx.strokeStyle = "#e8e8f0";
    ctx.lineWidth = 2.5;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
      const r0 = h.w * 0.3;
      const r1 = h.w * 0.58;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0 * 0.75);
      ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1 * 0.75);
      ctx.stroke();
    }

    ctx.beginPath();
    ctx.arc(cx, cy, 7, 0, Math.PI * 2);
    ctx.fillStyle = blink ? accent : "#3a1018";
    ctx.fill();
    if (blink) {
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(cx - 2, cy - 2, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.shadowBlur = 8;
    ctx.shadowColor = accent;
    ctx.fillStyle = accent;
    ctx.font = "bold 12px Share Tech Mono, monospace";
    ctx.textAlign = "center";
    const label = !h.armed
      ? "ARMING…"
      : h.hits >= 2
        ? "⚠ HOT"
        : h.hits === 1
          ? "⚠ HIT"
          : "⚠ MINE";
    ctx.fillText(label, cx, h.y - 10);
    ctx.font = "bold 10px Share Tech Mono, monospace";
    ctx.fillText(`${h.hits || 0}/3`, cx, h.y - 22);
    ctx.textAlign = "left";

    ctx.shadowBlur = 0;
    ctx.restore();
  }
}

function drawBoss() {
  if (!boss) return;
  const sY = standY();
  ctx.save();
  if (boss.dead) ctx.globalAlpha = Math.max(0, boss.deadT);

  // тень
  ctx.fillStyle = "rgba(0,0,0,0.5)";
  ctx.beginPath();
  ctx.ellipse(boss.x + boss.w / 2, sY - 2, boss.w * 0.4, 8, 0, 0, Math.PI * 2);
  ctx.fill();

  const pulse = 0.7 + Math.sin(game.time * 6) * 0.3;
  ctx.shadowColor = boss.color;
  ctx.shadowBlur = 22 * pulse;
  if (boss.flash > 0) ctx.globalAlpha = Math.min(ctx.globalAlpha, 0.55);

  const frames = assets.bosses[boss.id] || [];
  const img = frames[boss.frame % frames.length];

  if (img) {
    ctx.save();
    // спрайты смотрят вправо — зеркалим к игроку слева
    if (boss.id !== "spikecore") {
      ctx.translate(boss.x + boss.w, boss.y);
      ctx.scale(-1, 1);
      ctx.drawImage(img, 0, 0, boss.w, boss.h);
    } else {
      ctx.drawImage(img, boss.x, boss.y, boss.w, boss.h);
    }
    ctx.restore();
  } else if (boss.id === "titan") {
    const g = ctx.createLinearGradient(boss.x, boss.y, boss.x, boss.y + boss.h);
    g.addColorStop(0, "#3a1430");
    g.addColorStop(1, "#120818");
    ctx.fillStyle = g;
    ctx.fillRect(boss.x + 20, boss.y + 30, boss.w - 40, boss.h - 30);
    ctx.fillRect(boss.x + 8, boss.y + 50, 28, boss.h - 55);
    ctx.fillRect(boss.x + boss.w - 36, boss.y + 50, 28, boss.h - 55);
    ctx.fillStyle = "#1a0a18";
    ctx.fillRect(boss.x + 40, boss.y + 8, boss.w - 80, 40);
    ctx.fillStyle = boss.color;
    ctx.fillRect(boss.x + 52, boss.y + 18, boss.w - 104, 12);
    ctx.strokeStyle = boss.color;
    ctx.lineWidth = 3;
    ctx.strokeRect(boss.x + 18, boss.y + 28, boss.w - 36, boss.h - 32);
  } else if (boss.id === "helldrone") {
    ctx.fillStyle = "#2a1010";
    ctx.beginPath();
    ctx.ellipse(boss.x + boss.w / 2, boss.y + boss.h / 2, boss.w * 0.48, boss.h * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = boss.color;
    ctx.lineWidth = 3;
    ctx.stroke();
  } else {
    const cx = boss.x + boss.w / 2;
    const cy = boss.y + boss.h / 2;
    ctx.fillStyle = "#142010";
    ctx.beginPath();
    ctx.arc(cx, cy, boss.w * 0.32, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = boss.color;
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1;

  drawLaserDrone();

  ctx.restore();
}

function drawBossHud() {
  if (!boss && game.bossWarn <= 0) return;
  const w = lw();
  ctx.save();
  if (game.bossWarn > 0) {
    ctx.fillStyle = `rgba(255, 40, 70, ${0.15 + Math.sin(game.time * 12) * 0.08})`;
    ctx.fillRect(0, 0, w, 54);
    ctx.fillStyle = "#ff4d6d";
    ctx.font = "bold 16px Orbitron, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(`⚠ BOSS INBOUND · ${game.bossIntro}`, w / 2, 32);
    ctx.textAlign = "left";
    ctx.restore();
    return;
  }
  if (!boss) {
    ctx.restore();
    return;
  }
  const barW = Math.min(360, w * 0.7);
  const barX = (w - barW) / 2;
  const barY = 18;
  const ratio = Math.max(0, boss.hp / boss.maxHp);
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(barX - 4, barY - 14, barW + 8, 28);
  ctx.strokeStyle = boss.color;
  ctx.lineWidth = 2;
  ctx.strokeRect(barX, barY, barW, 10);
  ctx.fillStyle = boss.color;
  ctx.shadowColor = boss.color;
  ctx.shadowBlur = 10;
  ctx.fillRect(barX, barY, barW * ratio, 10);
  ctx.shadowBlur = 0;
  ctx.fillStyle = "#e8f7ff";
  ctx.font = "bold 11px Share Tech Mono, monospace";
  ctx.textAlign = "center";
  ctx.fillText(`${boss.name}  ${Math.max(0, Math.ceil(boss.hp))}/${boss.maxHp}`, w / 2, barY - 3);
  ctx.textAlign = "left";
  ctx.restore();
}

function aabb(a, b) {
  return (
    a.x < b.x + b.w &&
    a.x + a.w > b.x &&
    a.y < b.y + b.h &&
    a.y + a.h > b.y
  );
}

/* ---------- Update ---------- */
function update(dt) {
  if (state !== STATE.PLAY) {
    draw(0);
    return;
  }

  game.time += dt;
  game.speed = 220 + Math.min(180, game.time * 4);
  game.scroll += game.speed * dt;
  game.distance = game.scroll / 28;
  if (game.shake > 0) game.shake = Math.max(0, game.shake - 40 * dt);

  // player physics
  const prevBottom = player.y + player.h;
  player.vy += GRAVITY * dt;
  player.y += player.vy * dt;

  // сначала двигаем препятствия, потом решаем посадку / урон
  for (const o of obstacles) {
    o.x -= game.speed * dt;
  }

  let landed = false;
  for (const o of obstacles) {
    if (tryLandOnObstacle(o, prevBottom)) {
      landed = true;
      break;
    }
  }

  const floorTop = standY();
  if (!landed && player.y + player.h >= floorTop) {
    player.y = floorTop - player.h;
    player.vy = 0;
    landed = true;
  }

  if (landed) {
    if (!player.onGround) {
      player.onGround = true;
      if (player.anim === "jump") player.anim = "run";
    }
  } else {
    player.onGround = false;
  }

  // урон только при боковом столкновении
  for (const o of obstacles) {
    if (hitObstacleSide(o, prevBottom)) {
      hurtPlayer(1, obstacleHitLabel(o.kind));
      // слегка оттолкнуть визуально — препятствие остаётся
      player.invuln = Math.max(player.invuln, 0.9);
    }
  }
  obstacles = obstacles.filter((o) => o.x > -120);

  if (player.invuln > 0) player.invuln -= dt;
  if (player.shootTimer > 0) player.shootTimer -= dt;
  if (player.shootFlash > 0) player.shootFlash -= dt;
  if (player.slideT > 0) {
    player.slideT = Math.max(0, player.slideT - dt);
    // держим кадр «ноги вместе» на всём подкате
    player.frame = player.slideFrame;
    player.frameT = 0;
    if (player.slideT <= 0 && player.onGround) {
      player.anim = "run";
      player.frame = player.slideFrame;
    }
  }

  // таймеры бонусов
  for (const key of ["spread", "autofire", "shield"]) {
    if (player.power[key] > 0) {
      player.power[key] = Math.max(0, player.power[key] - dt);
    }
  }
  game._hudAcc = (game._hudAcc || 0) + dt;
  if (game._hudAcc > 0.2) {
    game._hudAcc = 0;
    updateHud();
  }

  // AUTO: огонь пока зажато; направление — lastAim (не палец «управления» слева)
  if (player.power.autofire > 0.05 && touch.active && !touch.gestured) {
    touch.didAutofire = true;
    shoot(player.lastAimX, player.lastAimY);
  }

  // пушка плавно догоняет цель и медленно возвращается вперёд
  if (player.shootTimer <= 0 && !(player.power.autofire > 0.05 && touch.active)) {
    player.aimTarget += (0 - player.aimTarget) * Math.min(1, 2.2 * dt);
  }
  player.aimAngle += (player.aimTarget - player.aimAngle) * Math.min(1, 18 * dt);

  // animation — run / jump; в подкате кадр зафиксирован выше
  if (player.slideT <= 0) {
    player.frameT += dt;
    const animSpeed = player.anim === "jump" ? 0.06 : 0.055;
    if (player.frameT >= animSpeed) {
      player.frameT = 0;
      player.frame++;
      const len = assets.player[player.anim]?.length || 1;
      if (player.frame >= len) player.frame = 0;
    }
  }

  // bullets
  for (const b of bullets) {
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.life -= dt;
  }
  bullets = bullets.filter(
    (b) => b.life > 0 && b.x > -40 && b.x < lw() + 40 && b.y > -40 && b.y < lh() + 40
  );

  // rockets / пилы
  for (const r of rockets) {
    if (r.flash > 0) r.flash -= dt;
    if (r.home) {
      if (r.homeDelay > 0) {
        r.homeDelay -= dt;
      } else {
        const tx = player.x + player.w * 0.5 - (r.x + r.w * 0.5);
        const ty = player.y + player.h * 0.4 - (r.y + r.h * 0.5);
        const desired = Math.atan2(ty, tx);
        let ang = Math.atan2(r.vy, r.vx);
        let diff = desired - ang;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        const maxTurn = (r.homeStr || 2.2) * dt;
        ang += Math.max(-maxTurn, Math.min(maxTurn, diff));
        const cur = Math.hypot(r.vx, r.vy);
        const spd = Math.min(r.maxSpeed || 210, cur + 55 * dt);
        r.vx = Math.cos(ang) * spd;
        r.vy = Math.sin(ang) * spd;
      }
    } else {
      r.vy += r.grav * dt;
    }
    r.x += r.vx * dt;
    r.y += r.vy * dt;
    if (!r.screenSpace) r.x -= game.speed * dt;
    r.spin += dt * (r.look === "saw" ? 14 : 8);
    r.life -= dt;
    if (aabb({ x: r.x, y: r.y, w: r.w, h: r.h }, playerHitbox())) {
      destroyRocket(r, false);
      hurtPlayer(1, r.look === "saw" ? "ПИЛА!" : "РАКЕТА!");
    }
  }
  rockets = rockets.filter(
    (r) => r.life > 0 && r.hp > 0 && r.x > -60 && r.x < lw() + 60 && r.y < lh() + 80
  );

  // spawn — во время босса обычные враги/препятствия на паузе
  const bossFight = Boolean(boss) || game.bossWarn > 0;
  if (!bossFight && game.distance >= game.nextBossAt) {
    beginBossWarning();
  }

  game.spawnTimer -= dt;
  if (!bossFight && game.spawnTimer <= 0) {
    spawnEnemy();
    game.spawnTimer = Math.max(1.0, 2.0 - game.time * 0.015);
  }
  game.obstacleTimer -= dt;
  if (!bossFight && game.obstacleTimer <= 0) {
    spawnObstacle();
    game.obstacleTimer = 2.4 + Math.random() * 2.2;
  }

  updateBoss(dt);
  updateHazards(dt);

  // enemies
  for (const e of enemies) {
    if (e.dead) {
      e.deadT -= dt;
      continue;
    }
    e.x -= game.speed * dt;
    if (e.vx) e.x += e.vx * dt;
    e.frameT = (e.frameT || 0) + dt;
    if (e.frameT > 0.1) {
      e.frameT = 0;
      e.frame = ((e.frame || 0) + 1) % (e.frames || 4);
    }
    if (e.type === "drone") {
      e.bob += dt * 3.2;
      e.y = e.baseY + Math.sin(e.bob) * 10;
    }

    e.shootT -= dt;
    if (e.shootT <= 0 && e.x < lw() * 0.95 && e.x > 40) {
      if (e.type === "walker") {
        e.shootT = 1.6 + Math.random() * 0.9;
        fireWalkerShot(e);
      } else if (e.type === "drone") {
        e.shootT = 2.2 + Math.random() * 1.2;
        fireDroneRocket(e);
      }
    }

    if (e.x < lw() - 20 && aabb(playerHitbox(), enemyHitbox(e))) {
      hurtPlayer(1, e.type === "drone" ? "ДРОН!" : "ВРАГ!");
    }
  }
  enemies = enemies.filter((e) => e.x > -140 && (!e.dead || e.deadT > 0));

  // pickups
  for (const p of pickups) {
    p.x -= game.speed * dt;
    p.bob += dt * 3;
    p.y = p.baseY + Math.sin(p.bob) * 8;
    p.life -= dt;
    const box = { x: p.x, y: p.y, w: p.w, h: p.h };
    if (aabb(playerHitbox(), box)) {
      applyPickup(p.type);
      p.life = 0;
    }
  }
  pickups = pickups.filter((p) => p.life > 0 && p.x > -60);

  // bullet hits
  for (const b of bullets) {
    if (b.enemy) {
      if (
        aabb(
          { x: b.x - b.w / 2, y: b.y - b.h / 2, w: b.w, h: b.h },
          playerHitbox()
        )
      ) {
        b.life = 0;
        hurtPlayer(1, "ПУЛЯ!");
      }
      continue;
    }
    // сбить ракету / пилу
    for (const r of rockets) {
      if (r.hp <= 0) continue;
      if (aabb({ x: b.x - 4, y: b.y - 4, w: b.w + 8, h: 16 }, { x: r.x, y: r.y, w: r.w, h: r.h })) {
        b.life = 0;
        r.hp -= 1;
        r.flash = 0.12;
        if (r.hp <= 0) destroyRocket(r, true);
        else {
          particles.push({
            x: b.x,
            y: b.y,
            vx: -40,
            vy: -30,
            life: 0.2,
            color: r.look === "saw" ? "#c0ff3e" : "#ffb347",
            size: 3,
          });
        }
        break;
      }
    }
    if (b.life <= 0) continue;
    // сбить мину босса
    for (const h of hazards) {
      if (h.type !== "mine" || h.life <= 0) continue;
      if (aabb({ x: b.x - 4, y: b.y - 4, w: b.w + 8, h: 16 }, { x: h.x, y: h.y, w: h.w, h: h.h })) {
        b.life = 0;
        hitMine(h);
        particles.push({
          x: b.x,
          y: b.y,
          vx: -20,
          vy: -40,
          life: 0.2,
          color: h.stageColor || "#fff",
          size: 3,
        });
        break;
      }
    }
    if (b.life <= 0) continue;
    for (const e of enemies) {
      if (e.dead) continue;
      if (aabb({ x: b.x, y: b.y - 6, w: b.w + 8, h: b.h + 12 }, enemyHitbox(e))) {
        b.life = 0;
        e.hp -= 1;
        particles.push({
          x: b.x,
          y: b.y,
          vx: -40,
          vy: -40,
          life: 0.2,
          color: "#fff",
          size: 3,
        });
        if (e.hp <= 0) killEnemy(e);
        break;
      }
    }
    if (b.life <= 0) continue;
    if (boss && !boss.dead && aabb({ x: b.x, y: b.y - 6, w: b.w + 8, h: b.h + 12 }, bossHitbox())) {
      b.life = 0;
      hurtBoss(1);
      particles.push({
        x: b.x,
        y: b.y,
        vx: -30,
        vy: -50,
        life: 0.2,
        color: boss.color,
        size: 3,
      });
    }
  }

  // particles / floats / rain
  if (game.hitFlash > 0) game.hitFlash -= dt;
  for (const p of particles) {
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += 400 * dt;
    p.life -= dt;
  }
  particles = particles.filter((p) => p.life > 0);
  for (const f of floats) {
    f.y -= 50 * dt;
    f.life -= dt;
  }
  floats = floats.filter((f) => f.life > 0);

  for (const r of game.rain) {
    r.y += r.spd * dt;
    r.x -= game.speed * 0.15 * dt;
    if (r.y > lh()) {
      r.y = -10;
      r.x = Math.random() * lw();
    }
  }

  if (Math.floor(game.distance) % 5 === 0) updateHud();
  draw(dt);
}

/* ---------- Draw ---------- */
function drawParallax() {
  const w = lw();
  const h = lh();
  const gY = groundY();

  // noir sky
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, "#0a0420");
  grad.addColorStop(0.45, "#1a0a3a");
  grad.addColorStop(0.75, "#2a1048");
  grad.addColorStop(1, "#12081f");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // distant haze glow
  const glow = ctx.createRadialGradient(w * 0.7, h * 0.25, 10, w * 0.7, h * 0.25, w * 0.5);
  glow.addColorStop(0, "rgba(255, 43, 214, 0.18)");
  glow.addColorStop(0.5, "rgba(45, 226, 230, 0.08)");
  glow.addColorStop(1, "transparent");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);

  // Scale layers so pixel city fills the mobile viewport
  const fill = Math.max(1.4, (gY - 40) / 200);
  const layers = [
    { img: assets.bg.bg1, speed: 0.08, y: gY - 200 * fill, scale: fill * 1.05 },
    { img: assets.bg.skyA, speed: 0.12, y: gY - 230 * fill * 0.55, scale: fill * 0.95 },
    { img: assets.bg.skyB, speed: 0.14, y: gY - 220 * fill * 0.55, scale: fill * 0.95 },
    { img: assets.bg.bg2, speed: 0.22, y: gY - 210 * fill * 0.7, scale: fill },
    { img: assets.bg.buildings, speed: 0.35, y: gY - 150 * fill * 0.7, scale: fill * 1.15 },
    { img: assets.bg.bg3, speed: 0.55, y: gY - 220 * fill * 0.65, scale: fill },
    { img: assets.bg.near, speed: 0.78, y: gY - 200 * fill * 0.55, scale: fill * 0.95 },
  ];

  for (const L of layers) {
    if (!L.img) continue;
    const ih = L.img.height * L.scale;
    const iw = L.img.width * L.scale;
    const y = L.y;
    let x = -((game.scroll * L.speed) % iw);
    ctx.globalAlpha = 0.92;
    while (x < w) {
      ctx.drawImage(L.img, x, y, iw, ih);
      x += iw - 1;
    }
    ctx.globalAlpha = 1;
  }

  // street / ground
  ctx.fillStyle = "#0b0714";
  ctx.fillRect(0, gY, w, h - gY);
  // neon curb
  ctx.fillStyle = "#2de2e6";
  ctx.shadowColor = "#2de2e6";
  ctx.shadowBlur = 12;
  ctx.fillRect(0, gY, w, 3);
  ctx.shadowBlur = 0;
  // asphalt stripes
  ctx.fillStyle = "rgba(255, 179, 71, 0.35)";
  const stripeW = 48;
  const off = -(game.scroll % (stripeW * 2));
  for (let x = off; x < w; x += stripeW * 2) {
    ctx.fillRect(x, gY + 18, stripeW, 4);
  }

  // wet reflection band
  ctx.fillStyle = "rgba(45, 226, 230, 0.06)";
  ctx.fillRect(0, gY + 4, w, 40);
}

function drawPlayer() {
  const sliding = player.slideT > 0;
  const frames = assets.player[player.anim] || assets.player.run;
  const faceFrames = assets.player.face[player.anim] || assets.player.face.run;
  const fi = Math.min(player.frame, frames.length - 1);
  const img = frames[fi];
  if (!img) return;

  const blink = player.invuln > 0 && Math.floor(player.invuln * 20) % 2 === 0;
  const tilt = slideTilt();
  const prone = sliding && Math.abs(tilt) > 0.08;
  const face = faceFrames[Math.min(fi, faceFrames.length - 1)];
  const sx = player.w / assets.gunNative.srcW;
  const sy = player.h / assets.gunNative.srcH;
  const gw = assets.gunNative.w * sx;
  const gh = assets.gunNative.h * sy;
  const lx = assets.gunPivot.x * sx;
  const ly = assets.gunPivot.y * sy;

  ctx.save();
  if (blink) ctx.globalAlpha = 0.4;
  ctx.shadowColor = sliding ? "#2de2e6" : "#ff2bd6";
  ctx.shadowBlur = sliding ? 20 : 18;

  if (prone) {
    const pose = getSlideDrawPose();
    const footY = player.y + player.h;

    // тело — вращение вокруг центра
    ctx.save();
    ctx.translate(pose.pivotX, pose.pivotY);
    ctx.rotate(pose.tilt);
    ctx.drawImage(img, pose.ox, pose.oy, player.w, player.h);
    ctx.restore();
    ctx.shadowBlur = 0;

    // пушка в мире — шарнир на теле, ствол по aim
    if (assets.gun) {
      const pivot = getGunPivot();
      ctx.save();
      ctx.translate(pivot.x, pivot.y);
      ctx.rotate(player.aimAngle);
      ctx.shadowColor = "#2de2e6";
      ctx.shadowBlur = 10;
      ctx.drawImage(assets.gun, -lx, -ly, gw, gh);
      ctx.restore();
    }

    // лицо поверх пушки
    if (face) {
      ctx.save();
      ctx.translate(pose.pivotX, pose.pivotY);
      ctx.rotate(pose.tilt);
      ctx.drawImage(face, pose.ox, pose.oy, player.w, player.h);
      ctx.restore();
    }

    ctx.strokeStyle = `rgba(45, 226, 230, ${0.2 + player.slideT * 0.45})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(player.x + 12, footY - 5);
    ctx.lineTo(player.x - 30 - (1 - player.slideT / SLIDE_DUR) * 24, footY - 3);
    ctx.stroke();
  } else {
    ctx.drawImage(img, player.x, player.y, player.w, player.h);
    ctx.shadowBlur = 0;

    if (assets.gun) {
      const pivot = getGunPivot();
      ctx.save();
      ctx.translate(pivot.x, pivot.y);
      ctx.rotate(player.aimAngle);
      ctx.shadowColor = "#2de2e6";
      ctx.shadowBlur = 10;
      ctx.drawImage(assets.gun, -lx, -ly, gw, gh);
      ctx.restore();
    }

    if (face) {
      ctx.drawImage(face, player.x, player.y, player.w, player.h);
    }
  }

  if (player.shootFlash > 0) {
    const { x: mx, y: my } = getMuzzle();
    ctx.fillStyle = "rgba(45, 226, 230, 0.95)";
    ctx.shadowColor = "#2de2e6";
    ctx.shadowBlur = 16;
    ctx.beginPath();
    ctx.arc(mx, my, 6 + player.shootFlash * 28, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawEnemy(e) {
  const sY = standY();
  ctx.save();
  if (e.dead) {
    const fi = Math.min(
      assets.fx.boom.length - 1,
      Math.floor((1 - e.deadT / 0.45) * assets.fx.boom.length)
    );
    const boom = assets.fx.boom[fi];
    if (boom) ctx.drawImage(boom, e.x, e.y, e.w, e.h);
    ctx.restore();
    return;
  }

  ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
  const shadowW = e.grounded ? e.w * 0.65 : e.w * 0.4;
  ctx.beginPath();
  ctx.ellipse(e.x + e.w / 2, sY - 2, shadowW / 2, 5, 0, 0, Math.PI * 2);
  ctx.fill();

  if (e.type === "walker" && assets.walker.run) {
    const fw = 128;
    const fh = 68;
    const frame = e.frame % 8;
    ctx.shadowColor = "#ff2bd6";
    ctx.shadowBlur = 10;
    ctx.translate(e.x + e.w, e.y);
    ctx.scale(-1, 1);
    ctx.drawImage(assets.walker.run, frame * fw, 0, fw, fh, 0, 0, e.w, e.h);
  } else if (e.type === "drone") {
    const img = assets.drone[e.frame % assets.drone.length];
    ctx.shadowColor = "#2de2e6";
    ctx.shadowBlur = 16;
    if (img) ctx.drawImage(img, e.x, e.y, e.w, e.h);
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "rgba(45, 226, 230, 0.45)";
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(e.x + e.w / 2, e.y + e.h);
    ctx.lineTo(e.x + e.w / 2, sY - 4);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.restore();
}

function drawHazardPad(o, color) {
  const sY = standY();
  ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
  ctx.beginPath();
  ctx.ellipse(o.x + o.w / 2, sY - 2, o.w * 0.52, 7, 0, 0, Math.PI * 2);
  ctx.fill();
  const stripeH = 8;
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.9;
  ctx.fillRect(o.x - 6, sY - stripeH, o.w + 12, stripeH);
  ctx.globalAlpha = 1;
  ctx.fillStyle = "#0a0a0a";
  const sw = 10;
  for (let x = o.x - 6; x < o.x + o.w + 6; x += sw * 2) {
    ctx.beginPath();
    ctx.moveTo(x, sY - stripeH);
    ctx.lineTo(x + sw, sY - stripeH);
    ctx.lineTo(x + sw - 4, sY);
    ctx.lineTo(x - 4, sY);
    ctx.closePath();
    ctx.fill();
  }
}

function drawObstacleLabel(o, text, color) {
  ctx.shadowColor = color;
  ctx.shadowBlur = 10;
  ctx.fillStyle = color;
  ctx.font = "bold 12px Share Tech Mono, monospace";
  ctx.fillText(text, o.x + 4, o.y - 8);
  ctx.shadowBlur = 0;
  ctx.fillStyle = "rgba(255, 230, 120, 0.95)";
  ctx.font = "bold 10px Share Tech Mono, monospace";
  ctx.fillText("↑ TOP", o.x + o.w - 36, o.y - 8);
}

function drawCrateObstacle(o) {
  drawHazardPad(o, "#ffcc00");
  // корпус
  const g = ctx.createLinearGradient(o.x, o.y, o.x, o.y + o.h);
  g.addColorStop(0, "#6b4a28");
  g.addColorStop(0.5, "#4a3218");
  g.addColorStop(1, "#2e1e0e");
  ctx.fillStyle = g;
  ctx.shadowColor = "#ffcc00";
  ctx.shadowBlur = 14;
  ctx.fillRect(o.x, o.y, o.w, o.h);
  ctx.shadowBlur = 0;
  ctx.strokeStyle = "#ffcc00";
  ctx.lineWidth = 3;
  ctx.strokeRect(o.x + 1, o.y + 1, o.w - 2, o.h - 2);
  // доски
  ctx.strokeStyle = "rgba(255, 200, 100, 0.35)";
  ctx.lineWidth = 1.5;
  for (let i = 1; i < 3; i++) {
    const yy = o.y + (o.h * i) / 3;
    ctx.beginPath();
    ctx.moveTo(o.x + 4, yy);
    ctx.lineTo(o.x + o.w - 4, yy);
    ctx.stroke();
  }
  // крест-лента
  ctx.strokeStyle = "#c45a12";
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(o.x + 8, o.y + 8);
  ctx.lineTo(o.x + o.w - 8, o.y + o.h - 8);
  ctx.moveTo(o.x + o.w - 8, o.y + 8);
  ctx.lineTo(o.x + 8, o.y + o.h - 8);
  ctx.stroke();
  // warning угол
  ctx.fillStyle = "#ffcc00";
  ctx.beginPath();
  ctx.moveTo(o.x, o.y);
  ctx.lineTo(o.x + 22, o.y);
  ctx.lineTo(o.x, o.y + 22);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#111";
  ctx.font = "bold 10px Share Tech Mono, monospace";
  ctx.fillText("!", o.x + 4, o.y + 14);
  drawObstacleLabel(o, "CRATE", "#ffcc00");
}

function drawWireObstacle(o) {
  drawHazardPad(o, "#c0ff3e");
  const postW = 8;
  const posts = [o.x + 6, o.x + o.w * 0.5 - 4, o.x + o.w - 14];
  // стойки
  for (const px of posts) {
    ctx.fillStyle = "#3a3a42";
    ctx.shadowColor = "#c0ff3e";
    ctx.shadowBlur = 8;
    ctx.fillRect(px, o.y, postW, o.h);
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#8a8a98";
    ctx.fillRect(px + 2, o.y, 2, o.h);
    // навершие
    ctx.fillStyle = "#c0ff3e";
    ctx.fillRect(px - 1, o.y - 4, postW + 2, 5);
  }
  // колючая проволока — 3 ряда
  const rows = [0.22, 0.5, 0.78];
  for (const t of rows) {
    const yy = o.y + o.h * t;
    ctx.strokeStyle = "#d8d8e0";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(o.x + 4, yy);
    for (let x = o.x + 12; x < o.x + o.w - 4; x += 10) {
      const bump = (x / 10) % 2 === 0 ? -4 : 4;
      ctx.lineTo(x, yy + bump);
    }
    ctx.lineTo(o.x + o.w - 4, yy);
    ctx.stroke();
    // шипы
    ctx.strokeStyle = "#c0ff3e";
    ctx.lineWidth = 1.5;
    for (let x = o.x + 14; x < o.x + o.w - 8; x += 14) {
      ctx.beginPath();
      ctx.moveTo(x, yy - 5);
      ctx.lineTo(x + 3, yy);
      ctx.lineTo(x, yy + 5);
      ctx.lineTo(x - 3, yy);
      ctx.closePath();
      ctx.stroke();
    }
  }
  // табличка
  ctx.fillStyle = "#1a1a12";
  ctx.strokeStyle = "#c0ff3e";
  ctx.lineWidth = 2;
  ctx.fillRect(o.x + o.w * 0.28, o.y + o.h * 0.3, o.w * 0.44, 16);
  ctx.strokeRect(o.x + o.w * 0.28, o.y + o.h * 0.3, o.w * 0.44, 16);
  ctx.fillStyle = "#c0ff3e";
  ctx.font = "bold 9px Share Tech Mono, monospace";
  ctx.fillText("WIRE", o.x + o.w * 0.35, o.y + o.h * 0.3 + 12);
  drawObstacleLabel(o, "BARBED", "#c0ff3e");
}

function drawBurnerObstacle(o) {
  drawHazardPad(o, "#ff5a1f");
  const g = ctx.createLinearGradient(o.x, o.y, o.x + o.w, o.y + o.h);
  g.addColorStop(0, "#3a1a12");
  g.addColorStop(0.45, "#5a2818");
  g.addColorStop(1, "#1e0c08");
  ctx.fillStyle = g;
  ctx.shadowColor = "#ff5a1f";
  ctx.shadowBlur = 18;
  ctx.fillRect(o.x, o.y, o.w, o.h);
  ctx.shadowBlur = 0;
  // рёбра контейнера
  ctx.strokeStyle = "#8a4030";
  ctx.lineWidth = 2;
  for (let i = 1; i < 4; i++) {
    const xx = o.x + (o.w * i) / 4;
    ctx.beginPath();
    ctx.moveTo(xx, o.y + 4);
    ctx.lineTo(xx, o.y + o.h - 4);
    ctx.stroke();
  }
  ctx.strokeStyle = "#ff5a1f";
  ctx.lineWidth = 3;
  ctx.strokeRect(o.x + 1, o.y + 1, o.w - 2, o.h - 2);
  // hazard полосы
  ctx.save();
  ctx.beginPath();
  ctx.rect(o.x + 4, o.y + o.h - 18, o.w - 8, 12);
  ctx.clip();
  for (let x = o.x - 20; x < o.x + o.w; x += 14) {
    ctx.fillStyle = "#ffcc00";
    ctx.beginPath();
    ctx.moveTo(x, o.y + o.h - 18);
    ctx.lineTo(x + 8, o.y + o.h - 18);
    ctx.lineTo(x + 2, o.y + o.h - 6);
    ctx.lineTo(x - 6, o.y + o.h - 6);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
  // маркировка
  ctx.fillStyle = "rgba(255, 90, 31, 0.9)";
  ctx.font = "bold 11px Share Tech Mono, monospace";
  ctx.fillText("FLAM", o.x + 10, o.y + 22);
  // огонь сверху
  const flicker = 0.7 + Math.sin(game.time * 14 + (o.phase || 0)) * 0.3;
  const flameCount = 5;
  for (let i = 0; i < flameCount; i++) {
    const fx = o.x + 10 + (i * (o.w - 20)) / (flameCount - 1);
    const hWave =
      16 +
      Math.sin(game.time * 18 + i * 1.3 + (o.phase || 0)) * 8 * flicker;
    const fg = ctx.createLinearGradient(fx, o.y - hWave, fx, o.y + 4);
    fg.addColorStop(0, "rgba(255, 240, 160, 0.95)");
    fg.addColorStop(0.4, "rgba(255, 120, 20, 0.9)");
    fg.addColorStop(1, "rgba(180, 20, 0, 0)");
    ctx.fillStyle = fg;
    ctx.beginPath();
    ctx.moveTo(fx - 6, o.y + 2);
    ctx.quadraticCurveTo(fx - 2, o.y - hWave * 0.5, fx, o.y - hWave);
    ctx.quadraticCurveTo(fx + 2, o.y - hWave * 0.5, fx + 6, o.y + 2);
    ctx.closePath();
    ctx.fill();
  }
  // дым
  ctx.globalAlpha = 0.35;
  for (let i = 0; i < 3; i++) {
    const sx =
      o.x +
      o.w * 0.25 +
      i * 18 +
      Math.sin(game.time * 2 + i + (o.phase || 0)) * 6;
    const sy = o.y - 28 - i * 10 - ((game.time * 30 + i * 20) % 24);
    ctx.fillStyle = "#888";
    ctx.beginPath();
    ctx.arc(sx, sy, 7 + i * 2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  drawObstacleLabel(o, "FIRE", "#ff5a1f");
}

function drawObstacle(o) {
  ctx.save();
  if (o.kind === "wire") drawWireObstacle(o);
  else if (o.kind === "burner") drawBurnerObstacle(o);
  else drawCrateObstacle(o);
  ctx.restore();
}

function drawBullets() {
  for (const b of bullets) {
    ctx.save();
    if (b.enemy) {
      ctx.shadowColor = "#ff3355";
      ctx.shadowBlur = 18;
      const g = ctx.createRadialGradient(b.x, b.y, 1, b.x, b.y, b.w);
      g.addColorStop(0, "#fff");
      g.addColorStop(0.35, "#ff4d6d");
      g.addColorStop(1, "rgba(255, 40, 80, 0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.w * 0.55, 0, Math.PI * 2);
      ctx.fill();
    } else {
      const img = assets.fx.shot[Math.floor(game.time * 16) % assets.fx.shot.length];
      ctx.translate(b.x, b.y);
      ctx.rotate(b.angle || 0);
      ctx.shadowColor = "#2de2e6";
      ctx.shadowBlur = 14;
      if (img) ctx.drawImage(img, 0, -9, 30, 18);
      else {
        ctx.fillStyle = "#2de2e6";
        ctx.fillRect(0, -3, b.w, 6);
      }
    }
    ctx.restore();
  }
}

function drawRockets() {
  for (const r of rockets) {
    ctx.save();
    if (r.look === "saw") {
      const cx = r.x + r.w / 2;
      const cy = r.y + r.h / 2;
      const rad = r.w * 0.42;
      ctx.translate(cx, cy);
      ctx.rotate(r.spin);
      ctx.shadowColor = r.flash > 0 ? "#fff" : "#c0ff3e";
      ctx.shadowBlur = r.flash > 0 ? 22 : 14;
      ctx.fillStyle = "#1a2210";
      ctx.strokeStyle = r.flash > 0 ? "#fff" : "#c0ff3e";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        const rr = i % 2 === 0 ? rad : rad * 0.62;
        const x = Math.cos(a) * rr;
        const y = Math.sin(a) * rr;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, rad * 0.28, 0, Math.PI * 2);
      ctx.fillStyle = "#ff5a1f";
      ctx.fill();
      ctx.restore();
      continue;
    }
    if (r.look === "drone" && assets.drone.length) {
      const img = assets.drone[Math.floor(r.spin * 2) % assets.drone.length];
      ctx.shadowColor = "#2de2e6";
      ctx.shadowBlur = 12;
      if (img) ctx.drawImage(img, r.x, r.y, r.w, r.h);
      else {
        ctx.fillStyle = "#2de2e6";
        ctx.fillRect(r.x, r.y, r.w, r.h);
      }
      ctx.restore();
      continue;
    }
    ctx.translate(r.x + r.w / 2, r.y + r.h / 2);
    ctx.rotate(Math.atan2(r.vy, r.vx));
    ctx.shadowColor = "#ffb347";
    ctx.shadowBlur = 16;
    // корпус
    ctx.fillStyle = "#2a1520";
    ctx.strokeStyle = "#ffb347";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(14, 0);
    ctx.lineTo(-10, -7);
    ctx.lineTo(-6, 0);
    ctx.lineTo(-10, 7);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // огонь
    ctx.fillStyle = "#ff4d6d";
    ctx.beginPath();
    ctx.moveTo(-10, 0);
    ctx.lineTo(-18 - Math.sin(r.spin) * 3, -4);
    ctx.lineTo(-18 - Math.sin(r.spin) * 3, 4);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

function drawPickups() {
  for (const p of pickups) {
    const def = POWER[p.type] || POWER.heal;
    ctx.save();
    ctx.shadowColor = def.color;
    ctx.shadowBlur = 14;
    ctx.fillStyle = "rgba(8, 2, 24, 0.85)";
    ctx.strokeStyle = def.color;
    ctx.lineWidth = 2;
    const cx = p.x + p.w / 2;
    const cy = p.y + p.h / 2;
    ctx.beginPath();
    ctx.arc(cx, cy, 15, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = def.color;
    ctx.font = "bold 9px Share Tech Mono, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const short =
      p.type === "spread"
        ? "×3"
        : p.type === "autofire"
          ? "AUTO"
          : p.type === "shield"
            ? "SH"
            : "+HP";
    ctx.fillText(short, cx, cy);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.restore();
  }
}

function drawRain() {
  ctx.strokeStyle = "rgba(180, 220, 255, 0.22)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const r of game.rain) {
    ctx.moveTo(r.x, r.y);
    ctx.lineTo(r.x - 3, r.y + r.len);
  }
  ctx.stroke();
}

function drawVignette() {
  const w = lw();
  const h = lh();
  const g = ctx.createRadialGradient(w / 2, h / 2, h * 0.2, w / 2, h / 2, h * 0.85);
  g.addColorStop(0, "transparent");
  g.addColorStop(1, "rgba(0, 0, 0, 0.55)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

function draw(dt) {
  const w = lw();
  const h = lh();
  ctx.save();
  if (game.shake > 0) {
    ctx.translate(
      (Math.random() - 0.5) * game.shake,
      (Math.random() - 0.5) * game.shake
    );
  }

  drawParallax();

  for (const o of obstacles) drawObstacle(o);
  for (const e of enemies) drawEnemy(e);
  drawBoss();
  drawHazards();
  drawPickups();
  drawRockets();
  drawBullets();
  drawPlayer();

  // щит вокруг игрока
  if (player.power.shield > 0) {
    ctx.save();
    ctx.strokeStyle = `rgba(122, 247, 255, ${0.35 + Math.sin(game.time * 8) * 0.2})`;
    ctx.lineWidth = 2;
    ctx.shadowColor = "#7af7ff";
    ctx.shadowBlur = 18;
    ctx.beginPath();
    ctx.ellipse(
      player.x + player.w * 0.5,
      player.y + player.h * 0.5,
      player.w * 0.55,
      player.h * 0.55,
      0,
      0,
      Math.PI * 2
    );
    ctx.stroke();
    ctx.restore();
  }

  for (const p of particles) {
    ctx.globalAlpha = Math.max(0, p.life * 2);
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x, p.y, p.size, p.size);
    ctx.globalAlpha = 1;
  }
  for (const f of floats) {
    ctx.globalAlpha = Math.max(0, f.life);
    ctx.fillStyle = f.color || "#2de2e6";
    ctx.font = `bold ${f.size || 14}px Orbitron, sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText(f.text, f.x, f.y);
    ctx.textAlign = "left";
    ctx.globalAlpha = 1;
  }

  drawRain();
  drawVignette();
  drawBossHud();

  // красная вспышка при получении урона
  if (game.hitFlash > 0) {
    ctx.fillStyle = `rgba(255, 30, 70, ${game.hitFlash * 0.55})`;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#ff4d6d";
    ctx.font = "bold 22px Orbitron, sans-serif";
    ctx.textAlign = "center";
    ctx.globalAlpha = Math.min(1, game.hitFlash * 3);
    ctx.fillText(game.hitLabel || "УРОН", w / 2, h * 0.28);
    ctx.textAlign = "left";
    ctx.globalAlpha = 1;
  }

  ctx.restore();

  // menu idle preview
  if (state === STATE.MENU) {
    // soft animated backdrop only — overlay covers UI
  }
}

/* ---------- Loop ---------- */
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.033, (now - last) / 1000);
  last = now;
  update(dt);
  requestAnimationFrame(frame);
}

async function boot() {
  resize();
  window.addEventListener("resize", () => {
    resize();
    if (state === STATE.PLAY) {
      player.y = Math.min(player.y, standY() - player.h);
    }
  });
  // prevent scroll/bounce — except start-panel settings / scrollable panel
  document.body.addEventListener(
    "touchmove",
    (e) => {
      if (e.target.closest("#settings, .panel, select, button")) return;
      e.preventDefault();
    },
    { passive: false }
  );

  initSettingsUI();

  try {
    await loadAll();
  } catch (err) {
    console.error(err);
    alert("Не удалось загрузить ассеты. Проверьте пути в /assets");
    return;
  }

  initRain();
  // draw menu background once assets ready
  resetGame();
  state = STATE.MENU;
  requestAnimationFrame(frame);
}

boot();
