// 全部貼圖都用 canvas 現畫，不靠外部圖檔：GitHub Pages 上零資產也能跑。
// 顏色和花紋是照 rust 官方截圖抓的：橫疊原木的木頭等級、白灰泥砌石、橘紅色鏽鐵皮、
// 淺灰石灰岩層、「S PERM KET」超市的紅帶綠牆。
import * as THREE from 'three';

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function makeWH(w, h, draw, seed = 1, { srgb = true, repeat = true } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  draw(g, w, rng(seed), h);
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
const make = (size, draw, seed, opts) => makeWH(size, size, draw, seed, opts);

// 隨機小點點，讓表面有髒污顆粒感
function grit(g, s, r, n, dark = 0.18, light = 0.08, h = s) {
  for (let i = 0; i < n; i++) {
    const isDark = r() < 0.6;
    g.fillStyle = isDark ? `rgba(0,0,0,${r() * dark})` : `rgba(255,255,255,${r() * light})`;
    const w = 1 + r() * 2.5;
    g.fillRect(r() * s, r() * h, w, w);
  }
}

function blotch(g, x, y, rad, color, end = 'rgba(0,0,0,0)') {
  const gr = g.createRadialGradient(x, y, 0, x, y, rad);
  gr.addColorStop(0, color);
  gr.addColorStop(1, end);
  g.fillStyle = gr;
  g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
}

// 往下流的污漬（雨水、鏽水）
function streaks(g, s, r, n, rgb, maxA = 0.35, len = 90, h = s) {
  for (let i = 0; i < n; i++) {
    const x = r() * s, y = r() * h, l = len * (0.4 + r());
    const gr = g.createLinearGradient(0, y, 0, y + l);
    gr.addColorStop(0, `rgba(${rgb},${maxA * (0.4 + r() * 0.6)})`);
    gr.addColorStop(1, `rgba(${rgb},0)`);
    g.fillStyle = gr;
    g.fillRect(x, y, 1 + r() * 4, l);
  }
}

export function makeTextures() {
  const T = {};

  // 直向木板 + 橫樑 + 釘子（木門、木頭雜物用）
  T.wood = make(256, (g, s, r) => {
    g.fillStyle = '#5a4430'; g.fillRect(0, 0, s, s);
    const n = 4, w = s / n;
    for (let i = 0; i < n; i++) {
      const k = (r() - 0.5) * 26;
      g.fillStyle = `rgb(${112 + k},${88 + k * 0.8},${62 + k * 0.6})`;
      g.fillRect(i * w + 2, 0, w - 4, s);
      for (let j = 0; j < 16; j++) {
        g.strokeStyle = `rgba(40,28,16,${0.12 + r() * 0.25})`;
        g.lineWidth = 0.6 + r() * 1.2;
        g.beginPath();
        let x = i * w + 4 + r() * (w - 8);
        g.moveTo(x, 0);
        for (let y = 0; y <= s; y += 12) { x += (r() - 0.5) * 1.6; g.lineTo(x, y); }
        g.stroke();
      }
      g.fillStyle = '#21170e'; g.fillRect(i * w, 0, 3, s);
    }
    g.fillStyle = '#3c3a36'; g.fillRect(0, s * 0.2, s, s * 0.05); g.fillRect(0, s * 0.74, s, s * 0.05);   // 鐵條
    g.fillStyle = '#1e1e1c';
    for (let i = 0; i < n; i++) { g.fillRect(i * w + w * 0.5, s * 0.215, 4, 4); g.fillRect(i * w + w * 0.5, s * 0.755, 4, 4); }
    const gr = g.createLinearGradient(0, s * 0.75, 0, s);
    gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(20,14,6,0.4)');
    g.fillStyle = gr; g.fillRect(0, 0, s, s);
    grit(g, s, r, 900);
  }, 11);

  // 木頭等級的牆：橫向疊起來的原木（rust 截圖裡那種小木屋），每根約 25 公分高
  T.logs = make(256, (g, s, r) => {
    const n = 6, h = s / n;
    for (let i = 0; i < n; i++) {
      const y = i * h, k = (r() - 0.5) * 22;
      const base = [118 + k, 98 + k * 0.85, 76 + k * 0.7];
      // 圓木：上亮下暗
      const gr = g.createLinearGradient(0, y, 0, y + h);
      gr.addColorStop(0, `rgb(${base[0] * 0.78},${base[1] * 0.78},${base[2] * 0.78})`);
      gr.addColorStop(0.3, `rgb(${base[0] * 1.08},${base[1] * 1.08},${base[2] * 1.08})`);
      gr.addColorStop(0.75, `rgb(${base[0] * 0.92},${base[1] * 0.92},${base[2] * 0.92})`);
      gr.addColorStop(1, `rgb(${base[0] * 0.5},${base[1] * 0.5},${base[2] * 0.5})`);
      g.fillStyle = gr; g.fillRect(0, y, s, h);
      // 木紋
      for (let j = 0; j < 14; j++) {
        g.strokeStyle = `rgba(45,32,20,${0.1 + r() * 0.22})`;
        g.lineWidth = 0.6 + r();
        const yy = y + 3 + r() * (h - 6), x0 = r() * s, len = 30 + r() * 140;
        g.beginPath(); g.moveTo(x0, yy); g.quadraticCurveTo(x0 + len / 2, yy + (r() - 0.5) * 4, x0 + len, yy + (r() - 0.5) * 3); g.stroke();
      }
      // 節瘤、裂縫
      for (let j = 0; j < 2; j++) if (r() < 0.7) {
        g.fillStyle = 'rgba(40,26,14,0.55)';
        g.beginPath(); g.ellipse(r() * s, y + h * (0.35 + r() * 0.3), 5 + r() * 4, 3 + r() * 2, 0, 0, 7); g.fill();
      }
      // 原木之間的縫（填了泥）
      g.fillStyle = '#2a2118'; g.fillRect(0, y + h - 3, s, 3);
      g.fillStyle = 'rgba(150,135,110,0.35)'; g.fillRect(0, y + h - 5, s, 2);
    }
    // 風化成灰
    for (let i = 0; i < 30; i++) blotch(g, r() * s, r() * s, 10 + r() * 30, 'rgba(170,165,155,0.12)');
    grit(g, s, r, 1400, 0.22, 0.1);
  }, 31);

  // 地板：橫向木板
  T.planks = make(256, (g, s, r) => {
    const n = 6, h = s / n;
    for (let i = 0; i < n; i++) {
      const k = (r() - 0.5) * 26;
      g.fillStyle = `rgb(${104 + k},${80 + k},${56 + k * 0.6})`;
      g.fillRect(0, i * h, s, h);
      for (let j = 0; j < 10; j++) {
        g.strokeStyle = `rgba(30,18,8,${0.1 + r() * 0.2})`;
        g.beginPath(); const y = i * h + r() * h; g.moveTo(0, y); g.lineTo(s, y + (r() - 0.5) * 4); g.stroke();
      }
      g.fillStyle = '#1d120a'; g.fillRect(0, i * h, s, 2);
      g.fillRect(((i * 97) % 5) * 50, i * h, 2, h);
    }
    grit(g, s, r, 700);
  }, 12);

  // 石頭等級：大小不一的方石，白色灰泥縫（rust 截圖裡的石牆、石塔）
  T.stone = make(256, (g, s, r) => {
    g.fillStyle = '#c9bfa9'; g.fillRect(0, 0, s, s);   // 灰泥（偏米色）
    let y = 0;
    while (y < s) {
      const rh = Math.min(s - y, 34 + Math.floor(r() * 26));
      let x = -Math.floor(r() * 40);
      while (x < s) {
        const cw = 44 + Math.floor(r() * 50);
        const k = (r() - 0.5) * 36, warm = r() * 10;
        const c = [156 + k + warm, 148 + k, 132 + k - warm];
        const gr = g.createLinearGradient(0, y, 0, y + rh);
        gr.addColorStop(0, `rgb(${c[0] + 18},${c[1] + 18},${c[2] + 16})`);
        gr.addColorStop(1, `rgb(${c[0] - 22},${c[1] - 22},${c[2] - 20})`);
        g.fillStyle = gr;
        // 邊角磨圓的石塊
        const px = x + 3, py = y + 3, pw = cw - 6, ph = rh - 6, rr = 5;
        g.beginPath();
        g.moveTo(px + rr, py); g.lineTo(px + pw - rr, py); g.quadraticCurveTo(px + pw, py, px + pw, py + rr);
        g.lineTo(px + pw, py + ph - rr); g.quadraticCurveTo(px + pw, py + ph, px + pw - rr, py + ph);
        g.lineTo(px + rr, py + ph); g.quadraticCurveTo(px, py + ph, px, py + ph - rr);
        g.lineTo(px, py + rr); g.quadraticCurveTo(px, py, px + rr, py);
        g.fill();
        for (let i = 0; i < 4; i++) blotch(g, px + r() * pw, py + r() * ph, 6 + r() * 12, `rgba(${r() < 0.5 ? '70,66,58' : '220,215,205'},0.18)`);
        g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(px, py + ph - 2, pw, 2);
        x += cw;
      }
      y += rh;
    }
    grit(g, s, r, 2600, 0.22, 0.12);
    streaks(g, s, r, 14, '60,58,50', 0.18, 70);
    for (let i = 0; i < 5; i++) blotch(g, r() * s, s * 0.75 + r() * s * 0.25, 14 + r() * 18, 'rgba(80,95,45,0.3)');
  }, 13);

  // 鐵皮等級：橘紅鏽色浪板，夾雜還沒鏽透的灰色鍍鋅板、鉚釘（rust 截圖裡的屋頂和車庫門）
  T.sheet = make(256, (g, s, r) => {
    g.fillStyle = '#8c4f2e'; g.fillRect(0, 0, s, s);
    // 幾塊還是灰色的板子
    for (let i = 0; i < 3; i++) {
      const x = Math.floor(r() * 4) * 64, y = Math.floor(r() * 3) * (s / 3);
      g.fillStyle = `rgba(${118 + r() * 20},${116 + r() * 15},${108},0.85)`;
      g.fillRect(x, y, 64, s / 3);
    }
    // 浪板凹凸
    for (let x = 0; x < s; x += 16) {
      const gr = g.createLinearGradient(x, 0, x + 16, 0);
      gr.addColorStop(0, 'rgba(255,220,180,0.14)');
      gr.addColorStop(0.5, 'rgba(0,0,0,0.26)');
      gr.addColorStop(1, 'rgba(255,220,180,0.14)');
      g.fillStyle = gr; g.fillRect(x, 0, 16, s);
    }
    for (let i = 0; i < 40; i++) blotch(g, r() * s, r() * s, 6 + r() * 28, `rgba(${110 + r() * 50},${45 + r() * 25},${15 + r() * 10},${0.3 + r() * 0.4})`);
    for (let i = 0; i < 16; i++) blotch(g, r() * s, r() * s, 4 + r() * 10, 'rgba(40,22,12,0.5)');
    streaks(g, s, r, 26, '90,40,12', 0.45, 80);
    for (let i = 1; i < 3; i++) { g.fillStyle = 'rgba(20,12,6,0.6)'; g.fillRect(0, i * s / 3 - 2, s, 3); }
    g.fillStyle = '#2a201a';
    for (let y = 8; y < s; y += s / 3) for (let x = 8; x < s; x += 32) { g.beginPath(); g.arc(x, y, 2.4, 0, 7); g.fill(); }
    grit(g, s, r, 1500, 0.25, 0.1);
  }, 14);

  // 水泥：灰底、雨漬、裂縫
  T.concrete = make(256, (g, s, r) => {
    g.fillStyle = '#9b978d'; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 40; i++) blotch(g, r() * s, r() * s, 10 + r() * 40, `rgba(${r() < 0.5 ? '50,48,42' : '190,186,176'},${0.1 + r() * 0.15})`);
    streaks(g, s, r, 30, '35,34,30', 0.32, 120);
    g.strokeStyle = 'rgba(25,25,22,0.6)';
    for (let i = 0; i < 5; i++) {
      g.lineWidth = 0.8 + r();
      g.beginPath(); let x = r() * s, y = r() * s; g.moveTo(x, y);
      for (let k = 0; k < 8; k++) { x += (r() - 0.5) * 30; y += r() * 20; g.lineTo(x, y); }
      g.stroke();
    }
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, s / 2, s, 2); g.fillRect(s / 2, 0, 2, s);
    grit(g, s, r, 2500, 0.2, 0.1);
  }, 15);

  // 超市外牆（貼圖代表 4m × 4m，從地面往上）：綠色腰板 → 白色牆板 → 紅色招牌帶 → 水泥女兒牆
  T.facade = make(256, (g, s, r) => {
    const m = s / 4;   // 每公尺幾 px（canvas 上方是高處）
    const band = (y0, y1, color) => { g.fillStyle = color; g.fillRect(0, s - y1 * m, s, (y1 - y0) * m); };
    band(0, 1.0, '#2f6a49');
    band(1.0, 2.55, '#d6d2c4');
    band(2.55, 3.2, '#a8342b');
    band(3.2, 4.0, '#8f8b83');
    // 白牆板的直縫
    for (let x = 0; x < s; x += 32) { g.fillStyle = 'rgba(60,60,55,0.35)'; g.fillRect(x, s - 2.55 * m, 2, 1.55 * m); }
    // 腰板、紅帶的浪板紋
    for (let x = 0; x < s; x += 10) {
      g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(x, s - 1.0 * m, 4, 1.0 * m);
      g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(x, s - 3.2 * m, 4, 0.65 * m);
    }
    // 分界線
    g.fillStyle = 'rgba(30,28,24,0.6)'; g.fillRect(0, s - 1.0 * m - 2, s, 3); g.fillRect(0, s - 2.55 * m - 2, s, 3); g.fillRect(0, s - 3.2 * m, s, 4);
    // 剝落的油漆露出鏽和水泥
    for (let i = 0; i < 26; i++) blotch(g, r() * s, r() * s, 5 + r() * 18, `rgba(${120 + r() * 30},${70 + r() * 20},40,${0.35 + r() * 0.3})`);
    for (let i = 0; i < 14; i++) blotch(g, r() * s, s - (1 + r() * 1.5) * m, 6 + r() * 14, 'rgba(150,145,135,0.6)');
    streaks(g, s, r, 40, '50,40,30', 0.35, 100);
    // 底部髒污、塗鴉
    const gr = g.createLinearGradient(0, s - 0.5 * m, 0, s);
    gr.addColorStop(0, 'rgba(40,32,20,0)'); gr.addColorStop(1, 'rgba(40,32,20,0.55)');
    g.fillStyle = gr; g.fillRect(0, s - 0.5 * m, s, 0.5 * m);
    g.save();
    g.translate(s * 0.2, s - 1.6 * m); g.rotate(-0.08);
    g.font = 'bold 22px "Arial Black", Impact, sans-serif';
    g.fillStyle = 'rgba(40,40,40,0.55)'; g.fillText('FP', 0, 0);
    g.restore();
    grit(g, s, r, 2200, 0.2, 0.1);
  }, 33);

  // 柏油路（u = 橫跨 5m 路寬，v = 沿路方向每張 6m）：裂縫、補丁、褪色的黃色中線和白色邊線
  T.asphalt = make(256, (g, s, r) => {
    g.fillStyle = '#45443f'; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 4000; i++) {
      g.fillStyle = `rgba(${r() < 0.5 ? '20,20,18' : '150,148,140'},${0.15 + r() * 0.25})`;
      g.fillRect(r() * s, r() * s, 1 + r() * 2, 1 + r() * 2);
    }
    for (let i = 0; i < 6; i++) { g.fillStyle = `rgba(${r() < 0.5 ? '30,30,28' : '95,93,86'},0.5)`; g.fillRect(r() * s, r() * s, 20 + r() * 60, 15 + r() * 40); }
    // 白色邊線、黃色虛線
    g.fillStyle = 'rgba(205,200,185,0.55)'; g.fillRect(s * 0.07, 0, 5, s); g.fillRect(s * 0.91, 0, 5, s);
    g.fillStyle = 'rgba(210,170,60,0.65)';
    for (let y = 0; y < s; y += 128) g.fillRect(s * 0.49, y + 10, 6, 70);
    // 裂縫
    g.strokeStyle = 'rgba(15,15,13,0.8)';
    for (let i = 0; i < 9; i++) {
      g.lineWidth = 0.8 + r() * 1.4;
      g.beginPath(); let x = r() * s, y = r() * s; g.moveTo(x, y);
      for (let k = 0; k < 7; k++) { x += (r() - 0.5) * 40; y += (r() - 0.5) * 40; g.lineTo(x, y); }
      g.stroke();
    }
    // 路肩崩掉的邊
    for (let y = 0; y < s; y += 6) {
      g.fillStyle = 'rgba(90,70,45,0.8)';
      g.fillRect(0, y, 3 + r() * 10, 6); g.fillRect(s - 3 - r() * 10, y, 13, 6);
    }
    grit(g, s, r, 1500, 0.2, 0.08);
  }, 34);

  // 停車場：柏油 + 白色停車格
  T.parking = make(256, (g, s, r) => {
    g.fillStyle = '#4a4943'; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 4000; i++) {
      g.fillStyle = `rgba(${r() < 0.5 ? '20,20,18' : '150,148,140'},${0.15 + r() * 0.25})`;
      g.fillRect(r() * s, r() * s, 1 + r() * 2, 1 + r() * 2);
    }
    g.fillStyle = 'rgba(215,210,195,0.6)';
    for (let x = 0; x < s; x += 64) g.fillRect(x, 0, 4, s * 0.55);
    g.fillRect(0, s * 0.55, s, 4);
    g.strokeStyle = 'rgba(15,15,13,0.8)';
    for (let i = 0; i < 7; i++) {
      g.lineWidth = 1 + r();
      g.beginPath(); let x = r() * s, y = r() * s; g.moveTo(x, y);
      for (let k = 0; k < 6; k++) { x += (r() - 0.5) * 50; y += (r() - 0.5) * 50; g.lineTo(x, y); }
      g.stroke();
    }
    for (let i = 0; i < 10; i++) blotch(g, r() * s, r() * s, 8 + r() * 20, 'rgba(25,24,20,0.35)');
    grit(g, s, r, 1500, 0.2, 0.08);
  }, 35);

  // 石灰岩懸崖：一層一層的淺灰色岩層、垂直裂縫、地衣（rust 截圖裡遠方那種白灰色岩壁）
  T.cliff = make(256, (g, s, r) => {
    let y = 0;
    while (y < s) {
      const h = 10 + r() * 26, k = (r() - 0.5) * 26;
      g.fillStyle = `rgb(${172 + k},${168 + k},${156 + k})`;
      g.fillRect(0, y, s, h);
      g.fillStyle = 'rgba(60,58,52,0.55)'; g.fillRect(0, y + h - 2, s, 2);
      g.fillStyle = 'rgba(255,255,250,0.18)'; g.fillRect(0, y, s, 2);
      y += h;
    }
    g.strokeStyle = 'rgba(50,48,44,0.55)';
    for (let i = 0; i < 18; i++) {
      g.lineWidth = 0.8 + r() * 1.5;
      g.beginPath(); let x = r() * s, yy = r() * s; g.moveTo(x, yy);
      for (let k = 0; k < 4; k++) { x += (r() - 0.5) * 10; yy += 10 + r() * 20; g.lineTo(x, yy); }
      g.stroke();
    }
    for (let i = 0; i < 50; i++) blotch(g, r() * s, r() * s, 8 + r() * 30, `rgba(${r() < 0.5 ? '70,68,60' : '215,212,202'},${0.08 + r() * 0.12})`);
    for (let i = 0; i < 10; i++) blotch(g, r() * s, r() * s, 6 + r() * 16, 'rgba(110,125,60,0.25)');
    streaks(g, s, r, 20, '60,58,50', 0.25, 90);
    grit(g, s, r, 3000, 0.22, 0.12);
  }, 36);

  // 一般岩石：比較淺、偏米灰（rust 的石頭礦點跟路邊大石）
  T.rock = make(256, (g, s, r) => {
    g.fillStyle = '#9d998e'; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 70; i++) blotch(g, r() * s, r() * s, 8 + r() * 36, `rgba(${r() < 0.5 ? '70,68,60' : '200,196,186'},${0.15 + r() * 0.2})`);
    for (let i = 0; i < 12; i++) blotch(g, r() * s, r() * s, 10 + r() * 30, 'rgba(95,110,50,0.3)');
    g.strokeStyle = 'rgba(40,38,34,0.45)';
    for (let i = 0; i < 14; i++) {
      g.lineWidth = 0.6 + r();
      g.beginPath(); let x = r() * s, y = r() * s; g.moveTo(x, y);
      for (let k = 0; k < 5; k++) { x += (r() - 0.5) * 40; y += (r() - 0.5) * 40; g.lineTo(x, y); }
      g.stroke();
    }
    grit(g, s, r, 3000, 0.28, 0.14);
  }, 19);

  // 貨櫃浪板（灰白，讓 material.color 去染色）
  T.container = make(256, (g, s, r) => {
    g.fillStyle = '#cfcfcf'; g.fillRect(0, 0, s, s);
    for (let x = 0; x < s; x += 21) {
      g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(x, 0, 4, s);
      g.fillStyle = 'rgba(0,0,0,0.28)'; g.fillRect(x + 10, 0, 6, s);
      g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(x + 16, 0, 5, s);
    }
    for (let i = 0; i < 34; i++) blotch(g, r() * s, r() * s, 6 + r() * 26, `rgba(${110 + r() * 40},${50 + r() * 15},20,${0.3 + r() * 0.4})`);
    streaks(g, s, r, 20, '80,40,15', 0.4, 70);
    const gr = g.createLinearGradient(0, s * 0.6, 0, s);
    gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(70,45,20,0.55)');
    g.fillStyle = gr; g.fillRect(0, 0, s, s);
    grit(g, s, r, 1500, 0.25, 0.1);
  }, 16);

  // 木箱：外框 + 斜撐
  T.crate = make(128, (g, s, r) => {
    g.fillStyle = '#93714a'; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 4; i++) {
      g.fillStyle = `rgba(0,0,0,${0.05 + r() * 0.1})`; g.fillRect(0, i * s / 4, s, s / 4);
      g.fillStyle = 'rgba(40,25,10,0.6)'; g.fillRect(0, i * s / 4, s, 1.5);
    }
    g.save(); g.translate(s / 2, s / 2); g.rotate(Math.PI / 4);
    g.fillStyle = '#6b4f2f'; g.fillRect(-s, -8, s * 2, 16); g.restore();
    g.strokeStyle = '#4e3820'; g.lineWidth = 14; g.strokeRect(7, 7, s - 14, s - 14);
    g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 2; g.strokeRect(14, 14, s - 28, s - 28);
    grit(g, s, r, 500);
  }, 17);

  // 軍用箱：橄欖綠 + 白色模板字
  T.military = make(128, (g, s, r) => {
    g.fillStyle = '#4b5634'; g.fillRect(0, 0, s, s);
    g.strokeStyle = '#353d24'; g.lineWidth = 10; g.strokeRect(5, 5, s - 10, s - 10);
    g.fillStyle = 'rgba(230,225,200,0.75)'; g.font = 'bold 22px monospace'; g.textAlign = 'center';
    g.fillText('MIL', s / 2, s / 2 + 8);
    g.fillRect(s * 0.25, s * 0.68, s * 0.5, 3);
    grit(g, s, r, 600, 0.25, 0.12);
  }, 18);

  // TC 工具櫃：木頭櫃子、兩扇門、中間一個鐵扣（UV 是整面 0~1，不會被切掉）
  T.tc = make(128, (g, s, r) => {
    g.fillStyle = '#7a5a36'; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 6; i++) {
      g.fillStyle = `rgba(0,0,0,${0.04 + r() * 0.1})`; g.fillRect(0, i * s / 6, s, s / 6);
      g.fillStyle = 'rgba(40,25,10,0.5)'; g.fillRect(0, i * s / 6, s, 1);
    }
    g.strokeStyle = '#3e2a16'; g.lineWidth = 10; g.strokeRect(5, 5, s - 10, s - 10);
    g.fillStyle = '#2e2014'; g.fillRect(s / 2 - 1.5, 10, 3, s - 20);
    g.fillStyle = '#4a4a48'; g.fillRect(s / 2 - 7, s * 0.42, 14, 18);
    g.fillStyle = '#8c8c86'; g.fillRect(s / 2 - 3, s * 0.42 + 5, 6, 8);
    grit(g, s, r, 500);
  }, 27);

  // 建築藍圖：rust 的 Building Plan
  T.blueprint = make(128, (g, s, r) => {
    g.fillStyle = '#2d5f9a'; g.fillRect(0, 0, s, s);
    g.strokeStyle = 'rgba(255,255,255,0.18)'; g.lineWidth = 1;
    for (let i = 0; i <= s; i += 8) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, s); g.moveTo(0, i); g.lineTo(s, i); g.stroke(); }
    g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 2;
    g.strokeRect(24, 34, 80, 60);
    for (let x = 24; x <= 104; x += 16) { g.beginPath(); g.moveTo(x, 34); g.lineTo(x, 94); g.stroke(); }
    g.fillStyle = 'rgba(255,255,255,0.85)'; g.font = 'bold 13px monospace'; g.textAlign = 'center';
    g.fillText('WALL', s / 2, 116);
    grit(g, s, r, 300, 0.12, 0.1);
  }, 28);

  // 松樹皮：深褐灰、很深的直向溝
  T.bark = make(128, (g, s, r) => {
    g.fillStyle = '#4c3e31'; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 26; i++) {
      const x = r() * s, w = 3 + r() * 7;
      g.fillStyle = `rgba(${105 + r() * 30},${92 + r() * 20},${76},${0.35 + r() * 0.3})`;
      g.fillRect(x, 0, w, s);
      g.fillStyle = 'rgba(15,10,6,0.55)'; g.fillRect(x + w, 0, 1.5, s);
    }
    for (let i = 0; i < 40; i++) { g.fillStyle = 'rgba(15,10,6,0.4)'; g.fillRect(r() * s, r() * s, 6 + r() * 10, 1.5); }
    grit(g, s, r, 500);
  }, 20);

  T.birch = make(128, (g, s, r) => {
    g.fillStyle = '#ddd8cb'; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 40; i++) {
      g.fillStyle = `rgba(25,22,20,${0.5 + r() * 0.4})`;
      g.fillRect(r() * s, r() * s, 6 + r() * 26, 1 + r() * 3);
    }
    grit(g, s, r, 300, 0.15, 0.1);
  }, 21);

  // 枯樹：灰白、乾裂的木頭
  T.deadwood = make(128, (g, s, r) => {
    g.fillStyle = '#7d766b'; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 50; i++) {
      g.fillStyle = `rgba(${r() < 0.5 ? '40,36,30' : '170,165,155'},${0.2 + r() * 0.3})`;
      g.fillRect(r() * s, 0, 1 + r() * 2.5, s);
    }
    grit(g, s, r, 400, 0.2, 0.12);
  }, 37);

  // 木頭切面：年輪（路障尖端、倒木兩端）
  T.woodEnd = make(128, (g, s, r) => {
    g.fillStyle = '#b8945f'; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 40; i++) {
      g.fillStyle = `rgba(${r() < 0.5 ? '120,85,45' : '215,185,135'},${0.2 + r() * 0.3})`;
      g.fillRect(r() * s, 0, 1 + r() * 3, s);
    }
    grit(g, s, r, 400, 0.15, 0.12);
  }, 38);

  // 麻繩
  T.rope = make(64, (g, s, r) => {
    g.fillStyle = '#a88d5c'; g.fillRect(0, 0, s, s);
    g.strokeStyle = 'rgba(70,52,28,0.7)'; g.lineWidth = 2;
    for (let i = -s; i < s * 2; i += 8) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + s * 0.6, s); g.stroke(); }
    grit(g, s, r, 200, 0.2, 0.15);
  }, 39);

  // 地形細節貼圖（灰階，乘在頂點色上）
  T.ground = make(256, (g, s, r) => {
    g.fillStyle = '#dadada'; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 60; i++) blotch(g, r() * s, r() * s, 10 + r() * 30, `rgba(${r() < 0.5 ? '0,0,0' : '255,255,255'},${0.05 + r() * 0.07})`);
    for (let i = 0; i < 2200; i++) {
      g.strokeStyle = `rgba(${r() < 0.5 ? '40,40,40' : '255,255,255'},${0.1 + r() * 0.2})`;
      g.lineWidth = 1;
      const x = r() * s, y = r() * s;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 3, y - 3 - r() * 5); g.stroke();
    }
    grit(g, s, r, 4000, 0.22, 0.15);
  }, 22);

  // 柔邊圓點：煙、塵、血、槍口焰共用
  T.puff = make(64, (g, s) => {
    const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.4, 'rgba(255,255,255,0.6)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, s, s);
  }, 23);

  // 槍口焰：星芒
  T.flash = make(128, (g, s, r) => {
    g.translate(s / 2, s / 2);
    for (let i = 0; i < 7; i++) {
      g.rotate(Math.PI * 2 / 7 + r() * 0.3);
      const gr = g.createLinearGradient(0, 0, s / 2, 0);
      gr.addColorStop(0, 'rgba(255,240,200,1)');
      gr.addColorStop(0.5, 'rgba(255,170,60,0.7)');
      gr.addColorStop(1, 'rgba(255,120,20,0)');
      g.fillStyle = gr;
      g.beginPath(); g.moveTo(0, -5); g.lineTo(s * (0.3 + r() * 0.2), 0); g.lineTo(0, 5); g.fill();
    }
    const gr = g.createRadialGradient(0, 0, 0, 0, 0, s * 0.25);
    gr.addColorStop(0, 'rgba(255,255,230,1)'); gr.addColorStop(1, 'rgba(255,160,50,0)');
    g.fillStyle = gr; g.fillRect(-s / 2, -s / 2, s, s);
  }, 24);

  // 積雲：先畫偏藍灰的底部陰影，再在上半部疊亮白，看起來有被太陽照到的體積感
  T.clouds = [0, 1, 2, 3].map((k) => makeWH(256, 128, (g, w, r, h) => {
    const puffs = [];
    const n = 16 + Math.floor(r() * 10);
    for (let i = 0; i < n; i++) {
      const t = i / n;
      const x = w * (0.12 + 0.76 * t + (r() - 0.5) * 0.12);
      const hump = Math.sin(t * Math.PI);   // 中間高、兩邊低
      const rad = h * (0.16 + 0.22 * hump * (0.6 + r() * 0.6));
      const y = h * 0.78 - rad * (0.6 + r() * 0.5);
      puffs.push([x, y, rad]);
    }
    for (const [x, y, rad] of puffs) blotch(g, x, y + rad * 0.25, rad * 1.05, 'rgba(158,172,190,0.55)', 'rgba(158,172,190,0)');
    for (const [x, y, rad] of puffs) blotch(g, x - rad * 0.1, y - rad * 0.12, rad * 0.95, 'rgba(255,255,255,0.75)', 'rgba(255,255,255,0)');
    for (const [x, y, rad] of puffs) blotch(g, x - rad * 0.15, y - rad * 0.3, rad * 0.6, 'rgba(255,253,246,0.55)', 'rgba(255,253,246,0)');
    // 雲底切平一點
    const gr = g.createLinearGradient(0, h * 0.7, 0, h);
    gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,1)');
    g.globalCompositeOperation = 'destination-out';
    g.fillStyle = gr; g.fillRect(0, h * 0.7, w, h * 0.3);
    g.globalCompositeOperation = 'source-over';
  }, 50 + k, { repeat: false }));

  // 水面法線：幾層正弦波疊加後算斜率
  T.waterNormal = make(256, (g, s, r) => {
    const img = g.createImageData(s, s);
    const waves = Array.from({ length: 9 }, () => ({
      a: r() * Math.PI * 2, f: (2 + Math.floor(r() * 6)) * Math.PI * 2 / s, p: r() * 6.28, amp: 0.4 + r(),
    }));
    const hgt = (x, y) => waves.reduce((acc, w) => acc + w.amp * Math.sin((x * Math.cos(w.a) + y * Math.sin(w.a)) * w.f + w.p), 0);
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const dx = hgt(x + 1, y) - hgt(x - 1, y), dy = hgt(x, y + 1) - hgt(x, y - 1);
      const nx = -dx * 2, ny = -dy * 2, nz = 1, l = Math.hypot(nx, ny, nz);
      const i = (y * s + x) * 4;
      img.data[i] = (nx / l * 0.5 + 0.5) * 255;
      img.data[i + 1] = (ny / l * 0.5 + 0.5) * 255;
      img.data[i + 2] = (nz / l * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  }, 40, { srgb: false });

  // 超市招牌：SUPERMARKET 掉了 U、A、R，剩下「S PERM KET」—— rust 的經典冷笑話
  T.sign = makeWH(1024, 160, (g, w, r, h) => {
    const letters = ['S', null, 'P', 'E', 'R', 'M', null, null, 'K', 'E', 'T'];
    const step = w / letters.length;
    g.font = 'bold 128px "Arial Black", Impact, "Roboto Condensed", sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    letters.forEach((ch, i) => {
      if (!ch) return;
      g.save();
      g.translate(step * (i + 0.5), h / 2 + 6);
      g.rotate(ch === 'M' ? 0.09 : ch === 'K' ? -0.05 : (r() - 0.5) * 0.03);   // 幾個字歪掉
      g.lineWidth = 16; g.strokeStyle = '#ece4d4'; g.strokeText(ch, 0, 0);
      g.fillStyle = '#c43a2c'; g.fillText(ch, 0, 0);
      g.restore();
    });
    // 髒污
    g.globalCompositeOperation = 'source-atop';
    for (let i = 0; i < 40; i++) blotch(g, r() * w, r() * h, 10 + r() * 30, 'rgba(70,40,20,0.35)');
    streaks(g, w, r, 60, '60,35,15', 0.4, 50, h);
    g.globalCompositeOperation = 'source-over';
  }, 41, { repeat: false });

  // 彈孔
  T.hole = make(32, (g, s) => {
    const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    gr.addColorStop(0, 'rgba(10,8,6,1)'); gr.addColorStop(0.35, 'rgba(20,16,12,0.9)');
    gr.addColorStop(0.6, 'rgba(40,35,30,0.4)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, s, s);
  }, 26);

  return T;
}
