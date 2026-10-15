// 全部貼圖都用 canvas 現畫，不靠外部圖檔：GitHub Pages 上零資產也能跑，
// 而且每張都是照 rust 的建材長相去模仿（木牆的橫樑、石牆的方塊、生鏽鐵皮）。
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

function make(size, draw, seed = 1, { srgb = true } = {}) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  draw(g, size, rng(seed));
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// 隨機小點點，讓表面有髒污顆粒感
function grit(g, s, r, n, dark = 0.18, light = 0.08) {
  for (let i = 0; i < n; i++) {
    const isDark = r() < 0.6;
    g.fillStyle = isDark ? `rgba(0,0,0,${r() * dark})` : `rgba(255,255,255,${r() * light})`;
    const w = 1 + r() * 2.5;
    g.fillRect(r() * s, r() * s, w, w);
  }
}

function blotch(g, x, y, rad, color, end = 'rgba(0,0,0,0)') {
  const gr = g.createRadialGradient(x, y, 0, x, y, rad);
  gr.addColorStop(0, color);
  gr.addColorStop(1, end);
  g.fillStyle = gr;
  g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
}

export function makeTextures() {
  const T = {};

  // 木牆：直向木板 + 中間一條橫樑 + 釘子，rust 升級成木頭後的經典長相
  T.wood = make(256, (g, s, r) => {
    g.fillStyle = '#5e4128'; g.fillRect(0, 0, s, s);
    const n = 4, w = s / n;
    for (let i = 0; i < n; i++) {
      const k = (r() - 0.5) * 28;
      g.fillStyle = `rgb(${104 + k},${72 + k * 0.8},${45 + k * 0.6})`;
      g.fillRect(i * w + 2, 0, w - 4, s);
      for (let j = 0; j < 16; j++) {
        g.strokeStyle = `rgba(38,22,10,${0.12 + r() * 0.25})`;
        g.lineWidth = 0.6 + r() * 1.2;
        g.beginPath();
        let x = i * w + 4 + r() * (w - 8);
        g.moveTo(x, 0);
        for (let y = 0; y <= s; y += 12) { x += (r() - 0.5) * 1.6; g.lineTo(x, y); }
        g.stroke();
      }
      if (r() < 0.8) {
        g.fillStyle = 'rgba(40,24,12,0.65)';
        g.beginPath();
        g.ellipse(i * w + w / 2 + (r() - 0.5) * w * 0.4, r() * s, 3 + r() * 3, 6 + r() * 4, 0, 0, Math.PI * 2);
        g.fill();
      }
      g.fillStyle = '#1e130a'; g.fillRect(i * w, 0, 3, s);
    }
    // 橫樑
    g.fillStyle = '#4d331d'; g.fillRect(0, s * 0.40, s, s * 0.11);
    g.fillStyle = 'rgba(255,220,170,0.08)'; g.fillRect(0, s * 0.40, s, 3);
    g.fillStyle = 'rgba(0,0,0,0.45)'; g.fillRect(0, s * 0.51, s, 4);
    g.fillStyle = '#252525';
    for (let i = 0; i < n; i++) {
      g.fillRect(i * w + w * 0.3, s * 0.43, 4, 4);
      g.fillRect(i * w + w * 0.68, s * 0.47, 4, 4);
    }
    // 底部受潮變深
    const gr = g.createLinearGradient(0, s * 0.75, 0, s);
    gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(20,14,6,0.45)');
    g.fillStyle = gr; g.fillRect(0, 0, s, s);
    grit(g, s, r, 900);
  }, 11);

  // 地板：橫向木板
  T.planks = make(256, (g, s, r) => {
    const n = 6, h = s / n;
    for (let i = 0; i < n; i++) {
      const k = (r() - 0.5) * 26;
      g.fillStyle = `rgb(${98 + k},${70 + k},${44 + k * 0.6})`;
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

  // 石牆：錯位方塊，每塊顏色略不同
  T.stone = make(256, (g, s, r) => {
    g.fillStyle = '#5f5d58'; g.fillRect(0, 0, s, s);
    const rows = 4, rh = s / rows;
    for (let y = 0; y < rows; y++) {
      const cols = 3, cw = s / cols, off = (y % 2) * cw / 2;
      for (let x = -1; x < cols + 1; x++) {
        const k = (r() - 0.5) * 30;
        g.fillStyle = `rgb(${132 + k},${129 + k},${121 + k})`;
        g.fillRect(x * cw + off + 3, y * rh + 3, cw - 6, rh - 6);
        blotch(g, x * cw + off + r() * cw, y * rh + r() * rh, 20 + r() * 20, 'rgba(60,58,50,0.35)');
        g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(x * cw + off + 3, y * rh + 3, cw - 6, 2);
      }
    }
    grit(g, s, r, 2200, 0.25, 0.1);
    // 苔蘚
    for (let i = 0; i < 6; i++) blotch(g, r() * s, s * 0.7 + r() * s * 0.3, 14 + r() * 18, 'rgba(70,85,40,0.35)');
  }, 13);

  // 鐵皮牆：直向浪板 + 鉚釘 + 鏽斑
  T.sheet = make(256, (g, s, r) => {
    g.fillStyle = '#6a665e'; g.fillRect(0, 0, s, s);
    for (let x = 0; x < s; x += 16) {
      const gr = g.createLinearGradient(x, 0, x + 16, 0);
      gr.addColorStop(0, 'rgba(255,255,255,0.10)');
      gr.addColorStop(0.5, 'rgba(0,0,0,0.18)');
      gr.addColorStop(1, 'rgba(255,255,255,0.10)');
      g.fillStyle = gr; g.fillRect(x, 0, 16, s);
    }
    // 三片鐵皮拼接
    for (let i = 1; i < 3; i++) { g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(0, i * s / 3 - 2, s, 3); }
    for (let i = 0; i < 26; i++) blotch(g, r() * s, r() * s, 8 + r() * 30, `rgba(${120 + r() * 40},${55 + r() * 20},20,${0.25 + r() * 0.35})`);
    // 鏽水往下流
    for (let i = 0; i < 18; i++) {
      const x = r() * s, y = r() * s;
      const gr = g.createLinearGradient(0, y, 0, y + 60);
      gr.addColorStop(0, 'rgba(110,50,15,0.4)'); gr.addColorStop(1, 'rgba(110,50,15,0)');
      g.fillStyle = gr; g.fillRect(x, y, 2 + r() * 3, 60);
    }
    g.fillStyle = '#2b2a27';
    for (let y = 8; y < s; y += s / 3) for (let x = 8; x < s; x += 32) { g.beginPath(); g.arc(x, y, 2.2, 0, 7); g.fill(); }
    grit(g, s, r, 1200);
  }, 14);

  // 水泥：灰底、雨漬、裂縫
  T.concrete = make(256, (g, s, r) => {
    g.fillStyle = '#8b8880'; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 40; i++) blotch(g, r() * s, r() * s, 10 + r() * 40, `rgba(${r() < 0.5 ? '40,40,35' : '170,168,160'},${0.1 + r() * 0.15})`);
    for (let i = 0; i < 30; i++) {
      const x = r() * s, len = 40 + r() * 140;
      const gr = g.createLinearGradient(0, 0, 0, len);
      gr.addColorStop(0, 'rgba(30,30,25,0.35)'); gr.addColorStop(1, 'rgba(30,30,25,0)');
      g.fillStyle = gr; g.fillRect(x, 0, 1 + r() * 4, len);
    }
    g.strokeStyle = 'rgba(25,25,22,0.6)';
    for (let i = 0; i < 5; i++) {
      g.lineWidth = 0.8 + r();
      g.beginPath(); let x = r() * s, y = r() * s; g.moveTo(x, y);
      for (let k = 0; k < 8; k++) { x += (r() - 0.5) * 30; y += r() * 20; g.lineTo(x, y); }
      g.stroke();
    }
    // 模板接縫
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, s / 2, s, 2); g.fillRect(s / 2, 0, 2, s);
    grit(g, s, r, 2500, 0.2, 0.1);
  }, 15);

  // 貨櫃浪板（灰白，讓 material.color 去染紅藍綠）
  T.container = make(256, (g, s, r) => {
    g.fillStyle = '#c9c9c9'; g.fillRect(0, 0, s, s);
    for (let x = 0; x < s; x += 21) {
      g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(x, 0, 4, s);
      g.fillStyle = 'rgba(0,0,0,0.28)'; g.fillRect(x + 10, 0, 6, s);
      g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(x + 16, 0, 5, s);
    }
    for (let i = 0; i < 30; i++) blotch(g, r() * s, r() * s, 6 + r() * 26, `rgba(${90 + r() * 40},${45 + r() * 15},20,${0.3 + r() * 0.4})`);
    const gr = g.createLinearGradient(0, s * 0.6, 0, s);
    gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(60,40,20,0.55)');
    g.fillStyle = gr; g.fillRect(0, 0, s, s);
    grit(g, s, r, 1500, 0.25, 0.1);
  }, 16);

  // 木箱：外框 + 斜撐
  T.crate = make(128, (g, s, r) => {
    g.fillStyle = '#8a6a43'; g.fillRect(0, 0, s, s);
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

  // 岩石：灰 + 苔蘚 + 裂紋
  T.rock = make(256, (g, s, r) => {
    g.fillStyle = '#7b7973'; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 70; i++) blotch(g, r() * s, r() * s, 8 + r() * 36, `rgba(${r() < 0.5 ? '45,44,40' : '150,148,140'},${0.15 + r() * 0.2})`);
    for (let i = 0; i < 12; i++) blotch(g, r() * s, r() * s, 10 + r() * 30, 'rgba(85,100,48,0.35)');
    g.strokeStyle = 'rgba(30,30,28,0.5)';
    for (let i = 0; i < 14; i++) {
      g.lineWidth = 0.6 + r();
      g.beginPath(); let x = r() * s, y = r() * s; g.moveTo(x, y);
      for (let k = 0; k < 5; k++) { x += (r() - 0.5) * 40; y += (r() - 0.5) * 40; g.lineTo(x, y); }
      g.stroke();
    }
    grit(g, s, r, 3000, 0.3, 0.12);
  }, 19);

  T.bark = make(128, (g, s, r) => {
    g.fillStyle = '#4a3b2c'; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 60; i++) {
      g.fillStyle = `rgba(${r() < 0.5 ? '20,14,8' : '110,95,75'},${0.2 + r() * 0.3})`;
      g.fillRect(r() * s, 0, 1 + r() * 4, s);
    }
    grit(g, s, r, 400);
  }, 20);

  T.birch = make(128, (g, s, r) => {
    g.fillStyle = '#d8d3c6'; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 40; i++) {
      g.fillStyle = `rgba(25,22,20,${0.5 + r() * 0.4})`;
      g.fillRect(r() * s, r() * s, 6 + r() * 26, 1 + r() * 3);
    }
    grit(g, s, r, 300, 0.15, 0.1);
  }, 21);

  // 地形細節貼圖（灰階，乘在頂點色上）
  T.ground = make(256, (g, s, r) => {
    g.fillStyle = '#d8d8d8'; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 60; i++) blotch(g, r() * s, r() * s, 10 + r() * 30, `rgba(${r() < 0.5 ? '0,0,0' : '255,255,255'},${0.06 + r() * 0.08})`);
    for (let i = 0; i < 1600; i++) {
      g.strokeStyle = `rgba(${r() < 0.5 ? '40,40,40' : '255,255,255'},${0.1 + r() * 0.2})`;
      g.lineWidth = 1;
      const x = r() * s, y = r() * s;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 3, y - 3 - r() * 5); g.stroke();
    }
    grit(g, s, r, 4000, 0.25, 0.15);
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

  // 雲
  T.cloud = make(128, (g, s, r) => {
    for (let i = 0; i < 14; i++) {
      const x = s * 0.2 + r() * s * 0.6, y = s * 0.35 + r() * s * 0.3, rad = s * (0.12 + r() * 0.15);
      blotch(g, x, y, rad, `rgba(255,255,255,${0.25 + r() * 0.25})`, 'rgba(255,255,255,0)');
    }
  }, 25);

  // 彈孔
  T.hole = make(32, (g, s) => {
    const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    gr.addColorStop(0, 'rgba(10,8,6,1)'); gr.addColorStop(0.35, 'rgba(20,16,12,0.9)');
    gr.addColorStop(0.6, 'rgba(40,35,30,0.4)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, s, s);
  }, 26);

  return T;
}
