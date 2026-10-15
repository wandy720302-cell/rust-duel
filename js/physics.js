// 玩家移動：垂直圓柱 vs 盒子/圓柱碰撞，能自動踩上 0.5m 以內的台階（樓梯、地基、箱子）。
import { heightAt, BOUNDS, WATER_Y } from './world.js';

export const RADIUS = 0.38;
export const STAND_H = 1.8;
export const CROUCH_H = 1.2;
const STEP = 0.5;        // 站在地上時能直接跨上去的高度
const AIR_STEP = 0.2;    // 空中只能「搆」上很低的邊，不然會卡進箱子裡
const GRAV = 20;
const JUMP = 6.6;        // 跳躍高度約 1.09m：翻得過半截牆、爬得上疊箱子
const FOOT = RADIUS * 0.7;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;

export function createBody(pos) {
  return { pos: pos.clone(), vel: { x: 0, y: 0, z: 0 }, onGround: true, crouch: 0, h: STAND_H, inWater: false };
}

function footOverlapBox(c, x, z, r) {
  const cx = clamp(x, c.min[0], c.max[0]), cz = clamp(z, c.min[2], c.max[2]);
  return (x - cx) ** 2 + (z - cz) ** 2 < r * r;
}

function groundAt(x, z, maxTop, cols) {
  let g = heightAt(x, z);
  for (const c of cols) {
    if (c.type === 'box') {
      const top = c.max[1];
      if (top > g && top <= maxTop && footOverlapBox(c, x, z, FOOT)) g = top;
    } else {
      if (c.y1 > g && c.y1 <= maxTop && Math.hypot(x - c.x, z - c.z) < c.r + FOOT * 0.5) g = c.y1;
    }
  }
  return g;
}

function ceilingAt(x, z, minBottom, cols) {
  let c0 = Infinity;
  for (const c of cols) {
    if (c.type === 'box' && c.min[1] >= minBottom && c.min[1] < c0 && footOverlapBox(c, x, z, RADIUS * 0.9)) c0 = c.min[1];
  }
  return c0;
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
        const d = Math.sqrt(d2), nx = dx / d, nz = dz / d;
        p.x += nx * (RADIUS - d); p.z += nz * (RADIUS - d);
        const vn = v.x * nx + v.z * nz;
        if (vn < 0) { v.x -= vn * nx; v.z -= vn * nz; }
      } else {
        // 圓心已經跑進盒子裡：從最近的一面推出去
        const pl = p.x - c.min[0] + RADIUS, pr = c.max[0] - p.x + RADIUS;
        const pb = p.z - c.min[2] + RADIUS, pf = c.max[2] - p.z + RADIUS;
        const m = Math.min(pl, pr, pb, pf);
        if (m === pl) p.x -= pl; else if (m === pr) p.x += pr; else if (m === pb) p.z -= pb; else p.z += pf;
      }
    } else {
      if (c.y1 <= p.y + stepH || c.y0 >= p.y + b.h) continue;
      const dx = p.x - c.x, dz = p.z - c.z, d = Math.hypot(dx, dz), min = RADIUS + c.r;
      if (d >= min || d < 1e-6) continue;
      const nx = dx / d, nz = dz / d;
      p.x += nx * (min - d); p.z += nz * (min - d);
      const vn = v.x * nx + v.z * nz;
      if (vn < 0) { v.x -= vn * nx; v.z -= vn * nz; }
    }
  }
}

function blockedAbove(b, cols) {
  for (const c of cols) {
    if (c.type !== 'box') continue;
    if (c.min[1] > b.pos.y + b.h - 0.05 && c.min[1] < b.pos.y + STAND_H + 0.02 && footOverlapBox(c, b.pos.x, b.pos.z, RADIUS * 0.9)) return true;
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

  b.inWater = b.pos.y < WATER_Y - 0.5;
  const sprinting = inp.sprint && inp.fwd > 0 && b.crouch < 0.3 && !inp.ads;
  let speed = sprinting ? 6.9 : 4.6;
  speed = lerp(speed, 2.3, b.crouch);
  if (inp.ads) speed *= 0.72;
  if (b.inWater) speed *= 0.55;

  const s = Math.sin(inp.yaw), c = Math.cos(inp.yaw);
  let wx = -s * inp.fwd + c * inp.right;
  let wz = -c * inp.fwd - s * inp.right;
  const len = Math.hypot(wx, wz);
  if (len > 1) { wx /= len; wz /= len; }
  const k = 1 - Math.exp(-(b.onGround ? 14 : 2.2) * dt);
  b.vel.x += (wx * speed - b.vel.x) * k;
  b.vel.z += (wz * speed - b.vel.z) * k;

  if (inp.jump && b.onGround && b.crouch < 0.5) { b.vel.y = JUMP; b.onGround = false; }
  b.vel.y -= GRAV * dt;

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
  return { sprinting, speed: Math.hypot(b.vel.x, b.vel.z) };
}
