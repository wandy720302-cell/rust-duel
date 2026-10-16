// 生存模式的介面：背包（拖曳 / 點選搬移）、製作清單、容器（火爐、背包、地上的東西）、
// 製作佇列、電子鎖密碼鍵盤、建築藍圖選單、快捷欄。
// 電腦：拖曳搬東西、右鍵或雙擊快速搬。手機：點一下選取，再點目標格。
import { ITEMS, ICONS, RECIPES, PIECES, PIECE_ORDER } from './items.js';
import * as INV from './inventory.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const CATS = ['全部', '工具', '武器', '彈藥', '設施', '醫療'];

// 建築件的小圖
const PIECE_ICON = {
  found: '<svg viewBox="0 0 64 64"><path d="M8 36 L32 24 L56 36 L32 48 Z" fill="#9a7b54"/><path d="M8 36 V44 L32 56 V48 Z" fill="#6e5236"/><path d="M56 36 V44 L32 56 V48 Z" fill="#82633f"/></svg>',
  tfound: '<svg viewBox="0 0 64 64"><path d="M10 40 L32 22 L54 40 Z" fill="#9a7b54"/><path d="M10 40 V47 L54 47 V40 Z" fill="#6e5236"/></svg>',
  wall: '<svg viewBox="0 0 64 64"><rect x="12" y="10" width="40" height="44" fill="#8a6a46"/><path d="M12 19 H52 M12 28 H52 M12 37 H52 M12 46 H52" stroke="#5a4028" stroke-width="2"/></svg>',
  doorway: '<svg viewBox="0 0 64 64"><path d="M12 10 H52 V54 H40 V26 H24 V54 H12 Z" fill="#8a6a46"/><path d="M12 19 H52 M12 28 H24 M40 28 H52 M12 37 H24 M40 37 H52 M12 46 H24 M40 46 H52" stroke="#5a4028" stroke-width="2"/></svg>',
  floor: '<svg viewBox="0 0 64 64"><path d="M8 32 L32 20 L56 32 L32 44 Z" fill="#a8885e"/><path d="M14 29 L38 41 M20 26 L44 38 M26 23 L50 35" stroke="#7a5c3a" stroke-width="1.5"/></svg>',
  tfloor: '<svg viewBox="0 0 64 64"><path d="M10 40 L32 22 L54 40 Z" fill="#a8885e"/><path d="M18 34 L46 34 M24 28 L40 28" stroke="#7a5c3a" stroke-width="1.5"/></svg>',
  roof: '<svg viewBox="0 0 64 64"><path d="M6 44 L32 14 L58 44 Z" fill="#8f7a60"/><path d="M32 14 L32 44 M19 29 L45 29" stroke="#6a5844" stroke-width="2"/></svg>',
  troof: '<svg viewBox="0 0 64 64"><path d="M12 46 L32 16 L52 46 Z" fill="#8f7a60"/><path d="M32 16 L26 46" stroke="#6a5844" stroke-width="2"/></svg>',
};

// 內容沒變就不要重寫 DOM：重寫會把手指 / 滑鼠底下的按鈕換掉，那一下點擊就不算了
const setHTML = (el, html) => { if (el._html !== html) { el._html = html; el.innerHTML = html; } };

export function createInvUI({ surv, audio, onClose, isTouch }) {
  const root = $('inv');
  root.innerHTML = `
    <div class="invWrap">
      <section class="invCraft">
        <h3>製作</h3>
        <div class="craftTabs">${CATS.map((c, i) => `<button data-cat="${c}" class="${i ? '' : 'on'}">${c}</button>`).join('')}</div>
        <div class="craftList" id="craftList"></div>
        <div class="craftDetail" id="craftDetail"></div>
      </section>
      <section class="invBag">
        <h3>背包 <small>拖曳搬東西 · 右鍵快速搬 · 拖到外面丟掉</small></h3>
        <div class="islots main" id="invMain"></div>
        <h4>快捷欄</h4>
        <div class="islots hot" id="invHot"></div>
        <div class="itemInfo" id="itemInfo"></div>
      </section>
      <section class="invCont" id="invCont" hidden>
        <h3 id="contTitle"></h3>
        <div class="contBody" id="contBody"></div>
        <div class="contBtns" id="contBtns"></div>
      </section>
      <button class="invClose" id="invClose" aria-label="關閉">✕</button>
    </div>`;
  const ui = { cat: '全部', recipe: 'plan', times: 1, sel: null, drag: null };
  const arrOf = (where) => (where === 'main' ? surv.sv.inv.main : where === 'hot' ? surv.sv.inv.hot : surv.contOf(surv.sv.openCont)?.slots);

  function slotHtml(where, i, it, extra = '') {
    const sel = ui.sel && ui.sel.where === where && ui.sel.i === i ? ' sel' : '';
    const mag = it?.d?.mag !== undefined ? `<i class="mag">${it.d.mag}</i>` : '';
    return `<div class="islot${sel}${it ? '' : ' empty'}${extra}" data-where="${where}" data-i="${i}">${it ? ICONS[it.id] : ''}${it && it.n > 1 ? `<b>${it.n}</b>` : ''}${mag}</div>`;
  }

  function renderSlots() {
    const inv = surv.sv.inv;
    setHTML($('invMain'), inv.main.map((it, i) => slotHtml('main', i, it)).join(''));
    setHTML($('invHot'), inv.hot.map((it, i) => slotHtml('hot', i, it, i === surv.hotIdx ? ' active' : '')).join(''));
  }

  function renderInfo() {
    const box = $('itemInfo');
    const it = ui.sel ? arrOf(ui.sel.where)?.[ui.sel.i] : null;
    if (!it) { setHTML(box, '<p class="dim">點一下東西看說明。手機：點一格、再點另一格就能搬過去。</p>'); return; }
    const def = ITEMS[it.id];
    const fromInv = ui.sel.where !== 'cont';
    setHTML(box, `<div class="infoHead">${ICONS[it.id]}<div><b>${esc(def.name)}</b>${it.n > 1 ? ` <span>×${it.n}</span>` : ''}<p>${esc(def.desc || '')}</p></div></div>
      <div class="infoBtns">${fromInv ? `<button data-act="drop">丟在地上</button>${it.n > 1 ? '<button data-act="split">拆一半</button>' : ''}` : '<button data-act="take">拿走</button>'}</div>`);
  }

  function canMake(r, times = 1) { return Object.entries(r.cost).every(([id, n]) => surv.count(id) >= n * times); }
  function maxTimes(r) { return Math.max(1, Math.min(99, ...Object.entries(r.cost).map(([id, n]) => Math.floor(surv.count(id) / n)))); }
  function renderCraft() {
    const list = RECIPES.filter((r) => ui.cat === '全部' || ITEMS[r.id].cat === ui.cat);
    setHTML($('craftList'), list.map((r) => `<div class="crow${r.id === ui.recipe ? ' on' : ''}${canMake(r) ? '' : ' no'}" data-r="${r.id}">${ICONS[r.id]}<span>${esc(ITEMS[r.id].name)}${r.out > 1 ? ` ×${r.out}` : ''}</span><em>${r.time}s</em></div>`).join(''));
    const r = RECIPES.find((x) => x.id === ui.recipe) || RECIPES[0];
    ui.times = Math.min(ui.times, 99);
    const ok = canMake(r, ui.times);
    setHTML($('craftDetail'), `<div class="infoHead">${ICONS[r.id]}<div><b>${esc(ITEMS[r.id].name)}</b><p>${esc(ITEMS[r.id].desc || '')}</p></div></div>
      <table>${Object.entries(r.cost).map(([id, n]) => { const have = surv.count(id), need = n * ui.times; return `<tr class="${have >= need ? '' : 'lack'}"><td>${ICONS[id]}</td><td>${esc(ITEMS[id].name)}</td><td>${need}</td><td class="have">${have}</td></tr>`; }).join('')}</table>
      <div class="craftGo"><button data-act="minus">−</button><span>${ui.times}</span><button data-act="plus">+</button><button data-act="max">最多</button>
      <button class="go" data-act="craft" ${ok ? '' : 'disabled'}>製作${r.out * ui.times > 1 ? ` ×${r.out * ui.times}` : ''}</button></div>`);
  }

  function renderCont() {
    const panel = $('invCont');
    const c = surv.sv.openCont ? surv.contOf(surv.sv.openCont) : null;
    root.querySelector('.invWrap').classList.toggle('looting', !!c);
    if (!c) { panel.hidden = true; return; }
    panel.hidden = false;
    const isFurn = surv.sv.furn.has(c.id);
    $('contTitle').textContent = isFurn ? '火爐' : c.kind === 'bag' ? '掉落的背包' : '地上的東西';
    if (isFurn) {
      const s = (j, label) => `<div class="fslot"><small>${label}</small>${slotHtml('cont', j, c.slots[j])}</div>`;
      setHTML($('contBody'), `<div class="furnace">
        <div class="frow">${s(0, '燃料（木頭）')}</div>
        <div class="frow">${s(1, '礦石')}${s(2, '礦石')}</div>
        <div class="fstate ${c.on ? 'on' : ''}">${c.on ? '🔥 燒煉中' : '熄火'}</div>
        <div class="frow">${s(3, '成品')}${s(4, '成品')}${s(5, '成品')}</div></div>`);
      setHTML($('contBtns'), `<button data-act="toggle" class="${c.on ? '' : 'go'}">${c.on ? '熄火' : '點火'}</button><button data-act="takeall">全部拿走</button>`);
    } else {
      setHTML($('contBody'), `<div class="islots cont">${c.slots.map((it, j) => slotHtml('cont', j, it)).join('')}</div>`);
      setHTML($('contBtns'), '<button data-act="takeall" class="go">全部拿走</button>');
    }
  }

  function render() {
    if (root.hidden) return;
    renderSlots(); renderInfo(); renderCraft(); renderCont();
  }
  surv.onChange(() => { render(); renderQueue(); });

  // ---------- 搬東西 ----------
  function moveItem(from, to) {
    if (!from || !to || (from.where === to.where && from.i === to.i)) return;
    const inv = surv.sv.inv;
    if (from.where !== 'cont' && to.where !== 'cont') {
      INV.move(arrOf(from.where), from.i, arrOf(to.where), to.i);
      audio.pop();
    } else if (from.where !== 'cont' && to.where === 'cont') surv.contPut(arrOf(from.where), from.i, to.i);
    else if (from.where === 'cont' && to.where !== 'cont') surv.contTake(from.i);
    void inv;
    ui.sel = null;
    surv.refresh();
  }
  function quickMove(where, i) {
    const inv = surv.sv.inv;
    if (where === 'cont') { surv.contTake(i); return; }
    if (surv.sv.openCont) { surv.contQuickPut(arrOf(where), i); return; }
    const to = where === 'main' ? inv.hot : inv.main;
    const j = to.findIndex((x) => !x);
    if (j >= 0) { INV.move(arrOf(where), i, to, j); audio.pop(); surv.refresh(); }
  }
  const slotOf = (el) => (el ? { where: el.dataset.where, i: +el.dataset.i } : null);

  let ghost = null;
  root.addEventListener('pointerdown', (e) => {
    const el = e.target.closest('.islot');
    if (!el || e.button === 2) return;
    const s = slotOf(el);
    if (!arrOf(s.where)?.[s.i]) {
      // 點空格：如果有選起來的東西就搬過來
      if (ui.sel) { moveItem(ui.sel, s); }
      return;
    }
    ui.drag = { s, x: e.clientX, y: e.clientY, moved: false, id: e.pointerId };
    e.preventDefault();
  });
  addEventListener('pointermove', (e) => {
    const d = ui.drag;
    if (!d || e.pointerId !== d.id) return;
    if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 7) {
      d.moved = true;
      const it = arrOf(d.s.where)?.[d.s.i];
      ghost = document.createElement('div');
      ghost.className = 'dragGhost';
      ghost.innerHTML = it ? ICONS[it.id] : '';
      document.body.appendChild(ghost);
    }
    if (ghost) { ghost.style.left = `${e.clientX}px`; ghost.style.top = `${e.clientY}px`; }
  });
  addEventListener('pointerup', (e) => {
    const d = ui.drag;
    if (!d || e.pointerId !== d.id) return;
    ui.drag = null;
    if (ghost) { ghost.remove(); ghost = null; }
    if (d.moved) {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const target = el?.closest?.('.islot');
      if (target) moveItem(d.s, slotOf(target));
      else if (!el?.closest?.('.invWrap') && d.s.where !== 'cont') { surv.dropFromSlot(arrOf(d.s.where), d.s.i); ui.sel = null; }
      return;
    }
    // 點一下：已經選了別格就搬過去，不然就選這一格
    if (ui.sel && (ui.sel.where !== d.s.where || ui.sel.i !== d.s.i)) moveItem(ui.sel, d.s);
    else { ui.sel = ui.sel && ui.sel.where === d.s.where && ui.sel.i === d.s.i ? null : d.s; render(); }
  });
  root.addEventListener('contextmenu', (e) => {
    const el = e.target.closest('.islot');
    e.preventDefault();
    if (el) { const s = slotOf(el); if (arrOf(s.where)?.[s.i]) quickMove(s.where, s.i); }
  });
  root.addEventListener('dblclick', (e) => {
    const el = e.target.closest('.islot');
    if (el && !isTouch) { const s = slotOf(el); if (arrOf(s.where)?.[s.i]) quickMove(s.where, s.i); }
  });
  root.addEventListener('click', (e) => {
    const tab = e.target.closest('[data-cat]');
    if (tab) { ui.cat = tab.dataset.cat; root.querySelectorAll('[data-cat]').forEach((b) => b.classList.toggle('on', b === tab)); renderCraft(); return; }
    const row = e.target.closest('[data-r]');
    if (row) { ui.recipe = row.dataset.r; ui.times = 1; renderCraft(); return; }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    const r = RECIPES.find((x) => x.id === ui.recipe);
    if (act === 'minus') { ui.times = Math.max(1, ui.times - 1); renderCraft(); }
    else if (act === 'plus') { ui.times = Math.min(99, ui.times + 1); renderCraft(); }
    else if (act === 'max') { ui.times = maxTimes(r); renderCraft(); }
    else if (act === 'craft') { surv.craft(ui.recipe, ui.times); ui.times = 1; }
    else if (act === 'drop' && ui.sel) { surv.dropFromSlot(arrOf(ui.sel.where), ui.sel.i); ui.sel = null; }
    else if (act === 'split' && ui.sel) { INV.splitHalf(arrOf(ui.sel.where), ui.sel.i); surv.refresh(); }
    else if (act === 'take' && ui.sel) { surv.contTake(ui.sel.i); ui.sel = null; }
    else if (act === 'toggle') surv.contToggle();
    else if (act === 'takeall') surv.contTakeAll();
  });
  $('invClose').addEventListener('click', () => onClose());

  // ---------- 製作佇列（畫面右下，背包關著也看得到） ----------
  function renderQueue() {
    const q = surv.sv.queue;
    const box = $('craftQueue');
    if (!q.length) { setHTML(box, ''); return; }
    setHTML(box, q.map((x, i) => `<div class="qrow${x.blocked ? ' blocked' : ''}" data-q="${i}" title="點一下取消">${ICONS[x.id]}<span>${esc(ITEMS[x.id].name)}${x.count > 1 ? ` ×${x.count}` : ''}</span><em>${x.blocked ? '背包滿' : `${Math.ceil(x.left)}s`}</em></div>`).join(''));
  }
  $('craftQueue').addEventListener('click', (e) => {
    const row = e.target.closest('[data-q]');
    if (row && !root.hidden) surv.cancelCraft(+row.dataset.q);
  });
  setInterval(() => { if (surv.sv.queue.length) renderQueue(); }, 250);

  // ---------- 快捷欄（HUD 上的那排） ----------
  function renderHotbar() {
    const inv = surv.sv.inv;
    setHTML($('hotbar'), inv.hot.map((it, i) => `<div class="slot${i === surv.hotIdx ? ' active' : ''}${it ? '' : ' emptySlot'}" data-hot="${i}">
      <span class="key">${i + 1}</span>${it ? ICONS[it.id] : ''}<span class="qty">${it ? (it.d?.mag !== undefined ? it.d.mag : it.n > 1 ? it.n : '') : ''}</span></div>`).join(''));
  }
  surv.onChange(renderHotbar);

  // ---------- 電子鎖鍵盤 ----------
  let keypadCb = null, code = '';
  $('keypad').innerHTML = `<div class="panel keypadBox"><h3 id="kpTitle"></h3><div class="kpScreen" id="kpScreen"></div>
    <div class="kpKeys">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button data-k="${n}">${n}</button>`).join('')}<button data-k="c">清除</button><button data-k="0">0</button><button data-k="ok" class="go">確定</button></div>
    <button class="btn ghost" data-k="x">取消</button></div>`;
  const kpShow = () => { $('kpScreen').textContent = code.padEnd(4, '·').split('').join(' '); };
  $('keypad').addEventListener('click', (e) => {
    const k = e.target.closest('[data-k]')?.dataset.k;
    if (!k) return;
    if (k === 'x') { closeKeypad(null); return; }
    if (k === 'c') code = '';
    else if (k === 'ok') { if (code.length === 4) closeKeypad(code); else audio.beep(false); return; }
    else if (code.length < 4) { code += k; audio.pop(); }
    kpShow();
  });
  addEventListener('keydown', (e) => {
    if ($('keypad').hidden) return;
    if (/^\d$/.test(e.key) && code.length < 4) { code += e.key; kpShow(); audio.pop(); }
    else if (e.key === 'Backspace') { code = code.slice(0, -1); kpShow(); }
    else if (e.key === 'Enter') { if (code.length === 4) closeKeypad(code); }
    else if (e.key === 'Escape') closeKeypad(null);
  });
  function openKeypad(title, cb) {
    keypadCb = cb; code = '';
    $('kpTitle').textContent = title;
    kpShow();
    $('keypad').hidden = false;
  }
  function closeKeypad(result) {
    $('keypad').hidden = true;
    const cb = keypadCb; keypadCb = null;
    cb?.(result);
    onClose(true);
  }

  // ---------- 建築藍圖選單 ----------
  $('buildMenu').innerHTML = `<div class="panel buildBox"><h3>要蓋什麼？</h3><div class="buildGrid">${PIECE_ORDER.map((t) => `<button data-p="${t}">${PIECE_ICON[t]}<b>${esc(PIECES[t].name)}</b><em>${PIECES[t].cost} 木頭</em></button>`).join('')}</div>
    <small>${isTouch ? '按「轉」可以旋轉自由放的地基' : '右鍵打開這個選單 · R 旋轉自由放的地基'}</small></div>`;
  $('buildMenu').addEventListener('click', (e) => {
    const b = e.target.closest('[data-p]');
    if (b) { surv.setBuildType(b.dataset.p); hl(); }
    $('buildMenu').hidden = true;
    onClose(true);
  });
  const hl = () => $('buildMenu').querySelectorAll('[data-p]').forEach((b) => b.classList.toggle('on', b.dataset.p === surv.buildType));

  return {
    open() { root.hidden = false; ui.sel = null; render(); },
    close() { root.hidden = true; ui.sel = null; if (ghost) { ghost.remove(); ghost = null; } surv.closeContainer(); },
    get isOpen() { return !root.hidden; },
    openKeypad, renderHotbar, renderQueue,
    get keypadOpen() { return !$('keypad').hidden; },
    openBuildMenu() { hl(); $('buildMenu').hidden = false; },
    get buildOpen() { return !$('buildMenu').hidden; },
    closeAll() { root.hidden = true; $('keypad').hidden = true; $('buildMenu').hidden = true; keypadCb = null; ui.sel = null; surv.closeContainer(); },
  };
}
