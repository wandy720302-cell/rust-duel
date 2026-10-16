// 北極熊：只在雪地出沒，看到人就衝過來咬。打死變屍體，拿石頭或刀刨可以拿到肉跟布。
// 同步：
//   - 房主跑 AI（找人、追、咬），每秒送 8 次位置；客人那邊只照著畫。
//   - 打中熊：打的人自己做射線，房主直接扣血；客人送 bdmg 給房主扣。
//   - 熊死掉：房主廣播 bdie，兩邊同一個 id 變成屍體。
//   - 刨屍體：刨的人自己算、再廣播扣掉的量（跟砍樹一樣）。
//   - 熊咬人：房主判定，咬到自己就直接扣血，咬到客人就送 hit 過去（算環境傷害，不算對手的分）。
import * as THREE from 'three';
import { BEAR } from './items.js';
import { pushCircle } from './physics.js';
import { BOUNDS } from './world.js';

const ST = { idle: 0, walk: 1, run: 2, attack: 3, dead: 4 };
const R = 0.75;          // 身體半徑（碰撞用）
const ATK_T = 0.8;       // 一次撲咬動作多久
const ATK_HIT = 0.42;    // 動作到哪裡算咬下去
const SINK = 1.5;        // 屍體最後幾秒沉進地裡
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const horiz = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const angDiff = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

export function createBears({ world, scene, audio, host, send }) {
  // host：isAuth()、me()、eye()、actors() → [{ who, pos, alive }]、hurtActor(who, dmg, from)
  const bears = new Map();
  const fur = new THREE.MeshStandardMaterial({ color: '#ebe6da', roughness: 1, flatShading: true });
  const furDark = new THREE.MeshStandardMaterial({ color: '#d2cbbb', roughness: 1, flatShading: true });
  const black = new THREE.MeshStandardMaterial({ color: '#1c1a18', roughness: 0.5 });
  const ball = new THREE.SphereGeometry(1, 10, 8);
  const legGeo = new THREE.CylinderGeometry(0.17, 0.14, 0.95, 8).translate(0, -0.475, 0);
  const pawGeo = new THREE.BoxGeometry(0.3, 0.14, 0.4).translate(0, -0.95, 0.05);
  let idN = 0, spawnT = BEAR.respawn, snapT = 0;

  // ---------- 模型：身體、肩膀隆起、頭（可以轉）、四條腿（從肩膀 / 屁股的地方擺） ----------
  function buildModel(id) {
    const root = new THREE.Group();
    const body = new THREE.Group(); root.add(body);
    const hits = [];
    const part = (geo, mat, sx, sy, sz, x, y, z, partName, parent = body) => {
      const m = new THREE.Mesh(geo, mat);
      m.scale.set(sx, sy, sz); m.position.set(x, y, z);
      m.castShadow = true; m.receiveShadow = true;
      if (partName) { m.userData = { surf: 'flesh', bearId: id, part: partName, noHole: true }; hits.push(m); }
      parent.add(m);
      return m;
    };
    part(ball, fur, 0.62, 0.55, 1.05, 0, 1.0, -0.05, 'body');
    part(ball, fur, 0.58, 0.56, 0.62, 0, 1.12, 0.55, 'body');
    part(ball, furDark, 0.5, 0.44, 0.5, 0, 0.98, -0.75, 'body');
    part(ball, fur, 0.32, 0.32, 0.45, 0, 1.08, 1.05, 'body');
    part(ball, fur, 0.12, 0.12, 0.1, 0, 1.08, -1.13, null);
    const head = new THREE.Group(); head.position.set(0, 1.1, 1.32); body.add(head);
    part(ball, fur, 0.3, 0.28, 0.36, 0, 0, 0, 'head', head);
    part(ball, furDark, 0.17, 0.14, 0.22, 0, -0.07, 0.32, 'head', head);
    part(ball, black, 0.07, 0.055, 0.05, 0, -0.03, 0.53, null, head);
    for (const sx of [-1, 1]) {
      part(ball, fur, 0.08, 0.07, 0.05, sx * 0.17, 0.2, 0.02, 'head', head);
      part(ball, black, 0.035, 0.035, 0.03, sx * 0.13, 0.07, 0.27, null, head);
    }
    const legs = [];
    for (const [x, z] of [[-0.33, 0.72], [0.33, 0.72], [-0.33, -0.62], [0.33, -0.62]]) {
      const pivot = new THREE.Group(); pivot.position.set(x, 0.98, z); body.add(pivot);
      for (const m of [new THREE.Mesh(legGeo, fur), new THREE.Mesh(pawGeo, furDark)]) {
        m.castShadow = true; m.receiveShadow = true;
        m.userData = { surf: 'flesh', bearId: id, part: 'legs', noHole: true };
        hits.push(m); pivot.add(m);
      }
      legs.push(pivot);
    }
    root.scale.setScalar(1.08);
    return { root, body, head, legs, hits };
  }

  function create(id, x, z, yaw = 0) {
    if (bears.has(id)) return bears.get(id);
    const m = buildModel(id);
    const y = world.heightAt(x, z);
    m.root.position.set(x, y, z); m.root.rotation.y = yaw;
    scene.add(m.root);
    for (const h of m.hits) world.solids.push(h);
    const col = { type: 'cyl', x, z, r: R, y0: y, y1: y + 1.5 };
    world.colliders.push(col);
    const b = {
      id, ...m, col, pos: new THREE.Vector3(x, y, z), yaw, home: new THREE.Vector3(x, y, z),
      st: ST.idle, hp: BEAR.hp, target: null, angry: 0, lastBy: null, atkT: -1, atkHit: false, cd: 0,
      dest: null, wanderT: 1 + Math.random() * 3, phase: 0, speed: 0, growlT: 4 + Math.random() * 8,
      net: { pos: new THREE.Vector3(x, y, z), yaw, st: ST.idle, hpPct: 1 },
      dead: false, deadT: 0, fall: 0, meat: BEAR.meat, cloth: BEAR.cloth,
    };
    bears.set(id, b);
    return b;
  }
  function removeBear(id) {
    const b = bears.get(id);
    if (!b) return;
    bears.delete(id);
    scene.remove(b.root);
    for (const h of b.hits) { const k = world.solids.indexOf(h); if (k >= 0) world.solids.splice(k, 1); }
    const k = world.colliders.indexOf(b.col);
    if (k >= 0) world.colliders.splice(k, 1);
  }
  const at = (b, dy = 1.1) => new THREE.Vector3(b.pos.x, b.pos.y + dy, b.pos.z);
  const distTo = (b) => horiz(b.pos, host.eye());
  const roar = (b) => audio.roar(at(b), distTo(b));
  const swipe = (b) => audio.swipe(at(b), distTo(b));

  // ---------- 移動：往目標走，撞到東西推開，不離開雪地 ----------
  function faceToward(b, p, dt) {
    const da = angDiff(b.yaw, Math.atan2(p.x - b.pos.x, p.z - b.pos.z));
    b.yaw += Math.sign(da) * Math.min(Math.abs(da), 5 * dt);
  }
  function step(b, tx, tz, speed, dt) {
    const dx = tx - b.pos.x, dz = tz - b.pos.z, d = Math.hypot(dx, dz);
    if (d < 0.05) { b.speed = 0; return d; }
    const da = angDiff(b.yaw, Math.atan2(dx, dz));
    b.yaw += Math.sign(da) * Math.min(Math.abs(da), 5 * dt);
    const mv = Math.min(speed * dt * Math.max(0, Math.cos(da)), d);   // 轉太多先原地轉，不要橫著滑
    const ox = b.pos.x, oz = b.pos.z;
    b.pos.x += Math.sin(b.yaw) * mv; b.pos.z += Math.cos(b.yaw) * mv;
    pushCircle(b.pos, R, b.pos.y + 0.3, b.pos.y + 1.4, world.colliders, b.col);
    b.pos.x = clamp(b.pos.x, BOUNDS.minX + 1, BOUNDS.maxX - 1);
    b.pos.z = clamp(b.pos.z, BOUNDS.minZ + 1, BOUNDS.maxZ - 1);
    if (world.snowAt(b.pos.x, b.pos.z) < 0.5) { b.pos.x = ox; b.pos.z = oz; }
    b.pos.y = world.heightAt(b.pos.x, b.pos.z);
    b.speed = Math.hypot(b.pos.x - ox, b.pos.z - oz) / Math.max(dt, 1e-4);
    return d;
  }

  // 中間被牆、門擋住就咬不到（不然人躲在屋子裡也會被隔牆咬）
  const losFrom = new THREE.Vector3(), losDir = new THREE.Vector3();
  function canReach(b, a) {
    losFrom.set(b.pos.x, b.pos.y + 1.1, b.pos.z);
    losDir.set(a.pos.x, a.pos.y + 1.1, a.pos.z).sub(losFrom);
    const d = losDir.length();
    if (d < 1e-3) return true;
    losDir.divideScalar(d);
    const wh = world.raycast(losFrom, losDir, d);
    return !wh || wh.dist > d - 0.35 || wh.mesh?.userData.bearId === b.id;
  }

  // ---------- AI（只有房主跑） ----------
  function think(b, dt, actors) {
    b.cd = Math.max(0, b.cd - dt);
    b.angry = Math.max(0, b.angry - dt);
    let tgt = null, best = Infinity;
    for (const a of actors) {
      if (!a.alive || world.snowAt(a.pos.x, a.pos.z) < 0.35) continue;   // 熊不追出雪地
      const d = horiz(b.pos, a.pos);
      if (d > (b.angry > 0 ? 36 : BEAR.aggro) || horiz(b.home, a.pos) > BEAR.leash) continue;
      const pri = b.angry > 0 && b.lastBy === a.who ? d - 10 : d;     // 先咬打牠的人
      if (pri < best) { best = pri; tgt = a; }
    }
    if (tgt && !b.target) roar(b);
    b.target = tgt;
    if (b.atkT >= 0) {
      b.atkT += dt;
      b.st = ST.attack;
      if (tgt) faceToward(b, tgt.pos, dt);
      if (b.atkT >= ATK_HIT && !b.atkHit) {
        b.atkHit = true;
        if (tgt && horiz(b.pos, tgt.pos) < BEAR.reach + 0.8 && Math.abs(tgt.pos.y - b.pos.y) < 2 && canReach(b, tgt)) host.hurtActor(tgt.who, BEAR.dmg, at(b));
      }
      if (b.atkT >= ATK_T) { b.atkT = -1; b.cd = Math.max(0, BEAR.attackCd - ATK_T); }
      return;
    }
    if (tgt) {
      const d = horiz(b.pos, tgt.pos);
      if (d < BEAR.reach && b.cd <= 0) { b.atkT = 0; b.atkHit = false; b.st = ST.attack; b.speed = 0; swipe(b); return; }
      if (d > BEAR.reach * 0.8) step(b, tgt.pos.x, tgt.pos.z, BEAR.run, dt);
      else { b.speed = 0; faceToward(b, tgt.pos, dt); }
      b.st = ST.run;
      return;
    }
    // 沒目標：在家附近晃，偶爾停下來聞一聞
    b.wanderT -= dt;
    if (b.wanderT <= 0) {
      if (Math.random() < 0.35 && horiz(b.pos, b.home) < 18) { b.dest = null; b.wanderT = 2 + Math.random() * 3; }
      else {
        const a = Math.random() * Math.PI * 2, r = 3 + Math.random() * 12;
        b.dest = new THREE.Vector3(b.home.x + Math.cos(a) * r, 0, b.home.z + Math.sin(a) * r);
        b.wanderT = 9;
      }
    }
    if (b.dest) {
      const d = step(b, b.dest.x, b.dest.z, BEAR.walk, dt);
      b.st = ST.walk;
      if (d < 0.6) { b.dest = null; b.wanderT = 1.5 + Math.random() * 3; }
    } else { b.st = ST.idle; b.speed = 0; }
  }

  // ---------- 客人：照房主送來的位置畫 ----------
  function follow(b, dt) {
    const n = b.net, k = 1 - Math.exp(-10 * dt);
    const ox = b.pos.x, oz = b.pos.z;
    b.pos.x += (n.pos.x - b.pos.x) * k; b.pos.z += (n.pos.z - b.pos.z) * k;
    b.pos.y = world.heightAt(b.pos.x, b.pos.z);
    b.yaw += angDiff(b.yaw, n.yaw) * k;
    b.speed = Math.hypot(b.pos.x - ox, b.pos.z - oz) / Math.max(dt, 1e-4);
    if (n.st !== b.st) {
      if (n.st === ST.run && b.st !== ST.attack) roar(b);
      if (n.st === ST.attack) { b.atkT = 0; swipe(b); }
      b.st = n.st;
    }
    if (b.atkT >= 0) { b.atkT += dt; if (b.atkT >= ATK_T) b.atkT = -1; }
  }

  // ---------- 動作：走路擺腿、攻擊時前半身抬起來往前咬、死掉倒向一邊 ----------
  function animate(b, dt) {
    const r = b.root;
    r.position.copy(b.pos);
    r.rotation.y = b.yaw;
    b.col.x = b.pos.x; b.col.z = b.pos.z; b.col.y0 = b.pos.y; b.col.y1 = b.pos.y + 1.5;
    if (b.dead) {
      // 側躺下去：繞著腳底轉的話身體會往旁邊移一公尺，所以把根節點往反方向推回來，身體才會躺在原地
      const f = b.fall * b.fall, rz = f * 1.45, sc = r.scale.x;
      r.rotation.z = rz;
      const side = Math.sin(rz) * 1.0 * sc;
      r.position.x += Math.cos(b.yaw) * side;
      r.position.z -= Math.sin(b.yaw) * side;
      // 高度：躺平時身體中心離地剛好半個身寬；最後幾秒沉進地裡
      r.position.y = b.pos.y + f * (0.62 - Math.cos(rz)) * sc - Math.max(0, b.deadT - (BEAR.corpseLife - SINK)) * 0.9;
      for (const L of b.legs) L.rotation.x *= 0.9;
      b.body.rotation.x *= 0.9;
      return;
    }
    const sp = b.speed;
    b.phase += dt * (sp > 3 ? 11 : 5.5) * (sp > 0.2 ? 1 : 0);
    const amp = sp > 3 ? 0.75 : sp > 0.2 ? 0.4 : 0;
    const [fl, fr, bl, br] = b.legs;
    const s1 = Math.sin(b.phase) * amp, s2 = -s1;
    fl.rotation.x = s1; br.rotation.x = s1; fr.rotation.x = s2; bl.rotation.x = s2;
    b.body.position.y = Math.abs(Math.sin(b.phase)) * (sp > 3 ? 0.08 : 0.03);
    let atk = 0;
    if (b.atkT >= 0) { const t = b.atkT / ATK_T; atk = t < 0.5 ? t / 0.5 : 1 - (t - 0.5) / 0.5; }
    b.body.rotation.x = -0.32 * atk;
    b.body.position.z = 0.25 * atk;
    const sniff = b.st === ST.idle ? 0.12 * Math.sin(performance.now() / 600 + b.phase) : 0;
    b.head.rotation.x = -0.08 + 0.35 * atk + sniff;
  }

  // ---------- 受傷、死掉、刨 ----------
  function applyDamage(b, dmg, who) {
    if (b.dead || dmg <= 0) return;
    b.hp -= dmg;
    b.angry = 14; b.lastBy = who;
    if (b.hp <= 0) {
      send('bdie', { id: b.id, x: +b.pos.x.toFixed(2), z: +b.pos.z.toFixed(2), yaw: +b.yaw.toFixed(2) });
      makeCorpse(b, b.pos.x, b.pos.z, b.yaw);
    }
  }
  function makeCorpse(b, x, z, yaw) {
    if (b.dead) return;
    b.dead = true; b.st = ST.dead; b.deadT = 0; b.fall = 0; b.atkT = -1; b.speed = 0;
    b.pos.set(x, world.heightAt(x, z), z); b.yaw = yaw;
    const k = world.colliders.indexOf(b.col);
    if (k >= 0) world.colliders.splice(k, 1);
    audio.growl(at(b), distTo(b));
  }
  // 自己打中熊：dmg 是武器的基本傷害，部位倍率在這裡算
  function hit(b, dmg, part) {
    if (b.dead) return;
    const d = Math.round(dmg * (part === 'head' ? BEAR.headMult : part === 'legs' ? 0.8 : 1));
    if (host.isAuth()) applyDamage(b, d, host.me());
    else { send('bdmg', { id: b.id, dmg: d, who: host.me() }); b.net.hpPct = Math.max(0, b.net.hpPct - d / BEAR.hp); }
  }
  // 刨屍體：tool 是 MELEE 裡的那一項（meat / cloth 是一下拿多少）
  function harvest(b, tool) {
    if (!b.dead) return null;
    const m = Math.min(tool.meat || 0, b.meat), c = Math.min(tool.cloth || 0, b.cloth);
    if (m + c <= 0) return null;
    b.meat -= m; b.cloth -= c;
    send('bharv', { id: b.id, m, c });
    if (b.meat <= 0 && b.cloth <= 0) b.deadT = Math.max(b.deadT, BEAR.corpseLife - SINK);   // 刨光了就沉下去
    return { meat: m, cloth: c };
  }

  function spawnOne(actors, initial = false) {
    const pts = world.bearSpawns.filter((p) => (initial || actors.every((a) => horiz(p, a.pos) > 32))
      && [...bears.values()].every((b) => horiz(b.home, p) > 10));
    if (!pts.length) return;
    const p = pts[Math.floor(Math.random() * pts.length)];
    create(`b${host.me()}${++idN}`, p.x, p.z, Math.random() * Math.PI * 2);
  }
  function sendSnap() {
    const s = [];
    for (const b of bears.values()) if (!b.dead) s.push([b.id, +b.pos.x.toFixed(2), +b.pos.z.toFixed(2), +b.yaw.toFixed(2), b.st, +(b.hp / BEAR.hp).toFixed(2)]);
    if (s.length) send('bears', { s });
  }

  function update(dt) {
    const auth = host.isAuth();
    const actors = host.actors();
    let alive = 0;
    for (const b of [...bears.values()]) {
      if (b.dead) {
        b.deadT += dt;
        b.fall = Math.min(1, b.fall + dt / 0.8);
        if (auth && b.deadT >= BEAR.corpseLife) { send('bgone', { id: b.id }); removeBear(b.id); continue; }
      } else {
        alive++;
        if (auth) think(b, dt, actors); else follow(b, dt);
        // 附近有人的時候偶爾低吼一聲（提醒你熊在哪）
        b.growlT -= dt;
        if (b.growlT <= 0) { b.growlT = 6 + Math.random() * 7; if (distTo(b) < 30 && b.st !== ST.run) audio.growl(at(b), distTo(b)); }
      }
      animate(b, dt);
    }
    if (!auth) return;
    if (alive < BEAR.max) { spawnT -= dt; if (spawnT <= 0) { spawnT = BEAR.respawn; spawnOne(actors); } } else spawnT = BEAR.respawn;
    snapT -= dt;
    if (snapT <= 0) { snapT = 0.12; sendSnap(); }
  }

  function onMessage(m) {
    switch (m.k) {
      case 'bears':
        if (host.isAuth()) break;
        for (const [id, x, z, yaw, st, hp] of m.s) {
          const b = bears.get(id) || create(id, x, z, yaw);
          if (b.dead) continue;
          b.net.pos.set(x, 0, z); b.net.yaw = yaw; b.net.st = st; b.net.hpPct = hp;
        }
        break;
      case 'bdmg': if (host.isAuth()) { const b = bears.get(m.id); if (b) applyDamage(b, m.dmg, m.who); } break;
      case 'bdie': makeCorpse(bears.get(m.id) || create(m.id, m.x, m.z, m.yaw), m.x, m.z, m.yaw); break;
      case 'bharv': {
        const b = bears.get(m.id);
        if (!b) break;
        b.meat = Math.max(0, b.meat - m.m); b.cloth = Math.max(0, b.cloth - m.c);
        if (b.meat <= 0 && b.cloth <= 0) b.deadT = Math.max(b.deadT, BEAR.corpseLife - SINK);
        break;
      }
      case 'bgone': removeBear(m.id); break;
    }
  }

  return {
    list: bears,
    fromHit(wh) { const id = wh?.mesh?.userData.bearId; return id ? bears.get(id) || null : null; },
    hpOf: (b) => (host.isAuth() ? b.hp : b.net.hpPct * BEAR.hp),
    hit, harvest, update, onMessage,
    // 手雷：範圍內的熊都扣血（只有丟的人呼叫）
    explode(p, radius, maxDmg) {
      for (const b of bears.values()) {
        if (b.dead) continue;
        const d = Math.hypot(b.pos.x - p.x, b.pos.y + 1 - p.y, b.pos.z - p.z);
        if (d < radius) hit(b, maxDmg * (d < 1 ? 1 : 1 - (d - 1) / (radius - 1)), 'body');
      }
    },
    reset() {
      for (const id of [...bears.keys()]) removeBear(id);
      spawnT = BEAR.respawn; snapT = 0;
      if (host.isAuth()) for (let i = 0; i < BEAR.max; i++) spawnOne([], true);
    },
  };
}
