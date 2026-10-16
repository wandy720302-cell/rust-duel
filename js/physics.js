// 玩家移動：垂直圓柱 vs 盒子/圓柱/旋轉盒碰撞，能自動踩上 0.5m 以內的台階（樓梯、地基、箱子）。
// 碰撞體種類：
//   box  { min, max }                         軸對齊盒（建築、箱子）
//   cyl  { x, z, r, y0, y1 }                  直立圓柱（樹幹、岩石、油桶）
//   obox { cx, cz, hx, hz, ax, az, y0, y1 }   可任意轉角度的盒子（玩家蓋的木牆），(ax, az) 是本地 x 軸方向
//   tri  { p: [[x,z]×3], y0, y1 }             直立的三角柱（三角地基、三角地板）
import { heightAt, BOUNDS, WATER_Y } from './world.js';

export const RADIUS = 0.38;
export const STAND_H = 1.8;
export const CROUCH_H = 1.2;
const STEP = 0.5;        // 站在地上時能直接跨上去的高度
const AIR_STEP = 0.2;    // 空中只能「搆」上很低的邊，不然會卡進箱子裡
const GRAV = 20;
const JUMP = 6.6;        // 跳躍高度約 1.09m：翻得過半截牆、爬得上疊箱子
const FOOT = RADIUS * 0.7;

// 落地懲罰：跟 rust 一樣不能靠連跳保持速度
const LAND_SLOW = 0.45;  // 落地瞬間水平速度剩幾成
const LAND_T = 0.45;     // 之後這段時間內最高速度被壓低，連跳會越壓越久
const JUMP_CD = 0.3;     // 落地後多久才能再跳

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;

export function createBody(pos) {
  return {
    pos: pos.clone(), vel: { x: 0, y: 0, z: 0 }, onGround: true, crouch: 0, h: STAND_H, inWater: false,
    airT: 0, landT: 0, landMax: LAND_T, jumpCd: 0, hops: 0, sinceLand: 9,
  };
}

function footOverlapBox(c, x, z, r) {
  const cx = clamp(x, c.min[0], c.max[0]), cz = clamp(z, c.min[2], c.max[2]);
  return (x - cx) ** 2 + (z - cz) ** 2 < r * r;
}

// 點到旋轉盒的最近距離：先轉進盒子的本地座標
function oboxLocal(c, x, z) {
  const dx = x - c.cx, dz = z - c.cz;
  return [dx * c.ax + dz * c.az, -dx * c.az + dz * c.ax];
}
export function oboxDist2(c, x, z) {
  const [lx, lz] = oboxLocal(c, x, z);
  const ex = lx - clamp(lx, -c.hx, c.hx), ez = lz - clamp(lz, -c.hz, c.hz);
  return ex * ex + ez * ez;
}

// 三角形：點在不在裡面、點到三角形的最近點
export function pointInTri(x, z, p) {
  const [a, b, c] = p;
  const d1 = (x - b[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (z - b[1]);
  const d2 = (x - c[0]) * (b[1] - c[1]) - (b[0] - c[0]) * (z - c[1]);
  const d3 = (x - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (z - a[1]);
  const neg = d1 < 0 || d2 < 0 || d3 < 0, pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}
function nearestOnTriEdge(x, z, p) {
  let best = Infinity, bx = 0, bz = 0;
  for (let i = 0; i < 3; i++) {
    const [ax, az] = p[i], [cx, cz] = p[(i + 1) % 3];
    const dx = cx - ax, dz = cz - az;
    const t = clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz), 0, 1);
    const qx = ax + dx * t, qz = az + dz * t, d = Math.hypot(x - qx, z - qz);
    if (d < best) { best = d; bx = qx; bz = qz; }
  }
  return [best, bx, bz];
}
export function triDist(x, z, p) { return pointInTri(x, z, p) ? 0 : nearestOnTriEdge(x, z, p)[0]; }

// 腳底踩得到的東西（r：腳掌半徑）
function under(c, x, z, r) {
  if (c.type === 'box') return footOverlapBox(c, x, z, r);
  if (c.type === 'cyl') return Math.hypot(x - c.x, z - c.z) < c.r + r * 0.5;
  if (c.type === 'obox') return oboxDist2(c, x, z) < r * r;
  return triDist(x, z, c.p) < r;
}
const topOf = (c) => (c.type === 'box' ? c.max[1] : c.y1);
const bottomOf = (c) => (c.type === 'box' ? c.min[1] : c.y0);

// 不是玩家的東西（北極熊）用：把一個直立圓柱（半徑 r、高度 y0~y1）從碰撞體裡推出去；ignore 是自己的碰撞體
export function pushCircle(p, r, y0, y1, cols, ignore = null) {
  for (const c of cols) {
    if (c === ignore || topOf(c) <= y0 || bottomOf(c) >= y1) continue;
    let nx = 0, nz = 0, amt = 0;
    if (c.type === 'box') {
      const qx = clamp(p.x, c.min[0], c.max[0]), qz = clamp(p.z, c.min[2], c.max[2]);
      const dx = p.x - qx, dz = p.z - qz, d = Math.hypot(dx, dz);
      if (d >= r) continue;
      if (d > 1e-6) { nx = dx / d; nz = dz / d; amt = r - d; }
      else {
        const cx = (c.min[0] + c.max[0]) / 2, cz = (c.min[2] + c.max[2]) / 2;
        const ex = (c.max[0] - c.min[0]) / 2 - Math.abs(p.x - cx), ez = (c.max[2] - c.min[2]) / 2 - Math.abs(p.z - cz);
        if (ex < ez) { nx = Math.sign(p.x - cx) || 1; amt = ex + r; } else { nz = Math.sign(p.z - cz) || 1; amt = ez + r; }
      }
    } else if (c.type === 'cyl') {
      const dx = p.x - c.x, dz = p.z - c.z, d = Math.hypot(dx, dz), min = r + c.r;
      if (d >= min) continue;
      if (d > 1e-6) { nx = dx / d; nz = dz / d; } else nx = 1;
      amt = min - d;
    } else if (c.type === 'obox') {
      const [lx, lz] = oboxLocal(c, p.x, p.z);
      const qx = clamp(lx, -c.hx, c.hx), qz = clamp(lz, -c.hz, c.hz);
      const ex = lx - qx, ez = lz - qz, d = Math.hypot(ex, ez);
      if (d >= r) continue;
      let lnx = 0, lnz = 0;
      if (d > 1e-6) { lnx = ex / d; lnz = ez / d; amt = r - d; }
      else {
        const px = c.hx - Math.abs(lx), pz = c.hz - Math.abs(lz);
        if (px < pz) { lnx = Math.sign(lx) || 1; amt = px + r; } else { lnz = Math.sign(lz) || 1; amt = pz + r; }
      }
      // 本地 → 世界：本地 x 軸是 (ax, az)、z 軸是 (-az, ax)
      nx = lnx * c.ax - lnz * c.az; nz = lnx * c.az + lnz * c.ax;
    } else if (c.type === 'tri') {
      const inside = pointInTri(p.x, p.z, c.p);
      const [d, qx, qz] = nearestOnTriEdge(p.x, p.z, c.p);
      if (!inside) { if (d >= r || d < 1e-9) continue; nx = (p.x - qx) / d; nz = (p.z - qz) / d; amt = r - d; }
      else if (d > 1e-9) { nx = (qx - p.x) / d; nz = (qz - p.z) / d; amt = d + r; }
      else continue;
    } else continue;
    p.x += nx * amt; p.z += nz * amt;
  }
}

function groundAt(x, z, maxTop, cols) {
  let g = heightAt(x, z);
  for (const c of cols) {
    const top = topOf(c);
    if (top > g && top <= maxTop && under(c, x, z, FOOT)) g = top;
  }
  return g;
}

// 頭頂上方最低的東西（樓板、屋頂、天花板）；圓柱不算（樹枝不擋頭）
function ceilingAt(x, z, minBottom, cols) {
  let c0 = Infinity;
  for (const c of cols) {
    if (c.type === 'cyl') continue;
    const b = bottomOf(c);
    if (b >= minBottom && b < c0 && under(c, x, z, RADIUS * 0.9)) c0 = b;
  }
  return c0;
}

function push(p, v, nx, nz, amt) {
  p.x += nx * amt; p.z += nz * amt;
  const vn = v.x * nx + v.z * nz;
  if (vn < 0) { v.x -= vn * nx; v.z -= vn * nz; }
}

function resolveXZ(b, cols, stepH) {
  const p = b.pos, v = b.vel;
  for (const c of cols) {
    if (c.type === 'box') {
      if (c.max[1] <= p.y + stepH || c.min[1] >= p.y + b.h) continue;
      const cx = clamp(p.x, c.min[0], c.max[0]), cz = clamp(p.z, c.min[2], c.max[2]);
      const dx = p.x - cx, dz = p.z - cz, d2 = dx * dx + dz * dz;
      if (d2 >= RADIUS * RADIUS) continue;
      if (d2 > 1e-10) {
        const d = Math.sqrt(d2);
        push(p, v, dx / d, dz / d, RADIUS - d);
      } else {
        // 圓心已經跑進盒子裡：從最近的一面推出去
        const pl = p.x - c.min[0] + RADIUS, pr = c.max[0] - p.x + RADIUS;
        const pb = p.z - c.min[2] + RADIUS, pf = c.max[2] - p.z + RADIUS;
        const m = Math.min(pl, pr, pb, pf);
        if (m === pl) p.x -= pl; else if (m === pr) p.x += pr; else if (m === pb) p.z -= pb; else p.z += pf;
      }
    } else if (c.type === 'cyl') {
      if (c.y1 <= p.y + stepH || c.y0 >= p.y + b.h) continue;
      const dx = p.x - c.x, dz = p.z - c.z, d = Math.hypot(dx, dz), min = RADIUS + c.r;
      if (d >= min || d < 1e-6) continue;
      push(p, v, dx / d, dz / d, min - d);
    } else if (c.type === 'tri') {
      if (c.y1 <= p.y + stepH || c.y0 >= p.y + b.h) continue;
      const inside = pointInTri(p.x, p.z, c.p);
      const [d, qx, qz] = nearestOnTriEdge(p.x, p.z, c.p);
      if (!inside) {
        if (d >= RADIUS || d < 1e-9) continue;
        push(p, v, (p.x - qx) / d, (p.z - qz) / d, RADIUS - d);
      } else if (d > 1e-9) {
        // 圓心跑進三角形：從最近的邊推出去
        push(p, v, (qx - p.x) / d, (qz - p.z) / d, d + RADIUS);
      }
    } else {
      if (c.y1 <= p.y + stepH || c.y0 >= p.y + b.h) continue;
      const [lx, lz] = oboxLocal(c, p.x, p.z);
      const qx = clamp(lx, -c.hx, c.hx), qz = clamp(lz, -c.hz, c.hz);
      const ex = lx - qx, ez = lz - qz, d2 = ex * ex + ez * ez;
      if (d2 >= RADIUS * RADIUS) continue;
      let nlx, nlz, amt;
      if (d2 > 1e-10) {
        const d = Math.sqrt(d2);
        nlx = ex / d; nlz = ez / d; amt = RADIUS - d;
      } else {
        const px = c.hx - Math.abs(lx) + RADIUS, pz = c.hz - Math.abs(lz) + RADIUS;
        if (px < pz) { nlx = Math.sign(lx) || 1; nlz = 0; amt = px; }
        else { nlx = 0; nlz = Math.sign(lz) || 1; amt = pz; }
      }
      // 法線轉回世界座標
      push(p, v, nlx * c.ax - nlz * c.az, nlx * c.az + nlz * c.ax, amt);
    }
  }
}

function blockedAbove(b, cols) {
  for (const c of cols) {
    if (c.type === 'cyl') continue;
    const bot = bottomOf(c);
    if (bot > b.pos.y + b.h - 0.05 && bot < b.pos.y + STAND_H + 0.02 && under(c, b.pos.x, b.pos.z, RADIUS * 0.9)) return true;
  }
  return false;
}

// inp: { fwd, right, jump, sprint, crouch, ads, yaw }
export function stepBody(b, inp, dt, cols) {
  // 蹲下 / 站起（頭頂有東西就站不起來）
  let target = inp.crouch ? 1 : 0;
  if (!inp.crouch && b.crouch > 0 && blockedAbove(b, cols)) target = b.crouch;
  b.crouch += clamp(target - b.crouch, -dt * 7, dt * 7);
  b.h = lerp(STAND_H, CROUCH_H, b.crouch);

  b.jumpCd = Math.max(0, b.jumpCd - dt);
  b.landT = Math.max(0, b.landT - dt);
  b.sinceLand += dt;

  b.inWater = b.pos.y < WATER_Y - 0.5;
  const sprinting = inp.sprint && inp.fwd > 0 && b.crouch < 0.3 && !inp.ads;
  let speed = sprinting ? 6.9 : 4.6;
  speed = lerp(speed, 2.3, b.crouch);
  if (inp.ads) speed *= 0.72;
  if (b.inWater) speed *= 0.55;
  if (b.landT > 0) speed *= 1 - 0.55 * (b.landT / b.landMax);

  const s = Math.sin(inp.yaw), c = Math.cos(inp.yaw);
  let wx = -s * inp.fwd + c * inp.right;
  let wz = -c * inp.fwd - s * inp.right;
  const len = Math.hypot(wx, wz);
  if (len > 1) { wx /= len; wz /= len; }
  const k = 1 - Math.exp(-(b.onGround ? 14 : 2.2) * dt);
  b.vel.x += (wx * speed - b.vel.x) * k;
  b.vel.z += (wz * speed - b.vel.z) * k;

  let jumped = false;
  if (inp.jump && b.onGround && b.crouch < 0.5 && b.jumpCd <= 0) {
    b.vel.y = JUMP; b.onGround = false; jumped = true;
    // 落地後很快又跳 = 在兔子跳，懲罰一次比一次重
    b.hops = b.sinceLand < 0.9 ? Math.min(b.hops + 1, 3) : 0;
  }
  b.vel.y -= GRAV * dt;

  const wasGround = b.onGround;
  const stepH = b.onGround ? STEP : AIR_STEP;
  const prevY = b.pos.y;
  b.pos.x += b.vel.x * dt;
  b.pos.z += b.vel.z * dt;
  for (let i = 0; i < 3; i++) resolveXZ(b, cols, stepH);
  b.pos.x = clamp(b.pos.x, BOUNDS.minX, BOUNDS.maxX);
  b.pos.z = clamp(b.pos.z, BOUNDS.minZ, BOUNDS.maxZ);

  b.pos.y += b.vel.y * dt;
  if (b.vel.y > 0) {
    const ceil = ceilingAt(b.pos.x, b.pos.z, prevY + b.h - 0.05, cols);
    if (b.pos.y + b.h > ceil) { b.pos.y = ceil - b.h; b.vel.y = 0; }
  }
  const ground = groundAt(b.pos.x, b.pos.z, prevY + stepH, cols);
  if (b.pos.y <= ground) {
    b.pos.y = ground; if (b.vel.y < 0) b.vel.y = 0; b.onGround = true;
  } else if (b.onGround && b.vel.y <= 0 && b.pos.y - ground < STEP) {
    b.pos.y = ground; b.vel.y = 0; b.onGround = true;   // 下樓梯時貼著地走，不要一直騰空
  } else {
    b.onGround = false;
  }

  let landed = false;
  if (b.onGround) {
    if (!wasGround && b.airT > 0.25) {
      landed = true;
      const mul = LAND_SLOW / (1 + b.hops * 0.35);
      b.vel.x *= mul; b.vel.z *= mul;
      b.landMax = LAND_T * (1 + b.hops * 0.6);
      b.landT = b.landMax;
      b.jumpCd = JUMP_CD;
      b.sinceLand = 0;
    }
    b.airT = 0;
  } else b.airT += dt;

  return { sprinting, speed: Math.hypot(b.vel.x, b.vel.z), landed, jumped };
}
