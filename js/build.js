// 玩家蓋的木牆：放置預覽（綠=可以蓋、紅=不行）、合法性檢查、耐久、被打爛。
// 牆可以任意角度擺（跟著視角轉），碰撞用 physics.js 的 obox。
import * as THREE from 'three';
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

  const bodyGeo = new THREE.BoxGeometry(WALL.w, H, WALL.t);
  const postGeo = new THREE.BoxGeometry(0.16, H + 0.12, WALL.t + 0.1);
  const beamGeo = new THREE.BoxGeometry(WALL.w, 0.14, WALL.t + 0.06);
  const postMat = new THREE.MeshStandardMaterial({ color: '#4a3220', roughness: 0.95, map: T.bark });

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
    const mat = new THREE.MeshStandardMaterial({ map: T.wood, roughness: 0.9 });
    const body = new THREE.Mesh(bodyGeo, mat);
    body.position.y = H / 2;
    const parts = [body];
    for (const sx of [-1, 1]) {
      const p = new THREE.Mesh(postGeo, postMat);
      p.position.set(sx * (WALL.w / 2 - 0.02), (H + 0.12) / 2, 0);
      parts.push(p);
    }
    const beam = new THREE.Mesh(beamGeo, postMat);
    beam.position.y = WALL.bury + WALL.h * 0.55;
    parts.push(beam);
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
    const rec = { id, owner, hp: WALL.hp, group: g, parts, col, mat, x, y, z, r };
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
    w.mat.dispose();
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
    w.mat.color.setRGB(1 - k * 0.5, 1 - k * 0.55, 1 - k * 0.6);
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
