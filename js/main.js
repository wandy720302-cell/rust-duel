import * as THREE from 'three';
import { buildWorld } from './world.js';
import { createBody, stepBody } from './physics.js';
import { createAvatar, SKINS } from './avatar.js';
import { createViewmodel, AK, RECOIL, ROCK, SIGHTS, SIGHT_ORDER } from './weapon.js';
import { createBuilder, WALL } from './build.js';
import { createEffects } from './effects.js';
import { createAudio } from './audio.js';
import { createNet, makeRoomCode, errText, hasTurn } from './net.js';
import { initHud, hud, ICON } from './hud.js';
import { createTouch, isTouchDevice } from './touch.js';
import { createPost } from './post.js';
import { createStructures } from './structures.js';
import { createProjectiles } from './projectiles.js';
import { createSurvival } from './survival.js';
import { createInvUI } from './invui.js';
import { GUNS, MELEE, BOW, REGEN, PIECES, ITEMS as ITEM_DEFS, FOOD, BANDAGE, falloffMult } from './items.js';

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const deg = THREE.MathUtils.degToRad;
const v3 = (v) => [+v.x.toFixed(2), +v.y.toFixed(2), +v.z.toFixed(2)];
const toV = (a) => new THREE.Vector3(a[0], a[1], a[2]);

const KILLS_TO_WIN = 5;
const REGEN_DELAY = REGEN.delay * 1000, REGEN_RATE = REGEN.perSec;
const PIECE_NAME = Object.fromEntries(Object.entries(PIECES).map(([k, v]) => [k, v.name]));
const COSTS = Object.fromEntries(Object.entries(PIECES).map(([k, v]) => [k, v.cost]));
const ITEM_NAME = Object.fromEntries(Object.entries(ITEM_DEFS).map(([k, v]) => [k, v.name]));
const SEND_HZ = 20;
const INTERP_MS = 110;     // 對手畫面延遲這麼多來做內插，換取不抖
const BAG_CD = 6, BEACH_CD = 3;
const SYRINGE_TIME = 1.3;
const TOUCH = isTouchDevice();   // 手機/平板：觸控操作 + 降畫質 + 輔助瞄準
document.body.classList.toggle('touch', TOUCH);
const OPEN_INV = TOUCH ? '按左上的「背包」' : '按 Tab 打開背包';

// ---------- 設定 ----------
const settings = { sens: 1, fov: 80, vol: 0.8, post: !TOUCH };
try { Object.assign(settings, JSON.parse(localStorage.getItem('rustduel.settings') || '{}')); } catch { /* 私密視窗 */ }
const saveSettings = () => { try { localStorage.setItem('rustduel.settings', JSON.stringify(settings)); } catch { /* ignore */ } };

// ---------- 畫面 ----------
const canvas = $('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, TOUCH ? 1.25 : 1.5));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.autoClear = false;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(settings.fov, 1, 0.08, 2600);
camera.rotation.order = 'YXZ';
scene.add(camera);

const world = buildWorld(scene, { mobile: TOUCH, renderer });
const T = world.T;
const fx = createEffects(scene, T);
const audio = createAudio();
audio.setVolume(settings.vol);
const vm = createViewmodel(T, SKINS[0].skin);
vm.scene.environment = world.env;
// 後製（泛光 + 調色）；手機預設關掉省電
const post = createPost(renderer, scene, camera, vm.scene, vm.cam);
const applyPost = () => document.body.classList.toggle('post', !!settings.post);
applyPost();
const builder = createBuilder(world, fx);
const structs = createStructures(world, fx);
const proj = createProjectiles(world, fx, audio, scene);
const ITEMS = ['ak', 'rock', 'plan'];
initHud();
if (TOUCH) {
  document.querySelector('#clickToPlay .panel').innerHTML = '<b>點一下開始</b><small>會切成全螢幕 · 左邊搖桿移動、右邊拖曳轉視角 · 右上 ❚❚ 暫停</small>';
  document.querySelector('.foot').textContent = '非官方致敬作品 · 手機請橫著拿 · 手機玩家有輔助瞄準';
}

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h);
  post.setSize(w, h, renderer.getPixelRatio());
  camera.aspect = w / h; camera.updateProjectionMatrix();
  vm.setAspect(w / h);
}
addEventListener('resize', resize);
resize();

// ---------- 狀態 ----------
const S = {
  mode: 'lobby', online: false,
  myName: '', oppName: '對手', side: 'A',
  body: createBody(new THREE.Vector3()), yaw: 0, pitch: 0, eyeY: 0, punch: 0, roll: 0,
  hp: 100, alive: false, kills: 0, deaths: 0,
  ammo: AK.mag, reload: -1, fireCd: 0, shotIdx: 0, lastShot: 0,
  syringes: 2, inject: -1, regen: 0,
  water: 60, food: 120,
  ads: 0, sprinting: false, speed: 0, stepAcc: 0,
  matchOver: false, wantRematch: false, oppWantRematch: false,
  deathAt: 0, sendAcc: 0, pingAcc: 0, mdx: 0, mdy: 0,
  item: 'ak', sight: 'iron', scoped: false, wood: 0, swingT: -1, swingCd: 0, wasFiring: false, wallN: 0, lookAt: 0, build: null,
  gameMode: 'duel', uiOpen: false, oppKills: 0, bowDraw: 0, tossT: -1, tossCd: 0, shake: 0, swingWith: 'rock', reloadTotal: AK.reload, scoreAt: 0,
  useT: -1, useDur: 0, useId: null, heal: 0, starving: false,
};
const opp = {
  avatar: null, snaps: [], prevPos: new THREE.Vector3(), stepAcc: 0,
  cur: { pos: new THREE.Vector3(), yaw: 0, pitch: 0, crouch: 0, speed: 0, alive: true, g: 1, item: 'ak', sight: 'iron' },
};
let dummy = null;
let net = null;

// ---------- 生存模式 ----------
const survHost = {
  send: (m) => { if (S.online) net?.send(m); },
  isAuth: () => !S.online || net?.role === 'host',
  me: () => S.side,
  feet: () => S.body.pos,
  eye: () => camera.position,
  aimDir: () => new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(S.pitch, S.yaw, 0, 'YXZ')),
  forwardFlat: () => new THREE.Vector3(-Math.sin(S.yaw), 0, -Math.cos(S.yaw)),
  yaw: () => S.yaw,
  velocity: () => new THREE.Vector3(S.body.vel.x, S.body.vel.y, S.body.vel.z),
  alive: () => S.alive,
  players() { const a = [S.body.pos]; if (S.online && opp.snaps.length && opp.cur.alive) a.push(opp.cur.pos); return a; },
  playersNear(p, r) { return survHost.players().some((q) => q.distanceTo(p) < r); },
  opponent: () => (S.online && opp.snaps.length ? { pos: opp.cur.pos, alive: opp.cur.alive } : null),
  damageSelf: (dmg, from, w) => onHit({ dmg, part: 'body', from: v3(from), w, self: true }),
  damageOpponent: (dmg, part, from, w) => { if (S.online) net.send({ t: 'hit', dmg, part, from: v3(from), w }); hud.hitmarker(false); },
  sendTreeHit: (tree, got, dir) => { if (S.online) net.send({ t: 'thit', k: tree.kind, i: tree.i, a: got, dx: +dir.x.toFixed(2), dz: +dir.z.toFixed(2) }); },
  openInventory: (open) => (open ? openInv() : closeInv()),
  keypad: (title, cb) => { S.uiOpen = true; releaseControl(); invui.openKeypad(title, cb); },
  shake: (k) => { S.shake = Math.max(S.shake, k); },
  // 北極熊用：場上的人，跟「熊咬到誰」（房主判定；咬到對手就送 hit 過去，算環境傷害）
  actors() {
    const a = [{ who: S.side, pos: S.body.pos, alive: S.alive }];
    if (S.online && opp.snaps.length) a.push({ who: S.side === 'A' ? 'B' : 'A', pos: opp.cur.pos, alive: opp.cur.alive });
    return a;
  },
  hurtActor(who, dmg, from) {
    const m = { dmg, part: 'body', from: v3(from), w: 'bear', env: '北極熊' };
    if (who === S.side) onHit(m); else if (S.online) net.send({ t: 'hit', ...m });
  },
};
const surv = createSurvival({ world, scene, fx, audio, hud, structs, proj, host: survHost });
const invui = createInvUI({ surv, audio, isTouch: TOUCH, onClose: (resume) => closeInv(resume !== false) });
surv.onChange(() => { if (S.gameMode === 'survival') syncHeld(); });

function openInv() {
  if (S.gameMode !== 'survival' || !S.alive || S.matchOver) return;
  S.uiOpen = true;
  releaseControl();
  invui.open();
}
// 關掉背包 / 鍵盤 / 建築選單。從點擊或按鍵關的就直接回到遊戲，不然跳出「點一下開始」
function closeInv(resume = true) {
  invui.closeAll();
  S.uiOpen = false;
  if (S.mode !== 'play' || !S.alive || S.matchOver) return;
  if (resume) resumeControl(); else $('clickToPlay').hidden = false;
}
function openBuildMenu() { S.uiOpen = true; releaseControl(); invui.openBuildMenu(); }

// 手上拿的東西變了（換格子、用完、撿到）就重設動作、換模型
let heldKey = '';
function syncHeld() {
  const it = surv.held();
  const look = surv.holdLook(), kind = surv.holdKind();
  const k = `${surv.hotIdx}|${it ? it.id : ''}`;
  if (k !== heldKey) {
    heldKey = k;
    S.reload = -1; S.swingT = -1; S.bowDraw = 0; S.tossT = -1; S.useT = -1;
    if (kind !== 'gun' && kind !== 'bow') aiming = false;
    vm.setItem(look);
    S.item = look;
    S.swingCd = 0.35; S.fireCd = Math.max(S.fireCd, 0.3);
    if (kind === 'gun') S.ammo = it.d?.mag ?? 0;
    if (kind !== 'build' && kind !== 'deploy') surv.hidePreview();
  }
  if (kind === 'gun' && S.reload < 0 && it.d) S.ammo = it.d.mag;
  touch.setMode(look, kind);
  invui.renderHotbar();
}
const selectHot = (i) => { if (S.alive) surv.selectHot(i); };

// ---------- 輸入 ----------
const keys = new Set();
let firing = false, aiming = false;
const locked = () => document.pointerLockElement === canvas;
// 電腦靠 pointer lock、手機靠觸控層，兩邊都叫「操作中」
const inputActive = () => (TOUCH ? touch.active : locked());

const touch = createTouch($('touch'), {
  onTap(b, idx) {
    if (b === 'reload') startReload();
    else if (b === 'slot') { if (S.gameMode === 'survival') selectHot(idx); else selectSlot(idx); }
    else if (b === 'inv') { if (S.uiOpen) closeInv(); else openInv(); }
    else if (b === 'use') surv.interact();
    else if (b === 'pick') openBuildMenu();
    else if (b === 'rot') surv.rotate();
    else if (b === 'scope') cycleSight();
    else if (b === 'pause') { releaseControl(); showPause(); }
  },
});

function enterFullscreen() {
  const el = document.documentElement;
  if (document.fullscreenElement || !el.requestFullscreen) return;
  el.requestFullscreen({ navigationUI: 'hide' })
    .then(() => screen.orientation?.lock?.('landscape'))
    .catch(() => { /* iPhone 的 Safari 不給全螢幕，橫著拿就好 */ });
}

// 回到操作狀態（一定要在點擊事件裡呼叫，瀏覽器才肯鎖滑鼠/開全螢幕）
function resumeControl() {
  audio.unlock();
  $('pause').hidden = true; $('clickToPlay').hidden = true;
  if (TOUCH) { enterFullscreen(); touch.setActive(true); return; }
  requestLock();
}
function releaseControl() {
  firing = aiming = false;
  if (TOUCH) { touch.setActive(false); touch.setAim(false); return; }
  if (document.pointerLockElement) document.exitPointerLock();
}

function requestLock() {
  // 瀏覽器拒絕鎖滑鼠（例如剛按過 Esc）時，退回「點一下開始」
  setTimeout(() => { if (!locked() && S.mode === 'play' && S.alive && !S.uiOpen && !S.matchOver && $('pause').hidden) $('clickToPlay').hidden = false; }, 400);
  try {
    const p = canvas.requestPointerLock({ unadjustedMovement: true });
    if (p?.catch) p.catch(() => { try { canvas.requestPointerLock(); } catch { /* 太快重鎖會被瀏覽器拒絕 */ } });
  } catch {
    try { canvas.requestPointerLock(); } catch { /* ignore */ }
  }
}

addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  keys.add(e.code);
  if (S.mode !== 'play') return;
  if (['Space', 'KeyC', 'Tab'].includes(e.code)) e.preventDefault();
  if (S.gameMode === 'survival') {
    if (e.code === 'Tab') { if (invui.isOpen) closeInv(); else if (locked()) openInv(); return; }
    if (e.code === 'Escape' && S.uiOpen) { closeInv(false); return; }
    if (!locked()) return;
    survivalKey(e);
    return;
  }
  if (!locked()) return;
  if (e.code === 'KeyR') startReload();
  if (e.code === 'KeyV') cycleSight();
  const slot = { Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3, Digit5: 4 }[e.code];
  if (slot !== undefined) selectSlot(slot);
});
function survivalKey(e) {
  const slot = { Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3, Digit5: 4, Digit6: 5 }[e.code];
  if (slot !== undefined) { selectHot(slot); return; }
  const kind = surv.holdKind();
  if (e.code === 'KeyE') surv.interact();
  else if (e.code === 'KeyR') { if (kind === 'gun') startReload(); else if (kind === 'build' || kind === 'deploy') surv.rotate(); }
  else if (e.code === 'KeyV' && surv.held()?.id === 'ak') cycleSight();
}
// 滾輪在 AK / 石頭 / 木牆之間輪流切（生存模式：快捷欄 1~6 輪流）
addEventListener('wheel', (e) => {
  if (S.mode !== 'play' || !locked() || !S.alive) return;
  if (S.gameMode === 'survival') { selectHot((surv.hotIdx + (e.deltaY > 0 ? 1 : 5)) % 6); return; }
  const i = ITEMS.indexOf(S.item);
  selectItem(ITEMS[(i + (e.deltaY > 0 ? 1 : ITEMS.length - 1)) % ITEMS.length]);
}, { passive: true });
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => { keys.clear(); firing = aiming = false; touch.reset(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) { keys.clear(); firing = aiming = false; touch.reset(); } });

canvas.addEventListener('mousedown', (e) => {
  if (S.mode !== 'play') return;
  if (!locked()) return;
  if (e.button === 0) firing = true;
  if (e.button === 2) {
    if (S.gameMode === 'survival' && surv.holdKind() === 'build') { openBuildMenu(); return; }
    aiming = true;
  }
});
addEventListener('mouseup', (e) => { if (e.button === 0) firing = false; if (e.button === 2) aiming = false; });
addEventListener('contextmenu', (e) => { if (S.mode === 'play') e.preventDefault(); });
addEventListener('mousemove', (e) => {
  if (!locked() || !S.alive || S.uiOpen) return;   // 開著背包、鍵盤時不轉視角
  if (Math.abs(e.movementX) > 500 || Math.abs(e.movementY) > 500) return; // Chrome 偶爾吐出的瞬移值
  const k = 0.0022 * settings.sens * (camera.fov / settings.fov);
  S.yaw -= e.movementX * k;
  S.pitch = clamp(S.pitch - e.movementY * k, -1.52, 1.52);
  S.mdx += e.movementX; S.mdy += e.movementY;
});

document.addEventListener('pointerlockchange', () => {
  if (locked()) {
    $('pause').hidden = true; $('clickToPlay').hidden = true;
  } else {
    firing = aiming = false;
    if (S.mode === 'play' && S.alive && !S.matchOver && !S.uiOpen) showPause();
  }
});
$('clickToPlay').addEventListener('click', () => resumeControl());

// ---------- 暫停 / 設定 ----------
function bindSlider(id, key, fmt, apply) {
  const el = $(id), out = $(id + 'Val');
  el.value = settings[key]; out.textContent = fmt(settings[key]);
  el.addEventListener('input', () => {
    settings[key] = +el.value; out.textContent = fmt(settings[key]);
    apply?.(); saveSettings();
  });
}
bindSlider('sens', 'sens', (v) => v.toFixed(2));
bindSlider('fov', 'fov', (v) => `${v}°`);
bindSlider('vol', 'vol', (v) => `${Math.round(v * 100)}%`, () => audio.setVolume(settings.vol));
$('post').checked = !!settings.post;
$('post').addEventListener('change', () => { settings.post = $('post').checked; applyPost(); saveSettings(); });
function showPause() { $('pause').hidden = false; }
$('btnResume').addEventListener('click', () => resumeControl());
$('btnLeave').addEventListener('click', leave);
// 遊戲說明：大廳和暫停選單都打得開；點背景、按 ✕ 或 Esc 關掉
function guideTab(g) {
  $('guideTabs').querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === g));
  $('guide').querySelectorAll('.guideBody [data-g]').forEach((el) => { el.hidden = el.dataset.g !== g; });
}
$('guideTabs').addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) guideTab(b.dataset.tab); });
function openGuide() {
  guideTab((S.mode === 'play' ? S.gameMode : lobbyMode) === 'survival' ? 'surv' : 'duel');
  $('guide').hidden = false; $('guide').querySelector('.guideBody').scrollTop = 0;
}
function closeGuide() { $('guide').hidden = true; }
$('btnGuide').addEventListener('click', openGuide);
$('btnGuide2').addEventListener('click', openGuide);
$('btnGuideClose').addEventListener('click', closeGuide);
$('guide').addEventListener('click', (e) => { if (e.target.id === 'guide') closeGuide(); });
addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('guide').hidden) closeGuide(); });
$('btnEndLeave').addEventListener('click', leave);
function leave() {
  net?.destroy();
  location.href = location.pathname;
}

// ---------- 大廳 ----------
const nameInput = $('nameInput');
try { nameInput.value = localStorage.getItem('rustduel.name') || ''; } catch { /* ignore */ }
if (!nameInput.value) nameInput.value = `裸男${Math.floor(100 + Math.random() * 900)}`;
const params = new URLSearchParams(location.search);
if (params.get('room')) { $('codeInput').value = params.get('room').toUpperCase(); }

function readName() {
  S.myName = nameInput.value.trim().slice(0, 14) || '無名裸男';
  try { localStorage.setItem('rustduel.name', S.myName); } catch { /* ignore */ }
}
let lobbyMode = 'duel';
$('modeSel').addEventListener('click', (e) => {
  const b = e.target.closest('[data-mode]');
  if (!b || net) return;
  lobbyMode = b.dataset.mode;
  $('modeSel').querySelectorAll('[data-mode]').forEach((x) => x.classList.toggle('on', x === b));
  $('modeTag').textContent = lobbyMode === 'survival' ? '1v1 · 生存 · 30 分鐘內擊殺多的贏' : '1v1 · 突擊步槍 · 先拿 5 殺的贏';
  $('btnSolo').textContent = lobbyMode === 'survival' ? '單人練習：自己挖、自己蓋' : '單人練習：打稻草人';
  const surv = lobbyMode === 'survival';
  $('keysDuel').hidden = $('tipDuel').hidden = surv;
  $('keysSurv').hidden = $('tipSurv').hidden = !surv;
});
const lobbyStatus = (t) => { $('lobbyStatus').textContent = t || ''; };
function lobbyBusy(b) { for (const id of ['btnHost', 'btnJoin', 'btnSolo']) $(id).disabled = b; }

function makeNet() {
  net = createNet({
    onOpen: () => net.send({ t: 'hello', name: S.myName }),
    onMessage,
    onClose: () => {
      if (S.mode === 'play') endMatch(null, '對手斷線了');
      else { lobbyStatus('連線中斷'); lobbyBusy(false); }
    },
    onError: (e) => { if (S.mode !== 'play') { lobbyStatus(errText(e)); lobbyBusy(false); } },
  });
}

$('btnHost').addEventListener('click', async () => {
  readName(); audio.unlock(); lobbyBusy(true); lobbyStatus('開房中…');
  makeNet();
  const code = makeRoomCode();
  try {
    await net.host(code);
    $('roomBox').hidden = false;
    $('roomCode').textContent = code;
    lobbyStatus((await hasTurn()) ? '' : '提示：沒設定 TURN，朋友用手機網路可能連不進來（README 有說明）');
  } catch (e) {
    lobbyStatus(errText(e)); lobbyBusy(false);
  }
});
$('btnCopy').addEventListener('click', async () => {
  const url = `${location.origin}${location.pathname}?room=${$('roomCode').textContent}`;
  try { await navigator.clipboard.writeText(url); $('btnCopy').textContent = '已複製'; }
  catch { prompt('複製這個連結給朋友', url); }
});
$('btnJoin').addEventListener('click', async () => {
  const code = $('codeInput').value.trim().toUpperCase();
  if (code.length !== 6) { lobbyStatus('房間碼是 6 碼'); return; }
  readName(); audio.unlock(); lobbyBusy(true); lobbyStatus('連線中…');
  makeNet();
  try { await net.join(code); lobbyStatus('連上了，等房主開始…'); }
  catch (e) { lobbyStatus(errText(e)); lobbyBusy(false); }
});
$('codeInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btnJoin').click(); });
$('btnSolo').addEventListener('click', () => { readName(); audio.unlock(); startSolo(lobbyMode); });

// ---------- 開局 ----------
function enterPlay() {
  S.mode = 'play';
  document.body.classList.add('playing');
  $('lobby').hidden = true;
  hud.show(true);
  S.kills = S.deaths = S.oppKills = 0;
  S.matchOver = false; S.wantRematch = S.oppWantRematch = false;
  $('matchEnd').hidden = true;
  fx.clearHoles();
  builder.clear();
  world.trees.reset();
  S.wood = 0; S.wallN = 0;
  setSight(S.sight);
  touch.setSurvival(S.gameMode === 'survival');
  document.body.classList.toggle('survival', S.gameMode === 'survival');
  if (S.gameMode === 'survival') {
    S.uiOpen = false;
    invui.closeAll();
    surv.reset();
    spawn('beach');
  } else spawn('bag');
  updateScore();
  $('clickToPlay').hidden = false;
}

function startMatch(mode = 'duel') {
  if (S.mode === 'play') return;
  S.online = true;
  S.gameMode = mode === 'survival' ? 'survival' : 'duel';
  S.side = net.role === 'host' ? 'A' : 'B';
  const mine = SKINS[S.side === 'A' ? 0 : 1], theirs = SKINS[S.side === 'A' ? 1 : 0];
  vm.setSkin(mine.skin);
  opp.avatar = createAvatar(scene, theirs, T);
  opp.avatar.setVisible(false);
  opp.snaps = [];
  enterPlay();
  hud.toast(S.gameMode === 'survival' ? `對上 ${S.oppName}。生存模式：先拿石頭敲樹，${OPEN_INV}做東西` : `對上 ${S.oppName}。你的基地在${S.side === 'A' ? '西' : '東'}邊`, 5000);
}

const DUMMY_SPOTS = [[0, 10], [-11, -1], [11, -1], [0, -11], [-21, 7], [21, 7], [-9, 15], [9, 15]];
function startSolo(mode = 'duel') {
  S.online = false;
  S.side = 'A';
  S.gameMode = mode === 'survival' ? 'survival' : 'duel';
  vm.setSkin(SKINS[0].skin);
  if (S.gameMode === 'survival') {
    enterPlay();
    hud.toast(`單人生存：拿石頭敲樹拿木頭，${OPEN_INV}做東西`, 5000);
    return;
  }
  dummy = {
    avatar: createAvatar(scene, SKINS[3], T), hp: 100, alive: true, spot: 0, t0: 0, respawnAt: 0,
    pos: new THREE.Vector3(), yaw: 0, prevX: 0,
  };
  placeDummy();
  enterPlay();
  hud.toast('稻草人 Bob 在中間廢墟附近晃。先熟悉一下壓槍', 4500);
}
function placeDummy() {
  const [x, z] = DUMMY_SPOTS[dummy.spot % DUMMY_SPOTS.length];
  dummy.spot++;
  dummy.base = new THREE.Vector3(x, 0, z);
  dummy.hp = 100; dummy.alive = true;
  dummy.t0 = performance.now() / 1000;
}

function spawn(kind) {
  let sp = null;
  if (S.gameMode === 'survival' && kind === 'bag') {
    const b = surv.myBags().at(-1);
    if (b) sp = { pos: new THREE.Vector3(b.x, b.y + 0.1, b.z), yaw: b.r };
  } else if (kind === 'bag') sp = world.spawns[S.side];
  if (!sp) {
    const enemy = S.online ? opp.cur.pos : null;
    const ranked = world.spawns.beach
      .map((s) => ({ s, d: enemy ? s.pos.distanceTo(enemy) : Math.random() }))
      .sort((a, b) => b.d - a.d);
    sp = ranked[Math.floor(Math.random() * 3)].s;
  }
  S.body = createBody(sp.pos);
  S.yaw = sp.yaw; S.pitch = 0; S.roll = 0; S.punch = 0;
  S.eyeY = sp.pos.y + 1.68;
  S.hp = 100; S.alive = true; S.ammo = AK.mag; S.reload = -1; S.fireCd = 0; S.shotIdx = 0;
  S.syringes = 2; S.inject = -1; S.regen = 0;
  // rust 的重生：又渴又餓
  S.water = 30 + Math.random() * 20;
  S.food = S.gameMode === 'survival' ? FOOD.spawn[0] + Math.random() * (FOOD.spawn[1] - FOOD.spawn[0]) : 60 + Math.random() * 40;
  S.heal = 0; S.useT = -1; S.starving = false;
  $('death').hidden = true;
  const w = $('wake'); w.classList.add('on'); void w.offsetWidth; w.classList.remove('on');
  S.swingT = -1; S.swingCd = 0; S.bowDraw = 0; S.tossT = -1; S.shake = 0;
  if (S.gameMode === 'survival') {
    surv.giveStart();
    heldKey = '';
    syncHeld();
  } else {
    S.item = '';
    selectItem('ak');
    hud.syringes(S.syringes);
    hud.wood(S.wood, WALL.cost);
  }
  sendState();
}

// ---------- 武器 ----------
// 瞄具：照門 → 全息紅點 → 8 倍鏡，輪流切
function setSight(k) {
  S.sight = k;
  vm.setSight(k);
  touch.setSightLabel(SIGHTS[k].short);
  hud.sight(SIGHTS[k].short);
}
function cycleSight() {
  if (!S.alive) return;
  setSight(SIGHT_ORDER[(SIGHT_ORDER.indexOf(S.sight) + 1) % SIGHT_ORDER.length]);
  hud.toast(`瞄具：${SIGHTS[S.sight].name}`, 1200);
}

// 快捷欄：0 AK、1 針筒、2 石頭、3 木牆、4 木頭（只是顯示）
function selectSlot(i) {
  if (!S.alive) return;
  if (i === 0) selectItem('ak');
  else if (i === 1) useSyringe();
  else if (i === 2) selectItem('rock');
  else if (i === 3) selectItem('plan');
  else hud.toast(`木頭 ${S.wood}：拿石頭敲樹可以拿更多`, 1500);
}
function selectItem(k) {
  if (S.item === k) return;
  S.item = k;
  S.reload = -1; S.swingT = -1;
  if (k !== 'ak') aiming = false;
  vm.setItem(k);
  touch.setMode(k);
  hud.activeSlot({ ak: 0, rock: 2, plan: 3 }[k]);
  if (k !== 'plan') { builder.showGhost(null); hud.hint(null); }
  S.swingCd = 0.35;   // 拿出來要一點時間
  S.fireCd = Math.max(S.fireCd, 0.3);
}

function startSwing() {
  S.swingCd = ROCK.swing;
  S.swingT = 0;
  vm.swing();
  audio.whoosh();
  if (S.online) net.send({ t: 'sw' });
}

// 石頭砸下去的那一瞬間：先看有沒有敲到人，再看敲到樹、牆、還是別的
function meleeHit() {
  if (!S.alive) return;
  aimEuler.set(S.pitch, S.yaw, 0);
  const dir = new THREE.Vector3(0, 0, -1).applyEuler(aimEuler);
  const origin = camera.position.clone();
  const wh = world.raycast(origin, dir, ROCK.reach);
  const target = S.online ? opp.avatar : dummy?.avatar;
  const oh = target?.rayHit(origin, dir, wh ? wh.dist : ROCK.reach);
  if (oh) {
    const head = oh.part === 'head';
    const dmg = Math.round(ROCK.dmg * (head ? ROCK.headMult : 1));
    fx.blood(origin.clone().addScaledVector(dir, oh.dist));
    audio.hit(head); audio.chop();
    hud.hitmarker(head);
    if (S.online) net.send({ t: 'hit', dmg, part: oh.part, from: v3(origin), w: 'rock' });
    else dummyHit(dmg, oh.part, origin, 'rock');
    return;
  }
  if (!wh) return;
  fx.impact(wh.point, wh.normal, wh.surf);
  const tree = world.trees.fromHit(wh);
  const wall = builder.fromHit(wh);
  if (tree) {
    audio.chop();
    const got = world.trees.chop(tree, ROCK.chop);
    if (got > 0) {
      S.wood += got;
      hud.wood(S.wood, WALL.cost);
      hud.pickup('木頭', `+${got}`);
    }
    if (S.online) net.send({ t: 'thit', k: tree.kind, i: tree.i, a: got, dx: +dir.x.toFixed(2), dz: +dir.z.toFixed(2) });
    if (tree.wood <= 0) { world.trees.fell(tree, dir.x, dir.z); audio.crash(); }
  } else if (wall) {
    audio.chop();
    hitWall(wall.id, ROCK.wallDmg);
  } else audio.clunk();
}

// 牆的傷害由出手的人算，再廣播給對方；兩邊各自扣同樣的數字，結果一定一致
function hitWall(id, dmg, remote = false) {
  const w = builder.walls.get(id);
  if (!w) return;
  const pos = new THREE.Vector3(w.x, w.y + 1.4, w.z);
  const res = builder.damage(id, dmg);
  if (!remote && S.online) net.send({ t: 'whit', id, dmg });
  if (res?.destroyed) {
    audio.crash(remote ? pos : null, pos.distanceTo(camera.position));
    if (w.owner === S.side) hud.toast('你的木牆被打爛了', 1500);
  }
}

function tryPlace() {
  const res = S.build;
  if (!res) return;
  if (!res.ok) { audio.empty(); hud.toast(res.reason, 1300); return; }
  const desc = {
    id: `${S.side}${++S.wallN}`, owner: S.side,
    x: +res.x.toFixed(2), y: +res.y.toFixed(2), z: +res.z.toFixed(2), r: +res.r.toFixed(3),
  };
  builder.place(desc);
  S.wood -= WALL.cost;
  hud.wood(S.wood, WALL.cost);
  vm.place();
  audio.build();
  if (S.online) net.send({ t: 'build', ...desc });
}

function currentGun() {
  if (S.gameMode === 'survival') return surv.holdKind() === 'gun' ? surv.held().id : null;
  return S.item === 'ak' ? 'ak' : null;
}
// 生存模式換彈要背包裡有子彈；auto：彈匣空了自動換的那種，沒子彈就安靜放棄、不跳提示
let noAmmoAt = 0;
function startReload(auto = false) {
  const g = currentGun();
  if (!g || !S.alive || S.reload >= 0 || S.inject >= 0 || S.ammo === GUNS[g].mag) return;
  if (S.gameMode === 'survival' && surv.count(GUNS[g].ammo) <= 0) {
    if (!auto && performance.now() - noAmmoAt > 1500) {
      noAmmoAt = performance.now();
      hud.toast(`沒有${ITEM_DEFS[GUNS[g].ammo].name}了，${OPEN_INV}做一些（10 鐵 + 5 硫磺）`, 2200);
    }
    return;
  }
  S.reload = S.reloadTotal = GUNS[g].reload;
  audio.reload(S.reload);
}
function useSyringe() {
  if (!S.alive || S.inject >= 0 || S.reload >= 0) return;
  if (S.syringes <= 0) { hud.toast('針筒用完了'); return; }
  if (S.hp >= 100) { hud.toast('血是滿的'); return; }
  S.syringes--; S.inject = SYRINGE_TIME;
  hud.syringes(S.syringes);
  audio.inject();
}

const aimEuler = new THREE.Euler(0, 0, 0, 'YXZ');
const tmpV = new THREE.Vector3();
function spreadDeg() {
  const b = S.body;
  const G = GUNS[currentGun() || 'ak'];
  const moving = Math.min(S.speed / 4.6, 1.5);
  let s = lerp(G.hip, G.adsSpread, S.ads) + moving * lerp(1.7, 0.55, S.ads);
  if (!b.onGround) s += 4;
  s *= lerp(1, 0.7, b.crouch);
  s += Math.min(S.shotIdx, 10) * 0.05 * (1 - S.ads * 0.5);
  return s;
}

const falloff = falloffMult;   // 傷害隨距離衰減（湯姆森掉比較多）
function fire(gid = 'ak') {
  const G = GUNS[gid];
  S.ammo--;
  S.lastShot = performance.now();
  const b = S.body;
  const sr = deg(spreadDeg()) * Math.sqrt(Math.random()), a = Math.random() * Math.PI * 2;
  aimEuler.set(S.pitch, S.yaw, 0);
  const dir = new THREE.Vector3(Math.tan(sr) * Math.cos(a), Math.tan(sr) * Math.sin(a), -1).normalize().applyEuler(aimEuler);
  const origin = camera.position.clone();
  const wh = world.raycast(origin, dir, G.range);
  let end = wh ? wh.point.clone() : origin.clone().addScaledVector(dir, G.range);

  const target = S.online ? opp.avatar : dummy?.avatar;
  const oh = target?.rayHit(origin, dir, wh ? wh.dist : G.range);
  if (oh) {
    end = origin.clone().addScaledVector(dir, oh.dist);
    // 距離衰減只用在生存模式，對決模式維持原本的 AK 手感
    const dmg = Math.round(G.dmg * G.mult[oh.part] * (S.gameMode === 'survival' ? falloff(G, oh.dist) : 1));
    fx.blood(end);
    audio.hit(oh.part === 'head');
    hud.hitmarker(oh.part === 'head');
    if (S.online) net.send({ t: 'hit', dmg, part: oh.part, from: v3(origin), w: gid });
    else dummyHit(dmg, oh.part, origin, gid);
  } else if (wh) {
    fx.impact(wh.point, wh.normal, wh.surf);
    if (!wh.terrain && !wh.instanced && !wh.mesh?.userData.noHole) fx.hole(wh.point, wh.normal);
    if (S.gameMode === 'survival') surv.gunHit(wh, gid);
    else { const wall = builder.fromHit(wh); if (wall) hitWall(wall.id, AK.wallDmg); }
  }

  camera.updateMatrixWorld();
  const mw = camera.localToWorld(vm.muzzleCamSpace(tmpV).clone());
  if (S.shotIdx % 2 === 0) fx.tracer(mw, end);
  fx.muzzleLight(mw);
  vm.fire();
  if (gid === 'thompson') audio.smg(); else audio.shot();
  if (S.online) net.send({ t: 'shot', o: v3(origin), e: v3(end), g: gid });

  // 後座力直接改準心，不會自己回來 —— 跟 rust 一樣要自己往下拉
  const [ry, rp] = RECOIL[Math.min(S.shotIdx, RECOIL.length - 1)];
  const m = lerp(1, 0.65, S.ads) * lerp(1, 0.8, b.crouch) * G.recoil;
  S.pitch = clamp(S.pitch + deg(rp) * m, -1.52, 1.52);
  S.yaw -= deg(ry) * m;
  S.punch += 0.006;
  S.shotIdx++;
}

// ---------- 生存模式的武器 ----------
function startSwingSurv(id) {
  const def = MELEE[id];
  S.swingCd = def.swing; S.swingT = 0; S.swingWith = id;
  vm.swing(def.swing);
  audio.whoosh();
  if (S.online) net.send({ t: 'sw', dur: def.swing });
}
function meleeHitSurv(id) {
  if (!S.alive) return;
  const def = MELEE[id];
  const dir = survHost.aimDir(), origin = camera.position.clone();
  const wh = world.raycast(origin, dir, def.reach);
  const oh = S.online && opp.cur.alive ? opp.avatar?.rayHit(origin, dir, wh ? wh.dist : def.reach) : null;
  if (oh) {
    const head = oh.part === 'head';
    const dmg = Math.round(def.dmg * (head ? def.headMult : 1));
    fx.blood(origin.clone().addScaledVector(dir, oh.dist));
    audio.hit(head); audio.chop();
    hud.hitmarker(head);
    net.send({ t: 'hit', dmg, part: oh.part, from: v3(origin), w: id });
    return;
  }
  if (!wh) return;
  fx.impact(wh.point, wh.normal, wh.surf);
  surv.meleeWorld(wh, id, dir);
}
function shootArrow(power) {
  if (!surv.take('arrow', 1)) return;
  const dir = survHost.aimDir();
  const spread = deg((1 - power) * 2.5 + (S.speed > 1 ? 0.8 : 0)) * Math.sqrt(Math.random()), a = Math.random() * Math.PI * 2;
  const right = new THREE.Vector3(Math.cos(S.yaw), 0, -Math.sin(S.yaw));
  const up = new THREE.Vector3().crossVectors(right, dir).normalize();
  dir.addScaledVector(right, Math.tan(spread) * Math.cos(a)).addScaledVector(up, Math.tan(spread) * Math.sin(a)).normalize();
  const o = camera.position.clone().addScaledVector(dir, 0.3);
  const v = dir.clone().multiplyScalar(lerp(BOW.minSpeed, BOW.maxSpeed, power));
  const id = surv.nid('a');
  proj.spawnArrow({ id, o, v, mine: true, power });
  surv.spawnArrowNet(id, o, v);
  audio.twang();
  S.punch += 0.01;
}
// 吃肉、包紮：拿到嘴邊（或手臂上）一段時間，時間到才生效；中途換東西就取消
function startUse(id) {
  const def = id === 'bandage' ? BANDAGE : FOOD.eat[id];
  if (!def) return;
  S.useT = 0; S.useDur = def.time; S.useId = id;
  vm.use(def.time);
  if (id === 'bandage') audio.bandage(); else audio.eat();
  if (S.online) net.send({ t: 'sw', dur: def.time });
}
function finishUse() {
  const id = S.useId;
  S.useT = -1;
  if (!S.alive || surv.held()?.id !== id) return;
  if (id === 'bandage') {
    S.hp = Math.min(100, S.hp + BANDAGE.hp);
    S.heal += BANDAGE.heal;
    hud.pickup('繃帶', `+${BANDAGE.hp} 血`);
  } else {
    const f = FOOD.eat[id];
    S.food = Math.min(FOOD.max, S.food + f.food);
    if (f.hp) S.hp = Math.max(1, Math.min(100, S.hp + f.hp));
    if (f.heal) S.heal += f.heal;
    if (S.food > 0) S.starving = false;
    hud.pickup(ITEM_DEFS[id].name, `飢餓 +${f.food}`);
    if (f.hp < 0) { hud.toast('生肉讓你吐了一地……拿去火爐烤熟再吃', 2500); audio.hurt(); S.shake = Math.max(S.shake, 0.4); }
  }
  surv.consumeHeld();
}
function updateWeaponSurv(dt) {
  const it = surv.held(), kind = surv.holdKind();
  if (S.reload >= 0) {
    S.reload -= dt;
    if (S.reload <= 0) {
      S.reload = -1;
      if (kind === 'gun') {
        const G = GUNS[it.id], got = Math.min(G.mag - S.ammo, surv.count(G.ammo));
        S.ammo += got;
        it.d = { ...(it.d || {}), mag: S.ammo };
        if (got > 0) surv.take(G.ammo, got);
        invui.renderHotbar();
      }
    }
  }
  const ready = S.alive && inputActive() && !S.matchOver && !S.uiOpen;
  const pressed = firing && !S.wasFiring, released = !firing && S.wasFiring;
  S.wasFiring = firing;
  S.swingCd = Math.max(0, S.swingCd - dt);
  S.tossCd = Math.max(0, S.tossCd - dt);
  if (S.swingT >= 0) {
    S.swingT += dt;
    const def = MELEE[S.swingWith];
    if (def && S.swingT >= def.hitAt) { S.swingT = -1; meleeHitSurv(S.swingWith); }
  }
  if (S.tossT >= 0) {
    S.tossT += dt;
    if (S.tossT >= 0.28) {
      S.tossT = -1;
      if (surv.held()?.id === 'grenade' || surv.held()?.id === 'c4') {
        surv.throwNade(camera.position.clone().add(survHost.forwardFlat().multiplyScalar(0.4)), survHost.aimDir());
        if (S.online) net.send({ t: 'sw', dur: 0.55 });
      }
    }
  }
  if (!it) return;
  if (kind === 'eat' || kind === 'heal') {
    if (S.useT >= 0) { S.useT += dt; if (S.useT >= S.useDur) finishUse(); }
    else if (firing && ready && S.swingCd <= 0) startUse(it.id);
    return;
  }
  if (kind === 'melee') { if (firing && ready && S.swingCd <= 0) startSwingSurv(it.id); return; }
  if (kind === 'throw') {
    if (pressed && ready && S.tossCd <= 0 && S.tossT < 0) { S.tossT = 0; S.tossCd = 0.9; vm.toss(); audio.whoosh(); }
    return;
  }
  if (kind === 'build' || kind === 'deploy') {
    if (pressed && ready && S.swingCd <= 0) { if (surv.placeCurrent()) vm.place(); }
    return;
  }
  if (kind === 'bow') {
    const arrows = surv.count('arrow');
    if (firing && ready && !S.sprinting && arrows > 0) S.bowDraw = Math.min(1, S.bowDraw + dt / BOW.draw);
    else if (S.bowDraw > 0) {
      if (released && ready && S.bowDraw >= 0.2 && arrows > 0) shootArrow(S.bowDraw);
      S.bowDraw = 0;
    }
    if (pressed && arrows <= 0) hud.toast('沒有箭了（5 木頭做 2 支）', 1400);
    return;
  }
  if (kind === 'gun') {
    const G = GUNS[it.id];
    const canFire = ready && S.reload < 0 && !S.sprinting;
    if (firing && canFire) {
      S.fireCd -= dt;
      while (S.fireCd <= 0) {
        if (S.ammo <= 0) { audio.empty(); startReload(); S.fireCd = 0.3; break; }
        fire(it.id);
        it.d = { ...(it.d || {}), mag: S.ammo };
        S.fireCd += 60 / G.rpm;
      }
      invui.renderHotbar();
    } else {
      S.fireCd = Math.max(0, S.fireCd - dt);
      if (S.alive && S.ammo === 0 && S.reload < 0 && !firing) startReload(true);
    }
    if (performance.now() - S.lastShot > 280) S.shotIdx = 0;
  }
}

function updateWeapon(dt) {
  if (S.gameMode === 'survival') { updateWeaponSurv(dt); return; }
  if (S.reload >= 0) {
    S.reload -= dt;
    if (S.reload <= 0) { S.reload = -1; S.ammo = AK.mag; }
  }
  if (S.inject >= 0) {
    S.inject -= dt;
    if (S.inject <= 0) { S.inject = -1; S.hp = Math.min(100, S.hp + 15); S.regen += 20; }
  }
  if (S.regen > 0 && S.alive) {
    const h = Math.min(S.regen, dt * 5);
    S.regen -= h; S.hp = Math.min(100, S.hp + h);
  }
  const ready = S.alive && inputActive() && !S.matchOver && S.inject < 0;
  const pressed = firing && !S.wasFiring;
  S.wasFiring = firing;
  S.swingCd = Math.max(0, S.swingCd - dt);
  if (S.swingT >= 0) {
    S.swingT += dt;
    if (S.swingT >= ROCK.hitAt) { S.swingT = -1; meleeHit(); }
  }
  if (S.item === 'rock') {
    if (firing && ready && S.swingCd <= 0) startSwing();
    return;
  }
  if (S.item === 'plan') {
    if (pressed && ready && S.swingCd <= 0) tryPlace();
    return;
  }
  const canFire = ready && S.reload < 0 && !S.sprinting;
  if (firing && canFire) {
    S.fireCd -= dt;
    while (S.fireCd <= 0) {
      if (S.ammo <= 0) { audio.empty(); startReload(); S.fireCd = 0.3; break; }
      fire();
      S.fireCd += 60 / AK.rpm;
    }
  } else {
    S.fireCd = Math.max(0, S.fireCd - dt);
    if (S.alive && S.ammo === 0 && S.reload < 0 && !firing) startReload();
  }
  if (performance.now() - S.lastShot > 280) S.shotIdx = 0;
}

// ---------- 受傷 / 死亡 ----------
function headingTo(from) {
  const dx = from.x - S.body.pos.x, dz = from.z - S.body.pos.z;
  const ang = Math.atan2(-dx, -dz) - S.yaw;
  return -THREE.MathUtils.radToDeg(ang);
}

function onHit(m) {
  if (!S.alive || S.matchOver) return;
  const from = toV(m.from);
  S.hp -= m.dmg;
  S.regen = 0;
  surv.hurt();
  audio.hurt();
  if (!m.self) hud.hurt(headingTo(from));
  S.punch -= 0.012;   // 被打到鏡頭會抖一下
  if (S.hp <= 0) die({ by: m.env || (m.self ? S.myName : S.oppName), part: m.part, dist: from.distanceTo(S.body.pos), w: m.w || 'ak', self: !!m.self, env: !!m.env });
}

function die(info) {
  S.alive = false; S.hp = 0; S.deaths++;
  if (!info.self && !info.env) S.oppKills++;
  firing = aiming = false; S.reload = -1; S.inject = -1; S.swingT = -1; S.bowDraw = 0; S.tossT = -1; S.useT = -1; S.heal = 0;
  // rust：死了身上的東西全掉光
  if (S.gameMode === 'survival') {
    if (S.uiOpen) { invui.closeAll(); S.uiOpen = false; }
    surv.onDeath(S.body.pos);
  } else {
    if (S.wood > 0) hud.toast(`死掉了，${S.wood} 木頭全掉光`, 2000);
    S.wood = 0; hud.wood(0, WALL.cost);
  }
  builder.showGhost(null); hud.hint(null);
  S.deathAt = performance.now();
  if (S.online) net.send({ t: 'dead', part: info.part, dist: +info.dist.toFixed(1), w: info.w, self: !!info.self, env: info.env ? info.by : '' });
  hud.killfeed(info.by, S.myName, { head: info.part === 'head', mine: true, weapon: info.w });
  updateScore();
  releaseControl();
  const lost = S.online && S.gameMode === 'duel' && S.oppKills >= KILLS_TO_WIN;
  const PART = { head: '爆頭', body: '身體', legs: '腿' };
  $('killerCard').innerHTML = `
    <div><span class="lbl">${info.w === 'starve' ? '死因' : '擊殺你的人'}</span><span class="who">${info.self ? '你自己 😵' : escapeHtml(info.by)}</span></div>
    <div><span class="lbl">武器</span>${ICON[info.w] || ICON.ak}</div>
    <div><span class="lbl">距離</span>${info.dist.toFixed(1)} m</div>
    <div><span class="lbl">最後一槍</span>${PART[info.part] || '?'}</div>`;
  setTimeout(() => {
    if (lost) endMatch(false);
    else if (!S.alive && S.mode === 'play' && !S.matchOver) $('death').hidden = false;
  }, 1400);
}
const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

$('btnBag').addEventListener('click', () => { spawn('bag'); resumeControl(); });
$('btnBeach').addEventListener('click', () => { spawn('beach'); resumeControl(); });

function updateDeathScreen(now) {
  if ($('death').hidden) return;
  const t = (now - S.deathAt) / 1000;
  // 生存模式：自己有放睡袋才能從睡袋重生，冷卻比較久
  const survival = S.gameMode === 'survival';
  $('btnBag').hidden = survival && !surv.myBags().length;
  $('btnBag').querySelector('span').textContent = survival ? '你放的睡袋' : '你的基地';
  const bag = Math.max(0, (survival ? 15 : BAG_CD) - t), beach = Math.max(0, BEACH_CD - t);
  $('btnBag').disabled = bag > 0;
  $('btnBeach').disabled = beach > 0;
  $('bagCd').textContent = bag > 0 ? `冷卻中 ${bag.toFixed(1)}s` : '重生 ▸';
  $('beachCd').textContent = beach > 0 ? `冷卻中 ${beach.toFixed(1)}s` : '重生 ▸';
}

function updateScore() {
  if (S.gameMode === 'survival') {
    const sec = Math.ceil(surv.remaining), mm = String(Math.floor(sec / 60)).padStart(2, '0'), ss = String(sec % 60).padStart(2, '0');
    hud.score(S.kills, S.oppKills, S.myName, S.online ? S.oppName : '', 0, `生存模式 · 剩 ${mm}:${ss}`);
  } else if (S.online) hud.score(S.kills, S.oppKills, S.myName, S.oppName, KILLS_TO_WIN);
  else hud.score(S.kills, 0, S.myName, '', 0);
}

function endMatch(win, reason) {
  S.matchOver = true;
  firing = aiming = false;
  $('death').hidden = true; $('pause').hidden = true; $('clickToPlay').hidden = true;
  releaseControl();
  const t = $('endTitle');
  if (reason) {
    t.textContent = reason; t.className = '';
    $('btnRematch').hidden = true;
  } else {
    t.textContent = win === 'draw' ? '平手' : win ? '你贏了' : '你輸了';
    t.className = win === 'draw' ? '' : win ? 'win' : 'lose';
    $('btnRematch').hidden = !S.online; $('btnRematch').disabled = false;
  }
  if (S.gameMode === 'survival') { invui.closeAll(); S.uiOpen = false; }
  $('endScore').textContent = S.online ? `${S.myName} ${S.kills} : ${S.oppKills} ${S.oppName}` : `擊殺 ${S.kills}`;
  $('rematchStatus').textContent = '';
  $('matchEnd').hidden = false;
}

$('btnRematch').addEventListener('click', () => {
  S.wantRematch = true;
  $('btnRematch').disabled = true;
  net?.send({ t: 'rematch' });
  checkRematch();
});
function checkRematch() {
  if (!S.matchOver) return;
  if (S.wantRematch && S.oppWantRematch) {
    S.mode = 'lobby';  // 讓 enterPlay 重設狀態
    enterPlay();
    hud.toast('第二回合，開打', 2500);
  } else if (S.wantRematch) $('rematchStatus').textContent = `等 ${S.oppName} 按再來一局…`;
  else if (S.oppWantRematch) $('rematchStatus').textContent = `${S.oppName} 想再來一局`;
}

// ---------- 稻草人（單人模式） ----------
function dummyHit(dmg, part, origin, w = 'ak') {
  if (!dummy.alive) return;
  dummy.hp -= dmg;
  if (dummy.hp <= 0) {
    dummy.alive = false;
    dummy.respawnAt = performance.now() + 2500;
    S.kills++;
    hud.killfeed(S.myName, '稻草人 Bob', { head: part === 'head', mine: true, weapon: w });
    hud.toast(`擊殺！距離 ${origin.distanceTo(dummy.pos).toFixed(1)}m`, 1500);
    updateScore();
  }
}
function updateDummy(dt, now) {
  if (!dummy) return;
  const t = now / 1000 - dummy.t0;
  if (!dummy.alive && now > dummy.respawnAt) placeDummy();
  // 左右橫移，偶爾蹲一下，給你一點練習壓力
  const x = dummy.base.x + Math.sin(t * 0.9) * 2.2;
  const z = dummy.base.z;
  const speed = dummy.alive ? Math.abs(Math.cos(t * 0.9) * 2.2 * 0.9) : 0;
  if (dummy.alive) dummy.pos.set(x, world.heightAt(x, z), z);
  const toMe = S.body.pos.clone().sub(dummy.pos);
  dummy.yaw = Math.atan2(-toMe.x, -toMe.z);
  const crouch = dummy.alive && Math.sin(t * 0.37) > 0.75 ? 1 : 0;
  dummy.avatar.update({ pos: dummy.pos, yaw: dummy.yaw, pitch: 0, crouch, speed, alive: dummy.alive }, dt);
}

// ---------- 網路訊息 ----------
function onMessage(m) {
  const now = performance.now();
  switch (m.t) {
    case 'hello':
      S.oppName = String(m.name || '對手').slice(0, 14);
      if (net.role === 'host' && S.mode !== 'play') { net.send({ t: 'start', mode: lobbyMode }); startMatch(lobbyMode); }
      break;
    case 'start': startMatch(m.mode); break;
    case 'sv': if (S.mode === 'play') surv.onMessage(m); break;
    case 'full': lobbyStatus('這個房間已經有兩個人了（1v1）'); lobbyBusy(false); break;
    case 'st': {
      const prev = opp.snaps[opp.snaps.length - 1];
      const snap = { t: now, pos: toV(m.p), yaw: m.y, pitch: m.x, crouch: m.c, speed: m.v, g: m.g, alive: !!m.a, item: m.h || ITEMS[m.w] || 'ak', sight: SIGHT_ORDER[m.sc] || 'iron', draw: m.dr || 0 };
      // 重生瞬移：不要從屍體位置滑過去
      if (prev && (prev.pos.distanceTo(snap.pos) > 8 || prev.alive !== snap.alive)) opp.snaps = [];
      opp.snaps.push(snap);
      if (opp.snaps.length > 30) opp.snaps.shift();
      break;
    }
    case 'shot': {
      if (!opp.avatar) break;
      const o = toV(m.o), e = toV(m.e);
      const mw = opp.avatar.muzzleWorld(new THREE.Vector3());
      fx.tracer(mw, e);
      fx.muzzleLight(mw);
      opp.avatar.flash();
      audio.shotAt(o, o.distanceTo(camera.position), m.g);
      // 在本地重算一次彈道，命中牆面就補上火花和彈孔
      const dir = e.clone().sub(o); const len = dir.length(); dir.normalize();
      const wh = world.raycast(o, dir, len + 0.3);
      if (wh && Math.abs(wh.dist - len) < 0.4) {
        fx.impact(wh.point, wh.normal, wh.surf);
        if (!wh.terrain && !wh.instanced && !wh.mesh?.userData.noHole) fx.hole(wh.point, wh.normal);
      }
      break;
    }
    case 'hit': onHit(m); break;
    case 'sw':
      opp.avatar?.swing(m.dur);
      audio.whoosh(opp.cur.pos, opp.cur.pos.distanceTo(camera.position));
      break;
    case 'build': {
      builder.place(m);
      const at = new THREE.Vector3(m.x, m.y + 1, m.z);
      audio.build(at, at.distanceTo(camera.position));
      break;
    }
    case 'whit': hitWall(m.id, m.dmg, true); break;
    case 'thit': {
      const t = world.trees.get(m.k, m.i);
      if (!t || !t.alive) break;
      world.trees.chop(t, m.a);
      const at = t.base.clone().setY(t.base.y + 1.2);
      audio.chop(at, at.distanceTo(camera.position));
      if (t.wood <= 0) { world.trees.fell(t, m.dx, m.dz); audio.crash(at, at.distanceTo(camera.position)); }
      break;
    }
    case 'dead':
      if (m.self) {   // 對手被自己的手雷炸死：不算你的擊殺
        hud.killfeed(S.oppName, S.oppName, { mine: false, weapon: m.w || 'grenade' });
        hud.toast(`${S.oppName} 被自己的手雷炸死了`, 2000);
        break;
      }
      if (m.env) {    // 被北極熊咬死、餓死：也不算你的
        hud.killfeed(m.env, S.oppName, { mine: false, weapon: m.w || 'bear' });
        hud.toast(m.w === 'starve' ? `${S.oppName} 餓死了` : `${S.oppName} 被${m.env}咬死了`, 2200);
        break;
      }
      S.kills++;
      hud.killfeed(S.myName, S.oppName, { head: m.part === 'head', mine: true, weapon: m.w || 'ak' });
      hud.toast(`擊殺 ${S.oppName}${m.part === 'head' ? '（爆頭）' : ''} · ${m.dist}m`, 2000);
      updateScore();
      if (S.gameMode === 'duel' && S.kills >= KILLS_TO_WIN) setTimeout(() => endMatch(true), 1200);
      break;
    case 'rematch': S.oppWantRematch = true; checkRematch(); break;
    case 'ping': net.send({ t: 'pong', t0: m.t0 }); break;
    case 'pong': hud.ping(now - m.t0); break;
  }
}

function sendState() {
  if (!S.online || !net) return;
  const b = S.body;
  net.send({
    t: 'st', p: v3(b.pos), y: +S.yaw.toFixed(3), x: +S.pitch.toFixed(3),
    c: +b.crouch.toFixed(2), v: +S.speed.toFixed(2), g: b.onGround ? 1 : 0, a: S.alive ? 1 : 0,
    w: Math.max(0, ITEMS.indexOf(S.item)), sc: SIGHT_ORDER.indexOf(S.sight), h: S.item, dr: +S.bowDraw.toFixed(2),
  });
}

function lerpAngle(a, b, t) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

function updateOpp(dt, now) {
  if (!opp.avatar) return;
  const snaps = opp.snaps;
  if (!snaps.length) { opp.avatar.setVisible(false); return; }
  opp.avatar.setVisible(true);
  const rt = now - INTERP_MS;
  let a = snaps[0], b = snaps[0];
  for (let i = snaps.length - 1; i >= 0; i--) {
    if (snaps[i].t <= rt) { a = snaps[i]; b = snaps[i + 1] || snaps[i]; break; }
  }
  const k = b.t > a.t ? clamp((rt - a.t) / (b.t - a.t), 0, 1) : 0;
  const c = opp.cur;
  c.pos.lerpVectors(a.pos, b.pos, k);
  c.yaw = lerpAngle(a.yaw, b.yaw, k);
  c.pitch = lerp(a.pitch, b.pitch, k);
  c.crouch = lerp(a.crouch, b.crouch, k);
  c.speed = lerp(a.speed, b.speed, k);
  c.alive = b.alive; c.g = b.g; c.item = b.item; c.sight = b.sight; c.draw = b.draw;
  opp.avatar.update(c, dt);
  while (snaps.length > 2 && snaps[1].t < rt) snaps.shift();

  // 對手腳步聲：蹲著走、在空中就沒聲音
  const moved = Math.hypot(c.pos.x - opp.prevPos.x, c.pos.z - opp.prevPos.z);
  opp.prevPos.copy(c.pos);
  if (c.alive && c.g && c.crouch < 0.5 && moved < 1) {
    opp.stepAcc += moved;
    const sprint = c.speed > 5.5;
    if (opp.stepAcc > (sprint ? 2.3 : 1.9)) {
      opp.stepAcc = 0;
      audio.stepAt(c.pos, c.pos.distanceTo(camera.position), sprint ? 1.5 : 1);
    }
  }
}

// ---------- 主迴圈 ----------
let last = performance.now();
let fovNow = settings.fov;
const fwdV = new THREE.Vector3(), sunNdc = new THREE.Vector3(), sunUv = new THREE.Vector2();
const LOBBY_FOCUS = new THREE.Vector3(0, 0, -4);

function lobbyCam(t) {
  const a = t * 0.035 + 0.6;
  camera.position.set(Math.sin(a) * 46, 15 + Math.sin(t * 0.12) * 2, Math.cos(a) * 46 - 4);
  camera.lookAt(0, 2, -4);
}

// 手機輔助瞄準：準心靠近對手時視角變黏（轉速減半），開鏡或開火時再往身上吸。
// 垂直方向只吸一半 —— 後座力還是要自己往下拉，不然就不是 rust 了。
const assist = { los: false, losAt: 0 };
const asA = new THREE.Vector3(), asB = new THREE.Vector3();
function aimAssist(dt, now) {
  if (!S.alive) return 1;
  let tgt = null;
  if (S.online) { if (opp.avatar && opp.snaps.length && opp.cur.alive) tgt = opp.cur; }
  else if (dummy?.alive) tgt = { pos: dummy.pos, crouch: 0 };
  if (!tgt) return 1;
  asA.set(tgt.pos.x, tgt.pos.y + 1.25 - tgt.crouch * 0.45, tgt.pos.z);
  const to = asB.copy(asA).sub(camera.position);
  const dist = to.length();
  if (dist > 90 || dist < 0.5) return 1;
  let dyaw = Math.atan2(-to.x, -to.z) - S.yaw;
  dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
  const dpitch = Math.atan2(to.y, Math.hypot(to.x, to.z)) - S.pitch;
  // 判定範圍跟著距離縮：近的時候大方一點，遠的時候只剩 3 度
  const cone = clamp(Math.atan2(1.5, dist), deg(3), deg(10)) * lerp(1, 1.3, S.ads);
  if (Math.hypot(dyaw, dpitch) > cone) return 1;
  if (now - assist.losAt > 120) {   // 隔牆不幫，視線每 120ms 檢查一次
    assist.losAt = now;
    const wh = world.raycast(camera.position, to.clone().normalize(), dist);
    assist.los = !wh || wh.dist > dist - 0.6;
  }
  if (!assist.los) return 1;
  if (firing || S.ads > 0.5) {
    const k = 1 - Math.exp(-(firing ? 5 : 3) * dt);
    S.yaw += dyaw * k;
    S.pitch = clamp(S.pitch + dpitch * k * 0.5, -1.52, 1.52);
  }
  return 0.5;
}

function readInput(active) {
  if (TOUCH) {
    firing = active && touch.fire;
    aiming = active && touch.aim;
    // 搖桿是類比的：推一半就走一半速度
    return {
      fwd: active ? -touch.my : 0,
      right: active ? touch.mx : 0,
      jump: active && touch.consumeJump(),
      sprint: active && touch.sprint && !firing,
      crouch: active && touch.crouch,
    };
  }
  return {
    fwd: active ? (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0) : 0,
    right: active ? (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0) : 0,
    jump: active && keys.has('Space'),
    sprint: active && (keys.has('ShiftLeft') || keys.has('ShiftRight')) && !firing,
    crouch: active && keys.has('KeyC'),
  };
}

function updatePlay(dt, now) {
  const b = S.body;
  const active = inputActive() && S.alive && !S.matchOver;
  const canAds = S.item === 'ak' || S.item === 'thompson' || S.item === 'bow';
  const inp = { ...readInput(active), ads: active && aiming && canAds && S.reload < 0 && S.inject < 0, yaw: S.yaw };
  if (TOUCH) {
    const { dx, dy } = touch.consumeLook();
    if (active) {
      const k = 0.0045 * settings.sens * (camera.fov / settings.fov) * aimAssist(dt, now);
      S.yaw -= dx * k;
      S.pitch = clamp(S.pitch - dy * k, -1.52, 1.52);
      S.mdx += dx; S.mdy += dy;
    }
    inp.yaw = S.yaw;
  }
  if (S.alive) {
    const r = stepBody(b, inp, dt, world.colliders);
    S.sprinting = r.sprinting; S.speed = r.speed;
    if (r.landed) audio.land();
    if (b.onGround && S.speed > 1 && b.crouch < 0.5) {
      S.stepAcc += S.speed * dt;
      if (S.stepAcc > (S.sprinting ? 2.3 : 1.9)) { S.stepAcc = 0; audio.step(S.sprinting ? 1.3 : 1); }
    }
    S.water = Math.max(0, S.water - dt / 20);
    if (S.gameMode !== 'survival') S.food = Math.max(0, S.food - dt / 8);
  } else {
    S.speed = 0; S.sprinting = false;
  }

  // 8 倍鏡舉起來慢一點
  S.ads += ((inp.ads && !S.sprinting ? 1 : 0) - S.ads) * (1 - Math.exp(-(S.sight === 'scope' ? 9 : 14) * dt));
  const zoom = S.item === 'ak' ? SIGHTS[S.sight].fov : S.item === 'thompson' ? 0.62 : S.item === 'bow' ? 0.8 : 1;
  const fovTarget = lerp(settings.fov, settings.fov * zoom, S.ads);
  // 8 倍鏡開到底：換成全黑鏡框畫面，手上的槍不畫
  S.scoped = S.alive && S.item === 'ak' && S.sight === 'scope' && S.ads > 0.85;
  hud.scope(S.scoped);
  if (Math.abs(fovTarget - fovNow) > 0.01) { fovNow = fovTarget; camera.fov = fovNow; camera.updateProjectionMatrix(); }

  // 鏡頭高度：上樓梯時平滑跟上，不會一格一格抖
  const eyeTarget = b.pos.y + b.h - 0.12;
  if (S.alive) {
    if (!b.onGround || Math.abs(eyeTarget - S.eyeY) > 0.8) S.eyeY = eyeTarget;
    else S.eyeY += (eyeTarget - S.eyeY) * (1 - Math.exp(-22 * dt));
  } else {
    // 死亡鏡頭：倒在地上、歪一邊
    S.eyeY += (b.pos.y + 0.3 - S.eyeY) * (1 - Math.exp(-5 * dt));
    S.roll += (0.9 - S.roll) * (1 - Math.exp(-4 * dt));
  }
  S.punch *= Math.exp(-12 * dt);
  S.shake = Math.max(0, S.shake - dt * 1.6);
  const sk = S.shake * S.shake * 0.05;
  camera.position.set(b.pos.x, S.eyeY, b.pos.z);
  camera.rotation.set(S.pitch + S.punch + (Math.random() - 0.5) * sk, S.yaw + (Math.random() - 0.5) * sk, S.roll);

  updateWeapon(dt);
  updateOpp(dt, now);
  updateDummy(dt, now);
  if (S.gameMode === 'survival') updateSurvival(dt, now);

  S.sendAcc += dt;
  if (S.sendAcc >= 1 / SEND_HZ) { S.sendAcc = 0; sendState(); }
  S.pingAcc += dt;
  if (S.online && S.pingAcc > 2) { S.pingAcc = 0; net?.send({ t: 'ping', t0: now }); }

  camera.getWorldDirection(fwdV);
  audio.setListener(camera.position, fwdV);

  vm.update({
    dt, ads: S.ads, sprint: S.sprinting && S.speed > 3, speed: S.speed, onGround: b.onGround,
    reload: S.reload >= 0 ? 1 - S.reload / S.reloadTotal : -1,
    down: S.inject >= 0, mdx: S.mdx, mdy: S.mdy,
    bowDraw: S.bowDraw, hasArrow: S.gameMode === 'survival' && surv.count('arrow') > 0, hasNade: S.gameMode !== 'survival' || surv.held()?.id === 'grenade' || surv.held()?.id === 'c4',
  });

  hud.health(S.hp);
  hud.survival(S.water, S.food);
  const gunNow = S.item === 'ak' || S.item === 'thompson';
  if (S.gameMode === 'survival') {
    if (gunNow) { const ammoId = GUNS[S.item].ammo; hud.ammo(S.ammo, surv.count(ammoId), S.reload >= 0, ITEM_DEFS[ammoId].name); }
    else if (S.item === 'bow') hud.ammo(surv.count('arrow'), null, false, '箭');
    else if (S.item === 'grenade') hud.ammo(surv.count('grenade'), null, false, '手雷');
    else if (S.item === 'c4') hud.ammo(surv.count('c4'), null, false, 'C4');
    else hud.ammo(null);
  } else hud.ammo(S.ammo, AK.mag, S.reload >= 0);
  hud.compass(S.yaw);
  hud.crosshair(gunNow ? 4 + spreadDeg() * 6 : 3, gunNow ? S.ads : 0);
  if (S.gameMode === 'duel') updateBuildAndLook(now);
  if (S.reload >= 0) hud.action('換彈中', 1 - S.reload / S.reloadTotal);
  else if (S.bowDraw > 0) hud.action(S.bowDraw >= 1 ? '拉滿了' : '拉弓', S.bowDraw);
  else if (S.useT >= 0) hud.action(S.useId === 'bandage' ? '包紮中' : '吃東西', S.useT / S.useDur);
  else if (S.inject >= 0) hud.action('注射中', 1 - S.inject / SYRINGE_TIME);
  else hud.action(null);
  updateDeathScreen(now);
}

// 生存模式每幀：製作、冶煉、投射物、預覽、互動提示、回血、倒數
function updateSurvival(dt, now) {
  surv.update(dt, now);
  structs.update(dt, S.side);
  proj.update(dt, {
    arrowHitsTarget: (o, d, max) => (S.online && opp.cur.alive ? opp.avatar?.rayHit(o, d, max) : null),
    onArrowHit: (a, wh, th) => {
      if (th) {
        const head = th.part === 'head';
        const dmg = Math.round(BOW.dmg * a.power * (head ? BOW.headMult : th.part === 'legs' ? 0.75 : 1));
        fx.blood(a.pos); audio.hit(head); hud.hitmarker(head);
        if (S.online) net.send({ t: 'hit', dmg, part: th.part, from: v3(camera.position), w: 'bow' });
      } else if (wh) {
        fx.impact(wh.point, wh.normal, wh.surf);
        audio.thunk(a.mine ? null : wh.point, wh.point.distanceTo(camera.position));
        if (a.mine) surv.hitThings(wh, { piece: BOW.pieceDmg, crate: BOW.crateDmg, deploy: BOW.pieceDmg, bear: BOW.dmg * a.power });
      }
    },
    onNadeBoom: (n) => { surv.explode(n.pos.clone(), true, n.type); surv.sendBoom(n.id, n.pos, n.type); },
  });
  const kind = surv.holdKind();
  if (S.alive && !S.matchOver && (kind === 'build' || kind === 'deploy')) {
    const pv = surv.updatePreview();
    if (pv) {
      const name = kind === 'build' ? (PIECE_NAME[pv.type] || '') : surv.held()?.id && ITEM_NAME[surv.held().id];
      const cost = kind === 'build' ? ` · ${COSTS[pv.type]} 木頭` : '';
      hud.hint(pv.ok ? `${TOUCH ? '按放置' : '左鍵'}：${name}${cost}${kind === 'build' ? (TOUCH ? ' · 按「選擇」換種類' : ' · 右鍵換種類') : ''}` : `${name}：${pv.reason}`, pv.ok);
    } else hud.hint(null);
  } else { surv.hidePreview(); hud.hint(null); }
  const tg = S.alive ? surv.target : null;
  hud.interact(tg?.label && !S.uiOpen ? tg.label : null);
  touch.setUse(tg?.label && !S.uiOpen ? tg.label : null);
  hud.look(tg?.hp || null);
  // 飢餓：一直在掉，衝刺掉得更快；歸零就開始扣血，也不會自己回血
  if (S.alive && !S.matchOver) {
    S.food = Math.max(0, S.food - (FOOD.drain + (S.sprinting ? FOOD.sprintDrain : 0)) * dt);
    if (S.food <= 0) {
      if (!S.starving) { S.starving = true; hud.toast('餓到開始掉血了！去雪地打北極熊，烤熊肉來吃', 4000); }
      S.hp -= FOOD.starveDps * dt;
      if (S.hp <= 0) die({ by: '飢餓', part: 'body', dist: 0, w: 'starve', env: true });
    }
  }
  // 吃東西、繃帶的慢慢回血
  if (S.alive && S.heal > 0) { const h = Math.min(S.heal, 3 * dt); S.heal -= h; S.hp = Math.min(100, S.hp + h); }
  // 12 秒沒受傷、而且沒在餓肚子，就慢慢回血
  if (S.alive && S.hp < 100 && S.food > 0 && now - surv.lastHurt > REGEN_DELAY) S.hp = Math.min(100, S.hp + REGEN_RATE * dt);
  if (now - S.scoreAt > 500) { S.scoreAt = now; updateScore(); }
  if (!S.matchOver && surv.remaining <= 0) endMatch(S.online ? (S.kills > S.oppKills ? true : S.kills < S.oppKills ? false : 'draw') : true, S.online ? null : '時間到');
}

// 拿著藍圖：每幀算預覽位置；平常：每 0.1 秒看一下準心對著什麼（牆的耐久、樹還剩多少）
function updateBuildAndLook(now) {
  if (S.item === 'plan' && S.alive && !S.matchOver) {
    const others = [S.body.pos];
    if (S.online && opp.cur.alive && opp.snaps.length) others.push(opp.cur.pos);
    if (!S.online && dummy?.alive) others.push(dummy.pos);
    S.build = builder.evaluate({ pos: S.body.pos, yaw: S.yaw, others, myCount: builder.countOf(S.side), wood: S.wood });
    builder.showGhost(S.build);
    hud.hint(S.build.ok ? `${TOUCH ? '按放置' : '左鍵放置'} · ${WALL.cost} 木頭（剩 ${WALL.max - builder.countOf(S.side)} 面）` : S.build.reason, S.build.ok);
  } else S.build = null;
  if (now - S.lookAt < 100) return;
  S.lookAt = now;
  if (!S.alive) { hud.look(null); return; }
  aimEuler.set(S.pitch, S.yaw, 0);
  const dir = new THREE.Vector3(0, 0, -1).applyEuler(aimEuler);
  const wh = world.raycast(camera.position, dir, 14);
  const wall = builder.fromHit(wh);
  const tree = S.item === 'rock' && wh && wh.dist < ROCK.reach + 1 ? world.trees.fromHit(wh) : null;
  if (wall) hud.look(`木牆 ${Math.max(0, Math.ceil(wall.hp))} / ${WALL.hp}`);
  else if (tree) hud.look(`樹 · 還有 ${tree.wood} 木頭`);
  else hud.look(null);
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  if (S.mode === 'lobby') lobbyCam(now / 1000);
  else updatePlay(dt, now);
  world.setFocus(S.mode === 'play' ? camera.position : LOBBY_FOCUS);
  world.update(now / 1000, dt);
  audio.setWind(1 + 2.2 * world.snowAt(camera.position.x, camera.position.z));
  fx.update(dt);
  const showVm = S.mode === 'play' && S.alive && !S.scoped;
  if (settings.post) {
    // 太陽在畫面上的位置：面向太陽、太陽沒跑出畫面太遠才開光束
    camera.getWorldDirection(fwdV);
    const facing = fwdV.dot(world.sunDir);
    sunNdc.copy(world.sunDir).multiplyScalar(1000).add(camera.position).project(camera);
    const vis = facing > 0 ? THREE.MathUtils.smoothstep(facing, 0.15, 0.6) * (1 - THREE.MathUtils.smoothstep(Math.max(Math.abs(sunNdc.x), Math.abs(sunNdc.y)), 1.1, 1.8)) : 0;
    sunUv.set(sunNdc.x * 0.5 + 0.5, sunNdc.y * 0.5 + 0.5);
    post.render(dt, now / 1000, showVm, sunUv, vis);
  }
  else {
    renderer.clear();
    renderer.render(scene, camera);
    if (showVm) { renderer.clearDepth(); renderer.render(vm.scene, vm.cam); }
  }
  S.mdx = S.mdy = 0;
}
requestAnimationFrame(frame);
