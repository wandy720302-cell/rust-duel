// 玩家蓋的木牆：放置預覽（綠=可以蓋、紅=不行）、合法性檢查、耐久、被打爛。
// 外觀是 rust 經典的木頭路障：一排削尖的直立原木，中間用麻繩綁兩圈。
// 牆可以任意角度擺（跟著視角轉），碰撞用 physics.js 的 obox。
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { oboxDist2, RADIUS } from './physics.js';
import { WATER_Y, BOUNDS } from './world.js';

export const WALL = {
  w: 2.6, h: 2.2, t: 0.24,   // 寬、地面以上的高度、厚度
  bury: 0.4,                 // 埋進地裡的深度，斜坡上才不會底下透光
  hp: 350,
  cost: 100,                 // 木頭
  max: 8,                    // 每人最多幾面
  ahead: 2.6,                // 蓋在面前多遠
};

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export function createBuilder(world, fx) {
  const { scene, colliders, solids, heightAt, T } = world;
  const walls = new Map();
  const H = WALL.h + WALL.bury;

  const bodyGeo = new THREE.BoxGeometry(WALL.w, H, WALL.t);   // 預覽用
  let seed = 1;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };

  // 每面牆的原木高低、歪斜都不一樣（用牆的 id 當種子，雙方看到的一樣）
  function barricadeGeos(id) {
    seed = [...id].reduce((a, c) => a * 31 + c.charCodeAt(0), 7) % 2147483647 || 1;
    const N = 9, r = 0.15, logs = [], tips = [], ropes = [];
    for (let i = 0; i < N; i++) {
      const x = -WALL.w / 2 + r + i * (WALL.w - 2 * r) / (N - 1);
      const len = H - 0.3 + (rnd() - 0.5) * 0.3, rr = r * (0.85 + rnd() * 0.3);
      const tilt = (rnd() - 0.5) * 0.06, zj = (rnd() - 0.5) * 0.05;
      const log = new THREE.CylinderGeometry(rr, rr * 1.05, len, 8).translate(0, len / 2, 0);
      const tip = new THREE.ConeGeometry(rr, 0.38, 8).translate(0, len + 0.19, 0);
      for (const geo of [log, tip]) { geo.rotateZ(tilt); geo.translate(x, 0, zj); }
      logs.push(log); tips.push(tip);
    }
    for (const hy of [WALL.bury + 0.45, WALL.bury + 1.45]) {
      for (const side of [-1, 1]) {
        ropes.push(new THREE.CylinderGeometry(0.035, 0.035, WALL.w + 0.04, 6).rotateZ(Math.PI / 2).translate(0, hy, side * 0.15));
      }
    }
    return { logs: mergeGeometries(logs), tips: mergeGeometries(tips), ropes: mergeGeometries(ropes) };
  }

  const ghostMat = new THREE.MeshBasicMaterial({ color: '#5fd16a', transparent: true, opacity: 0.35, depthWrite: false });
  const ghost = new THREE.Mesh(bodyGeo, ghostMat);
  ghost.visible = false;
  ghost.renderOrder = 5;
  scene.add(ghost);

  function place({ id, owner, x, y, z, r }) {
    if (walls.has(id)) return walls.get(id);
    const g = new THREE.Group();
    g.position.set(x, y, z);
    g.rotation.y = r;
    // 每面牆自己一份材質，被打的時候才能單獨變暗
    const mats = [
      new THREE.MeshStandardMaterial({ map: T.bark, roughness: 0.95, envMapIntensity: 0.6 }),
      new THREE.MeshStandardMaterial({ map: T.woodEnd, roughness: 0.9, envMapIntensity: 0.6 }),
      new THREE.MeshStandardMaterial({ map: T.rope, roughness: 1, envMapIntensity: 0.6 }),
    ];
    const geos = barricadeGeos(id);
    const parts = [new THREE.Mesh(geos.logs, mats[0]), new THREE.Mesh(geos.tips, mats[1]), new THREE.Mesh(geos.ropes, mats[2])];
    for (const m of parts) {
      m.castShadow = m.receiveShadow = true;
      m.userData = { surf: 'wood', wallId: id };
      g.add(m);
      solids.push(m);
    }
    scene.add(g);
    // 牆的長軸是本地 x，轉 r 之後在世界裡是 (cos r, -sin r)
    const col = {
      type: 'obox', cx: x, cz: z, hx: WALL.w / 2 + 0.06, hz: WALL.t / 2 + 0.03,
      ax: Math.cos(r), az: -Math.sin(r), y0: y, y1: y + H,
    };
    colliders.push(col);
    const rec = { id, owner, hp: WALL.hp, group: g, parts, col, mats, x, y, z, r };
    walls.set(id, rec);
    return rec;
  }

  function remove(id, shatter = true) {
    const w = walls.get(id);
    if (!w) return;
    walls.delete(id);
    scene.remove(w.group);
    for (const m of w.parts) { const k = solids.indexOf(m); if (k >= 0) solids.splice(k, 1); }
    const k = colliders.indexOf(w.col);
    if (k >= 0) colliders.splice(k, 1);
    for (const m of w.mats) m.dispose();
    for (const m of w.parts) m.geometry.dispose();
    if (shatter && fx) {
      const ax = Math.cos(w.r), az = -Math.sin(w.r);
      for (let i = -2; i <= 2; i++) for (const hy of [0.8, 1.6, 2.3]) {
        const p = new THREE.Vector3(w.x + ax * i * 0.55, w.y + hy, w.z + az * i * 0.55);
        fx.impact(p, new THREE.Vector3(-az, 0.4, ax).normalize(), 'wood');
      }
    }
  }

  // 回傳 { destroyed, hp }；被打越多次顏色越暗
  function damage(id, dmg) {
    const w = walls.get(id);
    if (!w) return null;
    w.hp -= dmg;
    const k = clamp(1 - w.hp / WALL.hp, 0, 1);
    for (const m of w.mats) m.color.setRGB(1 - k * 0.5, 1 - k * 0.55, 1 - k * 0.6);
    if (w.hp <= 0) { remove(id); return { destroyed: true, hp: 0 }; }
    return { destroyed: false, hp: w.hp };
  }

  function clear() { for (const id of [...walls.keys()]) remove(id, false); }

  // 預覽：算出面前的落點，順便檢查能不能蓋
  // ctx: { pos, yaw, others: [Vector3...], myCount, wood }
  function evaluate(ctx) {
    const r = ctx.yaw;
    const x = ctx.pos.x - Math.sin(r) * WALL.ahead;
    const z = ctx.pos.z - Math.cos(r) * WALL.ahead;
    const ax = Math.cos(r), az = -Math.sin(r);
    const hs = [-1, -0.5, 0, 0.5, 1].map((k) => heightAt(x + ax * k * WALL.w / 2, z + az * k * WALL.w / 2));
    const lo = Math.min(...hs), hi = Math.max(...hs);
    const y = lo - WALL.bury;
    const res = { x, y, z, r, ok: false, reason: '' };

    if (x < BOUNDS.minX || x > BOUNDS.maxX || z < BOUNDS.minZ || z > BOUNDS.maxZ) res.reason = '地圖邊界外';
    else if (lo < WATER_Y + 0.1) res.reason = '不能蓋在水裡';
    else if (hi - lo > 0.9) res.reason = '地面太斜';
    else if (ctx.myCount >= WALL.max) res.reason = `最多只能蓋 ${WALL.max} 面`;
    else if (ctx.wood < WALL.cost) res.reason = `木頭不夠（${ctx.wood} / ${WALL.cost}）`;
    else if (blocked(x, z, ax, az, lo, y)) res.reason = '這裡擋到東西了';
    else if (ctx.others.some((p) => segDist(p.x, p.z, x, z, ax, az) < RADIUS + WALL.t / 2 + 0.1)) res.reason = '會卡到人';
    else res.ok = true;
    return res;
  }

  function segDist(px, pz, cx, cz, ax, az) {
    const t = clamp((px - cx) * ax + (pz - cz) * az, -WALL.w / 2, WALL.w / 2);
    return Math.hypot(px - (cx + ax * t), pz - (cz + az * t));
  }

  // 沿著牆的中線取幾個點，跟現有碰撞體比距離。很矮的東西（廢墟地坪）埋得住就不算擋到
  function blocked(x, z, ax, az, lo, y0) {
    const y1 = y0 + H, pad = WALL.t / 2 + 0.05;
    for (let k = -1; k <= 1.001; k += 1 / 3) {
      const px = x + ax * k * WALL.w / 2, pz = z + az * k * WALL.w / 2;
      for (const c of colliders) {
        let top, bot, d;
        if (c.type === 'box') {
          top = c.max[1]; bot = c.min[1];
          const cx = clamp(px, c.min[0], c.max[0]), cz = clamp(pz, c.min[2], c.max[2]);
          d = Math.hypot(px - cx, pz - cz);
        } else if (c.type === 'cyl') {
          top = c.y1; bot = c.y0; d = Math.hypot(px - c.x, pz - c.z) - c.r;
        } else {
          top = c.y1; bot = c.y0; d = Math.sqrt(oboxDist2(c, px, pz));
        }
        if (top <= lo + 0.35 || bot >= y1) continue;
        if (d < pad) return true;
      }
    }
    return false;
  }

  function showGhost(res) {
    if (!res) { ghost.visible = false; return; }
    ghost.visible = true;
    ghost.position.set(res.x, res.y + H / 2, res.z);
    ghost.rotation.y = res.r;
    ghostMat.color.set(res.ok ? '#5fd16a' : '#e0503c');
  }

  return {
    walls, place, damage, remove, clear, evaluate, showGhost,
    countOf(owner) { let n = 0; for (const w of walls.values()) if (w.owner === owner) n++; return n; },
    fromHit(hit) { const id = hit?.mesh?.userData.wallId; return id ? walls.get(id) || null : null; },
  };
}
