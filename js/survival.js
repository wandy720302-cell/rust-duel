// 生存模式：背包、製作、鐵桶、掉落物、火爐、睡袋、礦點、建築、門鎖、手雷。
// 同步原則：
//   - 自己做的事（蓋房子、挖礦、打鐵桶、丟手雷）自己算，再廣播；兩邊套用同樣的結果。
//   - 「容器」（地上的東西、死掉的背包、火爐）裡面的東西只有房主能改：客人送請求，房主改完再廣播，
//     兩個人同時搶同一件東西也不會變成兩件。
//   - 鐵桶刷新、礦點重生、火爐冶煉都由房主決定。單人模式自己就是房主。
import * as THREE from 'three';
import { ITEMS, RECIPES, recipeOf, PIECES, DEPLOY, MELEE, GUNS, NADE, CRATE, NODE_RESPAWN, MATCH_SECONDS, BEAR, rollLoot, falloffMult } from './items.js';
import { createBears } from './bears.js';
import { rng } from './textures.js';
import * as INV from './inventory.js';
import { RADIUS } from './physics.js';

const REACH = 2.7;

export function createSurvival(env) {
  const { world, scene, fx, audio, hud, structs, proj, host } = env;
  const { colliders, solids, heightAt, T } = world;

  const sv = {
    inv: INV.createInv(), hotIdx: 0, queue: [],
    crates: new Map(), drops: new Map(), furn: new Map(), sbags: new Map(),
    nodeTimers: new Map(), crateTimer: 0, crateN: 0, idN: 0, reqN: 0, pending: new Map(),
    buildType: 'found', rot: 0, endAt: 0, openCont: null, lookAt: 0, target: null, lastHurt: -1e9,
    listeners: new Set(),
  };
  const send = (k, data) => host.send({ t: 'sv', k, ...data });
  const nid = (p = '') => `${host.me()}${p}${++sv.idN}`;
  const changed = () => { for (const fn of sv.listeners) fn(); };
  const v3 = (v) => [+v.x.toFixed(2), +v.y.toFixed(2), +v.z.toFixed(2)];
  const toV = (a) => new THREE.Vector3(a[0], a[1], a[2]);
  const bears = createBears({ world, scene, audio, host, send });

  // ---------- 外觀 ----------
  const stripeTex = (() => {
    const c = document.createElement('canvas'); c.width = 64; c.height = 16;
    const g = c.getContext('2d');
    g.fillStyle = '#d9b02c'; g.fillRect(0, 0, 64, 16);
    g.fillStyle = '#1e1d1b';
    for (let x = -16; x < 80; x += 16) { g.beginPath(); g.moveTo(x, 16); g.lineTo(x + 8, 0); g.lineTo(x + 16, 0); g.lineTo(x + 8, 16); g.fill(); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; return t;
  })();
  const MAT = {
    crate: new THREE.MeshStandardMaterial({ map: T.crate, roughness: 0.9, envMapIntensity: 0.6 }),
    stripe: new THREE.MeshStandardMaterial({ map: stripeTex, roughness: 0.8 }),
    sack: new THREE.MeshStandardMaterial({ color: '#8a7350', roughness: 1 }),
    pack: new THREE.MeshStandardMaterial({ color: '#4f4430', roughness: 0.95 }),
    stone: new THREE.MeshStandardMaterial({ map: T.stone, roughness: 0.95, envMapIntensity: 0.6 }),
    dark: new THREE.MeshStandardMaterial({ color: '#2c2b29', roughness: 0.6, metalness: 0.5 }),
    mouthOff: new THREE.MeshStandardMaterial({ color: '#1a1410', roughness: 1 }),
    mouthOn: new THREE.MeshBasicMaterial({ color: '#ff8a2a' }),
    bag: new THREE.MeshStandardMaterial({ color: '#5a6438', roughness: 0.95 }),
    bagHead: new THREE.MeshStandardMaterial({ color: '#8a7f5c', roughness: 0.95 }),
  };
  const dropMeshes = [];   // 拿來給「看著什麼」的射線用（子彈會穿過掉落物）

  // ---------- 背包 ----------
  function add(id, n, d = null) {
    const left = INV.add(sv.inv, id, n, d);
    if (left > 0) dropItems([{ id, n: left, ...(d ? { d } : {}) }], host.feet(), 'item');
    changed();
    return left;
  }
  const count = (id) => INV.count(sv.inv, id);
  function take(id, n) { const ok = INV.take(sv.inv, id, n); if (ok) changed(); return ok; }
  const held = () => sv.inv.hot[sv.hotIdx] || null;
  function holdKind() {
    const it = held();
    if (!it) return 'none';
    return ITEMS[it.id]?.hold || 'none';
  }
  // 給 viewmodel / 對手看的樣子
  function holdLook() {
    const it = held();
    if (!it) return 'none';
    const h = ITEMS[it.id]?.hold;
    if (h === 'gun' || h === 'melee') return it.id;
    if (h === 'bow') return 'bow';
    if (h === 'throw') return 'grenade';
    if (h === 'build' || h === 'deploy') return 'plan';
    if (h === 'eat') return it.id === 'cooked_meat' ? 'cooked' : 'meat';
    if (h === 'heal') return 'bandage';
    return 'none';
  }

  // ---------- 製作 ----------
  function craft(id, times = 1) {
    const r = recipeOf(id);
    if (!r) return false;
    if (!INV.startCraft(sv.inv, sv.queue, r, times)) { audio.beep(false); return false; }
    audio.pop();
    changed();
    return true;
  }
  function cancelCraft(idx) {
    const refund = INV.cancelCraft(sv.inv, sv.queue, idx);
    if (refund.length) dropItems(refund, host.feet(), 'item');
    changed();
  }

  // ---------- 掉落物（地上的東西 / 死掉的背包） ----------
  function dropMesh(kind) {
    const g = new THREE.Group();
    if (kind === 'bag') {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.42, 0.32).translate(0, 0.21, 0), MAT.pack);
      const flap = new THREE.Mesh(new THREE.BoxGeometry(0.57, 0.08, 0.34).translate(0, 0.42, 0), MAT.sack);
      const strap = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.38, 0.34).translate(0.14, 0.2, 0.01), MAT.dark);
      g.add(b, flap, strap);
    } else {
      const s = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6).scale(1, 0.75, 1).translate(0, 0.14, 0), MAT.sack);
      const knot = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.12, 6).translate(0, 0.32, 0), MAT.sack);
      g.add(s, knot);
    }
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    return g;
  }
  // 掉在哪：從上往下找第一個能放的面（地形或建築）
  function restingPoint(p) {
    const o = new THREE.Vector3(p.x, p.y + 1.2, p.z);
    const wh = world.raycast(o, new THREE.Vector3(0, -1, 0), 6);
    return wh ? wh.point : new THREE.Vector3(p.x, heightAt(p.x, p.z), p.z);
  }
  function createDrop({ id, p, slots, kind }) {
    if (sv.drops.has(id)) return;
    const pos = restingPoint(toV(p));
    const mesh = dropMesh(kind);
    mesh.position.copy(pos);
    mesh.rotation.y = Math.random() * 6.28;
    mesh.traverse((o) => { if (o.isMesh) o.userData.dropId = id; });
    scene.add(mesh);
    const d = { id, pos, slots: slots.map(INV.cloneItem), kind, mesh, born: performance.now() };
    sv.drops.set(id, d);
    mesh.traverse((o) => { if (o.isMesh) dropMeshes.push(o); });
  }
  function removeDrop(id) {
    const d = sv.drops.get(id);
    if (!d) return;
    sv.drops.delete(id);
    scene.remove(d.mesh);
    d.mesh.traverse((o) => { const k = dropMeshes.indexOf(o); if (k >= 0) dropMeshes.splice(k, 1); });
    if (sv.openCont === id) closeContainer();
  }
  // 把東西丟在地上（自己丟的：自己建立再廣播）
  function dropItems(items, pos, kind = 'item') {
    const list = items.filter((x) => x && x.n > 0);
    if (!list.length) return;
    const size = kind === 'bag' ? Math.max(list.length, 6) : list.length;
    const slots = Array(size).fill(null);
    list.forEach((it, i) => { slots[i] = INV.cloneItem(it); });
    const msg = { id: nid('d'), p: v3(pos), slots, kind };
    createDrop(msg);
    send('drop', msg);
  }
  function dropFromSlot(arr, i) {
    const it = arr[i];
    if (!it) return;
    arr[i] = null;
    const f = host.forwardFlat();
    dropItems([it], host.feet().clone().addScaledVector(f, 1.0).setY(host.feet().y + 0.6), 'item');
    audio.pop();
    changed();
  }

  // ---------- 容器存取（房主裁決） ----------
  const contOf = (id) => sv.drops.get(id) || sv.furn.get(id) || null;
  function broadcastCont(c) {
    const msg = { cid: c.id, slots: c.slots, on: c.on || false };
    send('cset', msg);
    if (sv.openCont === c.id) changed();
    if (c.slots && sv.drops.has(c.id) && INV.isEmpty(c.slots)) { removeDrop(c.id); send('cdel', { cid: c.id }); }
  }
  // 在房主這邊實際改容器，回傳要給請求者的東西
  function applyOp(op) {
    const c = contOf(op.cid);
    const give = [];
    if (!c) { if (op.item) give.push(op.item); return give; }
    const isFurn = sv.furn.has(c.id);
    if (op.op === 'take') { const it = INV.takeFrom(c.slots, op.slot); if (it) give.push(it); }
    else if (op.op === 'takeAll') { for (let j = 0; j < c.slots.length; j++) { const it = INV.takeFrom(c.slots, j); if (it) give.push(it); } }
    else if (op.op === 'put') {
      if (isFurn && !INV.furnaceAccepts(op.slot, op.item.id)) give.push(op.item);
      else { const back = INV.putInto(c.slots, op.slot, op.item); if (back) give.push(back); }
    } else if (op.op === 'toggle' && isFurn) {
      c.on = !c.on && !!c.slots[INV.FURNACE.FUEL];
      c.acc = 0;
      setFurnaceLook(c);
    }
    broadcastCont(c);
    return give;
  }
  function receive(items) {
    for (const it of items) add(it.id, it.n, it.d || null);
    if (items.length) audio.pop();
  }
  function requestOp(op) {
    if (host.isAuth()) { receive(applyOp(op)); return; }
    const rid = ++sv.reqN;
    sv.pending.set(rid, op);
    send('cop', { ...op, rid });
  }
  // UI 用的操作
  const contTake = (slot) => sv.openCont && requestOp({ op: 'take', cid: sv.openCont, slot });
  const contTakeAll = () => sv.openCont && requestOp({ op: 'takeAll', cid: sv.openCont });
  function contPut(fromArr, i, slot) {
    const it = fromArr[i];
    if (!it || !sv.openCont) return;
    if (sv.furn.has(sv.openCont) && !INV.furnaceAccepts(slot, it.id)) { audio.beep(false); return; }
    fromArr[i] = null;
    changed();
    requestOp({ op: 'put', cid: sv.openCont, slot, item: INV.cloneItem(it) });
  }
  // 快速放進火爐：木頭進燃料格，礦石進第一個放得下的礦石格
  function contQuickPut(fromArr, i) {
    const it = fromArr[i];
    if (!it || !sv.openCont) return;
    if (sv.furn.has(sv.openCont)) {
      const f = sv.furn.get(sv.openCont);
      const slot = it.id === 'wood' ? INV.FURNACE.FUEL : INV.FURNACE.IN.find((j) => !f.slots[j] || f.slots[j].id === it.id) ?? -1;
      if (slot < 0 || !INV.furnaceAccepts(slot, it.id)) { audio.beep(false); return; }
      contPut(fromArr, i, slot);
    } else {
      const c = contOf(sv.openCont);
      const slot = c.slots.findIndex((s) => !s || (s.id === it.id && s.n < INV.stackOf(it.id)));
      if (slot >= 0) contPut(fromArr, i, slot);
    }
  }
  const contToggle = () => sv.openCont && requestOp({ op: 'toggle', cid: sv.openCont });
  function openContainer(id) { sv.openCont = id; host.openInventory(true); changed(); }
  function closeContainer() { sv.openCont = null; changed(); }

  // ---------- 鐵桶（rust 路邊那種油桶：藍色、黃褐色兩種，掉漆生鏽，打破會掉東西） ----------
  // 程式內部還是叫 crate，網路訊息才不用改
  const BARREL = { r: 0.32, h: 0.95 };
  function paintTex(base, seed, lid = false) {
    const c = document.createElement('canvas'); c.width = 256; c.height = 128;
    const g = c.getContext('2d'), r = rng(seed);
    g.fillStyle = base; g.fillRect(0, 0, 256, 128);
    // 掉漆刮痕
    for (let i = 0; i < 70; i++) { g.fillStyle = `rgba(255,255,255,${0.04 + r() * 0.08})`; g.fillRect(r() * 256, r() * 128, 2 + r() * 16, 1 + r() * 2); }
    // 鏽斑：上下緣最多
    for (let i = 0; i < (lid ? 60 : 110); i++) {
      const y = lid ? r() * 128 : r() < 0.65 ? (r() < 0.5 ? r() * 20 : 108 + r() * 20) : r() * 128;
      g.fillStyle = `rgba(${115 + r() * 45},${55 + r() * 28},${22 + r() * 16},${0.3 + r() * 0.5})`;
      g.beginPath(); g.ellipse(r() * 256, y, 2 + r() * 10, 1.5 + r() * 7, r() * 3, 0, Math.PI * 2); g.fill();
    }
    if (!lid) {
      // 鏽水從上緣往下流
      for (let i = 0; i < 16; i++) {
        const x = r() * 256, len = 25 + r() * 70, gr = g.createLinearGradient(0, 0, 0, len);
        gr.addColorStop(0, 'rgba(105,52,24,0.6)'); gr.addColorStop(1, 'rgba(105,52,24,0)');
        g.fillStyle = gr; g.fillRect(x, 0, 1.5 + r() * 3.5, len);
      }
      // 兩圈凸起的箍
      for (const y of [43, 85]) { g.fillStyle = 'rgba(0,0,0,0.28)'; g.fillRect(0, y - 3, 256, 6); g.fillStyle = 'rgba(255,255,255,0.14)'; g.fillRect(0, y - 3, 256, 1.5); }
    }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; t.anisotropy = 4;
    return t;
  }
  const BARREL_MAT = [['#2b5f9e', 11], ['#2f6aa8', 12], ['#c39a3c', 13]].map(([c, s]) => ({
    side: new THREE.MeshStandardMaterial({ map: paintTex(c, s), roughness: 0.62, metalness: 0.35, envMapIntensity: 0.7 }),
    lid: new THREE.MeshStandardMaterial({ map: paintTex(c, s + 50, true), roughness: 0.7, metalness: 0.3, envMapIntensity: 0.7 }),
    rib: new THREE.MeshStandardMaterial({ color: new THREE.Color(c).multiplyScalar(0.72), roughness: 0.55, metalness: 0.45 }),
  }));
  const barrelGeo = {
    body: new THREE.CylinderGeometry(BARREL.r, BARREL.r, BARREL.h, 20).translate(0, BARREL.h / 2, 0),
    rib: mergeRibs(),
    cap: new THREE.CylinderGeometry(0.035, 0.035, 0.03, 8).translate(0.14, BARREL.h + 0.012, 0.05),
  };
  function mergeRibs() {
    const parts = [0.31, 0.62, BARREL.h - 0.012].map((y, i) => new THREE.TorusGeometry(BARREL.r + (i === 2 ? -0.004 : 0.008), i === 2 ? 0.02 : 0.016, 6, 28).rotateX(Math.PI / 2).translate(0, y, 0));
    const pos = [], idx = [];
    let off = 0;
    for (const p of parts) {
      const a = p.attributes.position.array;
      for (let i = 0; i < a.length; i++) pos.push(a[i]);
      const ix = p.index.array;
      for (let i = 0; i < ix.length; i++) idx.push(ix[i] + off);
      off += a.length / 3;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx); g.computeVertexNormals();
    return g;
  }
  function crateMesh(variant) {
    const mat = BARREL_MAT[variant % BARREL_MAT.length];
    const g = new THREE.Group();
    const body = new THREE.Mesh(barrelGeo.body, [mat.side, mat.lid, mat.lid]);
    const ribs = new THREE.Mesh(barrelGeo.rib, mat.rib);
    const cap = new THREE.Mesh(barrelGeo.cap, mat.rib);
    for (const m of [body, ribs, cap]) { m.castShadow = m.receiveShadow = true; g.add(m); }
    return { g, meshes: [body, ribs] };
  }
  function createCrate({ id, sp, loot }) {
    if (sv.crates.has(id)) return;
    const spot = world.crateSpots[sp];
    if (!spot) return;
    const { g, meshes } = crateMesh(sp * 7 + 3);
    g.position.copy(spot);
    g.rotation.y = (sp * 1.37) % 6.28;
    scene.add(g);
    for (const m of meshes) { m.userData = { surf: 'metal', crateId: id, noHole: true }; solids.push(m); }
    const col = { type: 'cyl', x: spot.x, z: spot.z, r: BARREL.r + 0.04, y0: spot.y - 0.2, y1: spot.y + BARREL.h };
    colliders.push(col);
    sv.crates.set(id, { id, sp, loot, hp: CRATE.hp, g, meshes, col, pos: spot.clone() });
  }
  function removeCrate(id) {
    const c = sv.crates.get(id);
    if (!c) return;
    sv.crates.delete(id);
    scene.remove(c.g);
    for (const m of c.meshes) { const k = solids.indexOf(m); if (k >= 0) solids.splice(k, 1); }
    const k = colliders.indexOf(c.col); if (k >= 0) colliders.splice(k, 1);
  }
  function damageCrate(id, dmg, remote = false) {
    const c = sv.crates.get(id);
    if (!c) return;
    c.hp -= dmg;
    if (!remote) send('chit', { id, dmg });
    if (c.hp <= 0) {
      // 兩邊都用同一份掉落表、同一個 id 生出掉落物
      const at = c.pos.clone().add(new THREE.Vector3(0, 0.3, 0));
      for (let i = 0; i < 6; i++) fx.impact(at.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.6, Math.random() * 0.6, (Math.random() - 0.5) * 0.6)), new THREE.Vector3(0, 1, 0), 'metal');
      audio.crash(remote ? at : null, at.distanceTo(host.eye()));
      audio.clunk(remote ? at : null, at.distanceTo(host.eye()));
      removeCrate(id);
      createDrop({ id: `${id}d`, p: v3(at), slots: c.loot, kind: 'item' });
    } else audio.clunk(remote ? c.pos : null, c.pos.distanceTo(host.eye()));
  }
  // initial：開局撒鐵桶時還沒重生，玩家位置不準，不用避開
  function spawnCrate(initial = false) {
    const free = world.crateSpots.map((_, i) => i).filter((i) => ![...sv.crates.values()].some((c) => c.sp === i)
      && (initial || !host.playersNear(world.crateSpots[i], 6)));
    if (!free.length) return;
    const sp = free[Math.floor(Math.random() * free.length)];
    const msg = { id: `c${++sv.crateN}`, sp, loot: rollLoot() };
    createCrate(msg);
    send('crate', msg);
  }

  // ---------- 火爐、睡袋（放在地上的設施） ----------
  function furnaceMesh() {
    const g = new THREE.Group();
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, 0.9).translate(0, 0.45, 0), MAT.stone);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.98, 0.1, 0.98).translate(0, 0.95, 0), MAT.dark);
    const chimney = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.9, 8).translate(0.22, 1.45, -0.22), MAT.dark);
    const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.3, 0.04).translate(0, 0.38, 0.46), MAT.mouthOff);
    for (const m of [base, cap, chimney, mouth]) { m.castShadow = m.receiveShadow = true; g.add(m); }
    return { g, meshes: [base, cap, chimney, mouth], mouth };
  }
  function sbagMesh() {
    const g = new THREE.Group();
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.12, 1.9).translate(0, 0.06, 0), MAT.bag);
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.08, 0.4).translate(0, 0.13, -0.68), MAT.bagHead);
    for (const m of [b, h]) { m.receiveShadow = true; g.add(m); }
    return { g, meshes: [b, h] };
  }
  function setFurnaceLook(f) {
    f.mouth.material = f.on ? MAT.mouthOn : MAT.mouthOff;
    if (f.fire) f.fire.visible = !!f.on;
  }
  function createDeploy({ id, kind, x, y, z, r, owner }) {
    if (sv.furn.has(id) || sv.sbags.has(id)) return;
    if (kind === 'furnace') {
      const { g, meshes, mouth } = furnaceMesh();
      g.position.set(x, y, z); g.rotation.y = r;
      const fire = new THREE.Sprite(new THREE.SpriteMaterial({ map: T.puff, color: '#ff9a3a', blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
      fire.position.set(0, 0.42, 0.5); fire.scale.setScalar(0.35); fire.visible = false; g.add(fire);
      scene.add(g);
      for (const m of meshes) { m.userData = { surf: 'stone', furnId: id, noHole: true }; solids.push(m); }
      const col = { type: 'obox', cx: x, cz: z, hx: 0.45, hz: 0.45, ax: Math.cos(r), az: -Math.sin(r), y0: y - 0.1, y1: y + 0.95 };
      colliders.push(col);
      const f = { id, owner, x, y, z, r, g, meshes, mouth, fire, col, slots: Array(INV.FURNACE.SIZE).fill(null), on: false, acc: 0, hp: DEPLOY.furnace.hp };
      sv.furn.set(id, f);
    } else if (kind === 'sbag') {
      const { g, meshes } = sbagMesh();
      g.position.set(x, y, z); g.rotation.y = r;
      scene.add(g);
      for (const m of meshes) { m.userData = { surf: 'wood', sbagId: id, noHole: true }; solids.push(m); }
      sv.sbags.set(id, { id, owner, x, y, z, r, g, meshes, hp: DEPLOY.sbag.hp, readyAt: 0 });
    }
  }
  function removeDeploy(id) {
    const f = sv.furn.get(id) || sv.sbags.get(id);
    if (!f) return;
    scene.remove(f.g);
    for (const m of f.meshes) { const k = solids.indexOf(m); if (k >= 0) solids.splice(k, 1); }
    if (f.col) { const k = colliders.indexOf(f.col); if (k >= 0) colliders.splice(k, 1); }
    if (sv.furn.has(id)) {
      sv.furn.delete(id);
      // 火爐被炸掉：裡面的東西掉出來（兩邊都有同一份內容、同一個 id）
      const items = f.slots.filter(Boolean);
      if (items.length) createDrop({ id: `${id}d`, p: [f.x, f.y + 0.5, f.z], slots: items, kind: 'bag' });
      if (sv.openCont === id) closeContainer();
    }
    sv.sbags.delete(id);
  }
  function damageDeploy(id, dmg, remote = false) {
    const f = sv.furn.get(id) || sv.sbags.get(id);
    if (!f) return;
    f.hp -= dmg;
    if (!remote) send('ddmg', { id, dmg });
    if (f.hp <= 0) removeDeploy(id);
  }

  // 放設施的位置：準心打到的平面，太斜、擋到、太遠都不行
  function evaluateDeploy(kind, aim, normal) {
    const res = { kind, ok: false, reason: '', x: 0, y: 0, z: 0, r: 0, hide: true };
    if (!aim) { res.reason = '對著地面'; return res; }
    Object.assign(res, { x: aim.x, y: aim.y, z: aim.z, r: host.yaw() + sv.rot + Math.PI, hide: false });
    if (Math.hypot(aim.x - host.feet().x, aim.z - host.feet().z) > 4) { res.reason = '太遠了'; return res; }
    if (normal && normal.y < 0.75) { res.reason = '要放在平的地方'; return res; }
    const rr = kind === 'sbag' ? 0.5 : 0.55;
    for (const c of colliders) {
      const top = c.type === 'box' ? c.max[1] : c.y1, bot = c.type === 'box' ? c.min[1] : c.y0;
      if (top <= aim.y + 0.05 || bot >= aim.y + 1) continue;
      let d;
      if (c.type === 'box') d = Math.hypot(aim.x - THREE.MathUtils.clamp(aim.x, c.min[0], c.max[0]), aim.z - THREE.MathUtils.clamp(aim.z, c.min[2], c.max[2]));
      else if (c.type === 'cyl') d = Math.hypot(aim.x - c.x, aim.z - c.z) - c.r;
      else if (c.type === 'obox') { const dx = aim.x - c.cx, dz = aim.z - c.cz; const lx = dx * c.ax + dz * c.az, lz = -dx * c.az + dz * c.ax; d = Math.hypot(lx - THREE.MathUtils.clamp(lx, -c.hx, c.hx), lz - THREE.MathUtils.clamp(lz, -c.hz, c.hz)); }
      else d = 1;
      if (d < rr) { res.reason = '這裡擋到東西了'; return res; }
    }
    for (const p of host.players()) if (Math.hypot(p.x - aim.x, p.z - aim.z) < rr + RADIUS && Math.abs(p.y - aim.y) < 1.5) { res.reason = '會卡到人'; return res; }
    res.ok = true;
    return res;
  }
  const deployGhost = (() => {
    const mat = new THREE.MeshBasicMaterial({ color: '#5fd16a', transparent: true, opacity: 0.38, depthWrite: false });
    const g = new THREE.Group();
    const furnaceG = furnaceMesh().g, sbagG = sbagMesh().g;
    for (const gg of [furnaceG, sbagG]) gg.traverse((o) => { if (o.isMesh) o.material = mat; });
    g.add(furnaceG, sbagG);
    g.visible = false;
    scene.add(g);
    return {
      show(res) {
        if (!res || res.hide) { g.visible = false; return; }
        g.visible = true;
        furnaceG.visible = res.kind === 'furnace'; sbagG.visible = res.kind === 'sbag';
        g.position.set(res.x, res.y, res.z); g.rotation.y = res.r;
        mat.color.set(res.ok ? '#5fd16a' : '#e0503c');
      },
      hide() { g.visible = false; },
    };
  })();

  // ---------- 拿著藍圖 / 設施時的預覽 ----------
  let preview = null;
  function aimInfo() {
    const o = host.eye(), d = host.aimDir();
    const wh = world.raycast(o, d, 8);
    return wh ? { point: wh.point, normal: wh.normal, dist: wh.dist } : { point: o.clone().addScaledVector(d, 4), normal: null, dist: 4, air: true };
  }
  function updatePreview() {
    const kind = holdKind();
    const it = held();
    structs.hideGhost(); deployGhost.hide();
    preview = null;
    if (kind === 'build') {
      const a = aimInfo();
      preview = structs.evaluate({ type: sv.buildType, aim: a.point, pos: host.feet(), yaw: host.yaw(), rot: sv.rot, players: host.players(), wood: count('wood'), myCount: structs.countOf(host.me()) });
      structs.showGhost(preview);
      return preview;
    }
    if (kind === 'deploy') {
      const a = aimInfo();
      const eye = host.eye(), dir = host.aimDir();
      if (it.id === 'door') preview = structs.evaluateDoor({ aim: a.point, eye, dir, pos: host.feet(), players: host.players() });
      else if (it.id === 'lock') preview = structs.evaluateLock({ aim: a.point, eye, dir, pos: host.feet() });
      else { preview = evaluateDeploy(it.id, a.air ? null : a.point, a.normal); deployGhost.show(preview); return preview; }
      structs.showGhost(preview);
      return preview;
    }
    return null;
  }
  function hidePreview() { structs.hideGhost(); deployGhost.hide(); preview = null; }

  // 左鍵：蓋 / 放
  function placeCurrent() {
    const it = held();
    if (!preview || !it) return false;
    if (!preview.ok) { audio.beep(false); hud.toast(preview.reason, 1300); return false; }
    const kind = holdKind();
    if (kind === 'build') {
      const cost = PIECES[preview.type].cost;
      if (!take('wood', cost)) return false;
      const msg = { id: nid('p'), type: preview.type, x: +preview.x.toFixed(3), y: +preview.y.toFixed(3), z: +preview.z.toFixed(3), r: +preview.r.toFixed(4), owner: host.me() };
      structs.place(msg);
      send('piece', msg);
      audio.build();
      return true;
    }
    if (it.id === 'door') {
      const msg = { id: nid('door'), parent: preview.parent, owner: host.me() };
      structs.placeDoor(msg);
      send('pdoor', msg);
      consumeHeld();
      audio.door();
      return true;
    }
    if (it.id === 'lock') {
      // 先設密碼，按確定才真的裝上去（取消就不會扣掉鎖）
      const parent = preview.parent;
      host.keypad('設定 4 位數密碼', (code) => {
        if (!code) return;
        if (!held() || held().id !== 'lock') return;
        const msg = { parent, code, owner: host.me() };
        structs.attachLock(msg);
        send('lock', msg);
        consumeHeld();
        audio.beep(true);
        hud.toast(`電子鎖裝好了，密碼 ${code}`, 2500);
      });
      return true;
    }
    if (it.id === 'furnace' || it.id === 'sbag') {
      const msg = { id: nid(it.id === 'furnace' ? 'f' : 's'), kind: it.id, x: +preview.x.toFixed(3), y: +preview.y.toFixed(3), z: +preview.z.toFixed(3), r: +preview.r.toFixed(3), owner: host.me() };
      createDeploy(msg);
      send('deploy', msg);
      consumeHeld();
      audio.build();
      return true;
    }
    return false;
  }
  // 退出子彈：槍裡剩的子彈放回背包
  function unloadGun(arr, i) {
    const it = arr[i], g = it && GUNS[it.id];
    if (!g || !it.d?.mag) return;
    const n = it.d.mag;
    it.d = { ...it.d, mag: 0 };
    add(g.ammo, n);
    audio.pop();
  }
  function consumeHeld(n = 1) {
    const it = held();
    if (!it) return;
    it.n -= n;
    if (it.n <= 0) sv.inv.hot[sv.hotIdx] = null;
    changed();
  }

  // ---------- 挖、砍、敲 ----------
  // 近戰命中世界上的東西（不是人）：樹、礦、鐵桶、北極熊、建築、設施
  function meleeWorld(wh, weapon, dir) {
    const def = MELEE[weapon];
    const bear = bears.fromHit(wh);
    if (bear) {
      if (!bear.dead) { hitThings(wh, { bear: def.dmg }); audio.chop(); return; }
      const got = bears.harvest(bear, def);
      if (!got) { audio.clunk(); return; }
      audio.chop();
      if (got.meat) { add('bear_meat', got.meat); hud.pickup(ITEMS.bear_meat.name, `+${got.meat}`); }
      if (got.cloth) { add('cloth', got.cloth); hud.pickup(ITEMS.cloth.name, `+${got.cloth}`); }
      return;
    }
    const tree = world.trees.fromHit(wh);
    if (tree) {
      audio.chop();
      const got = world.trees.chop(tree, def.wood);
      if (got > 0) { add('wood', got); hud.pickup('木頭', `+${got}`); }
      host.sendTreeHit(tree, got, dir);
      if (tree.wood <= 0) { world.trees.fell(tree, dir.x, dir.z); audio.crash(); }
      return;
    }
    const node = world.nodes.fromHit(wh);
    if (node) {
      audio.clunk();
      const got = world.nodes.mine(node, def.ore);
      const id = node.kind === 'metal' ? 'metal_ore' : 'sulfur_ore';
      if (got > 0) { add(id, got); hud.pickup(ITEMS[id].name, `+${got}`); }
      send('nhit', { i: node.i, a: got });
      afterNodeHit(node);
      return;
    }
    if (wh.mesh?.userData.crateId) { hitThings(wh, { crate: def.crateDmg }); return; }   // 鐵桶自己會發出金屬聲
    if (hitThings(wh, { piece: def.pieceDmg, crate: def.crateDmg, deploy: def.pieceDmg })) { audio.chop(); return; }
    audio.clunk();
  }
  function afterNodeHit(node) {
    if (node.ore > 0) return;
    world.nodes.setAlive(node, false);
    if (host.isAuth()) sv.nodeTimers.set(node.i, NODE_RESPAWN);
  }
  // 子彈、箭、近戰打到東西：北極熊、建築、鐵桶、設施各自扣血。回傳有沒有打到這幾類
  function hitThings(wh, dmg) {
    if (!wh?.mesh) return false;
    const ud = wh.mesh.userData;
    if (ud.bearId) {
      const b = bears.list.get(ud.bearId);
      if (b && !b.dead && dmg.bear) {
        const head = ud.part === 'head';
        bears.hit(b, dmg.bear, ud.part);
        audio.hit(head); hud.hitmarker(head);
      }
      return true;
    }
    if (ud.crateId) { damageCrate(ud.crateId, dmg.crate); return true; }
    if (ud.furnId || ud.sbagId) { damageDeploy(ud.furnId || ud.sbagId, dmg.deploy); return true; }
    const rec = structs.fromHit(wh);
    if (rec) { damagePiece(rec.id, dmg.piece); return true; }
    return false;
  }
  function damagePiece(id, dmg, remote = false) {
    const rec = structs.pieces.get(id);
    if (!rec) return;
    const at = structs.centerOf(rec);
    const res = structs.damage(id, dmg);
    if (!remote) send('pdmg', { id, dmg });
    if (res?.destroyed) {
      audio.crash(remote ? at : null, at.distanceTo(host.eye()));
      if (rec.owner === host.me()) hud.toast(`你的${rec.type === 'door' ? '門' : PIECES[rec.type]?.name || '建築'}被打爛了`, 1600);
    }
  }
  const gunHit = (wh, gun) => hitThings(wh, { piece: GUNS[gun].pieceDmg, crate: 12, deploy: GUNS[gun].pieceDmg, bear: GUNS[gun].dmg * falloffMult(GUNS[gun], wh.dist) });

  // ---------- 手雷 ----------
  function throwNade(origin, dir) {
    const v = dir.clone().multiplyScalar(NADE.speed).add(new THREE.Vector3(0, 2.5, 0)).add(host.velocity().multiplyScalar(0.5));
    const id = nid('n');
    proj.spawnNade({ id, o: origin, v, mine: true });
    send('nade', { id, o: v3(origin), v: v3(v) });
    consumeHeld();
  }
  function explode(p, mine) {
    fx.explosion(p);
    const dist = p.distanceTo(host.eye());
    audio.boom(p, dist);
    host.shake(Math.max(0, 1 - dist / 30));
    if (!mine) return;
    // 以下只有丟的人算：人、北極熊、建築、鐵桶、設施
    const center = (pos) => pos.clone().add(new THREE.Vector3(0, 1.0, 0));
    const losFactor = (to) => {
      const from = p.clone().add(new THREE.Vector3(0, 0.3, 0));
      const d = to.clone().sub(from); const len = d.length(); d.normalize();
      const wh = world.raycast(from, d, len);
      return wh && wh.dist < len - 0.4 ? 0.25 : 1;
    };
    const pdmg = (pos) => {
      const d = center(pos).distanceTo(p);
      if (d > NADE.radius) return 0;
      return Math.round(NADE.playerDmg * (d < 1 ? 1 : 1 - (d - 1) / (NADE.radius - 1)) * losFactor(center(pos)));
    };
    const me = pdmg(host.feet());
    if (me > 0) host.damageSelf(me, p, 'grenade');
    const opp = host.opponent();
    if (opp && opp.alive) { const d = pdmg(opp.pos); if (d > 0) host.damageOpponent(d, 'body', p, 'grenade'); }
    for (const rec of [...structs.pieces.values()]) {
      const d = structs.centerOf(rec).distanceTo(p);
      if (d > NADE.pieceRadius) continue;
      const k = d < 1.5 ? 1 : 1 - (d - 1.5) / (NADE.pieceRadius - 1.5);
      damagePiece(rec.id, Math.round(NADE.pieceDmg * k));
    }
    for (const c of [...sv.crates.values()]) if (c.pos.distanceTo(p) < 3) damageCrate(c.id, NADE.crateDmg);
    bears.explode(p, NADE.radius, NADE.playerDmg);
    for (const f of [...sv.furn.values(), ...sv.sbags.values()]) {
      const d = Math.hypot(f.x - p.x, f.y - p.y, f.z - p.z);
      if (d < NADE.pieceRadius) damageDeploy(f.id, Math.round(NADE.pieceDmg * (1 - d / NADE.pieceRadius)));
    }
  }

  // ---------- 互動（E） ----------
  function scanTarget() {
    const o = host.eye(), d = host.aimDir();
    const wh = world.raycast(o, d, REACH);
    const rc = new THREE.Raycaster(o, d, 0, REACH);
    const dh = rc.intersectObjects(dropMeshes, false)[0];
    if (dh && (!wh || dh.distance < wh.dist)) {
      const drop = sv.drops.get(dh.object.userData.dropId);
      if (drop) {
        const items = drop.slots.filter(Boolean);
        const label = drop.kind === 'bag' ? `搜刮（${items.length} 樣東西）` : `撿起 ${items.map((x) => `${ITEMS[x.id].name}${x.n > 1 ? ` ×${x.n}` : ''}`).join('、')}`;
        return { kind: 'drop', id: drop.id, label };
      }
    }
    // 門：直接看著門板，或視線穿過門洞
    const hitRec = wh?.mesh ? structs.fromHit(wh) : null;
    const door = hitRec?.type === 'door' ? hitRec : structs.doorOnRay(o, d, wh ? wh.dist + 0.2 : REACH);
    if (door) {
      const locked = door.lock && !door.lock.auth.has(host.me());
      return { kind: 'door', id: door.id, label: locked ? '輸入密碼' : door.open ? '關門' : '開門' };
    }
    const bearInfo = (b) => (b.dead
      ? { kind: 'corpse', label: null, hp: b.meat + b.cloth > 0 ? `北極熊的屍體 · 拿石頭或刀刨：肉 ${b.meat}、布 ${b.cloth}` : '北極熊的屍體 · 刨光了' }
      : { kind: 'bear', label: null, hp: `北極熊 ${Math.max(0, Math.ceil(bears.hpOf(b)))} / ${BEAR.hp}` });
    const nearBear = bears.fromHit(wh);
    if (nearBear) return bearInfo(nearBear);
    if (!wh?.mesh) {
      const far = bears.fromHit(world.raycast(o, d, 45));
      return far && !far.dead ? bearInfo(far) : null;
    }
    const ud = wh.mesh.userData;
    // label：按 E 會做的事（畫面中間的提示）；hp：只是看的資訊（準心下面的小字）
    const tree = world.trees.fromHit(wh);
    if (tree) return { kind: 'tree', label: null, hp: `樹 · 還有 ${tree.wood} 木頭` };
    const node = world.nodes.fromHit(wh);
    if (node?.alive) return { kind: 'node', label: null, hp: `${node.kind === 'metal' ? '鐵礦' : '硫磺礦'} · 還有 ${node.ore}` };
    if (ud.furnId) return { kind: 'furnace', id: ud.furnId, label: '打開火爐' };
    if (ud.sbagId) { const b = sv.sbags.get(ud.sbagId); return { kind: 'sbag', id: ud.sbagId, label: null, hp: b?.owner === host.me() ? '你的睡袋 · 死掉可以從這裡重生' : '別人的睡袋 · 打爛它，他就不能在這重生' }; }
    if (ud.crateId) { const c = sv.crates.get(ud.crateId); return { kind: 'crate', id: ud.crateId, label: null, hp: `鐵桶 ${Math.max(0, Math.ceil(c?.hp ?? 0))} / ${CRATE.hp} · 打破它拿東西` }; }
    const rec = hitRec;
    if (rec) return { kind: 'piece', id: rec.id, label: null, hp: `${PIECES[rec.type]?.name || ''} ${Math.max(0, Math.ceil(rec.hp))} / ${rec.maxHp}` };
    return null;
  }
  function interact() {
    const t = sv.target;
    if (!t) return;
    if (t.kind === 'drop') {
      const drop = sv.drops.get(t.id);
      if (!drop) return;
      if (drop.kind === 'bag') openContainer(drop.id);
      else requestOp({ op: 'takeAll', cid: drop.id });
    } else if (t.kind === 'furnace') openContainer(t.id);
    else if (t.kind === 'door') {
      const rec = structs.pieces.get(t.id);
      if (!rec) return;
      if (rec.lock && !rec.lock.auth.has(host.me())) {
        host.keypad('輸入密碼', (code) => {
          if (!code) return;
          const r2 = structs.pieces.get(t.id);
          if (!r2?.lock) return;
          if (code === r2.lock.code) {
            structs.authorize(t.id, host.me());
            send('auth', { door: t.id, who: host.me() });
            audio.beep(true);
            toggleDoor(t.id);
          } else { audio.beep(false); hud.toast('密碼錯誤', 1200); }
        });
        return;
      }
      toggleDoor(t.id);
    }
  }
  function toggleDoor(id, open = null, remote = false) {
    const rec = structs.pieces.get(id);
    if (!rec) return;
    const want = open === null ? !rec.open : open;
    structs.setDoor(id, want);
    const at = structs.centerOf(rec);
    audio.door(remote ? at : null, at.distanceTo(host.eye()));
    if (!remote) send('door', { id, open: want });
  }

  // ---------- 網路 ----------
  function onMessage(m) {
    switch (m.k) {
      case 'crate': createCrate(m); break;
      case 'chit': damageCrate(m.id, m.dmg, true); break;
      case 'drop': createDrop(m); break;
      case 'cop': if (host.isAuth()) send('cgive', { rid: m.rid, items: applyOp(m) }); break;
      case 'cgive': { sv.pending.delete(m.rid); receive(m.items || []); break; }
      case 'cset': {
        const c = contOf(m.cid);
        if (!c) break;
        c.slots = m.slots.map(INV.cloneItem);
        if (sv.furn.has(c.id)) { c.on = m.on; setFurnaceLook(c); }
        if (sv.openCont === c.id) changed();
        break;
      }
      case 'cdel': removeDrop(m.cid); break;
      case 'nhit': {
        const n = world.nodes.list[m.i];
        if (!n || !n.alive) break;
        world.nodes.mine(n, m.a);
        audio.clunk(new THREE.Vector3(n.x, n.y + 0.5, n.z), Math.hypot(n.x - host.eye().x, n.z - host.eye().z));
        afterNodeHit(n);
        break;
      }
      case 'nres': { const n = world.nodes.list[m.i]; if (n) world.nodes.setAlive(n, true); break; }
      case 'piece': {
        structs.place(m);
        const at = new THREE.Vector3(m.x, m.y + 1, m.z);
        audio.build(at, at.distanceTo(host.eye()));
        break;
      }
      case 'pdmg': damagePiece(m.id, m.dmg, true); break;
      case 'pdoor': structs.placeDoor(m); break;
      case 'door': toggleDoor(m.id, m.open, true); break;
      case 'lock': structs.attachLock(m); break;
      case 'auth': structs.authorize(m.door, m.who); break;
      case 'deploy': createDeploy(m); break;
      case 'ddmg': damageDeploy(m.id, m.dmg, true); break;
      case 'nade': proj.spawnNade({ id: m.id, o: toV(m.o), v: toV(m.v), mine: false }); break;
      case 'boom': { proj.remove(m.id); explode(toV(m.p), false); break; }
      case 'bears': case 'bdmg': case 'bdie': case 'bharv': case 'bgone': bears.onMessage(m); break;
      case 'arrow': {
        proj.spawnArrow({ id: m.id, o: toV(m.o), v: toV(m.v), mine: false });
        audio.twang(toV(m.o), toV(m.o).distanceTo(host.eye()));
        break;
      }
    }
  }

  // ---------- 每幀 ----------
  function update(dt, now) {
    // 製作
    // 只在做好一個（add 會通知）或卡住時通知介面，不要每幀都叫它重畫 ——
    // 每幀重畫整個背包會把手機拖垮，按鈕也會一直被換掉而點不到
    if (sv.queue.length) {
      const wasBlocked = !!sv.queue[0].blocked;
      for (const it of INV.tickCraft(sv.queue, dt, (id, n) => INV.roomFor(sv.inv, id) >= n)) {
        add(it.id, it.n);
        hud.pickup(ITEMS[it.id].name, `+${it.n}`);
        audio.chime();
      }
      const blocked = !!sv.queue[0]?.blocked;
      if (blocked !== wasBlocked) {
        if (blocked) hud.toast('背包滿了，清出空間才會繼續做', 2500);
        changed();
      }
    }
    bears.update(dt);
    // 只有房主做：火爐冶煉、礦點重生、鐵桶刷新
    if (host.isAuth()) {
      for (const f of sv.furn.values()) if (INV.smeltTick(f, dt)) { setFurnaceLook(f); broadcastCont(f); }
      for (const [i, t] of sv.nodeTimers) {
        const left = t - dt;
        if (left <= 0) { sv.nodeTimers.delete(i); world.nodes.setAlive(world.nodes.list[i], true); send('nres', { i }); }
        else sv.nodeTimers.set(i, left);
      }
      sv.crateTimer -= dt;
      if (sv.crateTimer <= 0) { sv.crateTimer = CRATE.respawn; if (sv.crates.size < CRATE.max) spawnCrate(); }
      // 背包放太久沒人撿就收掉（5 分鐘）
      for (const d of sv.drops.values()) if (now - d.born > 300000) { removeDrop(d.id); send('cdel', { cid: d.id }); }
    }
    for (const f of sv.furn.values()) if (f.on && f.fire) { f.fire.material.opacity = 0.7 + Math.random() * 0.3; f.fire.scale.setScalar(0.3 + Math.random() * 0.1); }
    // 準心對著什麼
    if (now - sv.lookAt > 90) { sv.lookAt = now; sv.target = host.alive() ? scanTarget() : null; }
  }

  function reset() {
    INV.clearInv(sv.inv);
    sv.queue.length = 0;
    sv.hotIdx = 0;
    for (const id of [...sv.crates.keys()]) removeCrate(id);
    for (const id of [...sv.drops.keys()]) removeDrop(id);
    for (const id of [...sv.furn.keys(), ...sv.sbags.keys()]) { const f = sv.furn.get(id); if (f) f.slots.fill(null); removeDeploy(id); }
    for (const id of [...sv.drops.keys()]) removeDrop(id);
    sv.nodeTimers.clear();
    world.nodes.reset();
    structs.clear();
    proj.clear();
    bears.reset();
    hidePreview();
    sv.openCont = null; sv.target = null;
    sv.crateTimer = 0; sv.crateN = 0;
    sv.endAt = performance.now() + MATCH_SECONDS * 1000;
    // 房主一開始就把鐵桶撒滿
    if (host.isAuth()) for (let i = 0; i < CRATE.max; i++) spawnCrate(true);
    sv.crateTimer = CRATE.respawn;
    changed();
  }
  // 重生：只有一顆石頭
  function giveStart() {
    INV.clearInv(sv.inv);
    sv.queue.length = 0;
    sv.hotIdx = 0;
    INV.add(sv.inv, 'rock', 1);
    changed();
  }
  // 死掉：身上所有東西包成一個背包丟在原地（製作到一半的也退回來一起掉）
  function onDeath(pos) {
    while (sv.queue.length) INV.cancelCraft(sv.inv, sv.queue, 0);
    const items = INV.allItems(sv.inv);
    INV.clearInv(sv.inv);
    if (items.length) dropItems(items, pos.clone().add(new THREE.Vector3(0, 0.5, 0)), 'bag');
    hidePreview();
    closeContainer();
    changed();
  }
  const myBags = () => [...sv.sbags.values()].filter((b) => b.owner === host.me());

  return {
    sv, bears, add, count, take, held, holdKind, holdLook, craft, cancelCraft, consumeHeld, unloadGun,
    dropFromSlot, contTake, contTakeAll, contPut, contQuickPut, contToggle, openContainer, closeContainer, contOf,
    updatePreview, hidePreview, placeCurrent, meleeWorld, gunHit, hitThings, throwNade, explode, interact,
    onMessage, update, reset, giveStart, onDeath, myBags,
    get target() { return sv.target; },
    get remaining() { return Math.max(0, (sv.endAt - performance.now()) / 1000); },
    rotate() { sv.rot += Math.PI / 4; },
    setBuildType(t) { sv.buildType = t; },
    get buildType() { return sv.buildType; },
    onChange(fn) { sv.listeners.add(fn); },
    hurt() { sv.lastHurt = performance.now(); },
    get lastHurt() { return sv.lastHurt; },
    selectHot(i) { sv.hotIdx = i; changed(); },
    get hotIdx() { return sv.hotIdx; },
    spawnArrowNet(id, o, v) { send('arrow', { id, o: v3(o), v: v3(v) }); },
    sendBoom(id, p) { send('boom', { id, p: v3(p) }); },
    nid,
    refresh: changed,
  };
}
