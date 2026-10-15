// 對手的身體：rust 經典「只穿一條內褲拿 AK 的裸男」
import * as THREE from 'three';
import { buildAK } from './weapon.js';

export const SKINS = [
  { skin: '#d2a67f', shorts: '#2a3f6b', hair: '#3b2a1c' },
  { skin: '#a8754f', shorts: '#7b2b22', hair: '#1c1714' },
  { skin: '#e3bc98', shorts: '#2f4a2c', hair: '#8a6a3a' },
  { skin: '#8a5a3c', shorts: '#4a4a4a', hair: '#141210' },
];

export function createAvatar(scene, look, T) {
  const root = new THREE.Group();
  const body = new THREE.Group();   // 死掉時整個轉倒
  root.add(body);
  const mat = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 });
  const skin = mat(look.skin), shorts = mat(look.shorts), hair = mat(look.hair), eye = mat('#111');
  const box = (w, h, d, m, parent, x = 0, y = 0, z = 0) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    b.position.set(x, y, z); b.castShadow = true; b.receiveShadow = true; parent.add(b); return b;
  };

  const legL = new THREE.Group(), legR = new THREE.Group();
  legL.position.set(-0.1, 0.88, 0); legR.position.set(0.1, 0.88, 0);
  box(0.15, 0.88, 0.17, skin, legL, 0, -0.44, 0);
  box(0.15, 0.88, 0.17, skin, legR, 0, -0.44, 0);
  box(0.16, 0.06, 0.24, skin, legL, 0, -0.85, -0.03);
  box(0.16, 0.06, 0.24, skin, legR, 0, -0.85, -0.03);
  body.add(legL, legR);

  const upper = new THREE.Group();
  upper.position.y = 0.88;
  body.add(upper);
  box(0.37, 0.26, 0.23, shorts, upper, 0, 0.05, 0);           // 內褲
  box(0.4, 0.52, 0.22, skin, upper, 0, 0.42, 0);              // 軀幹
  const head = new THREE.Group();
  head.position.y = 0.82;
  upper.add(head);
  box(0.24, 0.26, 0.24, skin, head);
  box(0.25, 0.07, 0.25, hair, head, 0, 0.13, 0.01);
  box(0.25, 0.14, 0.06, hair, head, 0, 0.06, 0.1);
  box(0.04, 0.03, 0.01, eye, head, -0.055, 0.02, -0.121);
  box(0.04, 0.03, 0.01, eye, head, 0.055, 0.02, -0.121);

  // 肩膀：跟著視角上下抬，手和槍都掛在這裡
  const aim = new THREE.Group();
  aim.position.y = 0.6;
  upper.add(aim);
  const { group: ak, muzzle } = buildAK();
  ak.position.set(0.1, -0.06, -0.38);
  aim.add(ak);
  const armR = box(0.1, 0.1, 0.4, skin, aim, 0.2, -0.08, -0.16); armR.rotation.y = 0.18;
  const armL = box(0.1, 0.1, 0.55, skin, aim, -0.04, -0.09, -0.32); armL.rotation.y = -0.55;

  const flash = new THREE.Sprite(new THREE.SpriteMaterial({
    map: T.flash, color: '#ffd59a', blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
  }));
  flash.scale.set(0.5, 0.5, 1);
  flash.visible = false;
  muzzle.add(flash);

  scene.add(root);

  const st = { phase: 0, dead: 0, flashT: 0, crouch: 0, alive: true, stepAcc: 0 };
  const inv = new THREE.Matrix4();
  const lo = new THREE.Vector3(), ld = new THREE.Vector3();

  function slab(o, d, min, max) {
    let t0 = 0, t1 = Infinity;
    for (let i = 0; i < 3; i++) {
      const oi = o.getComponent(i), di = d.getComponent(i);
      if (Math.abs(di) < 1e-9) { if (oi < min[i] || oi > max[i]) return null; continue; }
      let a = (min[i] - oi) / di, b = (max[i] - oi) / di;
      if (a > b) [a, b] = [b, a];
      t0 = Math.max(t0, a); t1 = Math.min(t1, b);
      if (t0 > t1) return null;
    }
    return t0;
  }

  return {
    root,
    get alive() { return st.alive; },
    setVisible(v) { root.visible = v; },
    // s: { pos, yaw, pitch, crouch, speed, alive }
    update(s, dt) {
      root.position.copy(s.pos);
      root.rotation.y = s.yaw;
      st.crouch = s.crouch;
      aim.rotation.x = s.pitch;
      head.rotation.x = s.pitch * 0.6;
      const c = s.crouch;
      upper.position.y = 0.88 - 0.45 * c;
      for (const l of [legL, legR]) { l.position.y = 0.88 - 0.45 * c; l.scale.y = 1 - 0.5 * c; }
      const k = Math.min(s.speed / 4.6, 1.5);
      st.phase += dt * (3 + s.speed * 1.6);
      legL.rotation.x = Math.sin(st.phase) * 0.55 * k;
      legR.rotation.x = -Math.sin(st.phase) * 0.55 * k;
      upper.rotation.z = Math.sin(st.phase) * 0.03 * k;

      if (s.alive !== st.alive) { st.alive = s.alive; if (s.alive) st.dead = 0; }
      if (!st.alive) st.dead = Math.min(1, st.dead + dt * 2.6);
      const e = st.dead * st.dead;
      body.rotation.x = e * Math.PI / 2 * 0.98;
      body.position.y = e * 0.15;
      if (st.flashT > 0) { st.flashT -= dt; if (st.flashT <= 0) flash.visible = false; }
    },
    flash() {
      st.flashT = 0.05; flash.visible = true;
      flash.material.rotation = Math.random() * 6.28;
    },
    muzzleWorld(out) { root.updateMatrixWorld(true); return muzzle.getWorldPosition(out); },
    // 命中判定：射線轉進角色本地座標，對三個 AABB（頭/身/腿）做 slab test
    rayHit(origin, dir, maxDist = Infinity) {
      if (!st.alive || !root.visible) return null;
      root.updateMatrixWorld(true);
      inv.copy(root.matrixWorld).invert();
      lo.copy(origin).applyMatrix4(inv);
      ld.copy(dir).transformDirection(inv);
      const c = st.crouch * 0.45;
      const parts = [
        ['head', [-0.15, 1.57 - c, -0.15], [0.15, 1.87 - c, 0.15]],
        ['body', [-0.24, 0.86 - c, -0.16], [0.24, 1.57 - c, 0.16]],
        ['legs', [-0.2, 0, -0.14], [0.2, 0.86 - c, 0.14]],
      ];
      let best = null;
      for (const [part, mn, mx] of parts) {
        const t = slab(lo, ld, mn, mx);
        if (t !== null && t < maxDist && (!best || t < best.dist)) best = { dist: t, part };
      }
      return best;
    },
    dispose() { scene.remove(root); },
  };
}
