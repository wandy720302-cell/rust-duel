// 手持物：AK（rust 叫 Assault Rifle）、石頭、建築藍圖。
// 第一人稱視角另開一個 scene 疊在最上層，槍才不會插進牆裡。
import * as THREE from 'three';

export const AK = {
  rpm: 450,
  mag: 30,
  reload: 3.0,
  dmg: 30,
  mult: { head: 2.0, body: 1.0, legs: 0.75 },
  range: 320,
  wallDmg: 10,   // 打木牆：一面牆要 35 發
};

// 石頭：rust 開局唯一的財產。敲樹拿木頭，也可以拿來敲人
export const ROCK = { swing: 0.85, hitAt: 0.3, reach: 2.4, dmg: 20, headMult: 1.6, chop: 25, wallDmg: 25 };

// rust AK 經典的「先往上、往左，再甩右、再甩左」S 型後座力（單位：度）
export const RECOIL = Array.from({ length: 30 }, (_, i) => {
  const pitch = 1.25 * (i < 7 ? 1 : i < 15 ? 0.72 : 0.5);
  const yaw = 0.62 * Math.sin(i * 0.42 + 0.35) * Math.min(1, (i + 1) / 5) - (i < 5 ? 0.18 : 0);
  return [yaw, pitch];
});

const skinMat = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.75 });

export function buildAK() {
  const metal = new THREE.MeshStandardMaterial({ color: '#3a3b3e', roughness: 0.45, metalness: 0.35 });
  const metal2 = new THREE.MeshStandardMaterial({ color: '#4a4b4e', roughness: 0.5, metalness: 0.3 });
  const wood = new THREE.MeshStandardMaterial({ color: '#7a3a17', roughness: 0.55 });
  const woodDark = new THREE.MeshStandardMaterial({ color: '#5c2a10', roughness: 0.6 });
  const g = new THREE.Group();
  const box = (w, h, d, m, x, y, z, rx = 0) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    mesh.position.set(x, y, z); mesh.rotation.x = rx; mesh.castShadow = true;
    g.add(mesh); return mesh;
  };
  const tube = (r, len, m, x, y, z) => {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 10).rotateX(Math.PI / 2), m);
    mesh.position.set(x, y, z); mesh.castShadow = true;
    g.add(mesh); return mesh;
  };
  box(0.05, 0.075, 0.34, metal, 0, 0.02, -0.13);            // 機匣
  box(0.046, 0.026, 0.30, metal2, 0, 0.07, -0.12);          // 防塵蓋
  box(0.03, 0.012, 0.04, metal, 0, 0.078, -0.28);           // 照門座
  box(0.009, 0.024, 0.02, metal, -0.0105, 0.092, -0.28);   // 照門缺口左（頂端 0.104）
  box(0.009, 0.024, 0.02, metal, 0.0105, 0.092, -0.28);    // 照門缺口右
  box(0.058, 0.056, 0.22, wood, 0, 0.004, -0.41);           // 下護木
  box(0.044, 0.032, 0.17, woodDark, 0, 0.056, -0.40);       // 上護木
  tube(0.011, 0.2, metal, 0, 0.056, -0.58);                 // 導氣管
  tube(0.012, 0.36, metal, 0, 0.018, -0.68);                // 槍管
  box(0.026, 0.05, 0.03, metal, 0, 0.045, -0.80);           // 準星座
  box(0.006, 0.03, 0.006, metal, 0, 0.08, -0.80);           // 準星（頂端 0.095）
  tube(0.018, 0.06, metal2, 0, 0.018, -0.88);               // 槍口制退器
  box(0.042, 0.085, 0.27, wood, 0, -0.022, 0.17, 0.1);      // 槍托
  box(0.045, 0.1, 0.02, metal, 0, -0.038, 0.305, 0.1);      // 托底板
  box(0.035, 0.11, 0.05, woodDark, 0, -0.07, 0.02, -0.3);   // 握把
  box(0.01, 0.008, 0.07, metal, 0, -0.03, -0.06);           // 扳機護弓
  box(0.025, 0.012, 0.012, metal2, 0.032, 0.04, -0.17);     // 拉柄

  const mag = new THREE.Group();
  mag.position.set(0, -0.02, -0.17);
  for (const [y, z, r] of [[-0.045, 0, 0.15], [-0.115, -0.018, 0.35], [-0.18, -0.05, 0.55]]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.08, 0.075), metal2);
    m.position.set(0, y, z); m.rotation.x = r; m.castShadow = true; mag.add(m);
  }
  g.add(mag);

  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.018, -0.93);
  g.add(muzzle);
  return { group: g, muzzle, mag };
}

// 同一個方向永遠回傳同一個值，共用頂點才不會裂開
const jitter = (x, y, z) => Math.sin(x * 7.1 + y * 3.3 + z * 5.9) * 0.5 + Math.sin(x * 13.7 - y * 9.1 + z * 4.2) * 0.3;
export function buildRock(radius, T) {
  const geo = new THREE.IcosahedronGeometry(radius, 1);
  const p = geo.attributes.position, v = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    n.copy(v).normalize();
    v.multiplyScalar(1 + 0.22 * jitter(n.x, n.y, n.z));
    v.y *= 0.8;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ map: T.rock, color: '#b9b4a8', roughness: 0.95, flatShading: true });
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  return m;
}

export function buildPlan(T) {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(
    new THREE.PlaneGeometry(0.2, 0.26),
    new THREE.MeshStandardMaterial({ map: T.blueprint, roughness: 0.9, side: THREE.DoubleSide }),
  ));
  return g;
}

export function createViewmodel(T, skin = '#c99d7a') {
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(52, 1, 0.01, 10);
  scene.add(new THREE.HemisphereLight('#d6dde2', '#4b4434', 1.3));
  const key = new THREE.DirectionalLight('#ffe7c8', 2.2);
  key.position.set(0.6, 1, 0.4);
  scene.add(key);

  // holder 負責位置/晃動；每種手持物各一組 rig，切換時只顯示一組
  const RIG = 0.6;   // 視角武器都是縮過的，不然整個畫面都是槍
  const holder = new THREE.Group();
  scene.add(holder);
  const sk = skinMat(skin);
  const Z = new THREE.Vector3(0, 0, 1);
  const limb = (parent, from, to, w, h) => {
    const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to);
    const d = b.clone().sub(a), len = d.length();
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, len), sk);
    m.position.copy(a).add(b).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(Z, d.normalize());
    parent.add(m);
    return m;
  };
  const block = (parent, w, h, d, x, y, z, rx = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), sk);
    m.position.set(x, y, z); m.rotation.x = rx; parent.add(m); return m;
  };

  // --- AK ---
  const akRig = new THREE.Group();
  akRig.scale.setScalar(RIG);
  holder.add(akRig);
  const { group: ak, muzzle, mag } = buildAK();
  akRig.add(ak);
  block(akRig, 0.06, 0.09, 0.1, 0.008, -0.075, 0.035, -0.3);                 // 右手握把
  limb(akRig, [0.02, -0.1, 0.07], [0.16, -0.42, 0.5], 0.085, 0.08);          // 右前臂
  block(akRig, 0.075, 0.05, 0.13, -0.004, -0.03, -0.42);                     // 左手托護木
  limb(akRig, [-0.03, -0.05, -0.4], [-0.32, -0.42, -0.02], 0.085, 0.08);     // 左前臂

  // --- 石頭 ---
  const rockRig = new THREE.Group();
  holder.add(rockRig);
  const rock = buildRock(0.075, T);
  rock.position.set(0, 0.02, -0.02);
  rockRig.add(rock);
  block(rockRig, 0.07, 0.06, 0.09, 0.01, -0.035, 0.02);                      // 握著石頭的手
  limb(rockRig, [0.02, -0.05, 0.05], [0.09, -0.2, 0.36], 0.065, 0.06);

  // --- 建築藍圖 ---
  const planRig = new THREE.Group();
  holder.add(planRig);
  const plan = buildPlan(T);
  plan.scale.setScalar(0.55);
  plan.rotation.set(-0.85, 0.15, 0.05);
  planRig.add(plan);
  block(planRig, 0.06, 0.03, 0.07, 0.07, -0.09, 0.02);
  limb(planRig, [0.08, -0.1, 0.04], [0.16, -0.24, 0.36], 0.06, 0.055);

  const rigs = { ak: akRig, rock: rockRig, plan: planRig };

  const flash = new THREE.Sprite(new THREE.SpriteMaterial({
    map: T.flash, color: '#ffd59a', blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
  }));
  flash.scale.set(0.22, 0.22, 1);
  flash.visible = false;
  muzzle.add(flash);

  // 開鏡時讓「照門缺口 → 準星」這條線剛好落在畫面正中央（槍身座標 y=0.097）
  const POSE = {
    hip: { p: [0.12, -0.12, -0.27], r: [0, 0.03, 0] },
    ads: { p: [0, -0.097 * RIG, -0.1], r: [0, 0, 0] },
    sprint: { p: [0.1, -0.15, -0.22], r: [-0.35, 0.7, 0.25] },
    down: { p: [0.12, -0.42, -0.22], r: [-0.6, 0.2, 0] },
    rock: { p: [0.17, -0.17, -0.3], r: [0.15, -0.35, 0.1] },
    plan: { p: [0.13, -0.115, -0.3], r: [0.05, -0.25, 0] },
  };

  const st = {
    kick: 0, kickRot: 0, swayX: 0, swayY: 0, phase: 0, flashT: 0, sprint: 0, down: 0, bob: 0,
    item: 'ak', draw: 0, swing: -1, place: -1,
  };
  const p = new THREE.Vector3(), r = new THREE.Euler(), tmp = new THREE.Vector3();
  const ease = (t) => t * t * (3 - 2 * t);
  const bump = (t, a, b, c, d) => (t < a || t > d ? 0 : t < b ? ease((t - a) / (b - a)) : t < c ? 1 : 1 - ease((t - c) / (d - c)));
  const showRig = (k) => { for (const [name, g] of Object.entries(rigs)) g.visible = name === k; };
  showRig('ak');

  return {
    scene, cam, muzzle,
    setSkin(c) { sk.color.set(c); },
    setAspect(a) { cam.aspect = a; cam.updateProjectionMatrix(); },
    // 換手上的東西：先放下再拿起來
    setItem(k) {
      if (k === st.item) return;
      st.item = k; st.draw = 1; st.swing = -1; st.place = -1;
      showRig(k);
    },
    fire() {
      st.kick = Math.min(st.kick + 0.045, 0.07);
      st.kickRot = Math.min(st.kickRot + 0.05, 0.09);
      st.flashT = 0.045;
      flash.visible = true;
      flash.material.rotation = Math.random() * Math.PI * 2;
      const s = 0.18 + Math.random() * 0.1;
      flash.scale.set(s, s, 1);
    },
    swing() { st.swing = 0; },
    place() { st.place = 0; },
    // o: { dt, ads(0..1), sprint(bool), speed, onGround, reload(-1 或 0..1), down(bool), mdx, mdy }
    update(o) {
      const dt = o.dt;
      st.sprint += ((o.sprint ? 1 : 0) - st.sprint) * (1 - Math.exp(-10 * dt));
      st.down += ((o.down ? 1 : 0) - st.down) * (1 - Math.exp(-9 * dt));
      st.draw = Math.max(0, st.draw - dt * 3.2);
      st.kick *= Math.exp(-14 * dt);
      st.kickRot *= Math.exp(-11 * dt);
      st.swayX += (-o.mdx * 0.00035 - st.swayX) * (1 - Math.exp(-8 * dt));
      st.swayY += (o.mdy * 0.00035 - st.swayY) * (1 - Math.exp(-8 * dt));
      st.swayX = THREE.MathUtils.clamp(st.swayX, -0.04, 0.04);
      st.swayY = THREE.MathUtils.clamp(st.swayY, -0.04, 0.04);
      const moving = o.onGround ? Math.min(o.speed / 4.6, 1.6) : 0;
      st.phase += dt * (6 + o.speed * 1.4) * (moving > 0.05 ? 1 : 0);
      st.bob += (moving - st.bob) * (1 - Math.exp(-8 * dt));

      const isAk = st.item === 'ak';
      const a = isAk ? o.ads : 0;
      if (isAk) {
        p.set(...POSE.hip.p).lerp(tmp.set(...POSE.ads.p), a);
        r.set(POSE.hip.r[0] * (1 - a), POSE.hip.r[1] * (1 - a), 0);
      } else {
        const pose = POSE[st.item];
        p.set(...pose.p); r.set(...pose.r);
      }
      const sp = st.sprint, dn = Math.max(st.down, st.draw);
      p.lerp(tmp.set(...POSE.sprint.p), sp * (isAk ? 1 : 0.4));
      if (isAk) { r.x += (POSE.sprint.r[0] - r.x) * sp; r.y += (POSE.sprint.r[1] - r.y) * sp; r.z += (POSE.sprint.r[2] - r.z) * sp; }
      p.lerp(tmp.set(...POSE.down.p), dn);
      r.x += (POSE.down.r[0] - r.x) * dn;

      const bobAmt = st.bob * (1 - a * 0.85) * (1 + sp * 0.8);
      p.x += Math.sin(st.phase) * 0.012 * bobAmt;
      p.y += Math.abs(Math.cos(st.phase)) * 0.014 * bobAmt - st.bob * 0.004;
      r.z += Math.sin(st.phase) * 0.015 * bobAmt;
      const t = performance.now() / 1000;
      p.y += Math.sin(t * 1.6) * 0.0025 * (1 - a * 0.7);   // 呼吸

      p.x += st.swayX * (1 - a * 0.6); p.y += st.swayY * (1 - a * 0.6);
      r.y += st.swayX * 2; r.x += st.swayY * 1.5;
      p.z += st.kick * (1 - a * 0.7); r.x += st.kickRot * (1 - a * 0.6);

      // 換彈動畫：傾斜 → 彈匣拔出 → 插回 → 拉槍機
      mag.position.set(0, -0.02, -0.17); mag.rotation.set(0, 0, 0);
      if (isAk && o.reload >= 0) {
        const q = o.reload;
        const tilt = bump(q, 0, 0.14, 0.82, 0.98);
        r.z += 0.55 * tilt; r.x += 0.12 * tilt; p.y -= 0.04 * tilt; p.x -= 0.03 * tilt;
        const out = bump(q, 0.14, 0.3, 0.5, 0.68);
        mag.position.y -= 0.32 * out; mag.position.z += 0.08 * out; mag.rotation.x = 0.6 * out;
        const bolt = bump(q, 0.78, 0.83, 0.85, 0.9);
        p.z += 0.03 * bolt; r.x += 0.08 * bolt;
      }
      // 揮石頭：舉起 → 往前下砸 → 收回
      if (st.swing >= 0) {
        st.swing += dt / ROCK.swing;
        const q = st.swing;
        const up = bump(q, 0, 0.3, 0.32, 0.38), hit = bump(q, 0.3, 0.4, 0.5, 0.9);
        r.x += 0.7 * up - 1.1 * hit; p.y += 0.06 * up - 0.03 * hit; p.z -= 0.16 * hit; p.x -= 0.05 * hit;
        r.z -= 0.3 * hit;
        if (q >= 1) st.swing = -1;
      }
      // 放牆：藍圖往前推一下
      if (st.place >= 0) {
        st.place += dt / 0.4;
        const k = bump(st.place, 0, 0.3, 0.4, 1);
        p.z -= 0.08 * k; r.x -= 0.3 * k;
        if (st.place >= 1) st.place = -1;
      }
      holder.position.copy(p);
      holder.rotation.copy(r);

      if (st.flashT > 0) { st.flashT -= dt; if (st.flashT <= 0) flash.visible = false; }
    },
    // 槍口在「主相機座標系」裡的位置（給子彈曳光當起點）
    muzzleCamSpace(out) {
      holder.updateMatrixWorld(true);
      return muzzle.getWorldPosition(out);
    },
  };
}
