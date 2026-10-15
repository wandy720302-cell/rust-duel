// 地圖：一張 rust 取樣的小島切片。
// 西邊 A 基地、東邊 B 基地（對稱），中間兩層水泥廢墟 + 貨櫃區，北邊山林，南邊沙灘。
// 地圖左右鏡像（樹、岩石、貨櫃都是先生成左半邊再鏡射），兩邊出生點一樣公平。
import * as THREE from 'three';
import { makeTextures, rng } from './textures.js';

export const WATER_Y = -1.5;
export const BOUNDS = { minX: -55, maxX: 55, minZ: -54, maxZ: 44 };
export const BASES = {
  A: { x: -38, z: -12, dir: 1 },   // dir：門朝哪個 x 方向（都朝向地圖中央）
  B: { x: 38, z: -12, dir: -1 },
};

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;

// x 一律取絕對值，地形才會左右對稱
function rawHeight(x, z) {
  const ax = Math.abs(x);
  let h = Math.cos(ax * 0.055) * 1.2 + Math.sin(z * 0.06 + 0.7) * 1.1
    + Math.sin(ax * 0.11 + z * 0.08) * 0.55 + Math.cos(ax * 0.23 - z * 0.19) * 0.18;
  h += smooth(-34, -62, z) * 7;          // 北邊山脊
  h += smooth(44, 64, ax) * 6;           // 東西兩側山壁
  h = lerp(h, 0.4 - (z - 22) * 0.12, smooth(22, 40, z)); // 南邊緩降入海
  return h;
}

// 蓋房子的地方把地形整平
const ZONES = [
  { x: -38, z: -12, r: 6 }, { x: 38, z: -12, r: 6 },
  { x: 0, z: -2, r: 10 },
];
for (const f of ZONES) f.h = rawHeight(f.x, f.z);

export function heightAt(x, z) {
  let h = rawHeight(x, z);
  for (const f of ZONES) {
    const d = Math.hypot(x - f.x, z - f.z);
    const k = 1 - smooth(f.r, f.r + 7, d);
    if (k > 0) h = lerp(h, f.h, k);
  }
  return h;
}

// 主幹道：A 基地門口 → 繞過廢墟南側 → B 基地門口；另一條岔路往海灘
const ROADS = [
  [[-34, -12], [-25, -7], [-15, 3], [-6, 5.6], [6, 5.6], [15, 3], [25, -7], [34, -12]],
  [[0, 5.6], [0, 14], [3, 24], [2, 34]],
];
function distSeg(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const t = clamp(((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz), 0, 1);
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}
function distRoad(x, z) {
  let d = Infinity;
  for (const r of ROADS) for (let i = 0; i < r.length - 1; i++)
    d = Math.min(d, distSeg(x, z, r[i][0], r[i][1], r[i + 1][0], r[i + 1][1]));
  return d;
}

// 盒子的 UV 依真實尺寸展開，貼圖不會被拉長（texSize = 一張貼圖代表幾公尺）
function worldUV(geo, w, h, d, size) {
  const uv = geo.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      uv.setXY(i, uv.getX(i) * dims[f][0] / size, uv.getY(i) * dims[f][1] / size);
    }
  }
}

// 同一個座標永遠回傳同一個值，讓共用頂點的岩石面不會裂開
function hash3(x, y, z, seed) {
  return Math.sin(x * 3.1 + y * 5.7 + z * 2.3 + seed) * 0.5
    + Math.sin(x * 7.3 - y * 3.9 + z * 6.1 + seed * 1.7) * 0.3
    + Math.sin(-x * 11.1 + y * 9.2 + z * 13.7 + seed * 2.3) * 0.2;
}

// opts.mobile：手機降畫質（陰影解析度減半、草少三分之二、霧濃一點，剛好把遠景少畫的部分遮掉）
export function buildWorld(scene, opts = {}) {
  const mobile = !!opts.mobile;
  const T = makeTextures();
  const colliders = [];   // 玩家碰撞：{type:'box',min,max} | {type:'cyl',x,z,r,y0,y1}
  const solids = [];      // 子彈會打到的 mesh
  const blockers = [];    // 樹木/草避開用：{x,z,r}
  const R = rng(20261015);
  const updaters = [];

  const std = (o) => new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0, ...o });
  const tex = (t, rx = 1, ry = 1) => { const c = t.clone(); c.repeat.set(rx, ry); c.needsUpdate = true; return c; };
  const M = {
    wood: std({ map: T.wood }),
    planks: std({ map: T.planks }),
    stone: std({ map: T.stone }),
    sheet: std({ map: T.sheet, roughness: 0.7, metalness: 0.35 }),
    concrete: std({ map: T.concrete, roughness: 0.95 }),
    crate: std({ map: T.crate }),
    military: std({ map: T.military }),
    rock: std({ map: T.rock, flatShading: true }),
    bark: std({ map: T.bark }),
    birch: std({ map: T.birch }),
    pine: std({ color: '#ffffff', flatShading: true, roughness: 1 }),
    leaf: std({ color: '#ffffff', flatShading: true, roughness: 1 }),
    darkMetal: std({ color: '#2c2b29', roughness: 0.6, metalness: 0.6 }),
    rustCar: std({ map: T.sheet, color: '#b06a3a', roughness: 0.8, metalness: 0.4 }),
    glass: std({ color: '#1a1f22', roughness: 0.2, metalness: 0.5 }),
    tire: std({ color: '#151515', roughness: 1 }),
    bag: std({ color: '#5a6438' }),
    bagHead: std({ color: '#8a7f5c' }),
    glow: new THREE.MeshBasicMaterial({ color: '#ff8a2a' }),
    tcRed: new THREE.MeshBasicMaterial({ color: '#d33b1f' }),
    barrelBlue: std({ color: '#2d4f78', roughness: 0.6, metalness: 0.4, map: T.sheet }),
    barrelYellow: std({ color: '#c9a531', roughness: 0.6, metalness: 0.4, map: T.sheet }),
  };

  function addBox(min, max, mat, o = {}) {
    const { collide = true, shoot = true, cast = true, size = 3, surf = 'wood' } = o;
    const w = max[0] - min[0], h = max[1] - min[1], d = max[2] - min[2];
    const geo = new THREE.BoxGeometry(w, h, d);
    worldUV(geo, w, h, d, size);
    const m = new THREE.Mesh(geo, mat);
    m.position.set((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
    m.castShadow = cast; m.receiveShadow = true;
    m.userData.surf = surf;
    scene.add(m);
    if (collide) colliders.push({ type: 'box', min: [...min], max: [...max] });
    if (shoot) solids.push(m);
    return m;
  }
  const cyl = (x, z, r, y0, y1) => colliders.push({ type: 'cyl', x, z, r, y0, y1 });

  // ---------- 天空、光線、霧 ----------
  // rust 那種「陰天但有太陽」的灰綠霧感：地平線偏暖灰，天頂偏冷藍
  const FOG = new THREE.Color('#b9bdb5');
  scene.fog = new THREE.FogExp2(FOG, mobile ? 0.0125 : 0.0105);
  scene.background = FOG;

  const sunDir = new THREE.Vector3(0.55, 0.62, 0.35).normalize();
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(500, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: {
        top: { value: new THREE.Color('#6f8aa0') },
        horizon: { value: new THREE.Color('#c4c6bb') },
        ground: { value: new THREE.Color('#8d8e84') },
        sunDir: { value: sunDir },
        sunColor: { value: new THREE.Color('#fff1d6') },
      },
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `
        uniform vec3 top, horizon, ground, sunDir, sunColor; varying vec3 vDir;
        void main(){
          vec3 d = normalize(vDir); float h = d.y;
          vec3 col = mix(horizon, top, pow(clamp(h,0.0,1.0), 0.6));
          col = mix(col, ground, smoothstep(0.0, -0.12, h));
          float s = max(dot(d, sunDir), 0.0);
          col += sunColor * (pow(s, 900.0) * 6.0 + pow(s, 12.0) * 0.35);
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    }),
  );
  sky.renderOrder = -1;
  scene.add(sky);

  const hemi = new THREE.HemisphereLight('#c8d2d8', '#4d4836', 1.35);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight('#ffe3bf', 2.7);
  sun.position.copy(sunDir).multiplyScalar(110);
  sun.castShadow = true;
  sun.shadow.mapSize.set(mobile ? 1024 : 2048, mobile ? 1024 : 2048);
  Object.assign(sun.shadow.camera, { left: -68, right: 68, top: 68, bottom: -68, near: 10, far: 260 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.05;
  scene.add(sun, sun.target);

  // 雲：遠處幾片大霧團，慢慢飄
  const clouds = [];
  for (let i = 0; i < 16; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({
      map: T.cloud, color: '#f2f0ea', transparent: true, opacity: 0.3 + R() * 0.35, fog: false, depthWrite: false,
    }));
    const a = R() * Math.PI * 2, d = 160 + R() * 220;
    s.position.set(Math.cos(a) * d, 90 + R() * 70, Math.sin(a) * d);
    s.scale.set(140 + R() * 160, 45 + R() * 40, 1);
    scene.add(s); clouds.push(s);
  }
  updaters.push((t, dt) => {
    for (const c of clouds) { c.position.x += dt * 1.2; if (c.position.x > 380) c.position.x = -380; }
  });

  // ---------- 地形 ----------
  {
    const SIZE = 240, SEG = 180;
    const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setY(i, heightAt(pos.getX(i), pos.getZ(i)));
    geo.computeVertexNormals();
    const nrm = geo.attributes.normal;
    const col = new Float32Array(pos.count * 3);
    const C = (s) => new THREE.Color(s);
    const grassA = C('#5b6537'), grassB = C('#727640'), dry = C('#7d7550'), dirt = C('#6a5841'),
      road = C('#5d4f3d'), rock = C('#706d66'), sand = C('#bfb08a'), wet = C('#7f7458'), gravel = C('#77726a');
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const n = 0.5 + 0.25 * Math.sin(x * 0.21 + Math.sin(z * 0.13) * 2) + 0.25 * Math.sin(z * 0.17 - x * 0.05);
      c.copy(grassA).lerp(grassB, n);
      c.lerp(dry, smooth(0.6, 0.95, 0.5 + 0.5 * Math.sin(x * 0.07 + z * 0.11)) * 0.7);
      // 整平區（基地/廢墟）周圍是踩禿的泥土碎石
      for (const f of ZONES) {
        const k = 1 - smooth(f.r - 2, f.r + 4, Math.hypot(x - f.x, z - f.z));
        if (k > 0) c.lerp(f.r > 8 ? gravel : dirt, k * 0.9);
      }
      c.lerp(road, (1 - smooth(1.6, 3.0, distRoad(x, z))) * 0.92);
      const slope = 1 - nrm.getY(i);
      c.lerp(rock, smooth(0.18, 0.4, slope));
      const beach = smooth(17, 26, z) * (1 - smooth(1.6, 3.0, y));
      c.lerp(sand, beach);
      c.lerp(wet, smooth(WATER_Y + 0.6, WATER_Y - 0.4, y));
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const gt = tex(T.ground, SIZE / 4, SIZE / 4);
    const terrain = new THREE.Mesh(geo, std({ vertexColors: true, map: gt, roughness: 1 }));
    terrain.receiveShadow = true;
    scene.add(terrain);
  }

  // 海
  {
    const water = new THREE.Mesh(
      new THREE.PlaneGeometry(900, 320).rotateX(-Math.PI / 2),
      std({ color: '#3f5f5e', roughness: 0.12, metalness: 0.25, transparent: true, opacity: 0.86 }),
    );
    water.position.set(0, WATER_Y, 170);
    water.receiveShadow = true;
    scene.add(water);
    updaters.push((t) => { water.position.y = WATER_Y + Math.sin(t * 0.6) * 0.05; });
  }

  // ---------- 牆片（rust 的建築都是 3m 模組，一片牆最多一個洞） ----------
  function wallPiece(axis, a0, a1, fixed, y0, h, t, hole, mat, surf, size = 3) {
    const L = a1 - a0, parts = [];
    if (!hole) parts.push([0, L, 0, h]);
    else {
      const [u0, u1, v0, v1] = hole;
      if (u0 > 0) parts.push([0, u0, 0, h]);
      if (u1 < L) parts.push([u1, L, 0, h]);
      if (v0 > 0) parts.push([u0, u1, 0, v0]);
      if (v1 < h) parts.push([u0, u1, v1, h]);
    }
    for (const [u0, u1, v0, v1] of parts) {
      if (axis === 'x') addBox([a0 + u0, y0 + v0, fixed - t / 2], [a0 + u1, y0 + v1, fixed + t / 2], mat, { surf, size });
      else addBox([fixed - t / 2, y0 + v0, a0 + u0], [fixed + t / 2, y0 + v1, a0 + u1], mat, { surf, size });
    }
    // 窗戶加鐵條（純裝飾，子彈穿得過）
    if (hole && hole[2] > 0) {
      const [u0, u1, v0, v1] = hole;
      for (let k = 1; k <= 3; k++) {
        const u = a0 + u0 + (u1 - u0) * k / 4;
        const min = axis === 'x' ? [u - 0.02, y0 + v0, fixed - 0.02] : [fixed - 0.02, y0 + v0, u - 0.02];
        const max = axis === 'x' ? [u + 0.02, y0 + v1, fixed + 0.02] : [fixed + 0.02, y0 + v1, u + 0.02];
        addBox(min, max, M.darkMetal, { collide: false, shoot: false, cast: false });
      }
    }
  }

  // ---------- 2x1 小基地 ----------
  const spawns = {};
  function buildBase(key, wallM, surf, doorM) {
    const { x: cx, z: cz, dir } = BASES[key];
    const g = heightAt(cx, cz), fy = g + 0.9, H = 3, TH = 0.2;
    const X = (l) => cx + l * dir;
    const span = (l0, l1) => [Math.min(X(l0), X(l1)), Math.max(X(l0), X(l1))];
    // 石頭地基
    for (const [l0, l1] of [[-3, 0], [0, 3]]) {
      const [x0, x1] = span(l0, l1);
      addBox([x0, g - 1.5, cz - 1.5], [x1, fy, cz + 1.5], M.stone, { surf: 'stone' });
      addBox([x0 + 0.05, fy, cz - 1.45], [x1 - 0.05, fy + 0.02, cz + 1.45], M.planks, { collide: false, shoot: false, cast: false });
    }
    const WIN = [1.0, 2.0, 1.3, 2.1], DOOR = [0.9, 2.1, 0, 2.3];
    for (const [l0, l1, hole] of [[-3, 0, null], [0, 3, WIN]]) {
      const [x0, x1] = span(l0, l1);
      wallPiece('x', x0, x1, cz - 1.5 + TH / 2, fy, H, TH, hole, wallM, surf);
    }
    for (const [l0, l1, hole] of [[-3, 0, WIN], [0, 3, null]]) {
      const [x0, x1] = span(l0, l1);
      wallPiece('x', x0, x1, cz + 1.5 - TH / 2, fy, H, TH, hole, wallM, surf);
    }
    wallPiece('z', cz - 1.5, cz + 1.5, X(-3) + TH / 2 * dir, fy, H, TH, null, wallM, surf);
    wallPiece('z', cz - 1.5, cz + 1.5, X(3) - TH / 2 * dir, fy, H, TH, DOOR, wallM, surf);
    // 天花板 + 四角柱子
    addBox([cx - 3, fy + H, cz - 1.5], [cx + 3, fy + H + 0.22, cz + 1.5], M.planks, { surf: 'wood' });
    for (const l of [-3, 3]) for (const zz of [cz - 1.5, cz + 1.5]) {
      const x = X(l);
      addBox([x - 0.14, fy, zz - 0.14], [x + 0.14, fy + H + 0.22, zz + 0.14], M.wood, { collide: false, shoot: false });
    }
    // 門口台階
    { const [x0, x1] = span(3, 3.9); addBox([x0, g - 0.6, cz - 0.7], [x1, g + 0.45, cz + 0.7], M.stone, { surf: 'stone' }); }
    // 被打開的門（往外推開 90 度）
    { const [x0, x1] = span(3.02, 4.2); addBox([x0, fy, cz - 0.68], [x1, fy + 2.28, cz - 0.6], doorM, { surf: surf === 'metal' ? 'metal' : 'wood', size: 2.3 }); }

    // 室內：TC、熔爐、大木箱、睡袋 —— rust 玩家的家具 starter pack
    { const [x0, x1] = span(-2.85, -2.3); addBox([x0, fy, cz - 1.3], [x1, fy + 1.1, cz - 0.75], M.crate, { surf: 'wood', size: 1 });
      const [s0, s1] = span(-2.31, -2.29);
      addBox([s0, fy + 0.75, cz - 1.15], [s1, fy + 0.95, cz - 0.9], M.tcRed, { collide: false, shoot: false }); }
    { const [x0, x1] = span(-2.85, -2.05); addBox([x0, fy, cz + 0.45], [x1, fy + 1.05, cz + 1.25], M.stone, { surf: 'stone', size: 1.2 });
      const [g0, g1] = span(-2.06, -2.03);
      addBox([g0, fy + 0.2, cz + 0.65], [g1, fy + 0.55, cz + 1.05], M.glow, { collide: false, shoot: false, cast: false });
      const [c0, c1] = span(-2.6, -2.3);
      addBox([c0, fy + 1.05, cz + 0.7], [c1, fy + 2.99, cz + 1.0], M.darkMetal, { collide: false, surf: 'metal' }); }
    { const [x0, x1] = span(-0.4, 0.9); addBox([x0, fy, cz - 1.3], [x1, fy + 0.75, cz - 0.7], M.crate, { surf: 'wood', size: 0.75 }); }
    { const [x0, x1] = span(-2.0, -0.2); addBox([x0, fy, cz + 0.25], [x1, fy + 0.1, cz + 1.05], M.bag, { collide: false, shoot: false, cast: false });
      const [h0, h1] = span(-2.0, -1.6); addBox([h0, fy + 0.1, cz + 0.3], [h1, fy + 0.18, cz + 1.0], M.bagHead, { collide: false, shoot: false, cast: false }); }
    // 微弱的爐火光
    const fire = new THREE.PointLight('#ff8a3a', 2.2, 6, 2);
    fire.position.set(X(-1.8), fy + 0.5, cz + 0.85);
    scene.add(fire);
    updaters.push((t) => { fire.intensity = 2.0 + Math.sin(t * 13) * 0.25 + Math.sin(t * 7.3) * 0.2; });

    spawns[key] = { pos: new THREE.Vector3(X(-1.1), fy, cz + 0.65), yaw: -Math.PI / 2 * dir };
    blockers.push({ x: cx, z: cz, r: 9 });
  }
  buildBase('A', M.wood, 'wood', M.wood);
  buildBase('B', M.sheet, 'metal', M.sheet);

  // ---------- 中央兩層水泥廢墟 ----------
  {
    const g = ZONES[2].h, fy = g + 0.15, H = 3.2, TH = 0.3;
    addBox([-6.4, g - 1.2, -6.4], [6.4, fy, 2.4], M.concrete, { surf: 'stone', size: 4 });
    const DOOR = [1.4, 2.6, 0, 2.4], WIN = [1.4, 2.6, 1.2, 2.2];
    const w = (axis, a0, a1, fixed, hole, h = H) => wallPiece(axis, a0, a1, fixed, fy, h, TH, hole, M.concrete, 'stone', 4);
    w('x', -6, -2, -6 + TH / 2, null); w('x', -2, 2, -6 + TH / 2, DOOR); w('x', 2, 6, -6 + TH / 2, WIN);
    w('x', -6, -2, 2 - TH / 2, WIN); w('x', -2, 2, 2 - TH / 2, DOOR); w('x', 2, 6, 2 - TH / 2, WIN);
    w('z', -6, -2, -6 + TH / 2, null, 1.0);    // 西牆北段塌了，剩半截可以翻過去
    w('z', -2, 2, -6 + TH / 2, WIN);
    w('z', -6, -2, 6 - TH / 2, DOOR); w('z', -2, 2, 6 - TH / 2, null);
    // 塌下來的牆角碎塊
    addBox([-6.6, fy, -5.4], [-6.0, fy + 0.5, -4.2], M.concrete, { surf: 'stone', size: 2 });
    // 樓梯：沿北牆內側往東爬，8 階每階 0.4m
    for (let i = 1; i <= 8; i++) {
      const x0 = -5.4 + (i - 1) * 0.55;
      addBox([x0, fy, -5.7], [x0 + 0.55, fy + 0.4 * i, -4.5], M.concrete, { surf: 'stone', size: 2 });
    }
    // 二樓樓板（只蓋東半邊，西半邊屋頂塌光了）+ 女兒牆
    addBox([-1, fy + H - 0.25, -6], [6, fy + H, 2], M.concrete, { surf: 'stone', size: 4 });
    const pt = fy + H, ph = 1.0;
    addBox([-1, pt, -6], [1.5, pt + ph, -5.7], M.concrete, { surf: 'stone', size: 2 });
    addBox([3, pt, -6], [6, pt + ph, -5.7], M.concrete, { surf: 'stone', size: 2 });
    addBox([-1, pt, 1.7], [6, pt + ph, 2], M.concrete, { surf: 'stone', size: 2 });
    addBox([5.7, pt, -6], [6, pt + ph, -3], M.concrete, { surf: 'stone', size: 2 });
    addBox([5.7, pt, -1], [6, pt + ph, 2], M.concrete, { surf: 'stone', size: 2 });
    // 一樓柱子 + 斷掉的鋼筋
    addBox([2.3, fy, -2.3], [2.8, fy + H - 0.25, -1.8], M.concrete, { surf: 'stone', size: 2 });
    for (let i = 0; i < 6; i++) {
      const x = -5.6 + i * 0.8;
      addBox([x, fy + H, -5.95], [x + 0.04, fy + H + 0.3 + R() * 0.5, -5.91], M.darkMetal, { collide: false, shoot: false });
    }
    // 室內箱子
    addBox([3.4, fy, 0.6], [4.3, fy + 0.9, 1.5], M.crate, { surf: 'wood', size: 0.9 });
    addBox([4.3, fy, 0.6], [5.2, fy + 0.9, 1.5], M.crate, { surf: 'wood', size: 0.9 });
    addBox([3.85, fy + 0.9, 0.6], [4.75, fy + 1.8, 1.5], M.crate, { surf: 'wood', size: 0.9 });
    addBox([4.4, fy, -5.5], [5.5, fy + 0.6, -4.8], M.military, { surf: 'metal', size: 0.8 });
    addBox([-5.2, fy, 0.3], [-4.2, fy + 0.6, 1.2], M.military, { surf: 'metal', size: 0.8 });
    // 屋頂上的軍用箱，給爬上去的人一點掩護
    addBox([2.2, pt, -1.2], [3.2, pt + 0.6, -0.4], M.military, { surf: 'metal', size: 0.8 });
    blockers.push({ x: 0, z: -2, r: 10 });
  }

  // ---------- 貨櫃（左邊生成，右邊鏡射） ----------
  function groundMin(x0, x1, z0, z1) {
    let m = Infinity;
    for (const [x, z] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1], [(x0 + x1) / 2, (z0 + z1) / 2]]) m = Math.min(m, heightAt(x, z));
    return m;
  }
  function container(x0, x1, z0, z1, y0, color) {
    const mat = std({ map: T.container, color, roughness: 0.75, metalness: 0.3 });
    addBox([x0, y0, z0], [x1, y0 + 2.6, z1], mat, { surf: 'metal', size: 2.6 });
    // 兩端門框
    const alongX = (x1 - x0) > (z1 - z0);
    const frame = std({ color: new THREE.Color(color).multiplyScalar(0.6), roughness: 0.8, metalness: 0.3 });
    if (alongX) for (const x of [x0, x1]) addBox([x - 0.06, y0, z0 - 0.04], [x + 0.06, y0 + 2.6, z1 + 0.04], frame, { collide: false, shoot: false });
    else for (const z of [z0, z1]) addBox([x0 - 0.04, y0, z - 0.06], [x1 + 0.04, y0 + 2.6, z + 0.06], frame, { collide: false, shoot: false });
  }
  function crate(x, z, y0, s = 0.9, mat = M.crate) {
    addBox([x - s / 2, y0, z - s / 2], [x + s / 2, y0 + s, z + s / 2], mat, { surf: 'wood', size: s });
  }
  for (const sx of [-1, 1]) {
    const mx = (a, b) => [Math.min(a * sx, b * sx), Math.max(a * sx, b * sx)];
    // 單層貨櫃，旁邊疊箱子可以爬上去
    { const [x0, x1] = mx(-16, -10); const y = groundMin(x0, x1, 7.8, 10.2) - 0.05;
      container(x0, x1, 7.8, 10.2, y, sx < 0 ? '#8e3426' : '#2f5578');
      const gx = heightAt(-9.45 * sx, 8.65);
      crate(-9.45 * sx, 8.65, gx); crate(-9.45 * sx, 8.65, gx + 0.9); crate(-8.55 * sx, 8.65, heightAt(-8.55 * sx, 8.65)); }
    // 兩層疊起來的貨櫃牆
    { const [x0, x1] = mx(-17.2, -14.8); const y = groundMin(x0, x1, -8, -2) - 0.05;
      container(x0, x1, -8, -2, y, sx < 0 ? '#4a6234' : '#2f5578');
      container(x0, x1, -8, -2, y + 2.6, sx < 0 ? '#9a4a22' : '#7a7a74'); }
    blockers.push({ x: -13 * sx, z: 9, r: 5 }, { x: -16 * sx, z: -5, r: 5 });

    // 廢棄車
    { const x = -21 * sx, z = -2.5, g = heightAt(x, z);
      addBox([x - 2.1, g + 0.25, z - 0.9], [x + 2.1, g + 1.1, z + 0.9], M.rustCar, { surf: 'metal', size: 2 });
      addBox([x - 0.9, g + 1.1, z - 0.8], [x + 0.8, g + 1.75, z + 0.8], M.rustCar, { surf: 'metal', size: 2 });
      addBox([x - 0.95, g + 1.18, z - 0.7], [x + 0.85, g + 1.65, z + 0.7], M.glass, { collide: false, shoot: false });
      for (const [ox, oz] of [[-1.4, -0.9], [1.4, -0.9], [-1.4, 0.9], [1.4, 0.9]]) {
        const w = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.22, 12).rotateX(Math.PI / 2), M.tire);
        w.position.set(x + ox, g + 0.3, z + oz); w.castShadow = true; scene.add(w);
      }
      blockers.push({ x, z, r: 3.5 }); }

    // 油桶
    for (const [x, z, col] of [[-8, -8.5, M.barrelBlue], [-7.3, -9.1, M.barrelYellow], [-8.4, -9.4, M.barrelBlue],
      [-4.2, 4.4, M.barrelYellow], [-20, -12, M.barrelBlue], [-26, 18, M.barrelBlue], [-26.7, 18.5, M.barrelYellow]]) {
      const bx = x * sx, g = heightAt(bx, z);
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.92, 14), col);
      m.position.set(bx, g + 0.46, z); m.castShadow = m.receiveShadow = true; m.userData.surf = 'metal';
      scene.add(m); solids.push(m);
      for (const ry of [0.2, 0.72]) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.325, 0.025, 4, 16).rotateX(Math.PI / 2), M.darkMetal);
        ring.position.set(bx, g + ry, z); scene.add(ring);
      }
      cyl(bx, z, 0.32, g - 1, g + 0.92);
    }
    // 散落木箱
    for (const [x, z, s, mil] of [[-20.5, 2.2, 0.9], [-21.4, 2.6, 0.9], [-30, -20, 0.9], [-12, 18, 1.0, 1], [-3.5, 10, 0.8]]) {
      crate(x * sx, z, heightAt(x * sx, z), s, mil ? M.military : M.crate);
    }
  }

  // ---------- 岩石、礦點 ----------
  const rockGeoCache = new Map();
  function rockGeo(seed) {
    if (rockGeoCache.has(seed)) return rockGeoCache.get(seed);
    const geo = new THREE.IcosahedronGeometry(1, 2);
    const p = geo.attributes.position, v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      const k = 1 + 0.22 * hash3(v.x * 1.6, v.y * 1.6, v.z * 1.6, seed) + 0.08 * hash3(v.x * 4, v.y * 4, v.z * 4, seed + 9);
      v.multiplyScalar(k);
      if (v.y < -0.2) v.y = -0.2 + (v.y + 0.2) * 0.3;  // 底部壓平
      p.setXYZ(i, v.x, v.y, v.z);
    }
    geo.computeVertexNormals();
    rockGeoCache.set(seed, geo);
    return geo;
  }
  function rock(x, z, r, seed, mat = M.rock) {
    const g = heightAt(x, z);
    const m = new THREE.Mesh(rockGeo(seed % 5), mat);
    m.scale.set(r, r * 0.72, r * 0.92);
    m.rotation.y = seed * 1.7;
    m.position.set(x, g - r * 0.12, z);
    m.castShadow = m.receiveShadow = true; m.userData.surf = 'stone';
    scene.add(m); solids.push(m);
    cyl(x, z, r * 0.82, g - 2, g + r * 0.62);
    blockers.push({ x, z, r: r + 1.2 });
    return m;
  }
  const VEIN = { metal: '#a05a2c', sulfur: '#d2b736', stone: '#a9a497' };
  function node(x, z, kind, seed) {
    const g = heightAt(x, z);
    rock(x, z, 0.85, seed);
    const vm = new THREE.MeshStandardMaterial({ color: VEIN[kind], roughness: kind === 'metal' ? 0.5 : 0.8, metalness: kind === 'metal' ? 0.5 : 0, flatShading: true });
    const r = rng(seed);
    for (let i = 0; i < 7; i++) {
      const a = r() * Math.PI * 2, e = 0.2 + r() * 0.9;
      const v = new THREE.Mesh(new THREE.BoxGeometry(0.22 + r() * 0.2, 0.1 + r() * 0.12, 0.2 + r() * 0.2), vm);
      v.position.set(x + Math.cos(a) * Math.cos(e) * 0.78, g - 0.1 + Math.sin(e) * 0.6, z + Math.sin(a) * Math.cos(e) * 0.72);
      v.rotation.set(r() * 3, r() * 3, r() * 3);
      scene.add(v);
    }
  }
  const ROCKS = [[-22, -15, 2.4], [-25, 12, 2.8], [-9, -17, 2.0], [-30, 4, 1.7], [-47, 10, 3.4], [-20, -32, 3.0],
    [-36, -36, 4.2], [-7, 22, 1.8], [-26, 26, 2.4], [-50, -24, 3.2], [-14, -44, 4.0], [-40, -48, 5.0], [-4, -30, 2.6]];
  ROCKS.forEach(([x, z, r], i) => { rock(x, z, r, i * 7 + 3); rock(-x, z, r, i * 7 + 3); });
  const NODES = [[-18, -22, 'stone'], [-29, -1, 'metal'], [-12, 15, 'sulfur'], [-45, -3, 'metal'], [-33, -28, 'sulfur']];
  NODES.forEach(([x, z, k], i) => { node(x, z, k, 100 + i); node(-x, z, k, 100 + i); });

  // ---------- 樹（instanced，一次畫一堆） ----------
  function blocked(x, z, pad = 0) {
    if (distRoad(x, z) < 3.2 + pad) return true;
    for (const b of blockers) if (Math.hypot(x - b.x, z - b.z) < b.r + pad) return true;
    return heightAt(x, z) < WATER_Y + 0.7;
  }
  const pines = [], birches = [];
  for (let tries = 0; tries < 900 && pines.length + birches.length < 120; tries++) {
    const x = -54 + R() * 52, z = -54 + R() * 78;
    if (z > 22) continue;
    const p = 0.25 + 0.75 * smooth(-18, -42, z) + 0.5 * smooth(40, 50, Math.abs(x));
    if (R() > p) continue;
    if (blocked(x, z, 1.5)) continue;
    let tooClose = false;
    for (const t of [...pines, ...birches]) if (Math.hypot(t.x - x, t.z - z) < 4) { tooClose = true; break; }
    if (tooClose) continue;
    const t = { x, z, s: 0.8 + R() * 0.5, rot: R() * 6 };
    (R() < 0.68 ? pines : birches).push(t, { ...t, x: -x });
  }
  {
    const trunkGeo = new THREE.CylinderGeometry(0.6, 1, 1, 7).translate(0, 0.5, 0);
    const coneGeo = new THREE.ConeGeometry(1, 1, 8).translate(0, 0.5, 0);
    const blobGeo = new THREE.IcosahedronGeometry(1, 0);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const pineTrunks = new THREE.InstancedMesh(trunkGeo, M.bark, pines.length);
    const pineCones = new THREE.InstancedMesh(coneGeo, M.pine, pines.length * 4);
    const pc = new THREE.Color();
    pines.forEach((t, i) => {
      const g = heightAt(t.x, t.z), h = 8 * t.s, r = 0.28 * t.s;
      q.setFromAxisAngle(up, t.rot);
      m4.compose(p.set(t.x, g - 0.3, t.z), q, s.set(r, h, r)); pineTrunks.setMatrixAt(i, m4);
      for (let k = 0; k < 4; k++) {
        const cr = (2.5 - k * 0.52) * t.s, ch = 2.8 * t.s;
        m4.compose(p.set(t.x, g + h * 0.28 + k * 1.45 * t.s, t.z), q, s.set(cr, ch, cr));
        pineCones.setMatrixAt(i * 4 + k, m4);
        pineCones.setColorAt(i * 4 + k, pc.setHSL(0.26 + (R() - 0.5) * 0.04, 0.3, 0.2 + k * 0.025 + R() * 0.04, THREE.SRGBColorSpace));
      }
      cyl(t.x, t.z, r + 0.05, g - 1, g + h);
    });
    const birchTrunks = new THREE.InstancedMesh(trunkGeo, M.birch, birches.length);
    const birchLeaves = new THREE.InstancedMesh(blobGeo, M.leaf, birches.length * 5);
    birches.forEach((t, i) => {
      const g = heightAt(t.x, t.z), h = 7.5 * t.s, r = 0.2 * t.s;
      q.setFromAxisAngle(up, t.rot);
      m4.compose(p.set(t.x, g - 0.3, t.z), q, s.set(r, h, r)); birchTrunks.setMatrixAt(i, m4);
      for (let k = 0; k < 5; k++) {
        const a = t.rot + k * 2.4, rr = (0.5 + (k % 3) * 0.45) * t.s;
        q.setFromAxisAngle(up, t.rot + k);
        m4.compose(p.set(t.x + Math.cos(a) * rr, g + h * (0.55 + k * 0.09), t.z + Math.sin(a) * rr), q,
          s.set((1.5 - k * 0.12) * t.s, (1.3 - k * 0.08) * t.s, (1.4 - k * 0.1) * t.s));
        birchLeaves.setMatrixAt(i * 5 + k, m4);
        birchLeaves.setColorAt(i * 5 + k, pc.setHSL(0.22 + (R() - 0.5) * 0.06, 0.3, 0.26 + R() * 0.06, THREE.SRGBColorSpace));
      }
      cyl(t.x, t.z, r + 0.05, g - 1, g + h);
    });
    for (const im of [pineTrunks, pineCones, birchTrunks, birchLeaves]) {
      im.castShadow = true; im.receiveShadow = true;
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.computeBoundingSphere();
      scene.add(im);
    }
    pineTrunks.userData.surf = birchTrunks.userData.surf = 'wood';
    solids.push(pineTrunks, birchTrunks);
  }

  // 灌木叢
  {
    const list = [];
    for (let i = 0; i < 400 && list.length < 140; i++) {
      const x = -54 + R() * 52, z = -54 + R() * 82;
      if (blocked(x, z, -0.5) || z > 30) continue;
      const s = 0.4 + R() * 0.5;
      list.push({ x, z, s }, { x: -x, z, s });
    }
    const im = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), M.leaf, list.length);
    const m4 = new THREE.Matrix4(), c = new THREE.Color(), q = new THREE.Quaternion();
    list.forEach((b, i) => {
      q.setFromEuler(new THREE.Euler(0, R() * 6, 0));
      m4.compose(new THREE.Vector3(b.x, heightAt(b.x, b.z) + b.s * 0.35, b.z), q, new THREE.Vector3(b.s * 1.3, b.s, b.s * 1.2));
      im.setMatrixAt(i, m4);
      im.setColorAt(i, c.setHSL(0.22 + (R() - 0.5) * 0.06, 0.28, 0.22 + R() * 0.06, THREE.SRGBColorSpace));
    });
    im.castShadow = true; im.receiveShadow = true;
    scene.add(im);
  }

  // 草：三片葉子一叢，vertex shader 讓它隨風擺
  {
    const blade = [];
    const cols = [];
    for (let k = 0; k < 3; k++) {
      const a = k * Math.PI / 3, ca = Math.cos(a) * 0.06, sa = Math.sin(a) * 0.06;
      const lean = (k - 1) * 0.08;
      blade.push(-ca, 0, -sa, ca, 0, sa, lean, 0.42, lean * 0.5);
      blade.push(ca, 0, sa, -ca, 0, -sa, lean, 0.42, lean * 0.5);
      cols.push(0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 1, 1, 1, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 1, 1, 1);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(blade, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 });
    const uTime = { value: 0 };
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = uTime;
      sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `
        #include <begin_vertex>
        #ifdef USE_INSTANCING
          float ph = instanceMatrix[3].x * 0.35 + instanceMatrix[3].z * 0.25;
          transformed.x += sin(uTime * 1.6 + ph) * 0.09 * position.y;
          transformed.z += cos(uTime * 1.2 + ph) * 0.05 * position.y;
        #endif`);
    };
    // 法線全部朝上，草才不會因為三角形方向一明一暗
    const n = geo.attributes.normal;
    for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
    const N = mobile ? 4500 : 14000;
    const im = new THREE.InstancedMesh(geo, mat, N);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color(), e = new THREE.Euler();
    let k = 0;
    for (let i = 0; i < N * 3 && k < N; i++) {
      const x = -56 + R() * 112, z = -54 + R() * 82;
      const y = heightAt(x, z);
      if (y < WATER_Y + 0.8 || z > 24) continue;
      if (distRoad(x, z) < 2.2) continue;
      let bad = false;
      for (const b of blockers) if (Math.hypot(x - b.x, z - b.z) < b.r * 0.55) { bad = true; break; }
      if (bad) continue;
      const s = 0.6 + R() * 0.6;
      q.setFromEuler(e.set((R() - 0.5) * 0.3, R() * 6.28, (R() - 0.5) * 0.3));
      m4.compose(new THREE.Vector3(x, y - 0.02, z), q, new THREE.Vector3(s, s * (0.7 + R() * 0.6), s));
      im.setMatrixAt(k, m4);
      im.setColorAt(k, c.setHSL(0.19 + R() * 0.06, 0.3 + R() * 0.12, 0.32 + R() * 0.12, THREE.SRGBColorSpace));
      k++;
    }
    im.count = k;
    im.receiveShadow = true;
    im.frustumCulled = false;
    scene.add(im);
    updaters.push((t) => { uTime.value = t; });
  }

  // ---------- 電線桿 ----------
  {
    const road = ROADS[0];
    const segs = [];
    let acc = 0;
    for (let i = 0; i < road.length - 1; i++) {
      const [ax, az] = road[i], [bx, bz] = road[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      segs.push({ ax, az, bx, bz, len, start: acc }); acc += len;
    }
    const tops = [];
    for (let d = 4; d < acc - 2; d += 13) {
      const sg = segs.find((s) => d >= s.start && d <= s.start + s.len) || segs[segs.length - 1];
      const t = (d - sg.start) / sg.len;
      const dx = (sg.bx - sg.ax) / sg.len, dz = (sg.bz - sg.az) / sg.len;
      const x = sg.ax + (sg.bx - sg.ax) * t - dz * 3.0, z = sg.az + (sg.bz - sg.az) * t + dx * 3.0;
      if (x > -7 && x < 7 && z < 3) continue; // 不要插進廢墟
      const g = heightAt(x, z), h = 8.5;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.15, h, 8), M.bark);
      pole.position.set(x, g + h / 2 - 0.3, z); pole.castShadow = true; pole.userData.surf = 'wood';
      scene.add(pole); solids.push(pole);
      const bar = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.14, 0.14), M.bark);
      // 橫擔要跟路垂直：box 的長軸是 local x，轉 atan2(dx,dz) 後會落在 (dz, -dx)
      bar.position.set(x, g + h - 0.8, z); bar.rotation.y = Math.atan2(dx, dz);
      bar.castShadow = true; scene.add(bar);
      cyl(x, z, 0.18, g - 1, g + h);
      const ends = [-1, 0, 1].map((k) => new THREE.Vector3(x + dz * k, g + h - 0.72, z - dx * k));
      tops.push(ends);
    }
    const wireMat = new THREE.LineBasicMaterial({ color: '#1f1f1f' });
    for (let i = 0; i < tops.length - 1; i++) {
      for (let k = 0; k < 3; k++) {
        const a = tops[i][k], b = tops[i + 1][k];
        if (a.distanceTo(b) > 25) continue;
        const pts = [];
        for (let j = 0; j <= 14; j++) {
          const t = j / 14;
          pts.push(new THREE.Vector3().lerpVectors(a, b, t).add(new THREE.Vector3(0, -0.9 * 4 * t * (1 - t), 0)));
        }
        scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), wireMat));
      }
    }
  }

  // ---------- 海灘重生點 ----------
  spawns.beach = [];
  for (const x of [-44, -32, -20, -8, 8, 20, 32, 44]) {
    const z = 29 + Math.abs(Math.sin(x)) * 3;
    spawns.beach.push({ pos: new THREE.Vector3(x, heightAt(x, z), z), yaw: 0 });
  }

  // ---------- 子彈射線 ----------
  const rc = new THREE.Raycaster();
  function rayTerrain(o, d, max) {
    const step = 0.35;
    for (let t = step; t < max; t += step) {
      const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
      if (y < heightAt(x, z)) {
        let a = t - step, b = t;
        for (let i = 0; i < 8; i++) {
          const m = (a + b) / 2;
          if (o.y + d.y * m < heightAt(o.x + d.x * m, o.z + d.z * m)) b = m; else a = m;
        }
        return b;
      }
      if (y > 60 && d.y > 0) break;
    }
    return Infinity;
  }
  function raycast(origin, dir, max) {
    rc.set(origin, dir); rc.far = max;
    const hits = rc.intersectObjects(solids, false);
    let best = null;
    if (hits.length) {
      const h = hits[0];
      const normal = (h.face && h.instanceId === undefined)
        ? h.face.normal.clone().transformDirection(h.object.matrixWorld)
        : dir.clone().negate();
      best = { dist: h.distance, point: h.point.clone(), normal, surf: h.object.userData.surf || 'stone', mesh: h.object, instanced: h.instanceId !== undefined };
    }
    const tt = rayTerrain(origin, dir, best ? best.dist : max);
    if (tt < (best ? best.dist : Infinity)) {
      const point = origin.clone().addScaledVector(dir, tt);
      best = { dist: tt, point, normal: new THREE.Vector3(0, 1, 0), surf: point.y < WATER_Y ? 'water' : 'dirt', terrain: true };
    }
    return best;
  }

  return {
    T, colliders, solids, spawns, heightAt, raycast, sun,
    update(t, dt) { for (const u of updaters) u(t, dt); },
  };
}
