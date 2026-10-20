// 全部音效現場合成：槍聲、腳步、命中、換彈、風聲。
// 對手的槍聲和腳步走 3D 定位（PannerNode），rust 打架一半靠耳朵。
export function createAudio() {
  let ctx = null, master = null, sfx = null, windGain = null;
  const buf = {};
  let volume = 0.8;

  function noise(len, fn) {
    const b = ctx.createBuffer(1, Math.floor(ctx.sampleRate * len), ctx.sampleRate);
    const d = b.getChannelData(0);
    fn(d, ctx.sampleRate);
    return b;
  }

  function build() {
    // 槍聲：爆裂聲 + 低頻悶響 + 長尾音（低通後的雜訊模擬空曠的回音）
    buf.shot = noise(0.9, (d, sr) => {
      let lp = 0, lp2 = 0;
      for (let i = 0; i < d.length; i++) {
        const t = i / sr, n = Math.random() * 2 - 1;
        lp += (n - lp) * 0.08; lp2 += (n - lp2) * 0.02;
        const crack = n * Math.exp(-t * 70) * 0.9;
        const thump = Math.sin(2 * Math.PI * (95 - 40 * t) * t) * Math.exp(-t * 16) * 0.9;
        const body = lp * Math.exp(-t * 14) * 2.2;
        const tail = lp2 * Math.exp(-t * 4.2) * 2.4;
        d[i] = Math.tanh((crack + thump + body + tail) * 1.4) * 0.9;
      }
    });
    buf.step = noise(0.14, (d, sr) => {
      let lp = 0;
      for (let i = 0; i < d.length; i++) {
        const t = i / sr, n = Math.random() * 2 - 1;
        lp += (n - lp) * 0.25;
        d[i] = (lp * 1.6 + n * 0.25) * Math.exp(-t * 38) * (t < 0.004 ? t / 0.004 : 1);
      }
    });
    buf.hit = noise(0.09, (d, sr) => {
      for (let i = 0; i < d.length; i++) {
        const t = i / sr;
        d[i] = (Math.sin(2 * Math.PI * 1900 * t) * 0.5 + (Math.random() - 0.5) * 0.6) * Math.exp(-t * 55);
      }
    });
    buf.head = noise(0.35, (d, sr) => {
      for (let i = 0; i < d.length; i++) {
        const t = i / sr;
        d[i] = (Math.sin(2 * Math.PI * 2600 * t) * 0.45 + Math.sin(2 * Math.PI * 3900 * t) * 0.2) * Math.exp(-t * 12)
          + (Math.random() - 0.5) * 0.5 * Math.exp(-t * 80);
      }
    });
    buf.hurt = noise(0.25, (d, sr) => {
      let lp = 0;
      for (let i = 0; i < d.length; i++) {
        const t = i / sr, n = Math.random() * 2 - 1;
        lp += (n - lp) * 0.06;
        d[i] = (Math.sin(2 * Math.PI * 70 * t) * 0.8 + lp * 2) * Math.exp(-t * 14);
      }
    });
    buf.click = noise(0.05, (d, sr) => {
      for (let i = 0; i < d.length; i++) {
        const t = i / sr;
        d[i] = ((Math.random() - 0.5) * 0.8 + Math.sin(2 * Math.PI * 3200 * t) * 0.3) * Math.exp(-t * 140);
      }
    });
    buf.clack = noise(0.12, (d, sr) => {
      for (let i = 0; i < d.length; i++) {
        const t = i / sr;
        d[i] = ((Math.random() - 0.5) + Math.sin(2 * Math.PI * 900 * t) * 0.6) * Math.exp(-t * 45);
      }
    });
    buf.wind = noise(6, (d) => {
      let lp = 0;
      for (let i = 0; i < d.length; i++) { lp += ((Math.random() * 2 - 1) - lp) * 0.012; d[i] = lp * 3.5; }
    });
    // 石頭敲木頭：低沉的「叩」+ 木頭共鳴
    buf.chop = noise(0.3, (d, sr) => {
      let lp = 0;
      for (let i = 0; i < d.length; i++) {
        const t = i / sr, n = Math.random() * 2 - 1;
        lp += (n - lp) * 0.15;
        d[i] = (Math.sin(2 * Math.PI * 180 * t) * 0.7 + Math.sin(2 * Math.PI * 410 * t) * 0.3) * Math.exp(-t * 22)
          + lp * 1.5 * Math.exp(-t * 60);
      }
    });
    // 石頭敲到石頭/鐵：比較尖
    buf.clunk = noise(0.2, (d, sr) => {
      for (let i = 0; i < d.length; i++) {
        const t = i / sr;
        d[i] = ((Math.random() - 0.5) * 1.2 * Math.exp(-t * 70) + Math.sin(2 * Math.PI * 820 * t) * 0.35 * Math.exp(-t * 30));
      }
    });
    // 揮空：風切聲
    buf.whoosh = noise(0.35, (d, sr) => {
      let lp = 0;
      for (let i = 0; i < d.length; i++) {
        const t = i / sr, n = Math.random() * 2 - 1;
        lp += (n - lp) * (0.05 + 0.25 * Math.sin(Math.PI * t / 0.35));
        d[i] = lp * 2.2 * Math.sin(Math.PI * Math.min(1, t / 0.35));
      }
    });
    // 牆倒：一堆木頭碎裂
    buf.crash = noise(1.2, (d, sr) => {
      let lp = 0;
      for (let i = 0; i < d.length; i++) {
        const t = i / sr, n = Math.random() * 2 - 1;
        lp += (n - lp) * 0.08;
        const crack = Math.random() < 0.004 * Math.exp(-t * 3) ? 1 : 0;
        d[i] = lp * 2.5 * Math.exp(-t * 3) + crack * (Math.random() - 0.5) * 2 + Math.sin(2 * Math.PI * 60 * t) * Math.exp(-t * 6) * 0.6;
      }
    });
    // 落地：悶悶的一聲
    buf.land = noise(0.18, (d, sr) => {
      let lp = 0;
      for (let i = 0; i < d.length; i++) {
        const t = i / sr, n = Math.random() * 2 - 1;
        lp += (n - lp) * 0.1;
        d[i] = (lp * 2 + Math.sin(2 * Math.PI * 75 * t) * 0.8) * Math.exp(-t * 28);
      }
    });
    // 湯姆森：比 AK 短、比較脆
    buf.smg = noise(0.55, (d, sr) => {
      let lp = 0, lp2 = 0;
      for (let i = 0; i < d.length; i++) {
        const t = i / sr, n = Math.random() * 2 - 1;
        lp += (n - lp) * 0.12; lp2 += (n - lp2) * 0.03;
        const crack = n * Math.exp(-t * 90);
        const thump = Math.sin(2 * Math.PI * (130 - 50 * t) * t) * Math.exp(-t * 24) * 0.7;
        d[i] = Math.tanh((crack + thump + lp * Math.exp(-t * 20) * 2 + lp2 * Math.exp(-t * 6) * 1.6) * 1.3) * 0.85;
      }
    });
    // 弓弦：低頻撥弦 + 一點擦過的雜訊
    buf.twang = noise(0.5, (d, sr) => {
      for (let i = 0; i < d.length; i++) {
        const t = i / sr;
        d[i] = (Math.sin(2 * Math.PI * 105 * t) * 0.6 + Math.sin(2 * Math.PI * 210 * t) * 0.25) * Math.exp(-t * 9) + (Math.random() - 0.5) * 0.5 * Math.exp(-t * 60);
      }
    });
    buf.thunk = noise(0.2, (d, sr) => {
      let lp = 0;
      for (let i = 0; i < d.length; i++) {
        const t = i / sr, n = Math.random() * 2 - 1;
        lp += (n - lp) * 0.2;
        d[i] = (lp * 1.5 + Math.sin(2 * Math.PI * 160 * t) * 0.6) * Math.exp(-t * 35);
      }
    });
    // 爆炸：低頻轟 + 長長的碎裂尾音
    buf.boom = noise(2.4, (d, sr) => {
      let lp = 0, lp2 = 0;
      for (let i = 0; i < d.length; i++) {
        const t = i / sr, n = Math.random() * 2 - 1;
        lp += (n - lp) * 0.05; lp2 += (n - lp2) * 0.01;
        const crack = n * Math.exp(-t * 30) * 0.9;
        const body = Math.sin(2 * Math.PI * (55 - 20 * t) * t) * Math.exp(-t * 3.5) * 1.2;
        d[i] = Math.tanh((crack + body + lp * Math.exp(-t * 4) * 3 + lp2 * Math.exp(-t * 1.6) * 4) * 1.5) * 0.95;
      }
    });
    // 門：鉸鏈吱一聲 + 碰到門框
    buf.door = noise(0.6, (d, sr) => {
      let ph = 0;
      for (let i = 0; i < d.length; i++) {
        const t = i / sr;
        ph += 2 * Math.PI * (420 + 260 * Math.sin(t * 9)) / sr;
        const creak = Math.sign(Math.sin(ph)) * 0.08 * Math.exp(-((t - 0.18) ** 2) * 40);
        const hit = (Math.random() - 0.5) * 0.9 * Math.exp(-Math.max(0, t - 0.42) * 40) * (t > 0.42 ? 1 : 0);
        d[i] = creak + hit + Math.sin(2 * Math.PI * 90 * t) * 0.5 * (t > 0.42 ? Math.exp(-(t - 0.42) * 25) : 0);
      }
    });
    buf.beep = noise(0.12, (d, sr) => { for (let i = 0; i < d.length; i++) { const t = i / sr; d[i] = Math.sin(2 * Math.PI * 1320 * t) * 0.4 * (t < 0.1 ? 1 : 0); } });
    buf.buzz = noise(0.3, (d, sr) => { for (let i = 0; i < d.length; i++) { const t = i / sr; d[i] = Math.sign(Math.sin(2 * Math.PI * 180 * t)) * 0.18 * (t < 0.25 ? 1 : 0); } });
    buf.chime = noise(0.5, (d, sr) => {
      for (let i = 0; i < d.length; i++) {
        const t = i / sr;
        d[i] = (Math.sin(2 * Math.PI * 880 * t) * 0.3 + Math.sin(2 * Math.PI * 1320 * t) * 0.2) * Math.exp(-t * 7);
      }
    });
    buf.pop = noise(0.08, (d, sr) => { for (let i = 0; i < d.length; i++) { const t = i / sr; d[i] = Math.sin(2 * Math.PI * (500 - 2500 * t) * t) * 0.5 * Math.exp(-t * 40); } });
    // 吃東西：咬幾口的脆聲
    buf.eat = noise(0.95, (d, sr) => {
      let lp = 0;
      for (let i = 0; i < d.length; i++) {
        const t = i / sr, ph = (t * 4.2) % 1, n = Math.random() * 2 - 1;
        lp += (n - lp) * 0.35;
        d[i] = lp * 0.9 * Math.exp(-ph * 20) * (t < 0.9 ? 1 : 0);
      }
    });
    // 繃帶：布料摩擦的沙沙聲
    buf.bandage = noise(1.5, (d, sr) => {
      let lp = 0;
      for (let i = 0; i < d.length; i++) {
        const t = i / sr, n = Math.random() * 2 - 1;
        lp += (n - lp) * 0.3;
        d[i] = lp * 0.55 * (0.5 + 0.5 * Math.sin(t * 9)) * Math.min(1, t * 8) * Math.exp(-Math.max(0, t - 1.2) * 10);
      }
    });
    // 北極熊衝過來前的大吼：低頻、會抖的喉音
    buf.roar = noise(1.6, (d, sr) => {
      let ph = 0, lp = 0;
      for (let i = 0; i < d.length; i++) {
        const t = i / sr, n = Math.random() * 2 - 1;
        const f = 95 + 40 * Math.sin(t * 3.1) - 30 * t + 12 * Math.sin(t * 37);
        ph += 2 * Math.PI * f / sr;
        lp += (n - lp) * 0.12;
        const env = Math.min(1, t * 5) * Math.exp(-Math.max(0, t - 0.9) * 4.5);
        d[i] = Math.tanh((Math.sin(ph) * 0.8 + Math.sin(ph * 2.03) * 0.4 + lp * 1.6 * (1 + Math.sin(ph * 0.5))) * 1.6) * 0.75 * env;
      }
    });
    // 熊在附近晃的低吼
    buf.growl = noise(1.0, (d, sr) => {
      let ph = 0, lp = 0;
      for (let i = 0; i < d.length; i++) {
        const t = i / sr, n = Math.random() * 2 - 1;
        ph += 2 * Math.PI * (62 + 8 * Math.sin(t * 23)) / sr;
        lp += (n - lp) * 0.05;
        d[i] = (Math.sin(ph) * 0.5 + lp * 1.3) * Math.sin(Math.PI * Math.min(1, t)) * 0.75;
      }
    });
    // 熊爪：揮過去的風聲 + 打中的悶響
    buf.swipe = noise(0.45, (d, sr) => {
      let lp = 0;
      for (let i = 0; i < d.length; i++) {
        const t = i / sr, n = Math.random() * 2 - 1;
        lp += (n - lp) * 0.2;
        d[i] = lp * 1.3 * Math.exp(-((t - 0.12) ** 2) * 160) + Math.sin(2 * Math.PI * 80 * t) * 0.6 * (t > 0.2 ? Math.exp(-(t - 0.2) * 22) : 0);
      }
    });
    // 火箭筒發射：低沉的砰 + 長長的噴射嘶聲
    buf.launch = noise(1.2, (d, sr) => {
      let lp = 0;
      for (let i = 0; i < d.length; i++) {
        const t = i / sr, n = Math.random() * 2 - 1;
        lp += (n - lp) * 0.15;
        const thump = Math.sin(2 * Math.PI * (70 - 30 * t) * t) * Math.exp(-t * 10) * 0.9;
        const hiss = lp * 1.4 * Math.min(1, t * 20) * Math.exp(-t * 2.2);
        d[i] = Math.tanh((thump + hiss + n * 0.4 * Math.exp(-t * 40)) * 1.3) * 0.85;
      }
    });
    buf.inject = noise(0.5, (d, sr) => {
      for (let i = 0; i < d.length; i++) {
        const t = i / sr;
        d[i] = (Math.random() - 0.5) * 0.4 * Math.exp(-((t - 0.15) ** 2) * 200);
      }
    });
  }

  function ensure() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = volume; master.connect(ctx.destination);
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12; comp.ratio.value = 4;
    comp.connect(master);
    sfx = comp;
    build();
    // 環境風聲：一直在背景晃
    const src = ctx.createBufferSource(); src.buffer = buf.wind; src.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 500;
    windGain = ctx.createGain(); windGain.gain.value = 0.05;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.08;
    const lfoGain = ctx.createGain(); lfoGain.gain.value = 0.03;
    lfo.connect(lfoGain); lfoGain.connect(windGain.gain); lfo.start();
    src.connect(lp); lp.connect(windGain); windGain.connect(sfx); src.start();
  }

  function play(name, { gain = 1, rate = 1, at = null, dist = 0, when = 0 } = {}) {
    if (!ctx || !buf[name]) return;
    const src = ctx.createBufferSource();
    src.buffer = buf[name];
    src.playbackRate.value = rate;
    const g = ctx.createGain(); g.gain.value = gain;
    let node = src;
    if (at) {
      // 越遠越悶（高頻先被空氣吃掉）
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
      lp.frequency.value = Math.max(900, 18000 * Math.exp(-dist / 45));
      const pan = ctx.createPanner();
      pan.panningModel = 'HRTF'; pan.distanceModel = 'inverse';
      pan.refDistance = 4; pan.rolloffFactor = 1.1; pan.maxDistance = 400;
      if (pan.positionX) { pan.positionX.value = at.x; pan.positionY.value = at.y; pan.positionZ.value = at.z; }
      else pan.setPosition(at.x, at.y, at.z);
      node.connect(lp); lp.connect(pan); node = pan;
    }
    node.connect(g); g.connect(sfx);
    src.start(ctx.currentTime + when);
  }

  const api = {
    listenerPos: null,
    unlock: ensure,
    setVolume(v) { volume = v; if (master) master.gain.value = v; },
    setListener(pos, fwd) {
      api.listenerPos = pos;
      if (!ctx) return;
      const L = ctx.listener;
      if (L.positionX) {
        L.positionX.value = pos.x; L.positionY.value = pos.y; L.positionZ.value = pos.z;
        L.forwardX.value = fwd.x; L.forwardY.value = fwd.y; L.forwardZ.value = fwd.z;
        L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0;
      } else {
        L.setPosition(pos.x, pos.y, pos.z);
        L.setOrientation(fwd.x, fwd.y, fwd.z, 0, 1, 0);
      }
    },
    shot() { play('shot', { gain: 0.55, rate: 0.96 + Math.random() * 0.08 }); },
    shotAt(pos, dist, kind) { play(kind === 'thompson' ? 'smg' : 'shot', { gain: 1.4, rate: 0.94 + Math.random() * 0.08, at: pos, dist }); },
    smg() { play('smg', { gain: 0.5, rate: 0.96 + Math.random() * 0.08 }); },
    twang(at, dist) { play('twang', { gain: at ? 1.2 : 0.6, rate: 0.95 + Math.random() * 0.1, at, dist }); },
    thunk(at, dist) { play('thunk', { gain: at ? 1.0 : 0.6, rate: 0.9 + Math.random() * 0.2, at, dist }); },
    boom(at, dist) { play('boom', { gain: 1.8, rate: 0.95 + Math.random() * 0.1, at, dist: Math.max(0, (dist || 0) - 20) }); },
    door(at, dist) { play('door', { gain: at ? 1.1 : 0.7, rate: 0.95 + Math.random() * 0.1, at, dist }); },
    beep(ok = true) { play(ok ? 'beep' : 'buzz', { gain: 0.6 }); if (ok) play('beep', { gain: 0.5, rate: 1.25, when: 0.13 }); },
    chime() { play('chime', { gain: 0.5 }); },
    pop() { play('pop', { gain: 0.5, rate: 0.9 + Math.random() * 0.2 }); },
    step(loud = 1) { play('step', { gain: 0.16 * loud, rate: 0.85 + Math.random() * 0.3 }); },
    stepAt(pos, dist, loud = 1) { play('step', { gain: 1.1 * loud, rate: 0.85 + Math.random() * 0.3, at: pos, dist }); },
    hit(head) { play(head ? 'head' : 'hit', { gain: head ? 0.55 : 0.5 }); },
    hurt() { play('hurt', { gain: 0.9 }); },
    empty() { play('click', { gain: 0.5, rate: 0.8 }); },
    reload(total) {
      play('clack', { gain: 0.45, rate: 0.9, when: total * 0.2 });
      play('clack', { gain: 0.5, rate: 1.1, when: total * 0.6 });
      play('click', { gain: 0.6, rate: 0.7, when: total * 0.82 });
      play('clack', { gain: 0.4, rate: 1.3, when: total * 0.86 });
    },
    inject() { play('inject', { gain: 0.8 }); play('click', { gain: 0.4, rate: 1.4, when: 0.05 }); },
    launch(at, dist) { play('launch', { gain: at ? 1.6 : 0.9, rate: 0.95 + Math.random() * 0.1, at, dist }); },
    eat() { play('eat', { gain: 0.7, rate: 0.95 + Math.random() * 0.1 }); },
    // C4：有方向的短嗶聲（對方聽得到你家牆上被黏了一顆）
    c4beep(at) { play('beep', { gain: 1.4, rate: 1.35, at, dist: at && api.listenerPos ? at.distanceTo(api.listenerPos) : 0 }); },
    bandage() { play('bandage', { gain: 0.6 }); },
    roar(at, dist) { play('roar', { gain: 1.7, rate: 0.9 + Math.random() * 0.15, at, dist }); },
    growl(at, dist) { play('growl', { gain: 1.1, rate: 0.85 + Math.random() * 0.2, at, dist }); },
    swipe(at, dist) { play('swipe', { gain: 1.3, rate: 0.9 + Math.random() * 0.2, at, dist }); },
    // 風聲大小：雪地裡風比較大
    setWind(k) { if (windGain) windGain.gain.value = 0.05 * k; },
    chop(at, dist) { play('chop', { gain: at ? 1.2 : 0.7, rate: 0.9 + Math.random() * 0.2, at, dist }); },
    clunk(at, dist) { play('clunk', { gain: at ? 1.0 : 0.5, rate: 0.9 + Math.random() * 0.2, at, dist }); },
    whoosh(at, dist) { play('whoosh', { gain: at ? 0.8 : 0.35, rate: 0.9 + Math.random() * 0.2, at, dist }); },
    land() { play('land', { gain: 0.35, rate: 0.9 + Math.random() * 0.2 }); },
    crash(at, dist) { play('crash', { gain: 1.2, at, dist }); },
    // 蓋牆：連敲三下槌子
    build(at, dist) { for (let i = 0; i < 3; i++) play('chop', { gain: at ? 1 : 0.6, rate: 1.3 + i * 0.05, at, dist, when: i * 0.12 }); },
  };
  return api;
}
