// 手持物：AK（rust 叫 Assault Rifle）、湯姆森、石頭、成吉思汗之刀、弓、手雷、建築藍圖。
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

// 瞄具：y = 瞄準線在槍身座標的高度，z = 開鏡時整把槍往前/後擺多少，fov = 開鏡時視野剩幾成
export const SIGHTS = {
  iron: { name: '機械照門', short: '照門', y: 0.097, z: -0.1, fov: 0.6 },
  holo: { name: '全息紅點', short: '紅點', y: 0.1245, z: -0.07, fov: 0.48 },
  scope: { name: '8 倍鏡', short: '8倍', y: 0.122, z: -0.02, fov: 0.125 },
};
export const SIGHT_ORDER = ['iron', 'holo', 'scope'];

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
  const metal = new THREE.MeshStandardMaterial({ color: '#3a3b3e', roughness: 0.5, metalness: 0.35, envMapIntensity: 0.25 });
  const metal2 = new THREE.MeshStandardMaterial({ color: '#4a4b4e', roughness: 0.55, metalness: 0.3, envMapIntensity: 0.25 });
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

  // --- 全息紅點：架在防塵蓋上，一個方框 + 一片玻璃 + 紅點 ---
  const black = new THREE.MeshStandardMaterial({ color: '#1c1d1f', roughness: 0.5, metalness: 0.4 });
  const holo = new THREE.Group();
  const hb = (w, h, d, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), black); m.position.set(x, y, z); m.castShadow = true; holo.add(m); };
  hb(0.03, 0.012, 0.08, 0, 0.089, -0.16);        // 底座
  hb(0.05, 0.016, 0.04, 0, 0.1, -0.17);          // 下殼
  hb(0.006, 0.042, 0.02, -0.023, 0.124, -0.17);  // 左框
  hb(0.006, 0.042, 0.02, 0.023, 0.124, -0.17);   // 右框
  hb(0.052, 0.006, 0.024, 0, 0.147, -0.17);      // 上框
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(0.04, 0.036), new THREE.MeshStandardMaterial({
    color: '#8fc9c0', transparent: true, opacity: 0.16, roughness: 0.05, metalness: 0.6, depthWrite: false,
  }));
  glass.position.set(0, 0.1245, -0.175);
  holo.add(glass);
  const dot = new THREE.Mesh(new THREE.CircleGeometry(0.0011, 12), new THREE.MeshBasicMaterial({ color: '#ff2a14', toneMapped: false }));
  dot.position.set(0, 0.1245, -0.174);
  holo.add(dot);
  holo.visible = false;
  g.add(holo);

  // --- 8 倍鏡：兩個鏡環 + 長鏡筒 ---
  const scope = new THREE.Group();
  const sb = (w, h, d, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), black); m.position.set(x, y, z); m.castShadow = true; scope.add(m); };
  sb(0.03, 0.012, 0.2, 0, 0.089, -0.15);         // 鏡座
  sb(0.012, 0.03, 0.02, 0, 0.104, -0.07);        // 前後鏡環
  sb(0.012, 0.03, 0.02, 0, 0.104, -0.22);
  const scopeTube = (r1, r2, len, z) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, len, 14).rotateX(Math.PI / 2), black);
    m.position.set(0, 0.122, z); m.castShadow = true; scope.add(m);
  };
  scopeTube(0.016, 0.016, 0.2, -0.145);   // 鏡筒
  scopeTube(0.024, 0.017, 0.06, -0.27);   // 物鏡端
  scopeTube(0.017, 0.021, 0.05, -0.02);   // 目鏡端
  scope.visible = false;
  g.add(scope);

  const setSight = (k) => { holo.visible = k === 'holo'; scope.visible = k === 'scope'; };
  return { group: g, muzzle, mag, setSight };
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

// ---------- 生存模式的新武器 ----------
const MATS = () => ({
  metal: new THREE.MeshStandardMaterial({ color: '#3a3b3e', roughness: 0.5, metalness: 0.35, envMapIntensity: 0.25 }),
  metal2: new THREE.MeshStandardMaterial({ color: '#4a4b4e', roughness: 0.55, metalness: 0.3, envMapIntensity: 0.25 }),
  wood: new THREE.MeshStandardMaterial({ color: '#7a3e1a', roughness: 0.55 }),
  woodDark: new THREE.MeshStandardMaterial({ color: '#5a2c12', roughness: 0.6 }),
});

// 湯姆森：木頭槍托、木頭前握把、帶散熱片的槍管、直彈匣
export function buildThompson() {
  const m = MATS();
  const g = new THREE.Group();
  const box = (w, h, d, mat, x, y, z, rx = 0) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z); mesh.rotation.x = rx; mesh.castShadow = true; g.add(mesh); return mesh;
  };
  const tube = (r, len, mat, x, y, z) => {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 12).rotateX(Math.PI / 2), mat);
    mesh.position.set(x, y, z); mesh.castShadow = true; g.add(mesh); return mesh;
  };
  box(0.05, 0.068, 0.3, m.metal, 0, 0.02, -0.12);              // 機匣
  box(0.034, 0.012, 0.03, m.metal, 0, 0.06, -0.03);            // 照門座
  box(0.009, 0.026, 0.016, m.metal, -0.0105, 0.078, -0.03);   // 照門缺口
  box(0.009, 0.026, 0.016, m.metal, 0.0105, 0.078, -0.03);
  tube(0.021, 0.2, m.metal, 0, 0.022, -0.37);                  // 散熱片段
  for (let i = 0; i < 8; i++) tube(0.026, 0.008, m.metal2, 0, 0.022, -0.29 - i * 0.022);
  tube(0.014, 0.12, m.metal, 0, 0.022, -0.53);                 // 槍管
  tube(0.022, 0.05, m.metal2, 0, 0.022, -0.6);                 // 槍口補償器
  box(0.006, 0.03, 0.006, m.metal, 0, 0.06, -0.58);            // 準星（頂端 0.075）
  box(0.044, 0.08, 0.27, m.wood, 0, -0.025, 0.17, 0.12);       // 槍托
  box(0.046, 0.095, 0.02, m.metal, 0, -0.045, 0.3, 0.12);
  box(0.034, 0.1, 0.045, m.woodDark, 0, -0.065, 0.02, -0.3);   // 握把
  box(0.034, 0.1, 0.042, m.wood, 0, -0.055, -0.3, 0.12);       // 前握把
  box(0.01, 0.008, 0.06, m.metal, 0, -0.024, -0.06);
  const mag = new THREE.Group();
  mag.position.set(0, -0.015, -0.15);
  const mg = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.16, 0.05), m.metal2);
  mg.position.y = -0.08; mg.castShadow = true; mag.add(mg);
  g.add(mag);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.022, -0.64);
  g.add(muzzle);
  return { group: g, muzzle, mag, sightY: 0.08 };
}

// 成吉思汗之刀：蒙古彎刀。刀身用 2D 外形擠出來，往 -z 指，刀背往上彎
export function buildSword() {
  const g = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: '#d7dbdf', roughness: 0.22, metalness: 0.9, envMapIntensity: 1.1 });
  const brass = new THREE.MeshStandardMaterial({ color: '#c49a36', roughness: 0.35, metalness: 0.8 });
  const leather = new THREE.MeshStandardMaterial({ color: '#4a2a16', roughness: 0.85 });
  const L = 0.78, s = new THREE.Shape();
  const back = (u) => 0.012 + 0.085 * (u / L) ** 2;
  const width = (u) => 0.034 * (1 - (u / L) ** 3) + 0.004;
  s.moveTo(0, back(0));
  for (let i = 1; i <= 16; i++) { const u = L * i / 16; s.lineTo(u, back(u)); }
  for (let i = 16; i >= 0; i--) { const u = L * i / 16; s.lineTo(u, back(u) - width(u)); }
  const blade = new THREE.Mesh(new THREE.ExtrudeGeometry(s, { depth: 0.005, bevelEnabled: false }).translate(0, 0, -0.0025).rotateY(Math.PI / 2), steel);
  blade.position.z = -0.03;
  blade.castShadow = true;
  g.add(blade);
  const guard = new THREE.Mesh(new THREE.BoxGeometry(0.024, 0.075, 0.025), brass);
  guard.position.set(0, -0.004, -0.02); g.add(guard);
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.017, 0.15, 10).rotateX(Math.PI / 2), leather);
  grip.position.set(0, -0.004, 0.06); g.add(grip);
  const pommel = new THREE.Mesh(new THREE.SphereGeometry(0.021, 10, 8), brass);
  pommel.position.set(0, -0.004, 0.14); g.add(pommel);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return { group: g };
}

// 弓：直立握在左手。兩片弓臂用管子沿曲線長出來；弦是兩條細線，拉弓時往後跑
export function buildBow() {
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: '#6e4220', roughness: 0.6 });
  const wrap = new THREE.MeshStandardMaterial({ color: '#2e1c10', roughness: 0.9 });
  const stringMat = new THREE.MeshStandardMaterial({ color: '#e6dcc4', roughness: 0.8 });
  const limbPts = (sgn) => [[0, 0, -0.035], [0, 0.1, -0.05], [0, 0.3, -0.07], [0, 0.5, -0.03], [0, 0.58, 0.01]]
    .map(([x, y, z]) => new THREE.Vector3(x, y * sgn, z));
  for (const sgn of [1, -1]) {
    const curve = new THREE.CatmullRomCurve3(limbPts(sgn));
    const limb = new THREE.Mesh(new THREE.TubeGeometry(curve, 20, 0.013, 6), wood);
    limb.castShadow = true; g.add(limb);
  }
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.019, 0.13, 8), wrap);
  grip.position.z = -0.035; g.add(grip);
  const top = new THREE.Vector3(0, 0.58, 0.01), bot = new THREE.Vector3(0, -0.58, 0.01);
  const strUp = new THREE.Mesh(new THREE.CylinderGeometry(0.0022, 0.0022, 1, 4), stringMat);
  const strDn = new THREE.Mesh(new THREE.CylinderGeometry(0.0022, 0.0022, 1, 4), stringMat);
  g.add(strUp, strDn);
  // 搭在弦上的箭
  const arrow = buildArrow();
  arrow.rotation.y = Math.PI;   // 箭頭朝 -z
  g.add(arrow);
  const nock = new THREE.Vector3();
  const Y = new THREE.Vector3(0, 1, 0), d = new THREE.Vector3();
  const setString = (a, b, mesh) => {
    d.subVectors(b, a); const len = d.length();
    mesh.position.copy(a).addScaledVector(d, 0.5);
    mesh.scale.set(1, len, 1);
    mesh.quaternion.setFromUnitVectors(Y, d.normalize());
  };
  // draw：0 = 放鬆、1 = 拉滿
  const setDraw = (draw, showArrow) => {
    nock.set(0, 0, 0.012 + draw * 0.48);
    setString(top, nock, strUp); setString(nock, bot, strDn);
    arrow.visible = showArrow;
    arrow.position.set(0.012, 0, nock.z);
  };
  setDraw(0, false);
  return { group: g, setDraw, nock };
}

// 箭：箭桿 + 箭頭 + 紅色箭羽，箭頭朝 +z（射出去時用 lookAt 轉）
export function buildArrow() {
  const g = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.72, 5).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#a5774a', roughness: 0.7 }));
  shaft.position.z = -0.36; g.add(shaft);
  const head = new THREE.Mesh(new THREE.ConeGeometry(0.009, 0.05, 6).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#7d8186', metalness: 0.7, roughness: 0.4 }));
  head.position.z = -0.745; g.add(head);
  const feather = new THREE.MeshStandardMaterial({ color: '#c83a22', roughness: 0.9, side: THREE.DoubleSide });
  for (const r of [0, Math.PI * 2 / 3, Math.PI * 4 / 3]) {
    const f = new THREE.Mesh(new THREE.PlaneGeometry(0.02, 0.09), feather);
    f.position.set(Math.cos(r) * 0.012, Math.sin(r) * 0.012, -0.05);
    f.rotation.set(Math.PI / 2, 0, r);
    g.add(f);
  }
  g.rotation.y = Math.PI;
  const wrap = new THREE.Group(); wrap.add(g);
  return wrap;
}

// 手雷：橄欖綠鳳梨、拉環、握把
export function buildGrenade() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.036, 12, 10), new THREE.MeshStandardMaterial({ color: '#4c5730', roughness: 0.7, flatShading: true }));
  body.scale.y = 1.22; body.castShadow = true; g.add(body);
  const metal = new THREE.MeshStandardMaterial({ color: '#7a7e83', roughness: 0.45, metalness: 0.7 });
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.015, 0.025, 8), metal);
  top.position.y = 0.052; g.add(top);
  const lever = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.075, 0.006), metal);
  lever.position.set(0.026, 0.03, 0); lever.rotation.z = -0.25; g.add(lever);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.012, 0.0025, 6, 14), new THREE.MeshStandardMaterial({ color: '#c49a36', metalness: 0.8, roughness: 0.3 }));
  ring.position.set(-0.02, 0.06, 0); ring.rotation.y = Math.PI / 2; g.add(ring);
  return { group: g };
}

// 一塊熊肉（帶一截骨頭）；cooked：烤過的焦褐色
export function buildMeat(cooked = false) {
  const g = new THREE.Group();
  const geo = new THREE.IcosahedronGeometry(1, 1);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 1 + 0.12 * Math.sin(x * 5 + z * 3) + 0.08 * Math.cos(y * 7);
    p.setXYZ(i, x * k, y * k, z * k);
  }
  geo.computeVertexNormals();
  const meat = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: cooked ? '#6e3b1d' : '#b3404a', roughness: cooked ? 0.75 : 0.42, flatShading: true }));
  meat.scale.set(0.075, 0.035, 0.06);
  const fat = new THREE.Mesh(new THREE.TorusGeometry(0.052, 0.008, 4, 12, Math.PI * 1.2), new THREE.MeshStandardMaterial({ color: cooked ? '#b98a55' : '#efd9cf', roughness: 0.6 }));
  fat.rotation.x = Math.PI / 2; fat.position.y = 0.012;
  const boneMat = new THREE.MeshStandardMaterial({ color: '#ece5d2', roughness: 0.5 });
  const bone = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.07, 6), boneMat);
  bone.rotation.z = Math.PI / 2; bone.position.set(0.085, 0, 0.01);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.016, 6, 5), boneMat);
  knob.position.set(0.122, 0, 0.01);
  g.add(meat, fat, bone, knob);
  return { group: g };
}
// 一卷繃帶
export function buildBandage() {
  const g = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color: '#ecebe4', roughness: 0.9 });
  const roll = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.07, 14), white);
  roll.rotation.z = Math.PI / 2;
  const core = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.072, 8), new THREE.MeshStandardMaterial({ color: '#a6a49a', roughness: 1 }));
  core.rotation.z = Math.PI / 2;
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.068, 0.004, 0.06).translate(0, -0.035, 0.03), white);
  const cross = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.0045, 0.02).translate(0, -0.0372, 0.045), new THREE.MeshBasicMaterial({ color: '#c43c2c' }));
  g.add(roll, core, tail, cross);
  return { group: g };
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
  const flashSprite = (muzzle) => {
    const f = new THREE.Sprite(new THREE.SpriteMaterial({ map: T.flash, color: '#ffd59a', blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    f.scale.set(0.22, 0.22, 1); f.visible = false; muzzle.add(f); return f;
  };

  // --- 槍：AK、湯姆森 ---
  const guns = {};
  {
    const akRig = new THREE.Group(); akRig.scale.setScalar(RIG); holder.add(akRig);
    const ak = buildAK(); akRig.add(ak.group);
    block(akRig, 0.06, 0.09, 0.1, 0.008, -0.075, 0.035, -0.3);
    limb(akRig, [0.02, -0.1, 0.07], [0.16, -0.42, 0.5], 0.085, 0.08);
    block(akRig, 0.075, 0.05, 0.13, -0.004, -0.03, -0.42);
    limb(akRig, [-0.03, -0.05, -0.4], [-0.32, -0.42, -0.02], 0.085, 0.08);
    guns.ak = { rig: akRig, muzzle: ak.muzzle, mag: ak.mag, setSight: ak.setSight, flash: flashSprite(ak.muzzle), magPos: ak.mag.position.clone() };

    const tRig = new THREE.Group(); tRig.scale.setScalar(RIG); holder.add(tRig);
    const th = buildThompson(); tRig.add(th.group);
    block(tRig, 0.06, 0.09, 0.1, 0.008, -0.075, 0.035, -0.3);
    limb(tRig, [0.02, -0.1, 0.07], [0.16, -0.42, 0.5], 0.085, 0.08);
    block(tRig, 0.06, 0.1, 0.07, 0, -0.08, -0.3);
    limb(tRig, [-0.02, -0.11, -0.29], [-0.3, -0.42, 0.0], 0.085, 0.08);
    guns.thompson = { rig: tRig, muzzle: th.muzzle, mag: th.mag, flash: flashSprite(th.muzzle), magPos: th.mag.position.clone(), sightY: th.sightY };
  }

  // --- 石頭 ---
  const rockRig = new THREE.Group();
  holder.add(rockRig);
  const rock = buildRock(0.075, T);
  rock.position.set(0, 0.02, -0.02);
  rockRig.add(rock);
  block(rockRig, 0.07, 0.06, 0.09, 0.01, -0.035, 0.02);
  limb(rockRig, [0.02, -0.05, 0.05], [0.09, -0.2, 0.36], 0.065, 0.06);

  // --- 成吉思汗之刀 ---
  const swordRig = new THREE.Group();
  holder.add(swordRig);
  const sword = buildSword();
  sword.group.rotation.x = 0.55;
  swordRig.add(sword.group);
  block(swordRig, 0.06, 0.06, 0.09, 0, -0.01, 0.05);
  limb(swordRig, [0.01, -0.03, 0.08], [0.1, -0.22, 0.4], 0.065, 0.06);

  // --- 弓：左手握弓、右手拉弦 ---
  const bowRig = new THREE.Group();
  holder.add(bowRig);
  const bow = buildBow();
  bow.group.rotation.set(0, 0, -0.22);
  bowRig.add(bow.group);
  block(bowRig, 0.06, 0.08, 0.07, 0, 0, -0.03);
  limb(bowRig, [0, -0.02, -0.02], [-0.18, -0.3, 0.3], 0.065, 0.06);
  const pullHand = block(bowRig, 0.06, 0.06, 0.08, 0, 0, 0.05);
  const pullArm = limb(bowRig, [0, 0, 0], [0, 0, 0.1], 0.065, 0.06);

  // --- 手雷 ---
  const nadeRig = new THREE.Group();
  holder.add(nadeRig);
  const nade = buildGrenade();
  nadeRig.add(nade.group);
  block(nadeRig, 0.07, 0.06, 0.09, 0.01, -0.04, 0.02);
  limb(nadeRig, [0.02, -0.05, 0.05], [0.09, -0.2, 0.36], 0.065, 0.06);

  // --- 建築藍圖（也拿來代表手上的設施：火爐、門、鎖、睡袋） ---
  const planRig = new THREE.Group();
  holder.add(planRig);
  const plan = buildPlan(T);
  plan.scale.setScalar(0.55);
  plan.rotation.set(-0.85, 0.15, 0.05);
  planRig.add(plan);
  block(planRig, 0.06, 0.03, 0.07, 0.07, -0.09, 0.02);
  limb(planRig, [0.08, -0.1, 0.04], [0.16, -0.24, 0.36], 0.06, 0.055);

  // --- 熊肉（生 / 烤）、繃帶：右手拿著，用的時候拿到面前 ---
  const handRig = (obj) => {
    const rig = new THREE.Group(); holder.add(rig);
    rig.add(obj);
    block(rig, 0.07, 0.06, 0.09, 0.01, -0.04, 0.02);
    limb(rig, [0.02, -0.05, 0.05], [0.09, -0.2, 0.36], 0.065, 0.06);
    return rig;
  };
  const meatRig = handRig(buildMeat(false).group), cookedRig = handRig(buildMeat(true).group), bandageRig = handRig(buildBandage().group);

  const rigs = { ak: guns.ak.rig, thompson: guns.thompson.rig, rock: rockRig, sword: swordRig, bow: bowRig, grenade: nadeRig, plan: planRig, meat: meatRig, cooked: cookedRig, bandage: bandageRig, none: null };

  // 開鏡時讓「照門缺口 → 準星」這條線剛好落在畫面正中央
  const POSE = {
    hip: { p: [0.12, -0.12, -0.27], r: [0, 0.03, 0] },
    ads: { p: [0, -0.097 * RIG, -0.1], r: [0, 0, 0] },   // 會依瞄具改寫
    sprint: { p: [0.1, -0.15, -0.22], r: [-0.35, 0.7, 0.25] },
    down: { p: [0.12, -0.42, -0.22], r: [-0.6, 0.2, 0] },
    rock: { p: [0.17, -0.17, -0.3], r: [0.15, -0.35, 0.1] },
    sword: { p: [0.17, -0.19, -0.3], r: [0.1, -0.3, 0.12] },
    bow: { p: [-0.04, -0.03, -0.42], r: [0, 0.1, 0] },
    grenade: { p: [0.16, -0.15, -0.3], r: [0.1, -0.2, 0] },
    plan: { p: [0.13, -0.115, -0.3], r: [0.05, -0.25, 0] },
    meat: { p: [0.16, -0.15, -0.3], r: [0.1, -0.3, 0] },
    cooked: { p: [0.16, -0.15, -0.3], r: [0.1, -0.3, 0] },
    bandage: { p: [0.15, -0.16, -0.3], r: [0.2, -0.2, 0] },
    none: { p: [0.13, -0.3, -0.3], r: [0, 0, 0] },
  };
  const ADS = { thompson: { p: [0, -guns.thompson.sightY * RIG, -0.1] } };

  const st = {
    kick: 0, kickRot: 0, swayX: 0, swayY: 0, phase: 0, flashT: 0, sprint: 0, down: 0, bob: 0,
    item: 'ak', draw: 0, swing: -1, swingDur: ROCK.swing, place: -1, sight: 'iron', toss: -1, use: -1, useDur: 1,
  };
  const p = new THREE.Vector3(), r = new THREE.Euler(), tmp = new THREE.Vector3();
  const ease = (t) => t * t * (3 - 2 * t);
  const bump = (t, a, b, c, d) => (t < a || t > d ? 0 : t < b ? ease((t - a) / (b - a)) : t < c ? 1 : 1 - ease((t - c) / (d - c)));
  const showRig = (k) => { for (const [name, g] of Object.entries(rigs)) if (g) g.visible = name === k; };
  showRig('ak');
  const curGun = () => guns[st.item] || null;
  const handPos = new THREE.Vector3();

  return {
    scene, cam,
    get muzzle() { return (curGun() || guns.ak).muzzle; },
    setSkin(c) { sk.color.set(c); },
    setAspect(a) { cam.aspect = a; cam.updateProjectionMatrix(); },
    // 換瞄具（只有 AK 有）：開鏡時讓新瞄具的瞄準線落在畫面正中央
    setSight(k) {
      st.sight = k;
      guns.ak.setSight(k);
      POSE.ads.p = [0, -SIGHTS[k].y * RIG, SIGHTS[k].z];
    },
    // 換手上的東西：先放下再拿起來
    setItem(k) {
      if (!(k in rigs)) k = 'plan';
      if (k === st.item) return;
      st.item = k; st.draw = 1; st.swing = -1; st.place = -1; st.toss = -1; st.use = -1;
      showRig(k);
    },
    fire() {
      const gun = curGun();
      if (!gun) return;
      st.kick = Math.min(st.kick + 0.045, 0.07);
      st.kickRot = Math.min(st.kickRot + 0.05, 0.09);
      st.flashT = 0.045;
      gun.flash.visible = true;
      gun.flash.material.rotation = Math.random() * Math.PI * 2;
      const s = 0.18 + Math.random() * 0.1;
      gun.flash.scale.set(s, s, 1);
    },
    swing(dur = ROCK.swing) { st.swing = 0; st.swingDur = dur; },
    place() { st.place = 0; },
    toss() { st.toss = 0; },
    use(dur = 1.2) { st.use = 0; st.useDur = dur; },
    // o: { dt, ads(0..1), sprint, speed, onGround, reload(-1 或 0..1), down, mdx, mdy, bowDraw(0..1), hasArrow, hasNade }
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

      const gun = curGun();
      const a = gun ? o.ads : 0;
      if (gun) {
        const adsP = st.item === 'ak' ? POSE.ads.p : ADS[st.item].p;
        p.set(...POSE.hip.p).lerp(tmp.set(...adsP), a);
        r.set(POSE.hip.r[0] * (1 - a), POSE.hip.r[1] * (1 - a), 0);
      } else {
        const pose = POSE[st.item] || POSE.plan;
        p.set(...pose.p); r.set(...pose.r);
      }
      const sp = st.sprint, dn = Math.max(st.down, st.draw);
      p.lerp(tmp.set(...POSE.sprint.p), sp * (gun ? 1 : 0.4));
      if (gun) { r.x += (POSE.sprint.r[0] - r.x) * sp; r.y += (POSE.sprint.r[1] - r.y) * sp; r.z += (POSE.sprint.r[2] - r.z) * sp; }
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
      for (const gg of Object.values(guns)) { gg.mag.position.copy(gg.magPos); gg.mag.rotation.set(0, 0, 0); }
      if (gun && o.reload >= 0) {
        const q = o.reload;
        const tilt = bump(q, 0, 0.14, 0.82, 0.98);
        r.z += 0.55 * tilt; r.x += 0.12 * tilt; p.y -= 0.04 * tilt; p.x -= 0.03 * tilt;
        const out = bump(q, 0.14, 0.3, 0.5, 0.68);
        gun.mag.position.y -= 0.32 * out; gun.mag.position.z += 0.08 * out; gun.mag.rotation.x = 0.6 * out;
        const bolt = bump(q, 0.78, 0.83, 0.85, 0.9);
        p.z += 0.03 * bolt; r.x += 0.08 * bolt;
      }
      // 揮石頭 / 揮刀：舉起 → 往前下砸 → 收回
      if (st.swing >= 0) {
        st.swing += dt / st.swingDur;
        const q = st.swing;
        const up = bump(q, 0, 0.3, 0.32, 0.38), hit = bump(q, 0.3, 0.4, 0.5, 0.9);
        if (st.item === 'sword') { r.y += 0.9 * up - 1.4 * hit; r.x += 0.3 * up - 0.5 * hit; p.x += 0.06 * up - 0.12 * hit; p.z -= 0.1 * hit; }
        else { r.x += 0.7 * up - 1.1 * hit; p.y += 0.06 * up - 0.03 * hit; p.z -= 0.16 * hit; p.x -= 0.05 * hit; r.z -= 0.3 * hit; }
        if (q >= 1) st.swing = -1;
      }
      // 丟手雷：往後拉 → 往前甩
      if (st.toss >= 0) {
        st.toss += dt / 0.55;
        const back = bump(st.toss, 0, 0.35, 0.4, 0.5), fwd = bump(st.toss, 0.4, 0.55, 0.6, 1);
        p.z += 0.12 * back - 0.2 * fwd; p.y += 0.08 * back; r.x += 0.6 * back - 0.9 * fwd;
        nade.group.visible = st.toss < 0.5;
        if (st.toss >= 1) st.toss = -1;
      } else nade.group.visible = o.hasNade !== false;
      // 吃東西、包紮：拿到面前，邊咬邊上下動
      if (st.use >= 0) {
        st.use += dt / st.useDur;
        const k = bump(st.use, 0, 0.2, 0.85, 1);
        p.x -= 0.12 * k; p.y += 0.07 * k; p.z += 0.08 * k; r.x += 0.35 * k; r.y += 0.6 * k;
        p.y += Math.sin(st.use * st.useDur * 18) * 0.008 * k;
        if (st.use >= 1) st.use = -1;
      }
      // 放牆：藍圖往前推一下
      if (st.place >= 0) {
        st.place += dt / 0.4;
        const k = bump(st.place, 0, 0.3, 0.4, 1);
        p.z -= 0.08 * k; r.x -= 0.3 * k;
        if (st.place >= 1) st.place = -1;
      }
      // 弓：弦跟右手一起往後拉
      if (st.item === 'bow') {
        const dr = o.bowDraw || 0;
        bow.setDraw(dr, !!o.hasArrow);
        bow.group.updateMatrix();
        handPos.copy(bow.nock).applyMatrix4(bow.group.matrix);
        pullHand.position.copy(handPos);
        const to = handPos.clone().add(new THREE.Vector3(0.16, -0.3, 0.3));
        const d = to.clone().sub(handPos), len = d.length();
        pullArm.position.copy(handPos).addScaledVector(d, 0.5);
        pullArm.scale.set(1, 1, len / 0.1);
        pullArm.quaternion.setFromUnitVectors(Z, d.normalize());
        p.z += dr * 0.04; r.z -= dr * 0.05;
      }
      holder.position.copy(p);
      holder.rotation.copy(r);

      if (st.flashT > 0) { st.flashT -= dt; if (st.flashT <= 0) for (const gg of Object.values(guns)) gg.flash.visible = false; }
    },
    // 槍口在「主相機座標系」裡的位置（給子彈曳光當起點）
    muzzleCamSpace(out) {
      holder.updateMatrixWorld(true);
      return (curGun() || guns.ak).muzzle.getWorldPosition(out);
    },
  };
}
