// 生存模式的 rust 式建築：方形 / 三角地基、牆、門框、地板、三角地板、屋頂、三角屋頂、門、電子鎖。
// 一格 3m。新的件會自動吸到現有件的「插座」上：
//   地基的邊 → 另一塊地基 / 牆 / 門框；地基或地板正上方 3m → 地板 / 屋頂；地板的邊 → 同一層的地板；
//   門框 → 門；門 → 電子鎖。都沒有插座可吸的話，地基可以直接蓋在地上。
// 座標慣例跟 three.js 的 rotation.y = r 一樣：本地 +x → (cos r, -sin r)，本地 +z → (sin r, cos r)。
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PIECES, UPGRADE } from './items.js';
import { pointInTri, triDist, oboxDist2, RADIUS } from './physics.js';

export const GRID = 3, WALL_H = 3;
const TRI_IN = GRID / (2 * Math.sqrt(3));    // 正三角形內切圓半徑 0.866
const TRI_OUT = GRID / Math.sqrt(3);         // 外接圓半徑 1.732
const HOLE = { w: 1.2, h: 2.3 };             // 門框的洞
const WIN = { w: 1.4, h: 1.0, y: 1.1 };      // 玻璃窗的洞
const STEPS = 10, STEP_RISE = WALL_H / STEPS, STEP_RUN = 0.27, STAIR_W = 2.6;
const MAX_PIECES = 120;                      // 每人上限
const REACH = 8;

const SQ_EDGES = [[1.5, 0, 1, 0], [-1.5, 0, -1, 0], [0, 1.5, 0, 1], [0, -1.5, 0, -1]];   // 邊中點 lx,lz、外法線 nx,nz
const TRI_V = [[-1.5, -TRI_IN], [1.5, -TRI_IN], [0, TRI_OUT]];
const TRI_EDGES = [[0, -TRI_IN, 0, -1], [0.75, TRI_IN / 2, 0.8660254, 0.5], [-0.75, TRI_IN / 2, -0.8660254, 0.5]];

const toW = (x, z, r, lx, lz) => [x + lx * Math.cos(r) + lz * Math.sin(r), z - lx * Math.sin(r) + lz * Math.cos(r)];
const dirW = (r, lx, lz) => [lx * Math.cos(r) + lz * Math.sin(r), -lx * Math.sin(r) + lz * Math.cos(r)];
const yawOf = (nx, nz) => Math.atan2(nx, nz);   // 讓本地 +z 指向 (nx, nz) 的 rotation.y
const key = (x, y, z) => `${Math.round(x * 10)}:${Math.round(y * 10)}:${Math.round(z * 10)}`;

// 本地座標的 UV：朝上的面用 (x, z)，側面用「沿著面的水平方向, 高度」。不管怎麼轉，貼圖都跟著件走
function localUV(geo, size) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const pos = g.attributes.position, uv = new Float32Array(pos.count * 2);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i); b.fromBufferAttribute(pos, i + 1); c.fromBufferAttribute(pos, i + 2);
    n.subVectors(c, b).cross(a.clone().sub(b)).normalize();
    for (let k = 0; k < 3; k++) {
      const p = [a, b, c][k];
      let u, v;
      if (Math.abs(n.y) > 0.55) { u = p.x; v = p.z; }
      else { const tl = Math.hypot(n.x, n.z) || 1; u = (p.x * -n.z + p.z * n.x) / tl; v = p.y; }
      uv[(i + k) * 2] = u / size; uv[(i + k) * 2 + 1] = v / size;
    }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

// 直立的三角柱：底在 y0、頂在 y1
function triPrism(y0, y1, verts = TRI_V) {
  const p = [];
  const [A, B, C] = verts;
  const T = (u, w) => [u[0], w, u[1]];
  p.push(...T(A, y1), ...T(C, y1), ...T(B, y1));   // 頂面（朝上）
  p.push(...T(A, y0), ...T(B, y0), ...T(C, y0));   // 底面
  for (const [u, w] of [[A, B], [B, C], [C, A]]) {
    p.push(...T(u, y0), ...T(u, y1), ...T(w, y1), ...T(u, y0), ...T(w, y1), ...T(w, y0));
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  return geo;
}
// 金字塔屋頂：底面多邊形 → 頂點
function pyramid(base, h) {
  const p = [];
  for (let i = 0; i < base.length; i++) {
    const a = base[i], b = base[(i + 1) % base.length];
    p.push(a[0], 0, a[1], 0, h, 0, b[0], 0, b[1]);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  return geo;
}

export function createStructures(world, fx) {
  const { scene, colliders, solids, heightAt, T } = world;
  const pieces = new Map();       // id → rec
  const occupied = new Map();     // 插座 key → 件 id

  const mat = (o) => new THREE.MeshStandardMaterial({ roughness: 0.92, envMapIntensity: 0.6, ...o });
  const M = {
    logs: mat({ map: T.logs }),
    planks: mat({ map: T.planks }),
    roof: mat({ map: T.planks, color: '#b49a7c' }),
    door: mat({ map: T.sheet, roughness: 0.75, metalness: 0.3 }),
    dark: mat({ color: '#2a2a28', roughness: 0.5, metalness: 0.6 }),
    glass: mat({ color: '#bcd6e2', transparent: true, opacity: 0.22, roughness: 0.05, metalness: 0.3, envMapIntensity: 1.2, depthWrite: false }),
  };
  // 電子鎖的面板：小螢幕 + 九宮格按鍵
  const keypadTex = (() => {
    const c = document.createElement('canvas'); c.width = 64; c.height = 96;
    const g = c.getContext('2d');
    g.fillStyle = '#2b2d31'; g.fillRect(0, 0, 64, 96);
    g.fillStyle = '#163020'; g.fillRect(8, 8, 48, 16);
    g.fillStyle = '#8f959b';
    for (let r = 0; r < 3; r++) for (let k = 0; k < 3; k++) g.fillRect(9 + k * 17, 32 + r * 19, 12, 13);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  M.lock = mat({ map: keypadTex, roughness: 0.6 });
  const ledOn = new THREE.MeshBasicMaterial({ color: '#ff3b2a' }), ledOff = new THREE.MeshBasicMaterial({ color: '#3ce06a' });

  // ---------- 幾何 ----------
  const sqVerts = [[-1.5, -1.5], [1.5, -1.5], [1.5, 1.5], [-1.5, 1.5]];
  function meshesFor(type, h = 1) {
    // 回傳 [[geometry, material], ...]，本地座標，y=0 是這件的基準高度
    switch (type) {
      case 'found': {
        const side = localUV(new THREE.BoxGeometry(GRID, h, GRID).translate(0, -h / 2, 0), 1.5);
        const top = localUV(new THREE.BoxGeometry(GRID - 0.02, 0.04, GRID - 0.02).translate(0, 0.005, 0), 2);
        return [[side, M.logs], [top, M.planks]];
      }
      case 'tfound': return [[localUV(triPrism(-h, 0), 1.5), M.logs], [localUV(triPrism(-0.01, 0.02, TRI_V.map(([x, z]) => [x * 0.98, z * 0.98])), 2), M.planks]];
      case 'wall': {
        const body = localUV(new THREE.BoxGeometry(GRID, WALL_H, 0.25).translate(0, WALL_H / 2, 0), 1.5);
        const posts = mergeGeometries([-1.45, 1.45].map((x) => new THREE.BoxGeometry(0.2, WALL_H, 0.32).translate(x, WALL_H / 2, 0)));
        return [[body, M.logs], [localUV(posts, 1), M.dark]];
      }
      case 'doorway': {
        const sideW = (GRID - HOLE.w) / 2;
        const parts = [
          new THREE.BoxGeometry(sideW, WALL_H, 0.25).translate(-GRID / 2 + sideW / 2, WALL_H / 2, 0),
          new THREE.BoxGeometry(sideW, WALL_H, 0.25).translate(GRID / 2 - sideW / 2, WALL_H / 2, 0),
          new THREE.BoxGeometry(HOLE.w, WALL_H - HOLE.h, 0.25).translate(0, HOLE.h + (WALL_H - HOLE.h) / 2, 0),
        ];
        const frame = mergeGeometries([
          new THREE.BoxGeometry(0.1, HOLE.h, 0.3).translate(-HOLE.w / 2, HOLE.h / 2, 0),
          new THREE.BoxGeometry(0.1, HOLE.h, 0.3).translate(HOLE.w / 2, HOLE.h / 2, 0),
          new THREE.BoxGeometry(HOLE.w + 0.1, 0.1, 0.3).translate(0, HOLE.h, 0),
        ]);
        return [[localUV(mergeGeometries(parts), 1.5), M.logs], [localUV(frame, 1), M.dark]];
      }
      case 'window': {
        const sideW = (GRID - WIN.w) / 2, top = WIN.y + WIN.h;
        const parts = [
          new THREE.BoxGeometry(sideW, WALL_H, 0.25).translate(-GRID / 2 + sideW / 2, WALL_H / 2, 0),
          new THREE.BoxGeometry(sideW, WALL_H, 0.25).translate(GRID / 2 - sideW / 2, WALL_H / 2, 0),
          new THREE.BoxGeometry(WIN.w, WIN.y, 0.25).translate(0, WIN.y / 2, 0),
          new THREE.BoxGeometry(WIN.w, WALL_H - top, 0.25).translate(0, top + (WALL_H - top) / 2, 0),
        ];
        const frame = mergeGeometries([
          new THREE.BoxGeometry(0.08, WIN.h, 0.3).translate(-WIN.w / 2, WIN.y + WIN.h / 2, 0),
          new THREE.BoxGeometry(0.08, WIN.h, 0.3).translate(WIN.w / 2, WIN.y + WIN.h / 2, 0),
          new THREE.BoxGeometry(WIN.w + 0.08, 0.08, 0.3).translate(0, WIN.y, 0),
          new THREE.BoxGeometry(WIN.w + 0.08, 0.08, 0.3).translate(0, top, 0),
          new THREE.BoxGeometry(0.05, WIN.h, 0.08).translate(0, WIN.y + WIN.h / 2, 0),   // 中間的窗櫺
        ]);
        const pane = new THREE.BoxGeometry(WIN.w, WIN.h, 0.03).translate(0, WIN.y + WIN.h / 2, 0);
        return [[localUV(mergeGeometries(parts), 1.5), M.logs], [localUV(frame, 1), M.dark], [pane, M.glass]];
      }
      // 樓梯：佔一整格，一階一階往本地 +z 爬到 3m（上面那格不能再蓋地板）
      case 'stairs': {
        const steps = [];
        for (let i = 0; i < STEPS; i++) {
          const h = STEP_RISE * (i + 1);
          steps.push(new THREE.BoxGeometry(STAIR_W, h, STEP_RUN).translate(0, h / 2, -GRID / 2 + 0.15 + STEP_RUN * (i + 0.5)));
        }
        const rails = mergeGeometries([-1, 1].map((sx) => {
          const g = new THREE.BoxGeometry(0.08, 0.08, 3.4);
          g.rotateX(-Math.atan2(WALL_H, STEPS * STEP_RUN));
          return g.translate(sx * (STAIR_W / 2 - 0.04), WALL_H / 2 + 0.95, 0.0);
        }));
        return [[localUV(mergeGeometries(steps), 1.2), M.planks], [localUV(rails, 1), M.dark]];
      }
      case 'floor': return [[localUV(new THREE.BoxGeometry(GRID, 0.2, GRID).translate(0, -0.1, 0), 2), M.planks]];
      case 'tfloor': return [[localUV(triPrism(-0.2, 0), 2), M.planks]];
      case 'roof': return [[localUV(pyramid(sqVerts.map(([x, z]) => [x * 1.06, z * 1.06]), 1.4), 1.5), M.roof], [localUV(new THREE.BoxGeometry(GRID, 0.12, GRID).translate(0, 0.06, 0), 2), M.planks]];
      case 'troof': return [[localUV(pyramid(TRI_V.map(([x, z]) => [x * 1.06, z * 1.06]), 1.1), 1.5), M.roof], [localUV(triPrism(0, 0.12), 2), M.planks]];
      // 門、鎖只有預覽會用到
      case 'door': return [[new THREE.BoxGeometry(HOLE.w - 0.05, HOLE.h - 0.03, 0.07).translate(0, (HOLE.h - 0.03) / 2, 0), M.door]];
      case 'lock': return [[new THREE.BoxGeometry(0.11, 0.17, 0.05).translate(HOLE.w / 2 - 0.2, 1.3, 0.07), M.lock]];
      default: return [];
    }
  }

  // 這件的碰撞體（世界座標）
  function collidersFor(rec) {
    const { type, x, y, z, r } = rec;
    const ax = Math.cos(r), az = -Math.sin(r);
    const ob = (lx, lz, hx, hz, y0, y1) => { const [cx, cz] = toW(x, z, r, lx, lz); return { type: 'obox', cx, cz, hx, hz, ax, az, y0, y1 }; };
    const tri = (y0, y1) => ({ type: 'tri', p: TRI_V.map(([lx, lz]) => toW(x, z, r, lx, lz)), y0, y1 });
    switch (type) {
      case 'found': return [ob(0, 0, 1.5, 1.5, rec.bottom, y)];
      case 'tfound': return [tri(rec.bottom, y)];
      case 'wall': return [ob(0, 0, 1.5, 0.13, y, y + WALL_H)];
      case 'doorway': {
        const sideW = (GRID - HOLE.w) / 2;
        return [ob(-GRID / 2 + sideW / 2, 0, sideW / 2, 0.13, y, y + WALL_H), ob(GRID / 2 - sideW / 2, 0, sideW / 2, 0.13, y, y + WALL_H), ob(0, 0, HOLE.w / 2, 0.13, y + HOLE.h, y + WALL_H)];
      }
      case 'window': return [ob(0, 0, 1.5, 0.13, y, y + WALL_H)];   // 玻璃也擋人、擋子彈
      case 'stairs': return Array.from({ length: STEPS }, (_, i) => ob(0, -GRID / 2 + 0.15 + STEP_RUN * (i + 0.5), STAIR_W / 2, STEP_RUN / 2 + 0.01, y, y + STEP_RISE * (i + 1)));
      case 'floor': return [ob(0, 0, 1.5, 1.5, y - 0.2, y)];
      case 'tfloor': return [tri(y - 0.2, y)];
      case 'roof': return [ob(0, 0, 1.5, 1.5, y, y + 0.15)];
      case 'troof': return [tri(y, y + 0.15)];
      default: return [];
    }
  }

  // ---------- 插座 ----------
  function edgesOf(rec) {
    const E = PIECES[rec.type].shape === 'tri' ? TRI_EDGES : SQ_EDGES;
    return E.map(([lx, lz, nx, nz]) => {
      const [mx, mz] = toW(rec.x, rec.z, rec.r, lx, lz);
      const [wx, wz] = dirW(rec.r, nx, nz);
      return { mx, mz, nx: wx, nz: wz, y: rec.y };
    });
  }
  const isBase = (rec) => rec.type === 'found' || rec.type === 'tfound';
  const isFloor = (rec) => rec.type === 'floor' || rec.type === 'tfloor';
  const isRoof = (rec) => rec.type === 'roof' || rec.type === 'troof';

  // 某種件能吸的所有位置
  function socketsFor(type) {
    const def = PIECES[type], out = [];
    const shape = def.shape;
    if (def.slot === 'found') {
      for (const rec of pieces.values()) if (isBase(rec)) for (const e of edgesOf(rec)) {
        const d = shape === 'tri' ? TRI_IN : GRID / 2;
        out.push({ x: e.mx + e.nx * d, y: e.y, z: e.mz + e.nz * d, r: yawOf(e.nx, e.nz), k: 'f' });
      }
    } else if (def.slot === 'wall') {
      const seen = new Set();
      for (const rec of pieces.values()) if (isBase(rec) || isFloor(rec)) for (const e of edgesOf(rec)) {
        const kk = key(e.mx, e.y, e.mz);
        if (seen.has(kk)) continue;
        seen.add(kk);
        out.push({ x: e.mx, y: e.y, z: e.mz, r: yawOf(e.nx, e.nz), k: 'w' });
      }
    } else if (def.slot === 'stairs') {
      // 樓梯蓋在方形地基 / 地板上面，跟底下那格同一個位置
      for (const rec of pieces.values()) if ((isBase(rec) || isFloor(rec)) && PIECES[rec.type].shape === 'sq') out.push({ x: rec.x, y: rec.y, z: rec.z, r: rec.r, k: 's' });
    } else if (def.slot === 'floor') {
      for (const rec of pieces.values()) {
        if ((isBase(rec) || isFloor(rec)) && PIECES[rec.type].shape === shape) out.push({ x: rec.x, y: rec.y + WALL_H, z: rec.z, r: rec.r, k: 'f' });
        // 地板可以往旁邊延伸（同一層）
        if (isFloor(rec) && (type === 'floor' || type === 'tfloor')) for (const e of edgesOf(rec)) {
          const d = shape === 'tri' ? TRI_IN : GRID / 2;
          out.push({ x: e.mx + e.nx * d, y: e.y, z: e.mz + e.nz * d, r: yawOf(e.nx, e.nz), k: 'f' });
        }
      }
    }
    return out.filter((s) => !occupied.has(`${s.k}:${key(s.x, s.y, s.z)}`));
  }

  // ---------- 合法性 ----------
  function footprint(type, x, z, r) {
    // 往內縮一點的取樣點，跟鄰居共用的邊不會被當成重疊
    const pts = [];
    if (PIECES[type].shape === 'sq') for (const a of [-1.2, 0, 1.2]) for (const b of [-1.2, 0, 1.2]) pts.push(toW(x, z, r, a, b));
    else if (PIECES[type].shape === 'tri') { pts.push([x, z]); for (const [lx, lz] of TRI_V) pts.push(toW(x, z, r, lx * 0.65, lz * 0.65)); }
    else for (const a of [-1.25, -0.6, 0, 0.6, 1.25]) pts.push(toW(x, z, r, a, 0));
    return pts;
  }
  function hitsCollider(px, pz, y0, y1, skip) {
    for (const c of colliders) {
      if (skip && skip.has(c)) continue;
      const top = c.type === 'box' ? c.max[1] : c.y1, bot = c.type === 'box' ? c.min[1] : c.y0;
      if (top <= y0 + 0.03 || bot >= y1 - 0.03) continue;
      if (c.type === 'box') { if (px > c.min[0] && px < c.max[0] && pz > c.min[2] && pz < c.max[2]) return true; }
      else if (c.type === 'cyl') { if (Math.hypot(px - c.x, pz - c.z) < c.r + 0.05) return true; }
      else if (c.type === 'obox') { if (oboxDist2(c, px, pz) < 1e-4) return true; }
      else if (pointInTri(px, pz, c.p)) return true;
    }
    return false;
  }

  // ctx: { type, aim (Vector3|null), pos (玩家腳), yaw, rot (自由放置時額外轉的角度), players: [Vector3], wood, owner }
  function evaluate(ctx) {
    const { type } = ctx;
    const def = PIECES[type];
    const res = { type, ok: false, reason: '', x: 0, y: 0, z: 0, r: 0, bottom: 0 };
    if (!ctx.aim) { res.reason = '對著地面或建築'; res.hide = true; return res; }
    // 找最近的插座
    let best = null, bestD = def.slot === 'wall' ? 2.2 : 2.6;
    for (const s of socketsFor(type)) {
      if (Math.hypot(s.x - ctx.pos.x, s.z - ctx.pos.z) > REACH) continue;
      const d = Math.hypot(s.x - ctx.aim.x, (s.y - ctx.aim.y) * 0.6, s.z - ctx.aim.z);
      if (d < bestD) { bestD = d; best = s; }
    }
    if (best) {
      Object.assign(res, { x: best.x, y: best.y, z: best.z, r: best.r, snapped: true });
      if (def.slot === 'stairs') res.r += Math.round((ctx.rot || 0) / (Math.PI / 2)) * (Math.PI / 2);   // R 轉樓梯的方向（一次 90 度）
    } else if (def.slot === 'found') {
      if (Math.hypot(ctx.aim.x - ctx.pos.x, ctx.aim.z - ctx.pos.z) > REACH) { res.reason = '太遠了'; return res; }
      Object.assign(res, { x: ctx.aim.x, z: ctx.aim.z, r: ctx.yaw + (ctx.rot || 0), snapped: false });
    } else {
      res.reason = def.slot === 'wall' ? '對準地基或地板的邊' : def.slot === 'stairs' ? '對準方形的地基或地板' : '對準地基或地板的正上方（牆頂）';
      Object.assign(res, { x: ctx.aim.x, y: ctx.aim.y, z: ctx.aim.z, r: ctx.yaw });
      return res;
    }

    // 地基：算高度
    if (def.slot === 'found') {
      const corners = def.shape === 'tri' ? TRI_V : sqVerts;
      const hs = [...corners.map(([lx, lz]) => heightAt(...toW(res.x, res.z, res.r, lx, lz))), heightAt(res.x, res.z)];
      const lo = Math.min(...hs), hi = Math.max(...hs);
      if (!res.snapped) res.y = hi + 0.2;
      res.bottom = lo - 0.5;
      if (res.snapped && hi > res.y - 0.05) { res.reason = '被地形擋住了'; return res; }
      if (res.y - lo > (res.snapped ? 3.2 : 2.6)) { res.reason = '地面太斜'; return res; }
      if (lo < -1.2) { res.reason = '不能蓋在水裡'; return res; }
    }
    // 重疊檢查：地基檢查整個柱體，牆檢查牆身，地板 / 屋頂檢查板子那一層
    const [y0, y1] = def.slot === 'found' ? [res.bottom + 0.6, res.y] : def.slot === 'wall' ? [res.y, res.y + WALL_H]
      : def.slot === 'stairs' ? [res.y + 0.05, res.y + WALL_H - 0.1]
      : type === 'roof' || type === 'troof' ? [res.y, res.y + 1.2] : [res.y - 0.2, res.y];
    if (footprint(type, res.x, res.z, res.r).some(([px, pz]) => hitsCollider(px, pz, y0, y1))) { res.reason = '這裡擋到東西了'; return res; }
    for (const p of ctx.players || []) {
      if (p.y > y1 - 0.05 || p.y + 1.8 < y0 + 0.05) continue;
      const pts = footprint(type, res.x, res.z, res.r);
      if (pts.some(([px, pz]) => Math.hypot(px - p.x, pz - p.z) < RADIUS + 0.6)) { res.reason = '會卡到人'; return res; }
    }
    if ((ctx.myCount || 0) >= MAX_PIECES) { res.reason = `最多蓋 ${MAX_PIECES} 塊`; return res; }
    if ((ctx.wood || 0) < def.cost) { res.reason = `木頭不夠（${ctx.wood || 0} / ${def.cost}）`; return res; }
    res.ok = true;
    return res;
  }

  // ---------- 預覽 ----------
  const ghostMat = new THREE.MeshBasicMaterial({ color: '#5fd16a', transparent: true, opacity: 0.38, depthWrite: false });
  const ghost = new THREE.Group();
  ghost.renderOrder = 5;
  scene.add(ghost);
  let ghostType = null, ghostH = 0;
  function showGhost(res) {
    if (!res || res.hide || (!res.ok && !res.reason)) { ghost.visible = false; return; }
    const h = res.type === 'found' || res.type === 'tfound' ? Math.max(0.3, res.y - res.bottom) : 1;
    if (ghostType !== res.type || Math.abs(ghostH - h) > 0.05) {
      for (const m of [...ghost.children]) { ghost.remove(m); m.geometry.dispose(); }
      for (const [geo] of meshesFor(res.type, h)) ghost.add(new THREE.Mesh(geo, ghostMat));
      ghostType = res.type; ghostH = h;
    }
    ghost.visible = true;
    ghost.position.set(res.x, res.y, res.z);
    ghost.rotation.set(0, res.r, 0);
    ghostMat.color.set(res.ok ? '#5fd16a' : '#e0503c');
  }

  // ---------- 放置 / 傷害 / 拆除 ----------
  function place(d) {
    if (pieces.has(d.id)) return pieces.get(d.id);
    const def = PIECES[d.type];
    const rec = { ...d, hp: def.hp, maxHp: def.hp, mats: [], meshes: [], cols: [], door: null, tier: 'wood' };
    if (def.slot === 'found' && rec.bottom === undefined) {
      const corners = def.shape === 'tri' ? TRI_V : sqVerts;
      rec.bottom = Math.min(...corners.map(([lx, lz]) => heightAt(...toW(d.x, d.z, d.r, lx, lz))), heightAt(d.x, d.z)) - 0.5;
    }
    const g = new THREE.Group();
    g.position.set(d.x, d.y, d.z);
    g.rotation.y = d.r;
    for (const [geo, m] of meshesFor(d.type, def.slot === 'found' ? d.y - rec.bottom : 1)) {
      const own = m.clone();
      const mesh = new THREE.Mesh(geo, own);
      mesh.castShadow = !own.transparent; mesh.receiveShadow = true;
      mesh.userData = { surf: 'wood', pieceId: d.id, noHole: true };
      g.add(mesh); solids.push(mesh);
      rec.meshes.push(mesh); rec.mats.push(own);
    }
    scene.add(g);
    rec.group = g;
    rec.cols = collidersFor(rec);
    colliders.push(...rec.cols);
    rec.sock = `${def.slot === 'wall' ? 'w' : def.slot === 'stairs' ? 's' : 'f'}:${key(d.x, d.y, d.z)}`;
    occupied.set(rec.sock, d.id);
    pieces.set(d.id, rec);
    return rec;
  }

  function dropMeshes(rec) {
    scene.remove(rec.group);
    for (const m of rec.meshes) { const k = solids.indexOf(m); if (k >= 0) solids.splice(k, 1); m.geometry.dispose(); }
    for (const m of rec.mats) m.dispose();
    for (const c of rec.cols) { const k = colliders.indexOf(c); if (k >= 0) colliders.splice(k, 1); }
  }
  function remove(id, shatter = true) {
    const rec = pieces.get(id);
    if (!rec) return;
    if (rec.type === 'door') { removeDoor(rec, shatter); return; }
    if (rec.door) removeDoor(pieces.get(rec.door), shatter);
    pieces.delete(id);
    if (occupied.get(rec.sock) === id) occupied.delete(rec.sock);
    dropMeshes(rec);
    if (shatter && fx) {
      const c = new THREE.Vector3(rec.x, rec.y + (PIECES[rec.type]?.slot === 'wall' ? 1.5 : 0), rec.z);
      for (let i = 0; i < 8; i++) fx.impact(c.clone().add(new THREE.Vector3((Math.random() - 0.5) * 2.4, Math.random() * 1.5, (Math.random() - 0.5) * 2.4)), new THREE.Vector3(0, 1, 0), 'wood');
    }
  }
  // 越破越暗
  function tint(rec) {
    const k = Math.max(0, Math.min(1, 1 - rec.hp / rec.maxHp));
    for (const m of rec.mats) if (!m.transparent) m.color.setRGB(1 - k * 0.45, 1 - k * 0.5, 1 - k * 0.55);
  }
  function damage(id, dmg) {
    const rec = pieces.get(id);
    if (!rec) return null;
    rec.hp -= dmg;
    tint(rec);
    if (rec.hp <= 0) { remove(id); return { destroyed: true, rec }; }
    return { destroyed: false, rec };
  }
  // 槌子升級：換成鐵皮的樣子，血量變 3 倍、補滿
  const sheetTex = T.sheet.clone(); sheetTex.wrapS = sheetTex.wrapT = THREE.RepeatWrapping; sheetTex.needsUpdate = true;
  function upgrade(id) {
    const rec = pieces.get(id);
    if (!rec || rec.type === 'door' || rec.tier === 'metal') return false;
    rec.tier = 'metal';
    rec.maxHp = PIECES[rec.type].hp * UPGRADE.mult;
    rec.hp = rec.maxHp;
    for (const m of rec.mats) {
      if (m.transparent || !m.map) continue;
      m.map = sheetTex; m.metalness = 0.35; m.roughness = 0.7; m.needsUpdate = true;
    }
    for (const m of rec.meshes) m.userData.surf = 'metal';
    tint(rec);
    return true;
  }
  function setHp(id, hp) {
    const rec = pieces.get(id);
    if (!rec) return;
    rec.hp = Math.min(rec.maxHp, hp);
    tint(rec);
  }

  // ---------- 門、電子鎖 ----------
  const doorSockets = () => [...pieces.values()].filter((p) => p.type === 'doorway' && !p.door);
  // 準心離門洞中心多遠：有給視線（eye + dir）就量射線到中心的垂直距離 ——
  // 準心常常會穿過門洞打到後面的地上，只看落點會判斷成沒對準
  function aimDist(ctx, x, y, z) {
    if (ctx.eye && ctx.dir) {
      const ox = x - ctx.eye.x, oy = y - ctx.eye.y, oz = z - ctx.eye.z;
      const t = ox * ctx.dir.x + oy * ctx.dir.y + oz * ctx.dir.z;
      if (t < 0 || t > 6) return Infinity;
      return Math.hypot(ox - ctx.dir.x * t, oy - ctx.dir.y * t, oz - ctx.dir.z * t);
    }
    return Math.hypot(x - ctx.aim.x, y - ctx.aim.y, z - ctx.aim.z);
  }
  // 視線穿過門洞（門開著的時候看到的是洞）也算對著那扇門；maxT 之外的不算（中間被擋住了）
  function doorOnRay(eye, dir, maxT) {
    let best = null, bestD = 0.75;
    for (const p of pieces.values()) {
      if (p.type !== 'door') continue;
      const ox = p.x - eye.x, oy = p.y + 1.1 - eye.y, oz = p.z - eye.z;
      const t = ox * dir.x + oy * dir.y + oz * dir.z;
      if (t < 0 || t > maxT) continue;
      const d = Math.hypot(ox - dir.x * t, oy - dir.y * t, oz - dir.z * t);
      if (d < bestD) { bestD = d; best = p; }
    }
    return best;
  }
  function evaluateDoor(ctx) {
    const res = { type: 'door', ok: false, reason: '對準沒有裝門的門框', x: 0, y: 0, z: 0, r: 0, hide: true };
    let best = null, bestD = ctx.eye ? 1.3 : 2.2;
    for (const p of doorSockets()) {
      const d = aimDist(ctx, p.x, p.y + 1.1, p.z);
      if (d < bestD && Math.hypot(p.x - ctx.pos.x, p.z - ctx.pos.z) < REACH) { bestD = d; best = p; }
    }
    if (!best) return res;
    Object.assign(res, { ok: true, reason: '', hide: false, parent: best.id, x: best.x, y: best.y, z: best.z, r: best.r });
    const [px, pz] = toW(best.x, best.z, best.r, 0, 0);
    for (const p of ctx.players || []) if (Math.hypot(px - p.x, pz - p.z) < 0.7 && Math.abs(p.y - best.y) < 2) { res.ok = false; res.reason = '有人站在門口'; }
    return res;
  }
  function evaluateLock(ctx) {
    const res = { type: 'lock', ok: false, reason: '對準還沒上鎖的門', x: 0, y: 0, z: 0, r: 0, hide: true };
    let best = null, bestD = ctx.eye ? 1.3 : 2.2;
    for (const p of pieces.values()) {
      if (p.type !== 'door' || p.lock) continue;
      const d = aimDist(ctx, p.x, p.y + 1.1, p.z);
      if (d < bestD && Math.hypot(p.x - ctx.pos.x, p.z - ctx.pos.z) < REACH) { bestD = d; best = p; }
    }
    if (!best) return res;
    return Object.assign(res, { ok: true, reason: '', hide: false, parent: best.id, x: best.x, y: best.y, z: best.z, r: best.r });
  }

  function placeDoor(d) {
    if (pieces.has(d.id)) return pieces.get(d.id);
    const frame = pieces.get(d.parent);
    if (!frame) return null;
    const rec = { id: d.id, type: 'door', owner: d.owner, parent: frame.id, x: frame.x, y: frame.y, z: frame.z, r: frame.r,
      hp: 300, maxHp: 300, open: false, ang: 0, mats: [], meshes: [], cols: [], lock: null };
    const g = new THREE.Group();
    g.position.set(frame.x, frame.y, frame.z);
    g.rotation.y = frame.r;
    // 鉸鏈在洞的左邊；門板從鉸鏈往右長
    const hinge = new THREE.Group();
    hinge.position.set(-HOLE.w / 2 + 0.02, 0, 0);
    g.add(hinge);
    const doorMat = M.door.clone(), darkMat = M.dark.clone();
    const leaf = new THREE.Mesh(new THREE.BoxGeometry(HOLE.w - 0.05, HOLE.h - 0.03, 0.07).translate((HOLE.w - 0.05) / 2, (HOLE.h - 0.03) / 2, 0), doorMat);
    const straps = new THREE.Mesh(mergeGeometries([0.4, 1.9].map((y) => new THREE.BoxGeometry(HOLE.w - 0.05, 0.09, 0.09).translate((HOLE.w - 0.05) / 2, y, 0))), darkMat);
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.2, 0.1).translate(HOLE.w - 0.2, 1.05, 0.06), darkMat);
    for (const m of [leaf, straps, handle]) {
      m.castShadow = m.receiveShadow = true;
      m.userData = { surf: 'metal', pieceId: rec.id, noHole: true };
      hinge.add(m); solids.push(m); rec.meshes.push(m);
    }
    rec.mats.push(doorMat, darkMat);
    scene.add(g);
    rec.group = g; rec.hinge = hinge;
    const ax = Math.cos(frame.r), az = -Math.sin(frame.r);
    const [cx, cz] = toW(frame.x, frame.z, frame.r, 0, 0);
    rec.closedCol = { type: 'obox', cx, cz, hx: HOLE.w / 2, hz: 0.06, ax, az, y0: frame.y, y1: frame.y + HOLE.h };
    rec.cols = [rec.closedCol];
    colliders.push(rec.closedCol);
    frame.door = rec.id;
    pieces.set(rec.id, rec);
    return rec;
  }
  function removeDoor(rec, shatter) {
    if (!rec) return;
    pieces.delete(rec.id);
    const frame = pieces.get(rec.parent);
    if (frame && frame.door === rec.id) frame.door = null;
    dropMeshes(rec);
    if (shatter && fx) {
      const c = new THREE.Vector3(rec.x, rec.y + 1.2, rec.z);
      for (let i = 0; i < 6; i++) fx.impact(c.clone().add(new THREE.Vector3((Math.random() - 0.5), Math.random(), (Math.random() - 0.5))), new THREE.Vector3(0, 1, 0), 'metal');
    }
  }
  function setDoor(id, open) {
    const rec = pieces.get(id);
    if (!rec || rec.type !== 'door' || rec.open === open) return;
    rec.open = open;
    const k = colliders.indexOf(rec.closedCol);
    if (open && k >= 0) colliders.splice(k, 1);
    if (!open && k < 0) colliders.push(rec.closedCol);
    rec.cols = open ? [] : [rec.closedCol];
  }
  function attachLock(d) {
    const door = pieces.get(d.parent);
    if (!door || door.lock) return null;
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.17, 0.05), M.lock);
    box.position.set(HOLE.w - 0.2, 1.3, 0.07);
    const led = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.02, 0.01), ledOn);
    led.position.set(HOLE.w - 0.2 + 0.03, 1.36, 0.098);
    box.userData = { surf: 'metal', pieceId: door.id, noHole: true };
    door.hinge.add(box, led);
    solids.push(box); door.meshes.push(box, led);
    door.lock = { code: String(d.code), owner: d.owner, auth: new Set([d.owner]), led };
    return door.lock;
  }
  function authorize(doorId, who) {
    const door = pieces.get(doorId);
    if (door?.lock) door.lock.auth.add(who);
  }

  function update(dt, viewer) {
    for (const rec of pieces.values()) {
      if (rec.type !== 'door') continue;
      const target = rec.open ? -1.45 : 0;
      rec.ang += (target - rec.ang) * (1 - Math.exp(-10 * dt));
      rec.hinge.rotation.y = rec.ang;
      if (rec.lock) rec.lock.led.material = rec.lock.auth.has(viewer) ? ledOff : ledOn;
    }
  }

  function clear() {
    for (const id of [...pieces.keys()]) { const r = pieces.get(id); if (r && r.type !== 'door') remove(id, false); }
    for (const id of [...pieces.keys()]) remove(id, false);
    occupied.clear();
  }

  return {
    pieces, evaluate, evaluateDoor, evaluateLock, doorOnRay, showGhost, place, placeDoor, attachLock, authorize, setDoor, damage, upgrade, setHp, remove, update, clear,
    hideGhost() { ghost.visible = false; },
    fromHit(hit) { const id = hit?.mesh?.userData.pieceId; return id ? pieces.get(id) || null : null; },
    countOf(owner) { let n = 0; for (const p of pieces.values()) if (p.owner === owner && p.type !== 'door') n++; return n; },
    centerOf(rec) {
      const h = PIECES[rec.type]?.slot === 'wall' || rec.type === 'door' ? 1.4 : rec.type === 'stairs' ? 1.5 : rec.type === 'roof' || rec.type === 'troof' ? 0.6 : -0.2;
      return new THREE.Vector3(rec.x, rec.y + h, rec.z);
    },
  };
}
