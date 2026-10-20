// 手機觸控操作：左半邊浮動搖桿、右半邊拖曳轉視角、固定位置的按鈕。
// 開火鍵按住的同時手指拖曳也會轉視角 —— 不然手機沒辦法壓槍。

const ICON_FIRE = `<svg viewBox="0 0 64 18"><path d="M2 7.5 L13 5.6 L15.5 4.6 L41 4.6 L41 3.6 L57 3.6 L57 5.2 L62.5 5.2 L62.5 6.8 L41 6.8 L39 8.4 L34 8.4 L31.5 15.6 L27.2 16.4 L28.6 8.4 L22.5 8.4 L20.4 12.8 L17.2 12.6 L18.6 8.4 L14.5 8.6 L3.2 11.8 Z"/></svg>`;

export const isTouchDevice = () =>
  new URLSearchParams(location.search).has('touch')
  || matchMedia('(pointer: coarse)').matches
  || (navigator.maxTouchPoints > 0 && matchMedia('(hover: none)').matches);

export function createTouch(root, { onTap }) {
  root.innerHTML = `
    <div id="tStick"><div id="tKnob"></div></div>
    <button class="tbtn" data-b="pause" id="tPause" aria-label="暫停">❚❚</button>
    <button class="tbtn fire" data-b="fire" id="tFire" aria-label="開火">${ICON_FIRE}</button>
    <button class="tbtn fire2" data-b="fire" id="tFire2" aria-label="開火">${ICON_FIRE}</button>
    <button class="tbtn" data-b="aim" id="tAim">瞄準</button>
    <button class="tbtn" data-b="scope" id="tScope">照門</button>
    <button class="tbtn" data-b="jump" id="tJump">跳</button>
    <button class="tbtn" data-b="crouch" id="tCrouch">蹲</button>
    <button class="tbtn" data-b="reload" id="tReload">換彈</button>
    <button class="tbtn" data-b="inv" id="tInv" hidden aria-label="背包">背包</button>
    <button class="tbtn" data-b="use" id="tUse" hidden>E</button>
    <button class="tbtn" data-b="pick" id="tPick" hidden>選擇</button>
    <button class="tbtn" data-b="rot" id="tRot" hidden>轉</button>`;

  const stick = root.querySelector('#tStick'), knob = root.querySelector('#tKnob');
  const btn = (b) => root.querySelector(`#t${b[0].toUpperCase()}${b.slice(1)}`);
  const STICK_R = 56;

  const st = {
    active: false,
    mx: 0, my: 0,              // 搖桿 -1..1（my 往上推是負的）
    lookDX: 0, lookDY: 0,      // 這一幀累積的視角拖曳（px）
    fireCount: 0,              // 兩顆開火鍵可能同時按著
    aim: false, crouch: false, jump: false,
  };
  const touches = new Map();   // touch.identifier -> { kind, b, x, y, ox, oy }

  function setStick(ox, oy, x, y) {
    let dx = x - ox, dy = y - oy;
    const d = Math.hypot(dx, dy);
    if (d > STICK_R) { dx *= STICK_R / d; dy *= STICK_R / d; }
    st.mx = dx / STICK_R; st.my = dy / STICK_R;
    stick.style.left = `${ox}px`; stick.style.top = `${oy}px`;
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    stick.classList.toggle('sprint', sprinting());
  }
  function resetStick() {
    st.mx = st.my = 0;
    stick.style.left = ''; stick.style.top = '';
    knob.style.transform = '';
    stick.classList.remove('held', 'sprint');
  }
  const sprinting = () => Math.hypot(st.mx, st.my) > 0.92 && st.my < -0.7;

  // 按鈕的內容沒變就不要重寫：手指壓著的元素被換掉之後，放開的 touchend 會送不到這裡，
  // 開火鍵就會一直卡在按下（手機長按揮石頭會揮個不停就是這樣來的）
  const setHtml = (el, html) => { if (el._html !== html) { el._html = html; el.innerHTML = html; } };
  // 保險：每次有觸控事件就對一次帳，已經不在螢幕上的手指一律當作放開
  function reconcile(e) {
    if (!touches.size) return;
    const alive = new Set([...e.touches].map((t) => t.identifier));
    for (const [id, o] of touches) {
      if (alive.has(id)) continue;
      touches.delete(id);
      if (o.kind === 'stick') resetStick();
      else if (o.kind === 'btn') release(o.b);
    }
  }

  function press(b) {
    switch (b) {
      case 'fire': st.fireCount++; break;
      case 'aim': st.aim = !st.aim; break;
      case 'crouch': st.crouch = !st.crouch; break;
      case 'jump': st.jump = true; break;
      default: onTap?.(b);
    }
    syncButtons();
  }
  function release(b) {
    if (b === 'fire') st.fireCount = Math.max(0, st.fireCount - 1);
    syncButtons();
  }
  function syncButtons() {
    btn('aim').classList.toggle('on', st.aim);
    btn('crouch').classList.toggle('on', st.crouch);
    const f = st.fireCount > 0;
    btn('fire').classList.toggle('on', f);
    root.querySelector('#tFire2').classList.toggle('on', f);
  }

  // 只有在遊戲操作中才攔截觸控；其他時候（死亡畫面、暫停選單）讓按鈕正常點
  function onStart(e) {
    if (!st.active) return;
    reconcile(e);
    const slot = e.target.closest?.('#hotbar .slot');
    if (slot) { e.preventDefault(); onTap?.('slot', [...slot.parentNode.children].indexOf(slot)); return; }
    e.preventDefault();
    for (const t of e.changedTouches) {
      const el = t.target.closest?.('[data-b]');
      if (el) {
        touches.set(t.identifier, { kind: 'btn', b: el.dataset.b, x: t.clientX, y: t.clientY });
        press(el.dataset.b);
      } else if (t.clientX < innerWidth * 0.4) {
        const ox = Math.max(STICK_R + 12, Math.min(t.clientX, innerWidth * 0.4 - STICK_R));
        const oy = Math.max(STICK_R + 12, Math.min(t.clientY, innerHeight - STICK_R - 12));
        touches.set(t.identifier, { kind: 'stick', ox, oy });
        stick.classList.add('held');
        setStick(ox, oy, t.clientX, t.clientY);
      } else {
        touches.set(t.identifier, { kind: 'look', x: t.clientX, y: t.clientY });
      }
    }
  }
  function onMove(e) {
    if (!st.active) return;
    e.preventDefault();
    reconcile(e);
    for (const t of e.changedTouches) {
      const o = touches.get(t.identifier);
      if (!o) continue;
      if (o.kind === 'stick') setStick(o.ox, o.oy, t.clientX, t.clientY);
      else if (o.kind === 'look' || (o.kind === 'btn' && o.b === 'fire')) {
        st.lookDX += t.clientX - o.x; st.lookDY += t.clientY - o.y;
        o.x = t.clientX; o.y = t.clientY;
      }
    }
  }
  function onEnd(e) {
    for (const t of e.changedTouches) {
      const o = touches.get(t.identifier);
      if (!o) continue;
      touches.delete(t.identifier);
      if (o.kind === 'stick') resetStick();
      else if (o.kind === 'btn') release(o.b);
    }
    reconcile(e);
  }
  addEventListener('touchstart', onStart, { passive: false });
  addEventListener('touchmove', onMove, { passive: false });
  addEventListener('touchend', onEnd);
  addEventListener('touchcancel', onEnd);

  return {
    get mx() { return st.mx; },
    get my() { return st.my; },
    get fire() { return st.fireCount > 0; },
    get aim() { return st.aim; },
    get crouch() { return st.crouch; },
    get sprint() { return sprinting(); },
    consumeJump() { const j = st.jump; st.jump = false; return j; },
    consumeLook() { const d = { dx: st.lookDX, dy: st.lookDY }; st.lookDX = st.lookDY = 0; return d; },
    setAim(v) { st.aim = v; syncButtons(); },
    setSightLabel(t) { btn('scope').textContent = t; },
    // 手上換東西：開火鍵的圖示跟著換，非 AK 時把瞄準鍵藏起來
    // item：手上拿的東西（ak / thompson / rock / sword / bow / grenade / plan / none）
    // kind：生存模式的手持型態（build / deploy 時多一顆「轉」，build 再多一顆「選擇」）
    setMode(item, kind = null) {
      const gun = item === 'ak' || item === 'thompson' || item === 'launcher';
      const label = { rock: '揮', sword: '揮', hammer: '敲', plan: '放置', bow: '拉弓', grenade: '丟', c4: '丟', meat: '吃', cooked: '吃', bandage: '包紮', none: '—' }[item] || null;
      for (const id of ['#tFire', '#tFire2']) setHtml(root.querySelector(id), label ? `<span>${label}</span>` : ICON_FIRE);
      btn('aim').hidden = !gun && item !== 'bow';
      btn('reload').hidden = !gun;
      btn('scope').hidden = item !== 'ak';
      btn('pick').hidden = kind !== 'build';
      btn('rot').hidden = kind !== 'build' && kind !== 'deploy';
      if (!gun && item !== 'bow') { st.aim = false; syncButtons(); }
    },
    setSurvival(on) { btn('inv').hidden = !on; },
    setUse(text) { const b = btn('use'); b.hidden = !text; },
    setActive(v) {
      st.active = v;
      root.hidden = !v;
      if (!v) this.reset();
    },
    // 全部放開（切到背景、失去焦點時用）
    reset() {
      touches.clear(); resetStick();
      st.fireCount = 0; st.lookDX = st.lookDY = 0; st.jump = false;
      syncButtons();
    },
    get active() { return st.active; },
  };
}
