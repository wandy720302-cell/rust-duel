// 曳光、彈孔、命中噴屑、血霧、槍口閃光的光源
import * as THREE from 'three';

const SURF_COLOR = {
  wood: '#8a6a45', stone: '#a29e94', metal: '#c8b28a', dirt: '#6d5a40', water: '#cfdcdc', blood: '#7a0d0d',
};

export function createEffects(scene, T) {
  const items = [];

  // 曳光：一根細長發光棒，以 600m/s 沿彈道飛
  const tracerGeo = new THREE.CylinderGeometry(0.012, 0.012, 1, 5).rotateX(Math.PI / 2);
  const tracerMat = new THREE.MeshBasicMaterial({ color: '#ffd9a0', transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });

  const puffMats = {};
  const puffMat = (c) => (puffMats[c] ||= new THREE.SpriteMaterial({ map: T.puff, color: c, transparent: true, depthWrite: false }));
  const sparkMat = new THREE.SpriteMaterial({ map: T.puff, color: '#ffcf70', blending: THREE.AdditiveBlending, transparent: true, depthWrite: false });
  const chipGeo = new THREE.BoxGeometry(0.03, 0.03, 0.03);
  const chipMats = {};
  const chipMat = (c) => (chipMats[c] ||= new THREE.MeshStandardMaterial({ color: c, roughness: 1 }));

  const holeMat = new THREE.MeshBasicMaterial({ map: T.hole, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
  const holeGeo = new THREE.PlaneGeometry(0.09, 0.09);
  const holes = [];

  const light = new THREE.PointLight('#ffb35c', 0, 9, 2);
  scene.add(light);
  let lightT = 0;

  function sprite(mat, pos, scale, life, vel, grow = 1.5) {
    const s = new THREE.Sprite(mat.clone());
    s.position.copy(pos); s.scale.setScalar(scale);
    scene.add(s);
    items.push({ obj: s, life, max: life, vel: vel || new THREE.Vector3(), grow, base: scale, fade: true });
  }

  return {
    tracer(from, to) {
      const dir = to.clone().sub(from);
      const total = dir.length();
      if (total < 2) return;
      dir.normalize();
      const m = new THREE.Mesh(tracerGeo, tracerMat);
      m.scale.z = Math.min(5, total);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
      scene.add(m);
      items.push({ obj: m, tracer: true, from: from.clone(), dir, total, t: 0 });
    },
    impact(point, normal, surf) {
      if (surf === 'flesh') { this.blood(point); return; }
      const c = SURF_COLOR[surf] || SURF_COLOR.stone;
      const p = point.clone().addScaledVector(normal, 0.03);
      sprite(puffMat(c), p, 0.25, 0.55, normal.clone().multiplyScalar(0.8).add(new THREE.Vector3(0, 0.3, 0)), 2.2);
      if (surf === 'metal' || surf === 'stone') {
        for (let i = 0; i < 4; i++) {
          const v = normal.clone().multiplyScalar(3 + Math.random() * 3)
            .add(new THREE.Vector3((Math.random() - 0.5) * 4, Math.random() * 3, (Math.random() - 0.5) * 4));
          sprite(sparkMat, p, 0.05, 0.12 + Math.random() * 0.1, v, 0.5);
        }
      }
      if (surf !== 'water') {
        for (let i = 0; i < 4; i++) {
          const ch = new THREE.Mesh(chipGeo, chipMat(c));
          ch.position.copy(p);
          scene.add(ch);
          const v = normal.clone().multiplyScalar(1.5 + Math.random() * 2)
            .add(new THREE.Vector3((Math.random() - 0.5) * 2.5, 1 + Math.random() * 2, (Math.random() - 0.5) * 2.5));
          items.push({ obj: ch, life: 0.7, max: 0.7, vel: v, grav: true, spin: true });
        }
      }
    },
    hole(point, normal) {
      const h = new THREE.Mesh(holeGeo, holeMat);
      h.position.copy(point).addScaledVector(normal, 0.012);
      h.lookAt(point.clone().add(normal));
      h.rotation.z = Math.random() * 6.28;
      scene.add(h); holes.push(h);
      if (holes.length > 80) scene.remove(holes.shift());
    },
    blood(point) {
      for (let i = 0; i < 3; i++) {
        const v = new THREE.Vector3((Math.random() - 0.5) * 1.2, Math.random() * 0.8, (Math.random() - 0.5) * 1.2);
        sprite(puffMat(SURF_COLOR.blood), point, 0.18 + Math.random() * 0.1, 0.4, v, 2.5);
      }
    },
    muzzleLight(pos) {
      light.position.copy(pos);
      light.intensity = 6;
      lightT = 0.05;
    },
    // 手雷爆炸：火球 + 一圈煙 + 飛散的土塊 + 一瞬間的強光
    // 火箭尾巴拖的白煙
    smoke(pos) {
      sprite(puffMat('#d8d4ca'), pos, 0.22, 0.9, new THREE.Vector3((Math.random() - 0.5) * 0.3, 0.25, (Math.random() - 0.5) * 0.3), 3.2);
    },
    explosion(pos) {
      const fire = new THREE.SpriteMaterial({ map: T.puff, color: '#ffb050', blending: THREE.AdditiveBlending, transparent: true, depthWrite: false });
      sprite(fire, pos.clone().add(new THREE.Vector3(0, 0.6, 0)), 1.6, 0.35, new THREE.Vector3(0, 1, 0), 2.2);
      sprite(fire, pos.clone().add(new THREE.Vector3(0, 1.0, 0)), 1.0, 0.25, new THREE.Vector3(0, 3, 0), 3);
      for (let i = 0; i < 9; i++) {
        const v = new THREE.Vector3((Math.random() - 0.5) * 3, 1 + Math.random() * 2.5, (Math.random() - 0.5) * 3);
        const c = ['#3a3632', '#55504a', '#6b655c'][i % 3];
        sprite(puffMat(c), pos.clone().add(new THREE.Vector3((Math.random() - 0.5), 0.4 + Math.random() * 0.6, (Math.random() - 0.5))), 1.2 + Math.random(), 1.8 + Math.random() * 1.2, v, 2.5);
      }
      for (let i = 0; i < 14; i++) {
        const ch = new THREE.Mesh(chipGeo, chipMat(SURF_COLOR.dirt));
        ch.position.copy(pos).add(new THREE.Vector3(0, 0.2, 0));
        ch.scale.setScalar(2 + Math.random() * 2);
        scene.add(ch);
        const v = new THREE.Vector3((Math.random() - 0.5) * 12, 4 + Math.random() * 6, (Math.random() - 0.5) * 12);
        items.push({ obj: ch, life: 1.3, max: 1.3, vel: v, grav: true, spin: true });
      }
      for (let i = 0; i < 10; i++) {
        const v = new THREE.Vector3((Math.random() - 0.5) * 16, Math.random() * 10, (Math.random() - 0.5) * 16);
        sprite(sparkMat, pos.clone().add(new THREE.Vector3(0, 0.4, 0)), 0.12, 0.3 + Math.random() * 0.3, v, 0.3);
      }
      light.position.copy(pos).add(new THREE.Vector3(0, 1.2, 0));
      light.intensity = 60; light.distance = 30;
      lightT = 0.12;
    },
    clearHoles() { for (const h of holes) scene.remove(h); holes.length = 0; },
    update(dt) {
      if (lightT > 0) { lightT -= dt; if (lightT <= 0) { light.intensity = 0; light.distance = 9; } }
      for (let i = items.length - 1; i >= 0; i--) {
        const it = items[i];
        if (it.tracer) {
          it.t += dt * 600;
          const len = it.obj.scale.z;
          const head = Math.min(it.t, it.total);
          it.obj.position.copy(it.from).addScaledVector(it.dir, Math.max(len / 2, head - len / 2));
          if (it.t - len > it.total) { scene.remove(it.obj); items.splice(i, 1); }
          continue;
        }
        it.life -= dt;
        if (it.life <= 0) {
          scene.remove(it.obj);
          if (it.obj.material && it.fade) it.obj.material.dispose();
          items.splice(i, 1); continue;
        }
        const k = 1 - it.life / it.max;
        if (it.grav) it.vel.y -= 9.8 * dt;
        it.obj.position.addScaledVector(it.vel, dt);
        if (!it.grav) it.vel.multiplyScalar(Math.exp(-4 * dt));
        if (it.spin) { it.obj.rotation.x += dt * 10; it.obj.rotation.y += dt * 7; }
        if (it.fade) {
          it.obj.material.opacity = 1 - k;
          it.obj.scale.setScalar(it.base * (1 + k * it.grow));
        }
      }
    },
  };
}
