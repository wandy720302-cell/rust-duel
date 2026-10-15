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

  return {
    unlock: ensure,
    setVolume(v) { volume = v; if (master) master.gain.value = v; },
    setListener(pos, fwd) {
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
    shotAt(pos, dist) { play('shot', { gain: 1.4, rate: 0.94 + Math.random() * 0.08, at: pos, dist }); },
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
  };
}
