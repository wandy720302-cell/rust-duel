// 會飛的東西：箭（有重力、打到東西會插著）、手雷（會彈、會滾、3 秒後爆）。
// 判定原則跟槍一樣：誰丟的誰算。對方畫面上的只是同一套物理跑出來的影子，爆炸位置以丟的人送來的為準。
import * as THREE from 'three';
import { buildArrow, buildGrenade, buildC4 } from './weapon.js';
import { BOW, NADE, C4 } from './items.js';

const STEP = 1 / 120;

export function createProjectiles(world, fx, audio, scene) {
  const list = [];
  const tmpDir = new THREE.Vector3(), tmpEnd = new THREE.Vector3();

  function spawnArrow({ id, o, v, mine, power = 1 }) {
    const mesh = buildArrow();
    mesh.position.copy(o);
    scene.add(mesh);
    const a = { kind: 'arrow', id, pos: o.clone(), vel: v.clone(), mesh, mine, power, stuck: false, life: 12 };
    list.push(a);
    return a;
  }

  // type：'nade' 手雷（會彈）或 'c4'（打到東西就黏住，嗶嗶叫 10 秒）
  function spawnNade({ id, o, v, mine, type = 'nade' }) {
    const c4 = type === 'c4';
    const built = c4 ? buildC4() : buildGrenade();
    const group = built.group;
    group.scale.setScalar(c4 ? 1.6 : 1.3);
    group.position.copy(o);
    scene.add(group);
    const n = { kind: 'nade', type, id, pos: o.clone(), vel: v.clone(), mesh: group, led: built.led, mine, fuse: c4 ? C4.fuse : NADE.fuse, rest: false, acc: 0, beepT: 0,
      spin: new THREE.Vector3(Math.random() * 8, Math.random() * 8, 0) };
    list.push(n);
    return n;
  }

  function removeAt(i) {
    const p = list[i];
    scene.remove(p.mesh);
    list.splice(i, 1);
  }
  function remove(id) {
    const i = list.findIndex((p) => p.id === id);
    if (i >= 0) removeAt(i);
  }

  // hooks.arrowHitsTarget(origin, dir, maxDist) → { dist, part } | null（只有自己射的箭會問）
  // hooks.onArrowHit(arrow, worldHit|null, targetHit|null)
  // hooks.onNadeBoom(nade)（只有自己丟的會觸發）
  function update(dt, hooks) {
    for (let i = list.length - 1; i >= 0; i--) {
      const p = list[i];
      if (p.kind === 'arrow') {
        p.life -= dt;
        if (p.life <= 0) { removeAt(i); continue; }
        if (p.stuck) continue;
        p.vel.y -= BOW.gravity * dt;
        tmpEnd.copy(p.pos).addScaledVector(p.vel, dt);
        tmpDir.subVectors(tmpEnd, p.pos);
        const len = tmpDir.length();
        if (len > 1e-6) {
          tmpDir.divideScalar(len);
          const wh = world.raycast(p.pos, tmpDir, len);
          const th = p.mine && hooks.arrowHitsTarget ? hooks.arrowHitsTarget(p.pos, tmpDir, wh ? wh.dist : len) : null;
          if (th) {
            hooks.onArrowHit?.(p, null, th);
            removeAt(i);
            continue;
          }
          if (wh && wh.mesh?.userData.bearId) {
            hooks.onArrowHit?.(p, wh, null);
            removeAt(i);
            continue;
          }
          if (wh) {
            p.pos.copy(wh.point).addScaledVector(tmpDir, 0.12);
            p.stuck = true; p.life = 8;
            p.mesh.position.copy(p.pos);
            hooks.onArrowHit?.(p, wh, null);
            continue;
          }
          p.pos.copy(tmpEnd);
        }
        p.mesh.position.copy(p.pos);
        p.mesh.lookAt(tmpEnd.copy(p.pos).add(p.vel));
        continue;
      }
      // 手雷：固定步長模擬，兩邊跑出來的軌跡才會一樣
      p.acc += dt;
      while (p.acc >= STEP) {
        p.acc -= STEP;
        p.fuse -= STEP;
        if (p.rest) continue;
        p.vel.y -= 9.8 * 1.15 * STEP;
        tmpEnd.copy(p.pos).addScaledVector(p.vel, STEP);
        tmpDir.subVectors(tmpEnd, p.pos);
        const len = tmpDir.length();
        if (len < 1e-7) continue;
        tmpDir.divideScalar(len);
        const wh = world.raycast(p.pos, tmpDir, len + 0.07);
        if (wh) {
          const n = wh.normal.clone();
          if (n.dot(tmpDir) > 0) n.negate();
          if (p.type === 'c4') {
            // 黏在打到的面上，平的那面貼著
            p.pos.copy(wh.point).addScaledVector(n, 0.04);
            p.rest = true; p.vel.set(0, 0, 0);
            p.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
            audio.thunk(p.mine ? null : p.pos, p.pos.distanceTo(audio.listenerPos || p.pos));
            continue;
          }
          p.pos.copy(wh.point).addScaledVector(n, 0.07);
          const vn = p.vel.dot(n);
          p.vel.addScaledVector(n, -1.55 * vn).multiplyScalar(0.55);
          if (Math.abs(vn) > 2) audio.thunk(p.pos, 0);
          if (p.vel.length() < 0.6 && n.y > 0.6) { p.rest = true; p.vel.set(0, 0, 0); }
        } else p.pos.copy(tmpEnd);
      }
      p.mesh.position.copy(p.pos);
      if (!p.rest) { p.mesh.rotation.x += p.spin.x * dt; p.mesh.rotation.y += p.spin.y * dt; }
      if (p.type === 'c4') {
        // 越接近爆炸嗶得越快，紅燈跟著閃
        p.beepT -= dt;
        if (p.beepT <= 0 && p.fuse > 0) { p.beepT = p.fuse > 4 ? 1 : p.fuse > 1.5 ? 0.45 : 0.18; audio.c4beep(p.pos); if (p.led) p.led.visible = true; }
        else if (p.led && p.beepT < (p.fuse > 4 ? 0.85 : 0.1)) p.led.visible = false;
      }
      if (p.fuse <= 0) {
        if (p.mine) { hooks.onNadeBoom?.(p); removeAt(i); }
        else if (p.fuse < -2) removeAt(i);   // 等不到對方的爆炸訊息就自己收掉
      }
    }
  }

  function clear() { for (let i = list.length - 1; i >= 0; i--) removeAt(i); }
  return { spawnArrow, spawnNade, update, remove, clear, list };
}
