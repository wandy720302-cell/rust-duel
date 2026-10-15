// 地圖：一張 rust 取樣的小島切片。
// 西邊 A 基地（木頭）、東邊 B 基地（鐵皮），中間「S PERM KET」超市 + 停車場 + 貨櫃區，
// 北邊針葉林和石灰岩壁，南邊沙灘。外圍一圈遠山，南邊是海。
// 地圖左右鏡像（樹、岩石、貨櫃都是先生成左半邊再鏡射），兩邊出生點一樣公平。
// 美術方向照 rust 官方截圖：晴天藍天積雲、強烈陽光、淡藍白色的空氣透視、黃綠色高草和野花、
// 偏橘的暖色泥土、淺灰石灰岩、橘紅鏽鐵。
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
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

// 地圖外圍：北、東、西三面隆起一圈遠山，往南一路降進海裡（只有看的，走不到）
const INNER = 120;
function farHeight(x, z) {
  const cd = Math.max(Math.abs(x), Math.abs(z));
  const n = 0.5 + 0.3 * Math.sin(x * 0.021 + 1.3) * Math.cos(z * 0.017) + 0.2 * Math.sin(x * 0.053 + z * 0.041);
  const hills = smooth(INNER, 280, cd) * (26 + 40 * n) * (1 - smooth(10, 110, z));
  return heightAt(x, z) + hills;
}

// 主幹道（柏油路）：A 基地門口 → 繞過超市停車場 → B 基地門口；另一條泥土小路往海灘
const ROADS = [
  [[-34, -12], [-25, -7], [-15, 3], [-6, 5.6], [6, 5.6], [15, 3], [25, -7], [34, -12]],
  [[0, 5.6], [0, 14], [3, 24], [2, 34]],
];
function distSeg(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const t = clamp(((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz), 0, 1);
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}
function distRoad(x, z, which = null) {
  let d = Infinity;
  ROADS.forEach((r, ri) => {
    if (which !== null && which !== ri) return;
    for (let i = 0; i < r.length - 1; i++) d = Math.min(d, distSeg(x, z, r[i][0], r[i][1], r[i + 1][0], r[i + 1][1]));
  });
  return d;
}
// 超市前的停車場
const PARKING = { x0: -9, x1: 9, z0: 2.4, z1: 9.5 };
const inParking = (x, z, pad = 0) => x > PARKING.x0 - pad && x < PARKING.x1 + pad && z > PARKING.z0 - pad && z < PARKING.z1 + pad;

// 旋轉過的盒子用：UV 照真實尺寸展開（texSize = 一張貼圖代表幾公尺）
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
// 軸對齊的盒子用：UV 直接從世界座標投影，相鄰的牆片花紋會接得起來（原木、石磚、超市外牆的色帶）
function projUV(geo, cx, cy, cz, size, vBase) {
  const pos = geo.attributes.position, nrm = geo.attributes.normal, uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + cx, y = pos.getY(i) + cy, z = pos.getZ(i) + cz;
    const ny = Math.abs(nrm.getY(i)), nx = Math.abs(nrm.getX(i));
    if (ny > 0.5) uv.setXY(i, x / size, z / size);
    else if (nx > 0.5) uv.setXY(i, z / size, (y - vBase) / size);
    else uv.setXY(i, x / size, (y - vBase) / size);
  }
}

// 同一個座標永遠回傳同一個值，讓共用頂點的岩石面不會裂開
function hash3(x, y, z, seed) {
  return Math.sin(x * 3.1 + y * 5.7 + z * 2.3 + seed) * 0.5
    + Math.sin(x * 7.3 - y * 3.9 + z * 6.1 + seed * 1.7) * 0.3
    + Math.sin(-x * 11.1 + y * 9.2 + z * 13.7 + seed * 2.3) * 0.2;
}

// opts.mobile：手機降畫質；opts.renderer：拿來烘天空的環境貼圖（金屬、水面反射天空）
export function buildWorld(scene, opts = {}) {
  const mobile = !!opts.mobile;
  const T = makeTextures();
  const colliders = [];   // 玩家碰撞：box / cyl / obox（見 physics.js）
  const solids = [];      // 子彈會打到的 mesh
  const blockers = [];    // 樹木/草避開用：{x,z,r}
  const R = rng(20261015);
  const updaters = [];

  // 天空環境光只吃六成：不然朝上的面（台階、屋頂）會被天空染得太藍
  const std = (o) => new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0, envMapIntensity: 0.6, ...o });
  const tex = (t, rx = 1, ry = 1) => { const c = t.clone(); c.repeat.set(rx, ry); c.needsUpdate = true; return c; };
  const M = {
    wood: std({ map: T.wood }),
    logs: std({ map: T.logs }),
    planks: std({ map: T.planks }),
    stone: std({ map: T.stone }),
    sheet: std({ map: T.sheet, roughness: 0.75, metalness: 0.25 }),
    concrete: std({ map: T.concrete, roughness: 0.95 }),
    facade: std({ map: T.facade, roughness: 0.85 }),
    cliff: std({ map: T.cliff, roughness: 0.95, flatShading: true }),
    crate: std({ map: T.crate }),
    military: std({ map: T.military }),
    rock: std({ map: T.rock, flatShading: true }),
    bark: std({ map: T.bark }),
    birch: std({ map: T.birch }),
    deadwood: std({ map: T.deadwood }),
    woodEnd: std({ map: T.woodEnd }),
    rope: std({ map: T.rope }),
    // 一點深綠自發光：站在樹冠底下往上看是深綠色，不是一片黑
    pine: std({ vertexColors: true, flatShading: true, roughness: 1, side: THREE.DoubleSide, emissive: '#0e1a0a' }),
    leaf: std({ color: '#ffffff', flatShading: true, roughness: 1 }),
    darkMetal: std({ color: '#2c2b29', roughness: 0.55, metalness: 0.6 }),
    whiteMetal: std({ color: '#d6d4cc', roughness: 0.6, metalness: 0.3, map: T.container }),
    glass: std({ color: '#1a1f22', roughness: 0.15, metalness: 0.6 }),
    tire: std({ color: '#151515', roughness: 1 }),
    bag: std({ color: '#5a6438' }),
    bagHead: std({ color: '#8a7f5c' }),
    glow: new THREE.MeshBasicMaterial({ color: '#ff8a2a' }),
    tc: std({ map: T.tc }),
    barrelBlue: std({ color: '#2d5a8c', roughness: 0.55, metalness: 0.4, map: T.container }),
    barrelYellow: std({ color: '#d4a92e', roughness: 0.55, metalness: 0.4, map: T.container }),
    jersey: std({ map: T.concrete, color: '#d8d4ca', roughness: 0.95 }),
    cone: std({ color: '#e0642a', roughness: 0.6 }),
    coneBand: std({ color: '#efece4', roughness: 0.5 }),
  };

  function addBox(min, max, mat, o = {}) {
    // fit：貼圖整張貼滿每一面（小家具用）；不然 UV 從世界座標投影
    const { collide = true, shoot = true, cast = true, size = 3, surf = 'wood', fit = false, vBase = 0 } = o;
    const w = max[0] - min[0], h = max[1] - min[1], d = max[2] - min[2];
    const cx = (min[0] + max[0]) / 2, cy = (min[1] + max[1]) / 2, cz = (min[2] + max[2]) / 2;
    const geo = new THREE.BoxGeometry(w, h, d);
    if (!fit) projUV(geo, cx, cy, cz, size, vBase);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(cx, cy, cz);
    m.castShadow = cast; m.receiveShadow = true;
    m.userData.surf = surf;
    scene.add(m);
    if (collide) colliders.push({ type: 'box', min: [...min], max: [...max] });
    if (shoot) solids.push(m);
    return m;
  }
  const cyl = (x, z, r, y0, y1) => colliders.push({ type: 'cyl', x, z, r, y0, y1 });
  // 可以任意轉角度的盒子（懸崖、倒木），碰撞用 obox
  function addRotBox(cx, cy, cz, w, h, d, ry, mat, o = {}) {
    const { size = 4, surf = 'stone', collide = true, tilt = 0, rough = 0 } = o;
    const geo = rough ? new THREE.BoxGeometry(w, h, d, 6, 4, 5) : new THREE.BoxGeometry(w, h, d);
    worldUV(geo, w, h, d, size);
    if (rough) {
      const p = geo.attributes.position, amp = Math.min(w, h, d) * rough;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        const n = hash3(x * 0.35 + cx, y * 0.35, z * 0.35 + cz, 7);
        const layer = 1 + 0.05 * Math.sin(y * 3.1 + cx);   // 一層一層的凹凸
        p.setXYZ(i, x * layer + n * amp, y + hash3(x * 0.5, y * 0.5 + 3, z * 0.5, 2) * amp * 0.5, z * layer + hash3(x * 0.4 + 5, y * 0.4, z * 0.4, 4) * amp);
      }
      geo.computeVertexNormals();
    }
    const m = new THREE.Mesh(geo, mat);
    m.position.set(cx, cy, cz);
    m.rotation.set(tilt, ry, tilt * 0.6);
    m.castShadow = true; m.receiveShadow = true;
    m.userData.surf = surf;
    scene.add(m); solids.push(m);
    if (collide) colliders.push({ type: 'obox', cx, cz, hx: w / 2, hz: d / 2, ax: Math.cos(ry), az: -Math.sin(ry), y0: cy - h / 2, y1: cy + h / 2 });
    return m;
  }

  // ---------- 天空、光線、霧 ----------
  // 晴天：天頂深藍、地平線淡藍白；太陽從南邊斜上方照過來
  const HORIZON = new THREE.Color('#c9dbe7');
  scene.fog = new THREE.FogExp2(HORIZON, mobile ? 0.0085 : 0.0066);
  scene.background = HORIZON;

  const sunDir = new THREE.Vector3(0.42, 0.7, 0.58).normalize();
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      top: { value: new THREE.Color('#3f74bf') },
      horizon: { value: HORIZON.clone() },
      ground: { value: new THREE.Color('#a9b9c2') },
      sunDir: { value: sunDir },
      sunColor: { value: new THREE.Color('#fff4e0') },
    },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `
      uniform vec3 top, horizon, ground, sunDir, sunColor; varying vec3 vDir;
      void main(){
        vec3 d = normalize(vDir); float h = d.y;
        vec3 col = mix(horizon, top, pow(clamp(h, 0.0, 1.0), 0.42));
        col = mix(col, horizon * 1.06, exp(-max(h, 0.0) * 16.0) * 0.55);   // 地平線那圈霧白
        col = mix(col, ground, smoothstep(0.0, -0.1, h));
        float s = max(dot(d, sunDir), 0.0);
        col += sunColor * (pow(s, 2400.0) * 60.0 + pow(s, 90.0) * 0.9 + pow(s, 7.0) * 0.22);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(2000, 32, 16), skyMat);
  sky.renderOrder = -1;
  scene.add(sky);

  // 天空烘成環境貼圖：金屬反光、水面倒影、陰影裡那層藍藍的天光都從這裡來
  let env = null;
  if (opts.renderer) {
    const pm = new THREE.PMREMGenerator(opts.renderer);
    const envScene = new THREE.Scene();
    envScene.add(new THREE.Mesh(sky.geometry, skyMat));
    const bounce = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#56532f' }));
    bounce.position.y = -20;
    envScene.add(bounce);
    env = pm.fromScene(envScene, 0.04, 0.1, 4000).texture;
    pm.dispose();
    scene.environment = env;
  }

  const hemi = new THREE.HemisphereLight('#c4d6e6', '#7a6744', 0.5);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight('#fff0d6', 3.3);
  sun.position.copy(sunDir).multiplyScalar(120);
  sun.castShadow = true;
  sun.shadow.mapSize.set(mobile ? 1024 : 2048, mobile ? 1024 : 2048);
  Object.assign(sun.shadow.camera, { left: -70, right: 70, top: 70, bottom: -70, near: 10, far: 320 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.05;
  scene.add(sun, sun.target);

  // 積雲：一圈大朵白雲，靠近地平線的比較多
  const clouds = [];
  for (let i = 0; i < 26; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({
      map: T.clouds[i % 4], color: new THREE.Color(1.2, 1.2, 1.22), transparent: true, opacity: 0.92, fog: false, depthWrite: false,
    }));
    const a = R() * Math.PI * 2, d = 700 + R() * 800;
    const w = 380 + R() * 520;
    s.position.set(Math.cos(a) * d, 170 + R() * 240 + (d - 700) * 0.12, Math.sin(a) * d);
    s.scale.set(w, w * (0.36 + R() * 0.14), 1);
    scene.add(s); clouds.push(s);
  }
  updaters.push((t, dt) => {
    for (const c of clouds) { c.position.x += dt * 2.5; if (c.position.x > 1500) c.position.x = -1500; }
  });

  // ---------- 地形 ----------
  const C = (s) => new THREE.Color(s);
  const PAL = {
    grassA: C('#5d7a2c'), grassB: C('#8a953a'), dry: C('#a89a50'), forest: C('#4c4a2c'),
    dirt: C('#8c6545'), shoulder: C('#7b5c3e'), rock: C('#a39d90'), sand: C('#d8c99f'),
    wet: C('#a08f6c'), foam: C('#eef2f0'), gravel: C('#8f877a'),
  };
  // 北邊是森林，地上是針葉跟落葉
  const forestness = (x, z) => smooth(-20, -34, z) * (0.7 + 0.3 * Math.sin(x * 0.09 + z * 0.05)) + 0.5 * smooth(44, 52, Math.abs(x)) * (1 - smooth(10, 25, z));
  function groundColor(c, x, y, z, slope, outer = false) {
    const n = 0.5 + 0.25 * Math.sin(x * 0.21 + Math.sin(z * 0.13) * 2) + 0.25 * Math.sin(z * 0.17 - x * 0.05);
    c.copy(PAL.grassA).lerp(PAL.grassB, n);
    c.lerp(PAL.dry, smooth(0.62, 0.95, 0.5 + 0.5 * Math.sin(x * 0.07 + z * 0.11)) * 0.65);
    c.lerp(PAL.forest, clamp(forestness(x, z), 0, 1) * 0.7);
    if (!outer) {
      for (const f of ZONES) {
        const k = 1 - smooth(f.r - 2, f.r + 4, Math.hypot(x - f.x, z - f.z));
        if (k > 0) c.lerp(f.r > 8 ? PAL.gravel : PAL.dirt, k * 0.9);
      }
      c.lerp(PAL.shoulder, (1 - smooth(2.6, 4.2, distRoad(x, z, 0))) * 0.9);
      c.lerp(PAL.dirt, (1 - smooth(1.2, 2.6, distRoad(x, z, 1))) * 0.9);
    }
    c.lerp(PAL.rock, smooth(0.2, 0.42, slope));
    c.lerp(PAL.sand, smooth(17, 26, z) * (1 - smooth(1.6, 3.2, y)));
    c.lerp(PAL.wet, smooth(WATER_Y + 0.7, WATER_Y + 0.1, y));
    c.lerp(PAL.foam, (1 - smooth(0.05, 0.3, Math.abs(y - (WATER_Y + 0.05)))) * smooth(15, 30, z) * 0.75);   // 浪花線
    return c;
  }
  {
    const SIZE = INNER * 2, SEG = mobile ? 150 : 200;
    const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setY(i, heightAt(pos.getX(i), pos.getZ(i)));
    geo.computeVertexNormals();
    const nrm = geo.attributes.normal;
    const col = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      groundColor(c, pos.getX(i), pos.getY(i), pos.getZ(i), 1 - nrm.getY(i));
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const terrain = new THREE.Mesh(geo, std({ vertexColors: true, map: tex(T.ground, SIZE / 4, SIZE / 4), roughness: 1 }));
    terrain.receiveShadow = true;
    scene.add(terrain);
  }
  // 外圍遠山：格子比較粗，邊界那排頂點跟內圈完全對齊，接縫才不會破
  {
    const SIZE = 1200, SEG = 120;
    const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i), cd = Math.max(Math.abs(x), Math.abs(z));
      pos.setY(i, cd < INNER - 0.01 ? heightAt(x, z) - 6 : farHeight(x, z));
    }
    geo.computeVertexNormals();
    const nrm = geo.attributes.normal;
    const col = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      groundColor(c, x, pos.getY(i), z, 1 - nrm.getY(i), true);
      c.lerp(PAL.forest, smooth(INNER, 200, Math.max(Math.abs(x), Math.abs(z))) * 0.55 * (1 - smooth(0, 60, z)));
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const outer = new THREE.Mesh(geo, std({ vertexColors: true, map: tex(T.ground, SIZE / 8, SIZE / 8), roughness: 1 }));
    outer.receiveShadow = true;
    scene.add(outer);

    // 遠山上的樹：只是一根根深綠色的錐，讓山看起來長滿針葉林
    const N = mobile ? 500 : 1400;
    const far = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 1, 6).translate(0, 0.5, 0), std({ color: '#ffffff', flatShading: true, roughness: 1 }), N);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), cc = new THREE.Color();
    let k = 0;
    for (let i = 0; i < N * 4 && k < N; i++) {
      const x = (R() - 0.5) * 900, z = -460 + R() * 560;
      const cd = Math.max(Math.abs(x), Math.abs(z));
      if (cd < INNER + 6 || z > 60) continue;
      const y = farHeight(x, z);
      if (y < WATER_Y + 2) continue;
      const s = 6 + R() * 7;
      m4.compose(new THREE.Vector3(x, y - 1, z), q, new THREE.Vector3(s * 0.32, s, s * 0.32));
      far.setMatrixAt(k, m4);
      far.setColorAt(k, cc.setHSL(0.3 + (R() - 0.5) * 0.04, 0.35, 0.14 + R() * 0.05, THREE.SRGBColorSpace));
      k++;
    }
    far.count = k;
    scene.add(far);
  }

  // 海：很大一片，藍綠色、帶波紋法線，倒映天空
  {
    const wn = T.waterNormal.clone(); wn.repeat.set(340, 340); wn.needsUpdate = true;
    const water = new THREE.Mesh(
      new THREE.PlaneGeometry(2400, 2400).rotateX(-Math.PI / 2),
      std({
        color: '#22667c', roughness: 0.16, metalness: 0.0, normalMap: wn, normalScale: new THREE.Vector2(0.16, 0.16),
        transparent: true, opacity: 0.95, envMapIntensity: 1.1,
      }),
    );
    water.position.set(0, WATER_Y, 0);
    water.receiveShadow = true;
    water.userData.dynamic = true;
    scene.add(water);
    updaters.push((t) => {
      water.position.y = WATER_Y + Math.sin(t * 0.6) * 0.04;
      wn.offset.set(t * 0.004, t * 0.0025);
    });
  }

  // ---------- 柏油路（沿主幹道拉一條緞帶貼在地形上） ----------
  function roadRibbon(pts, width, mat, lift = 0.06) {
    const path = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
      const len = Math.hypot(bx - ax, bz - az), n = Math.ceil(len / 1.0);
      for (let k = 0; k < n; k++) path.push([ax + (bx - ax) * k / n, az + (bz - az) * k / n]);
    }
    path.push(pts[pts.length - 1]);
    const verts = [], uvs = [], idx = [];
    let dist = 0;
    for (let i = 0; i < path.length; i++) {
      const p0 = path[Math.max(0, i - 1)], p1 = path[Math.min(path.length - 1, i + 1)];
      let tx = p1[0] - p0[0], tz = p1[1] - p0[1];
      const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
      if (i > 0) dist += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
      for (const side of [-1, 1]) {
        const x = path[i][0] - tz * side * width / 2, z = path[i][1] + tx * side * width / 2;
        verts.push(x, heightAt(x, z) + lift, z);
        uvs.push(side < 0 ? 0 : 1, dist / 6);
      }
      if (i > 0) { const a = (i - 1) * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, mat);
    m.receiveShadow = true;
    scene.add(m);
    return m;
  }
  const asphaltMat = std({ map: T.asphalt, roughness: 0.92, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  roadRibbon(ROADS[0], 5, asphaltMat);

  // ---------- 牆片（rust 的建築都是 3m 模組，一片牆最多一個洞） ----------
  function wallPiece(axis, a0, a1, fixed, y0, h, t, hole, mat, surf, size = 3, vBase = 0) {
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
      if (axis === 'x') addBox([a0 + u0, y0 + v0, fixed - t / 2], [a0 + u1, y0 + v1, fixed + t / 2], mat, { surf, size, vBase });
      else addBox([fixed - t / 2, y0 + v0, a0 + u0], [fixed + t / 2, y0 + v1, a0 + u1], mat, { surf, size, vBase });
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

  // 自製風力發電機：rust 基地屋頂的標準配備，生鏽的扇葉一直轉
  function windmill(x, y, z, faceYaw) {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 4, 8), M.darkMetal);
    pole.position.y = 2; g.add(pole);
    const head = new THREE.Group();
    head.position.y = 4.1; head.rotation.y = faceYaw; g.add(head);
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.35, 0.8), M.sheet); head.add(body);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.6, 0.8), M.sheet); tail.position.set(0, 0.1, 0.75); head.add(tail);
    const rotor = new THREE.Group(); rotor.position.z = -0.45; head.add(rotor);
    for (let i = 0; i < 4; i++) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.28, 1.5, 0.03), M.sheet);
      b.position.y = 0.8; b.rotation.y = 0.35;
      const arm = new THREE.Group(); arm.rotation.z = i * Math.PI / 2; arm.add(b); rotor.add(arm);
    }
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    scene.add(g);
    updaters.push((t, dt) => { rotor.rotation.z += dt * 2.2; });
  }

  // ---------- 2x1 小基地 ----------
  const spawns = {};
  function buildBase(key, wallM, surf, doorM, wallSize) {
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
      wallPiece('x', x0, x1, cz - 1.5 + TH / 2, fy, H, TH, hole, wallM, surf, wallSize);
    }
    for (const [l0, l1, hole] of [[-3, 0, WIN], [0, 3, null]]) {
      const [x0, x1] = span(l0, l1);
      wallPiece('x', x0, x1, cz + 1.5 - TH / 2, fy, H, TH, hole, wallM, surf, wallSize);
    }
    wallPiece('z', cz - 1.5, cz + 1.5, X(-3) + TH / 2 * dir, fy, H, TH, null, wallM, surf, wallSize);
    wallPiece('z', cz - 1.5, cz + 1.5, X(3) - TH / 2 * dir, fy, H, TH, DOOR, wallM, surf, wallSize);
    // 天花板 + 四角柱子
    addBox([cx - 3, fy + H, cz - 1.5], [cx + 3, fy + H + 0.22, cz + 1.5], M.planks, { surf: 'wood' });
    for (const l of [-3, 3]) for (const zz of [cz - 1.5, cz + 1.5]) {
      const x = X(l);
      addBox([x - 0.14, fy, zz - 0.14], [x + 0.14, fy + H + 0.22, zz + 0.14], key === 'A' ? M.bark : M.darkMetal, { collide: false, shoot: false, size: 1 });
    }
    // 門口台階
    { const [x0, x1] = span(3, 3.9); addBox([x0, g - 0.6, cz - 0.7], [x1, g + 0.45, cz + 0.7], M.stone, { surf: 'stone' }); }
    // 被打開的門（往外推開 90 度）
    { const [x0, x1] = span(3.02, 4.2); addBox([x0, fy, cz - 0.68], [x1, fy + 2.28, cz - 0.6], doorM, { surf: surf === 'metal' ? 'metal' : 'wood', fit: true }); }

    // 室內：TC、熔爐、大木箱、睡袋 —— rust 玩家的家具 starter pack
    { const [x0, x1] = span(-2.85, -2.3); addBox([x0, fy, cz - 1.3], [x1, fy + 1.1, cz - 0.75], M.tc, { surf: 'wood', fit: true });
      const [l0, l1] = span(-2.89, -2.26); addBox([l0, fy + 1.1, cz - 1.34], [l1, fy + 1.16, cz - 0.71], M.planks, { surf: 'wood', fit: true, collide: false }); }
    { const [x0, x1] = span(-2.85, -2.05); addBox([x0, fy, cz + 0.45], [x1, fy + 1.05, cz + 1.25], M.stone, { surf: 'stone', size: 1.2 });
      const [g0, g1] = span(-2.06, -2.03);
      addBox([g0, fy + 0.2, cz + 0.65], [g1, fy + 0.55, cz + 1.05], M.glow, { collide: false, shoot: false, cast: false });
      const [c0, c1] = span(-2.6, -2.3);
      addBox([c0, fy + 1.05, cz + 0.7], [c1, fy + 2.99, cz + 1.0], M.darkMetal, { collide: false, surf: 'metal' }); }
    { const [x0, x1] = span(-0.4, 0.9); addBox([x0, fy, cz - 1.3], [x1, fy + 0.75, cz - 0.7], M.crate, { surf: 'wood', fit: true }); }
    { const [x0, x1] = span(-2.0, -0.2); addBox([x0, fy, cz + 0.25], [x1, fy + 0.1, cz + 1.05], M.bag, { collide: false, shoot: false, cast: false });
      const [h0, h1] = span(-2.0, -1.6); addBox([h0, fy + 0.1, cz + 0.3], [h1, fy + 0.18, cz + 1.0], M.bagHead, { collide: false, shoot: false, cast: false }); }
    // 微弱的爐火光
    const fire = new THREE.PointLight('#ff8a3a', 2.2, 6, 2);
    fire.position.set(X(-1.8), fy + 0.5, cz + 0.85);
    scene.add(fire);
    updaters.push((t) => { fire.intensity = 2.0 + Math.sin(t * 13) * 0.25 + Math.sin(t * 7.3) * 0.2; });
    // 屋頂的風力發電機
    windmill(X(-2.2), fy + H + 0.22, cz - 0.8, dir > 0 ? Math.PI / 2 : -Math.PI / 2);

    spawns[key] = { pos: new THREE.Vector3(X(-1.1), fy, cz + 0.65), yaw: -Math.PI / 2 * dir };
    blockers.push({ x: cx, z: cz, r: 9 });
  }
  buildBase('A', M.logs, 'wood', M.wood, 1.5);
  buildBase('B', M.sheet, 'metal', M.sheet, 3);

  // ---------- 中央：S PERM KET 超市（兩層，可以上頂樓） ----------
  {
    const g = ZONES[2].h, fy = g + 0.15, H = 3.2, TH = 0.3;
    addBox([-6.4, g - 1.2, -6.4], [6.4, fy, 2.4], M.concrete, { surf: 'stone', size: 4 });
    const DOOR = [1.4, 2.6, 0, 2.4], WIN = [1.4, 2.6, 1.2, 2.2];
    // 外牆用超市的色帶（綠腰板、白牆、紅招牌帶），UV 從地板算起，色帶才會對齊
    const w = (axis, a0, a1, fixed, hole, h = H) => wallPiece(axis, a0, a1, fixed, fy, h, TH, hole, M.facade, 'stone', 4, fy);
    w('x', -6, -2, -6 + TH / 2, null); w('x', -2, 2, -6 + TH / 2, DOOR); w('x', 2, 6, -6 + TH / 2, WIN);
    w('x', -6, -2, 2 - TH / 2, WIN); w('x', -2, 2, 2 - TH / 2, DOOR); w('x', 2, 6, 2 - TH / 2, WIN);
    w('z', -6, -2, -6 + TH / 2, null, 1.0);    // 西牆北段塌了，剩半截可以翻過去
    w('z', -2, 2, -6 + TH / 2, WIN);
    w('z', -6, -2, 6 - TH / 2, DOOR); w('z', -2, 2, 6 - TH / 2, null);
    addBox([-6.6, fy, -5.4], [-6.0, fy + 0.5, -4.2], M.concrete, { surf: 'stone', size: 2 });
    // 樓梯：沿北牆內側往東爬，8 階每階 0.4m
    for (let i = 1; i <= 8; i++) {
      const x0 = -5.4 + (i - 1) * 0.55;
      addBox([x0, fy, -5.7], [x0 + 0.55, fy + 0.4 * i, -4.5], M.concrete, { surf: 'stone', size: 2 });
    }
    // 二樓樓板（只蓋東半邊，西半邊屋頂塌光了）+ 女兒牆
    addBox([-1, fy + H - 0.25, -6], [6, fy + H, 2], M.concrete, { surf: 'stone', size: 4 });
    const pt = fy + H, ph = 1.0;
    const par = (min, max) => addBox(min, max, M.concrete, { surf: 'stone', size: 2 });
    par([-1, pt, -6], [1.5, pt + ph, -5.7]);
    par([3, pt, -6], [6, pt + ph, -5.7]);
    par([-1, pt, 1.7], [6, pt + ph, 2]);
    par([5.7, pt, -6], [6, pt + ph, -3]);
    par([5.7, pt, -1], [6, pt + ph, 2]);
    // 一樓柱子 + 斷掉的鋼筋
    addBox([2.3, fy, -2.3], [2.8, fy + H - 0.25, -1.8], M.concrete, { surf: 'stone', size: 2 });
    for (let i = 0; i < 6; i++) {
      const x = -5.6 + i * 0.8;
      addBox([x, fy + H, -5.95], [x + 0.04, fy + H + 0.3 + R() * 0.5, -5.91], M.darkMetal, { collide: false, shoot: false });
    }
    // 店裡的白色貨架（可以躲）
    for (const [x, z0, z1] of [[-2.5, -3.6, -0.6], [0.5, -3.9, -1.3]]) {
      addBox([x - 0.25, fy, z0], [x + 0.25, fy + 1.5, z1], M.whiteMetal, { surf: 'metal', size: 1.5 });
      for (const hy of [0.5, 1.0]) addBox([x - 0.3, fy + hy, z0], [x + 0.3, fy + hy + 0.04, z1], M.whiteMetal, { collide: false, size: 1.5 });
    }
    // 室內箱子
    addBox([3.4, fy, 0.6], [4.3, fy + 0.9, 1.5], M.crate, { surf: 'wood', fit: true });
    addBox([4.3, fy, 0.6], [5.2, fy + 0.9, 1.5], M.crate, { surf: 'wood', fit: true });
    addBox([3.85, fy + 0.9, 0.6], [4.75, fy + 1.8, 1.5], M.crate, { surf: 'wood', fit: true });
    addBox([4.4, fy, -5.5], [5.5, fy + 0.6, -4.8], M.military, { surf: 'metal', fit: true });
    addBox([-5.2, fy, 0.3], [-4.2, fy + 0.6, 1.2], M.military, { surf: 'metal', fit: true });
    // 屋頂：軍用箱 + 兩台冷氣室外機，給爬上去的人一點掩護
    addBox([2.2, pt, -1.2], [3.2, pt + 0.6, -0.4], M.military, { surf: 'metal', fit: true });
    addBox([3.8, pt, -4.8], [5.2, pt + 1.0, -3.6], M.whiteMetal, { surf: 'metal', size: 1.4 });
    addBox([0.2, pt, -4.6], [1.4, pt + 0.9, -3.6], M.whiteMetal, { surf: 'metal', size: 1.4 });
    // 招牌「S PERM KET」：架在正面女兒牆上，面向停車場
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(7.6, 1.2),
      std({ map: T.sign, transparent: true, alphaTest: 0.35, side: THREE.DoubleSide, roughness: 0.7 }),
    );
    sign.position.set(2.5, pt + ph + 0.75, 1.92);
    sign.castShadow = true;
    scene.add(sign);
    addBox([-1.2, pt + ph + 0.05, 1.78], [6.2, pt + ph + 0.15, 1.88], M.darkMetal, { collide: false, shoot: false });
    for (const x of [-0.6, 2.5, 5.6]) addBox([x - 0.05, pt + ph - 0.1, 1.76], [x + 0.05, pt + ph + 1.35, 1.86], M.darkMetal, { collide: false, shoot: false });
    blockers.push({ x: 0, z: -2, r: 10 });

    // 停車場：柏油 + 白色停車格，跟著地形起伏
    {
      const W = PARKING.x1 - PARKING.x0, D = PARKING.z1 - PARKING.z0;
      const geo = new THREE.PlaneGeometry(W, D, 18, 7).rotateX(-Math.PI / 2);
      const pos = geo.attributes.position, uv = geo.attributes.uv;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i) + (PARKING.x0 + PARKING.x1) / 2, z = pos.getZ(i) + (PARKING.z0 + PARKING.z1) / 2;
        pos.setXYZ(i, x, heightAt(x, z) + 0.04, z);
        uv.setXY(i, (x - PARKING.x0) / 4, (PARKING.z1 - z) / 6.5);
      }
      geo.computeVertexNormals();
      const lot = new THREE.Mesh(geo, std({ map: T.parking, roughness: 0.92, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
      lot.receiveShadow = true;
      scene.add(lot);
      blockers.push({ x: 0, z: 6, r: 8 });
    }
    // 水泥護欄（紐澤西護欄），停車場的掩體
    const jerseyGeo = (() => {
      const s = new THREE.Shape();
      s.moveTo(-0.3, 0); s.lineTo(0.3, 0); s.lineTo(0.3, 0.12); s.lineTo(0.12, 0.3); s.lineTo(0.1, 0.82); s.lineTo(-0.1, 0.82); s.lineTo(-0.12, 0.3); s.lineTo(-0.3, 0.12); s.closePath();
      const geo = new THREE.ExtrudeGeometry(s, { depth: 3, bevelEnabled: false });
      geo.translate(0, 0, -1.5);
      return geo;
    })();
    const jersey = (x, z, alongX) => {
      const gy = heightAt(x, z);
      const m = new THREE.Mesh(jerseyGeo, M.jersey);
      m.position.set(x, gy, z);
      if (alongX) m.rotation.y = Math.PI / 2;
      m.castShadow = m.receiveShadow = true; m.userData.surf = 'stone';
      scene.add(m); solids.push(m);
      const hx = alongX ? 1.5 : 0.3, hz = alongX ? 0.3 : 1.5;
      colliders.push({ type: 'box', min: [x - hx, gy - 0.5, z - hz], max: [x + hx, gy + 0.82, z + hz] });
    };
    jersey(-6.5, 8.6, true); jersey(-2.5, 9.2, true); jersey(6.8, 8.4, true); jersey(-9.6, 4.5, false); jersey(9.6, 3.8, false);
    // 交通錐
    const coneGeo = new THREE.ConeGeometry(0.17, 0.62, 10).translate(0, 0.31, 0);
    const bandGeo = new THREE.CylinderGeometry(0.1, 0.12, 0.1, 10).translate(0, 0.33, 0);
    for (const [x, z] of [[-4.2, 3.4], [-3.4, 4.0], [3.6, 8.7], [8.2, 6.1], [-8.4, 7.4], [1.2, 3.0]]) {
      const gy = heightAt(x, z);
      const c = new THREE.Mesh(coneGeo, M.cone); c.position.set(x, gy, z); c.castShadow = true;
      const b = new THREE.Mesh(bandGeo, M.coneBand); b.position.set(x, gy, z);
      if (R() < 0.3) { c.rotation.z = Math.PI / 2; c.position.y += 0.15; b.visible = false; }   // 倒掉的
      scene.add(c, b);
    }
  }

  // ---------- 貨櫃（左邊生成，右邊鏡射） ----------
  function groundMin(x0, x1, z0, z1) {
    let m = Infinity;
    for (const [x, z] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1], [(x0 + x1) / 2, (z0 + z1) / 2]]) m = Math.min(m, heightAt(x, z));
    return m;
  }
  function container(x0, x1, z0, z1, y0, color) {
    const mat = std({ map: T.container, color, roughness: 0.7, metalness: 0.3 });
    addBox([x0, y0, z0], [x1, y0 + 2.6, z1], mat, { surf: 'metal', size: 2.6 });
    const alongX = (x1 - x0) > (z1 - z0);
    const frame = std({ color: new THREE.Color(color).multiplyScalar(0.55), roughness: 0.8, metalness: 0.3 });
    if (alongX) for (const x of [x0, x1]) addBox([x - 0.06, y0, z0 - 0.04], [x + 0.06, y0 + 2.6, z1 + 0.04], frame, { collide: false, shoot: false });
    else for (const z of [z0, z1]) addBox([x0 - 0.04, y0, z - 0.06], [x1 + 0.04, y0 + 2.6, z + 0.06], frame, { collide: false, shoot: false });
  }
  function crate(x, z, y0, s = 0.9, mat = M.crate) {
    addBox([x - s / 2, y0, z - s / 2], [x + s / 2, y0 + s, z + s / 2], mat, { surf: 'wood', fit: true });
  }
  function wreck(x, z, color) {
    const g = heightAt(x, z);
    const body = std({ map: T.container, color, roughness: 0.65, metalness: 0.35 });
    addBox([x - 2.1, g + 0.25, z - 0.9], [x + 2.1, g + 0.95, z + 0.9], body, { surf: 'metal', size: 2 });
    addBox([x - 0.9, g + 0.95, z - 0.8], [x + 0.7, g + 1.55, z + 0.8], body, { surf: 'metal', size: 2 });
    addBox([x - 0.95, g + 1.0, z - 0.72], [x + 0.75, g + 1.48, z + 0.72], M.glass, { collide: false, shoot: false });
    addBox([x - 2.15, g + 0.4, z - 0.85], [x - 2.05, g + 0.7, z + 0.85], M.darkMetal, { collide: false, shoot: false });   // 保險桿
    [[-1.4, -0.9], [1.4, -0.9], [-1.4, 0.9]].forEach(([ox, oz]) => {   // 少一顆輪子
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.22, 12).rotateX(Math.PI / 2), M.tire);
      w.position.set(x + ox, g + 0.3, z + oz); w.castShadow = true; scene.add(w);
    });
    blockers.push({ x, z, r: 3.5 });
  }
  for (const sx of [-1, 1]) {
    const mx = (a, b) => [Math.min(a * sx, b * sx), Math.max(a * sx, b * sx)];
    // 單層貨櫃，旁邊疊箱子可以爬上去
    { const [x0, x1] = mx(-16, -10); const y = groundMin(x0, x1, 7.8, 10.2) - 0.05;
      container(x0, x1, 7.8, 10.2, y, sx < 0 ? '#9c3526' : '#2f5f90');
      const gx = heightAt(-9.45 * sx, 8.65);
      crate(-9.45 * sx, 8.65, gx); crate(-9.45 * sx, 8.65, gx + 0.9); crate(-8.55 * sx, 8.65, heightAt(-8.55 * sx, 8.65)); }
    // 兩層疊起來的貨櫃牆
    { const [x0, x1] = mx(-17.2, -14.8); const y = groundMin(x0, x1, -8, -2) - 0.05;
      container(x0, x1, -8, -2, y, sx < 0 ? '#3d6b3a' : '#c48c2c');
      container(x0, x1, -8, -2, y + 2.6, sx < 0 ? '#c48c2c' : '#cac7bd'); }
    blockers.push({ x: -13 * sx, z: 9, r: 5 }, { x: -16 * sx, z: -5, r: 5 });
    wreck(-21 * sx, -2.5, sx < 0 ? '#bf9a3e' : '#8f3a2c');

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
    for (const [x, z, s, mil] of [[-20.5, 2.2, 0.9], [-21.4, 2.6, 0.9], [-30, -20, 0.9], [-12, 18, 1.0, 1], [-3.5, 12, 0.8]]) {
      crate(x * sx, z, heightAt(x * sx, z), s, mil ? M.military : M.crate);
    }
  }
  // 停車場正中間再一台廢車
  wreck(4.6, 4.0, '#c9a547');

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
  const VEIN = { metal: '#a05a2c', sulfur: '#d2b736', stone: '#b9b3a4' };
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

  // ---------- 石灰岩壁：北邊跟東西兩側的地圖邊緣，一層一層疊起來的淺灰岩 ----------
  function cliffStack(x, z, size, seed) {
    const r = rng(seed);
    const g = Math.min(heightAt(x, z), heightAt(x + 3, z), heightAt(x - 3, z), heightAt(x, z + 3), heightAt(x, z - 3));
    let y = g - 1.5, w = size * (1.4 + r() * 0.6), d = size * (0.9 + r() * 0.4);
    const ry = r() * Math.PI;
    for (let k = 0; k < 3; k++) {
      const h = size * (0.5 + r() * 0.45);
      addRotBox(x + (r() - 0.5) * size * 0.4, y + h / 2, z + (r() - 0.5) * size * 0.4, w, h, d, ry + (r() - 0.5) * 0.25, M.cliff, { size: 6, tilt: (r() - 0.5) * 0.08, rough: 0.12 });
      y += h * 0.92; w *= 0.62 + r() * 0.18; d *= 0.62 + r() * 0.18;
    }
    blockers.push({ x, z, r: size * 1.3 });
  }
  const CLIFFS = [[-48, -56, 7], [-30, -59, 8], [-12, -58, 6], [-58, -40, 7], [-60, -22, 6], [-59, -2, 5], [-57, 14, 5]];
  CLIFFS.forEach(([x, z, s], i) => { cliffStack(x, z, s, 300 + i); cliffStack(-x, z, s, 300 + i); });

  // 一團葉子：二十面體細分一次，每個頂點照位置亂推，邊緣才不會是完美的多面體
  function leafBlob(seed, amp = 0.22) {
    const geo = new THREE.IcosahedronGeometry(1, 1);
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const k = 1 + amp * hash3(x * 2.1, y * 2.1, z * 2.1, seed);
      p.setXYZ(i, x * k, y * k * 0.9, z * k);
    }
    geo.computeVertexNormals();
    return geo;
  }

  // ---------- 樹（instanced；拿石頭敲可以拿木頭，敲完會倒） ----------
  // p：雲杉（深綠層層下垂）、b：樺樹（白樹幹、秋天黃橘葉）、o：櫸樹（大片綠冠）、d：枯樹
  const TREE_WOOD = 200;
  const trees = { p: [], b: [], o: [], d: [] };
  function blocked(x, z, pad = 0) {
    if (distRoad(x, z) < 3.4 + pad || inParking(x, z, 1 + pad)) return true;
    for (const b of blockers) if (Math.hypot(x - b.x, z - b.z) < b.r + pad) return true;
    return heightAt(x, z) < WATER_Y + 0.7;
  }
  const plan = { p: [], b: [], o: [], d: [] };
  const all = [];
  for (let tries = 0; tries < 1400 && all.length < 150; tries++) {
    const x = -54 + R() * 52, z = -54 + R() * 78;
    if (z > 22) continue;
    const forest = smooth(-18, -42, z);
    const p = 0.22 + 0.78 * forest + 0.5 * smooth(40, 50, Math.abs(x));
    if (R() > p) continue;
    if (blocked(x, z, 1.5)) continue;
    if (all.some((t) => Math.hypot(t.x - x, t.z - z) < 3.6)) continue;
    const t = { x, z, s: 0.8 + R() * 0.5, rot: R() * 6 };
    const roll = R();
    const kind = roll < 0.05 ? 'd' : roll < 0.05 + lerp(0.45, 0.72, forest) ? 'p' : roll < 0.8 ? 'b' : 'o';
    plan[kind].push(t, { ...t, x: -x });
    all.push(t, { ...t, x: -x });
  }
  {
    const trunkGeo = new THREE.CylinderGeometry(0.6, 1, 1, 7).translate(0, 0.5, 0);
    // 雲杉的一層：邊緣頂點亂抖、往下垂，底部暗頂端亮
    const tierGeo = (() => {
      const geo = new THREE.ConeGeometry(1, 1, 9, 2, true).translate(0, 0.5, 0);
      const p = geo.attributes.position, cols = [];
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i), rr = Math.hypot(x, z);
        if (rr > 0.01) {
          const a = Math.atan2(z, x), k = 1 + 0.18 * Math.sin(a * 5 + 1.3) + 0.1 * Math.sin(a * 11);
          p.setXYZ(i, x * k, y - (y < 0.05 ? 0.12 * (0.5 + 0.5 * Math.sin(a * 7)) : 0), z * k);
        }
        const shade = 0.62 + 0.38 * clamp(y, 0, 1);
        cols.push(shade, shade, shade);
      }
      geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
      geo.computeVertexNormals();
      return geo;
    })();
    const blobGeo = leafBlob(11);
    const branchGeo = new THREE.CylinderGeometry(0.5, 1, 1, 5).translate(0, 0.5, 0);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), e = new THREE.Euler();
    const up = new THREE.Vector3(0, 1, 0);
    const pc = new THREE.Color();
    const meshes = [];
    const IM = (geo, mat, n) => { const im = new THREE.InstancedMesh(geo, mat, Math.max(1, n)); meshes.push(im); return im; };
    const reg = (kind, i, t, g, parts) => {
      trees[kind][i] = { kind, i, x: t.x, z: t.z, wood: TREE_WOOD, alive: true, col: colliders[colliders.length - 1],
        parts, fall: 0, dir: [1, 0], base: new THREE.Vector3(t.x, g, t.z) };
    };

    // 雲杉
    const TIERS = 6;
    const pineTrunks = IM(trunkGeo, M.bark, plan.p.length), pineTiers = IM(tierGeo, M.pine, plan.p.length * TIERS);
    plan.p.forEach((t, i) => {
      const g = heightAt(t.x, t.z), h = 9 * t.s, r = 0.3 * t.s;
      q.setFromAxisAngle(up, t.rot);
      m4.compose(p.set(t.x, g - 0.3, t.z), q, s.set(r, h, r)); pineTrunks.setMatrixAt(i, m4);
      const hue = 0.3 + (R() - 0.5) * 0.05;
      for (let k = 0; k < TIERS; k++) {
        const cr = (2.7 - k * 0.38) * t.s, ch = 2.4 * t.s;
        q.setFromAxisAngle(up, t.rot + k * 0.9);
        // 最低一層要比人的頭高，不然走進林子鏡頭會埋在樹冠裡
        m4.compose(p.set(t.x, g + Math.max(2.6, h * 0.24) + k * 1.12 * t.s, t.z), q, s.set(cr, ch, cr));
        pineTiers.setMatrixAt(i * TIERS + k, m4);
        pineTiers.setColorAt(i * TIERS + k, pc.setHSL(hue, 0.42, 0.2 + k * 0.012 + R() * 0.03, THREE.SRGBColorSpace));
      }
      cyl(t.x, t.z, r + 0.05, g - 1, g + h);
      reg('p', i, t, g, [[pineTrunks, i], ...Array.from({ length: TIERS }, (_, k) => [pineTiers, i * TIERS + k])]);
    });

    // 樺樹：秋天，一棵樹大致一種色調（綠、金黃、橘）
    const AUTUMN = [[0.2, 0.42, 0.34], [0.13, 0.62, 0.5], [0.11, 0.62, 0.52], [0.07, 0.6, 0.45]];
    const birchTrunks = IM(trunkGeo, M.birch, plan.b.length), birchLeaves = IM(blobGeo, M.leaf, plan.b.length * 6);
    plan.b.forEach((t, i) => {
      const g = heightAt(t.x, t.z), h = 7.5 * t.s, r = 0.19 * t.s;
      q.setFromAxisAngle(up, t.rot);
      m4.compose(p.set(t.x, g - 0.3, t.z), q, s.set(r, h, r)); birchTrunks.setMatrixAt(i, m4);
      const [hh, ss, ll] = AUTUMN[Math.floor(R() * AUTUMN.length)];
      for (let k = 0; k < 6; k++) {
        const a = t.rot + k * 2.4, rr = (0.45 + (k % 3) * 0.4) * t.s;
        q.setFromEuler(e.set(R() * 0.6, t.rot + k, R() * 0.6));
        m4.compose(p.set(t.x + Math.cos(a) * rr, g + h * (0.52 + k * 0.08), t.z + Math.sin(a) * rr), q,
          s.set((1.35 - k * 0.1) * t.s, (1.15 - k * 0.07) * t.s, (1.25 - k * 0.08) * t.s));
        birchLeaves.setMatrixAt(i * 6 + k, m4);
        birchLeaves.setColorAt(i * 6 + k, pc.setHSL(hh + (R() - 0.5) * 0.03, ss, ll * (0.85 + R() * 0.25), THREE.SRGBColorSpace));
      }
      cyl(t.x, t.z, r + 0.05, g - 1, g + h);
      reg('b', i, t, g, [[birchTrunks, i], ...Array.from({ length: 6 }, (_, k) => [birchLeaves, i * 6 + k])]);
    });

    // 櫸樹：粗樹幹、大片綠樹冠
    const oakTrunks = IM(trunkGeo, M.bark, plan.o.length), oakLeaves = IM(blobGeo, M.leaf, plan.o.length * 7);
    plan.o.forEach((t, i) => {
      const g = heightAt(t.x, t.z), h = 6.5 * t.s, r = 0.32 * t.s;
      q.setFromAxisAngle(up, t.rot);
      m4.compose(p.set(t.x, g - 0.3, t.z), q, s.set(r, h, r)); oakTrunks.setMatrixAt(i, m4);
      for (let k = 0; k < 7; k++) {
        const a = t.rot + k * 2.2, rr = (k === 0 ? 0 : 1.1 + (k % 2) * 0.5) * t.s;
        q.setFromEuler(e.set(R() * 0.5, t.rot + k, R() * 0.5));
        m4.compose(p.set(t.x + Math.cos(a) * rr, g + h * (0.75 + (k % 3) * 0.12), t.z + Math.sin(a) * rr), q,
          s.set((1.9 - (k % 3) * 0.2) * t.s, (1.5 - (k % 3) * 0.15) * t.s, (1.8 - (k % 3) * 0.2) * t.s));
        oakLeaves.setMatrixAt(i * 7 + k, m4);
        oakLeaves.setColorAt(i * 7 + k, pc.setHSL(0.23 + (R() - 0.5) * 0.04, 0.45, 0.27 + R() * 0.07, THREE.SRGBColorSpace));
      }
      cyl(t.x, t.z, r + 0.05, g - 1, g + h);
      reg('o', i, t, g, [[oakTrunks, i], ...Array.from({ length: 7 }, (_, k) => [oakLeaves, i * 7 + k])]);
    });

    // 枯樹：灰白樹幹 + 幾根斷枝
    const deadTrunks = IM(trunkGeo, M.deadwood, plan.d.length), deadBranches = IM(branchGeo, M.deadwood, plan.d.length * 4);
    plan.d.forEach((t, i) => {
      const g = heightAt(t.x, t.z), h = 8 * t.s, r = 0.24 * t.s;
      q.setFromAxisAngle(up, t.rot);
      m4.compose(p.set(t.x, g - 0.3, t.z), q, s.set(r, h, r)); deadTrunks.setMatrixAt(i, m4);
      for (let k = 0; k < 4; k++) {
        const a = t.rot + k * 1.9;
        q.setFromEuler(e.set(Math.cos(a) * 1.0, 0, Math.sin(a) * 1.0 + 0.4));
        m4.compose(p.set(t.x, g + h * (0.45 + k * 0.12), t.z), q, s.set(0.06 * t.s, (1.6 - k * 0.25) * t.s, 0.06 * t.s));
        deadBranches.setMatrixAt(i * 4 + k, m4);
      }
      cyl(t.x, t.z, r + 0.05, g - 1, g + h);
      reg('d', i, t, g, [[deadTrunks, i], ...Array.from({ length: 4 }, (_, k) => [deadBranches, i * 4 + k])]);
    });

    for (const im of meshes) {
      im.castShadow = true; im.receiveShadow = true;
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.computeBoundingSphere();
      scene.add(im);
    }
    for (const [im, kind] of [[pineTrunks, 'p'], [birchTrunks, 'b'], [oakTrunks, 'o'], [deadTrunks, 'd']]) {
      im.userData.surf = 'wood'; im.userData.treeKind = kind;
      solids.push(im);
    }
    // 記住原始矩陣，倒下動畫跟重置都從這裡算
    for (const kind of Object.keys(trees)) for (const t of trees[kind]) {
      t.parts = t.parts.map(([im, idx]) => { const m = new THREE.Matrix4(); im.getMatrixAt(idx, m); return [im, idx, m]; });
    }
  }

  // ---------- 倒木：躺在林子裡的大樹幹，可以躲、可以跳過去 ----------
  {
    const logMats = [M.bark, M.woodEnd, M.woodEnd];
    let n = 0;
    for (let i = 0; i < 300 && n < 6; i++) {
      const x = -50 + R() * 44, z = -50 + R() * 40;
      if (blocked(x, z, 1)) continue;
      const len = 5 + R() * 3, r = 0.36 + R() * 0.12, ry = R() * Math.PI;
      for (const sx of [-1, 1]) {
        const lx = x * sx, lry = sx < 0 ? ry : Math.PI - ry;
        const g = Math.min(heightAt(lx, z), heightAt(lx + Math.cos(lry) * len / 2, z - Math.sin(lry) * len / 2), heightAt(lx - Math.cos(lry) * len / 2, z + Math.sin(lry) * len / 2));
        const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.1, len, 10), logMats);
        m.rotation.set(0, lry, Math.PI / 2);
        m.position.set(lx, g + r * 0.8, z);
        m.castShadow = m.receiveShadow = true; m.userData.surf = 'wood';
        scene.add(m); solids.push(m);
        colliders.push({ type: 'obox', cx: lx, cz: z, hx: len / 2, hz: r, ax: Math.cos(lry), az: -Math.sin(lry), y0: g - 0.5, y1: g + r * 1.8 });
        blockers.push({ x: lx, z, r: len / 2 });
      }
      n++;
    }
  }

  // ---------- 灌木叢（有幾叢已經轉紅轉橘） ----------
  {
    const list = [];
    for (let i = 0; i < 500 && list.length < 180; i++) {
      const x = -54 + R() * 52, z = -54 + R() * 82;
      if (blocked(x, z, -0.5) || z > 30) continue;
      const s = 0.4 + R() * 0.55;
      list.push({ x, z, s }, { x: -x, z, s });
    }
    const parts = [[0, 0, 0, 1], [0.55, -0.1, 0.2, 0.7], [-0.45, -0.15, -0.3, 0.65]].map(([x, y, z, s], i) => {
      const g = leafBlob(40 + i, 0.28); g.scale(s, s, s); g.translate(x, y, z); return g;
    });
    const geo = (() => {
      // 自己把三團接起來（不想為了這個多載一個工具模組）
      const out = new THREE.BufferGeometry(), pos = [], nrm = [];
      for (const g of parts) { const ng = g.index ? g.toNonIndexed() : g; pos.push(...ng.attributes.position.array); nrm.push(...ng.attributes.normal.array); }
      out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      out.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
      return out;
    })();
    const im = new THREE.InstancedMesh(geo, M.leaf, list.length);
    const m4 = new THREE.Matrix4(), c = new THREE.Color(), q = new THREE.Quaternion();
    list.forEach((b, i) => {
      q.setFromEuler(new THREE.Euler(0, R() * 6, 0));
      m4.compose(new THREE.Vector3(b.x, heightAt(b.x, b.z) + b.s * 0.3, b.z), q, new THREE.Vector3(b.s * 1.1, b.s * 0.85, b.s));
      im.setMatrixAt(i, m4);
      if (R() < 0.22) im.setColorAt(i, c.setHSL(0.05 + R() * 0.05, 0.6, 0.36 + R() * 0.08, THREE.SRGBColorSpace));
      else im.setColorAt(i, c.setHSL(0.22 + (R() - 0.5) * 0.05, 0.48, 0.3 + R() * 0.08, THREE.SRGBColorSpace));
    });
    im.castShadow = true; im.receiveShadow = true;
    scene.add(im);
  }

  // 葉片只做一面三角形、用雙面畫；背面的法線不翻（法線全都設成朝上），背面才不會黑掉
  const grassTime = { value: 0 };
  const windify = (mat, amp = 0.1) => {
    mat.side = THREE.DoubleSide;
    mat.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>',
        '#include <normal_fragment_begin>\n  normal = normalize( vNormal );\n  nonPerturbedNormal = normal;');
      sh.uniforms.uTime = grassTime;
      sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `
        #include <begin_vertex>
        #ifdef USE_INSTANCING
          float ph = instanceMatrix[3].x * 0.35 + instanceMatrix[3].z * 0.25;
          float gust = 0.6 + 0.4 * sin(uTime * 0.7 + instanceMatrix[3].x * 0.05);
          transformed.x += sin(uTime * 1.6 + ph) * ${amp.toFixed(3)} * position.y * gust;
          transformed.z += cos(uTime * 1.2 + ph) * ${(amp * 0.55).toFixed(3)} * position.y * gust;
        #endif`);
    };
  };
  // ---------- 蕨類：林下一叢一叢的 ----------
  {
    const fronds = [];
    for (let k = 0; k < 7; k++) {
      const a = k / 7 * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a), w = 0.07;
      // 一片葉子：根部 → 中段往外拱起 → 尖端垂下
      const P = (d, h, side) => [ca * d - sa * side, h, sa * d + ca * side];
      const b0 = P(0, 0, -w * 0.3), b1 = P(0, 0, w * 0.3), m0 = P(0.35, 0.32, -w), m1 = P(0.35, 0.32, w), tip = P(0.75, 0.12, 0);
      for (const tri of [[b0, b1, m1], [b0, m1, m0], [m0, m1, tip]]) {
        for (const v of tri) fronds.push(...v);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(fronds, 3));
    // 越往外越亮
    const pos = geo.attributes.position, col = [];
    for (let i = 0; i < pos.count; i++) { const d = Math.hypot(pos.getX(i), pos.getZ(i)); const v = 0.45 + d * 0.7; col.push(v, v, v); }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.computeVertexNormals();
    const n = geo.attributes.normal; for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
    const N = mobile ? 220 : 700;
    const fernMat = std({ vertexColors: true, roughness: 1 });
    windify(fernMat, 0.05);
    const im = new THREE.InstancedMesh(geo, fernMat, N);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color();
    let k = 0;
    for (let i = 0; i < N * 6 && k < N; i++) {
      const x = -54 + R() * 108, z = -54 + R() * 70;
      if (forestness(x, z) < 0.35 && R() > 0.15) continue;
      if (blocked(x, z, -0.8)) continue;
      const s = 0.8 + R() * 0.8;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), R() * 6.28);
      m4.compose(new THREE.Vector3(x, heightAt(x, z) - 0.02, z), q, new THREE.Vector3(s, s * (0.8 + R() * 0.4), s));
      im.setMatrixAt(k, m4);
      im.setColorAt(k, c.setHSL(0.24 + (R() - 0.5) * 0.04, 0.5, 0.26 + R() * 0.06, THREE.SRGBColorSpace));
      k++;
    }
    im.count = k;
    im.receiveShadow = true;
    scene.add(im);
  }

  // ---------- 草：又高又密的黃綠色草，vertex shader 讓它隨風擺 ----------
  {
    const pts = [], cols = [];
    const BL = 5;
    for (let k = 0; k < BL; k++) {
      const a = k / BL * Math.PI * 2 + 0.3, ca = Math.cos(a), sa = Math.sin(a);
      const w = 0.045, lean = 0.12 + (k % 2) * 0.1;
      const off = [Math.cos(a + 1.7) * 0.06, Math.sin(a + 1.7) * 0.06];
      const V = (side, h, out) => [off[0] + ca * out - sa * side, h, off[1] + sa * out + ca * side];
      const b0 = V(-w, 0, 0), b1 = V(w, 0, 0), m0 = V(-w * 0.7, 0.45, lean * 0.4), m1 = V(w * 0.7, 0.45, lean * 0.4), tip = V(0, 0.82, lean);
      for (const [tri, sh] of [[[b0, b1, m1], [0.32, 0.32, 0.7]], [[b0, m1, m0], [0.32, 0.7, 0.7]], [[m0, m1, tip], [0.7, 0.7, 1]]]) {
        tri.forEach((v) => pts.push(...v)); sh.forEach((v) => cols.push(v, v, v));
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    geo.computeVertexNormals();
    // 法線全部朝上，草才不會因為三角形方向一明一暗
    const nn = geo.attributes.normal; for (let i = 0; i < nn.count; i++) nn.setXYZ(i, 0, 1, 0);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 });
    windify(mat, 0.1);
    const N = mobile ? 5000 : 24000;
    const im = new THREE.InstancedMesh(geo, mat, N);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color(), e = new THREE.Euler();
    let k = 0;
    for (let i = 0; i < N * 3 && k < N; i++) {
      const x = -56 + R() * 112, z = -54 + R() * 82;
      const y = heightAt(x, z);
      if (y < WATER_Y + 0.6) continue;
      const beach = smooth(18, 26, z);
      if (R() < beach * 0.9) continue;   // 沙灘上只剩稀疏的海濱草
      const dr = distRoad(x, z);
      if (dr < 2.4 || inParking(x, z)) continue;
      let bad = false;
      for (const b of blockers) if (Math.hypot(x - b.x, z - b.z) < b.r * 0.5) { bad = true; break; }
      if (bad) continue;
      // 空曠的草原長得最高，靠近路跟林下矮一點
      const tall = (0.7 + 0.5 * R()) * (1 - 0.4 * (1 - smooth(2.4, 7, dr))) * (1 - 0.35 * clamp(forestness(x, z), 0, 1)) * (1 - 0.5 * beach);
      const s = 0.75 + R() * 0.45;
      q.setFromEuler(e.set((R() - 0.5) * 0.25, R() * 6.28, (R() - 0.5) * 0.25));
      m4.compose(new THREE.Vector3(x, y - 0.03, z), q, new THREE.Vector3(s, tall, s));
      im.setMatrixAt(k, m4);
      const dry = R() < 0.25 + 0.4 * beach;
      im.setColorAt(k, dry ? c.setHSL(0.13 + R() * 0.04, 0.45, 0.5 + R() * 0.1, THREE.SRGBColorSpace)
        : c.setHSL(0.18 + R() * 0.06, 0.48 + R() * 0.12, 0.38 + R() * 0.12, THREE.SRGBColorSpace));
      k++;
    }
    im.count = k;
    im.receiveShadow = true;
    im.frustumCulled = false;
    scene.add(im);
    updaters.push((t) => { grassTime.value = t; });
  }

  // ---------- 野花：紅色罌粟、黃花、白花、藍紫花，一小片一小片長 ----------
  {
    const pts = [], cols = [];
    const stemH = 0.55;
    // 莖
    pts.push(-0.008, 0, 0, 0.008, 0, 0, 0, stemH, 0); for (let j = 0; j < 3; j++) cols.push(0.25, 0.4, 0.15);
    // 花：朝上的小花盤，五片花瓣
    const P = (a, r, dy = 0) => [Math.cos(a) * r, stemH + dy, Math.sin(a) * r];
    const ctr = [0, stemH - 0.005, 0];
    for (let k = 0; k < 5; k++) {
      const a = k / 5 * Math.PI * 2;
      for (const tri of [[ctr, P(a - 0.38, 0.024), P(a, 0.065, 0.014)], [ctr, P(a, 0.065, 0.014), P(a + 0.38, 0.024)]]) {
        tri.forEach((p) => pts.push(...p));
        for (let j = 0; j < 3; j++) cols.push(1, 1, 1);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    geo.computeVertexNormals();
    const nn = geo.attributes.normal; for (let i = 0; i < nn.count; i++) nn.setXYZ(i, 0, 1, 0);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });
    windify(mat, 0.08);
    const FLOWERS = ['#b8301c', '#b8301c', '#d6b432', '#dcd8cc', '#6a5cc4'];
    const N = mobile ? 800 : 3600;
    const im = new THREE.InstancedMesh(geo, mat, N);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color();
    let k = 0;
    for (let patch = 0; patch < 500 && k < N; patch++) {
      const px = -52 + R() * 104, pz = -40 + R() * 62;
      if (forestness(px, pz) > 0.5 || blocked(px, pz, 0)) continue;
      const color = FLOWERS[Math.floor(R() * FLOWERS.length)];
      const cnt = 6 + Math.floor(R() * 14);
      for (let j = 0; j < cnt && k < N; j++) {
        const x = px + (R() - 0.5) * 4, z = pz + (R() - 0.5) * 4;
        if (distRoad(x, z) < 2.5 || inParking(x, z)) continue;
        const s = 0.75 + R() * 0.5;
        q.setFromEuler(new THREE.Euler((R() - 0.5) * 0.9, R() * 6.28, (R() - 0.5) * 0.9));
        m4.compose(new THREE.Vector3(x, heightAt(x, z) - 0.02, z), q, new THREE.Vector3(s, s * (0.8 + R() * 0.5), s));
        im.setMatrixAt(k, m4);
        im.setColorAt(k, c.set(color));
        k++;
      }
    }
    im.count = k;
    im.frustumCulled = false;
    scene.add(im);
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
      const x = sg.ax + (sg.bx - sg.ax) * t - dz * 3.6, z = sg.az + (sg.bz - sg.az) * t + dx * 3.6;
      if (x > -7 && x < 7 && z < 3) continue; // 不要插進超市
      if (inParking(x, z, 0.5)) continue;
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
    const segPts = [];
    for (let i = 0; i < tops.length - 1; i++) {
      for (let k = 0; k < 3; k++) {
        const a = tops[i][k], b = tops[i + 1][k];
        if (a.distanceTo(b) > 25) continue;
        let prev = a.clone();
        for (let j = 1; j <= 14; j++) {
          const t = j / 14;
          const cur = new THREE.Vector3().lerpVectors(a, b, t).add(new THREE.Vector3(0, -0.9 * 4 * t * (1 - t), 0));
          segPts.push(prev, cur); prev = cur;
        }
      }
    }
    scene.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(segPts), new THREE.LineBasicMaterial({ color: '#1f1f1f' })));
  }

  // ---------- 海灘重生點 ----------
  spawns.beach = [];
  for (const x of [-44, -32, -20, -8, 8, 20, 32, 44]) {
    const z = 29 + Math.abs(Math.sin(x)) * 3;
    spawns.beach.push({ pos: new THREE.Vector3(x, heightAt(x, z), z), yaw: 0 });
  }

  // ---------- 樹木 API ----------
  // 砍掉的樹：縮到很小丟到地底（縮成 0 會讓矩陣不可逆，射線檢測會算出怪東西）
  const ZERO = new THREE.Matrix4().compose(new THREE.Vector3(0, -9999, 0), new THREE.Quaternion(), new THREE.Vector3(1e-3, 1e-3, 1e-3));
  const fm = new THREE.Matrix4(), fr = new THREE.Matrix4(), ft = new THREE.Matrix4(), fti = new THREE.Matrix4();
  const fAxis = new THREE.Vector3();
  const falling = new Set();
  function setTreeMatrices(t, angle) {
    const touched = new Set();
    for (const [im, idx, m] of t.parts) {
      if (angle === null) im.setMatrixAt(idx, ZERO);
      else if (angle === 0) im.setMatrixAt(idx, m);
      else {
        // 以樹根為支點往 dir 方向倒
        ft.makeTranslation(t.base.x, t.base.y, t.base.z);
        fti.makeTranslation(-t.base.x, -t.base.y, -t.base.z);
        fr.makeRotationAxis(fAxis.set(t.dir[1], 0, -t.dir[0]), angle);
        fm.copy(ft).multiply(fr).multiply(fti).multiply(m);
        im.setMatrixAt(idx, fm);
      }
      touched.add(im);
    }
    for (const im of touched) im.instanceMatrix.needsUpdate = true;
  }
  function fellTree(t, dx = 1, dz = 0) {
    if (!t.alive) return;
    t.alive = false; t.wood = 0;
    const d = Math.hypot(dx, dz) || 1;
    t.dir = [dx / d, dz / d];
    t.fall = 0;
    const k = colliders.indexOf(t.col);
    if (k >= 0) colliders.splice(k, 1);
    falling.add(t);
  }
  updaters.push((time, dt) => {
    for (const t of falling) {
      t.fall += dt;
      const a = Math.min(1, t.fall / 1.6);
      if (t.fall > 3.2) { setTreeMatrices(t, null); falling.delete(t); }
      else setTreeMatrices(t, a * a * Math.PI / 2 * 0.97);
    }
  });
  const treeApi = {
    MAX: TREE_WOOD,
    fromHit(hit) {
      const kind = hit?.mesh?.userData.treeKind;
      if (!kind || hit.instanceId === undefined) return null;
      const t = trees[kind][hit.instanceId];
      return t && t.alive ? t : null;
    },
    get(kind, i) { return trees[kind]?.[i] || null; },
    // 敲一下：回傳實際拿到多少木頭（樹剩不夠就只給剩的）
    chop(t, amt) {
      if (!t.alive) return 0;
      const got = Math.min(amt, t.wood);
      t.wood -= got;
      return got;
    },
    fell: fellTree,
    reset() {
      falling.clear();
      for (const kind of Object.keys(trees)) for (const t of trees[kind]) {
        t.wood = TREE_WOOD;
        if (!t.alive) { t.alive = true; colliders.push(t.col); }
        setTreeMatrices(t, 0);
      }
    },
  };

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
      best = { dist: h.distance, point: h.point.clone(), normal, surf: h.object.userData.surf || 'stone', mesh: h.object, instanced: h.instanceId !== undefined, instanceId: h.instanceId };
    }
    const tt = rayTerrain(origin, dir, best ? best.dist : max);
    if (tt < (best ? best.dist : Infinity)) {
      const point = origin.clone().addScaledVector(dir, tt);
      best = { dist: tt, point, normal: new THREE.Vector3(0, 1, 0), surf: point.y < WATER_Y ? 'water' : 'dirt', terrain: true };
    }
    return best;
  }

  // ---------- 靜態合批 ----------
  // 幾百個箱子、牆片、石頭照材質合成幾十個大 mesh 來畫。原本的 mesh 留著給子彈射線用，只是不畫出來
  {
    const groups = new Map();
    for (const m of [...scene.children]) {
      if (!m.isMesh || m.isInstancedMesh || m.userData.dynamic || Array.isArray(m.material) || m.material.transparent) continue;
      m.updateMatrixWorld(true);
      let g = m.geometry.clone().applyMatrix4(m.matrixWorld);
      if (g.index) g = g.toNonIndexed();
      const attrs = Object.keys(g.attributes).sort().join(',');
      const key = `${m.material.uuid}|${attrs}|${m.castShadow ? 1 : 0}`;
      if (!groups.has(key)) groups.set(key, { mat: m.material, cast: m.castShadow, geos: [] });
      groups.get(key).geos.push(g);
      if (solids.includes(m)) m.visible = false; else scene.remove(m);
    }
    for (const { mat, cast, geos } of groups.values()) {
      const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos);
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = cast; mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      scene.add(mesh);
    }
  }

  return {
    T, colliders, solids, spawns, heightAt, raycast, sun, sunDir, env, scene, trees: treeApi,
    update(t, dt) { for (const u of updaters) u(t, dt); },
  };
}
