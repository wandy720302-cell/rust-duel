// rust 風格 HUD：右下狀態條、底部快捷欄、頂部羅盤、右上擊殺通知
import { ICONS } from './items.js';
const $ = (id) => document.getElementById(id);

export const ICON = {
  ak: `<svg viewBox="0 0 64 18" class="ico"><path d="M2 7.5 L13 5.6 L15.5 4.6 L41 4.6 L41 3.6 L57 3.6 L57 5.2 L62.5 5.2 L62.5 6.8 L41 6.8 L39 8.4 L34 8.4 L31.5 15.6 L27.2 16.4 L28.6 8.4 L22.5 8.4 L20.4 12.8 L17.2 12.6 L18.6 8.4 L14.5 8.6 L3.2 11.8 Z"/></svg>`,
  syringe: `<svg viewBox="0 0 64 18" class="ico"><path d="M8 7 h4 v-3 h3 v3 h22 v4 h-22 v3 h-3 v-3 h-4 z M37 8 h8 v2 h-8 z M45 8.6 h14 v0.8 h-14 z"/></svg>`,
  rock: `<svg viewBox="0 0 64 18" class="ico"><path d="M20 14 L18 9 L23 4 L33 3 L42 6 L45 11 L40 15 L28 16 Z"/></svg>`,
  wall: `<svg viewBox="0 0 64 18" class="ico"><path d="M18 2 h28 v15 h-28 z M20.5 4 v11 h3 v-11 z M26 4 v11 h3 v-11 z M31.5 4 v11 h3 v-11 z M37 4 v11 h3 v-11 z M42 4 v11 h2 v-11 z" fill-rule="evenodd"/></svg>`,
  wood: `<svg viewBox="0 0 64 18" class="ico"><path d="M14 6 h30 a3.5 3.5 0 0 1 0 7 h-30 a3.5 3.5 0 0 1 0 -7z M20 8 h30 a3.5 3.5 0 0 1 0 7 h-30z" opacity=".9"/><circle cx="44" cy="9.5" r="2.2" fill="#2a2620"/></svg>`,
  thompson: ICONS.thompson, sword: ICONS.sword, bow: ICONS.bow, grenade: ICONS.grenade, bear: ICONS.bearpaw, starve: ICONS.starve,
  skull: `<svg viewBox="0 0 16 16" class="ico skull"><path d="M8 1 C3.5 1 2 4 2 7 c0 2 1 3 2 3.6 V13 h2 v-1.5 h1 V13 h2 v-1.5 h1 V13 h2 v-2.4 C13 10 14 9 14 7 14 4 12.5 1 8 1z M5.5 6 a1.4 1.4 0 1 1 0 2.8 a1.4 1.4 0 1 1 0-2.8z M10.5 6 a1.4 1.4 0 1 1 0 2.8 a1.4 1.4 0 1 1 0-2.8z"/></svg>`,
};

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function initHud() {
  // 羅盤：-180~540 度鋪一條長帶，靠位移顯示目前朝向
  const strip = $('compassStrip');
  const names = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
  let html = '';
  for (let d = -180; d <= 540; d += 15) {
    const n = ((d % 360) + 360) % 360;
    const label = names[n];
    html += `<span class="tick ${label ? 'major' : ''}" style="left:${(d + 180) * 4}px">${label || (d % 45 === 0 ? '' : n)}</span>`;
  }
  strip.innerHTML = html;

  const slots = [
    { icon: ICON.ak, id: 'slotAk', key: 1 },
    { icon: ICON.syringe, id: 'slotSyr', key: 2 },
    { icon: ICON.rock, id: 'slotRock', key: 3, title: '石頭：敲樹拿木頭，也能敲人' },
    { icon: ICON.wall, id: 'slotWall', key: 4, title: '木牆：100 木頭' },
    { icon: ICON.wood, id: 'slotWood', key: 5, title: '木頭' },
    {},
  ];
  $('hotbar').innerHTML = slots.map((s, i) => `
    <div class="slot ${i === 0 ? 'active' : ''}" ${s.id ? `id="${s.id}"` : ''} ${s.title ? `title="${s.title}"` : ''}>
      <span class="key">${i + 1}</span>${s.icon || ''}<span class="qty"></span>${i === 0 || i === 2 ? '<i class="cond"></i>' : ''}
    </div>`).join('');
}

let lastHp = -1, lastAmmo = '', lastHeading = -999;
export const hud = {
  show(v) { $('hud').hidden = !v; },
  health(hp) {
    const v = Math.max(0, Math.ceil(hp));
    if (v === lastHp) return;
    lastHp = v;
    $('hpBar').style.width = v + '%';
    $('hpVal').textContent = v;
    $('hpRow').classList.toggle('low', v <= 30);
  },
  survival(water, food) {
    $('waterBar').style.width = Math.min(100, water) + '%'; $('waterVal').textContent = Math.round(water);
    $('foodBar').style.width = Math.min(100, food / 5) + '%'; $('foodVal').textContent = Math.round(food);
    $('foodRow').classList.toggle('low', food < 40);
  },
  // max 是 null 代表不是彈匣（箭、手雷只顯示數量）；n 是 null 就把彈藥框藏起來
  ammo(n, max, reloading, label = '5.56 步槍彈') {
    const s = `${n}|${max}|${reloading}|${label}`;
    if (s === lastAmmo) return;
    lastAmmo = s;
    $('ammoBox').hidden = n === null;
    if (n === null) return;
    $('ammoNow').textContent = n;
    $('ammoMax').textContent = max === null ? '' : `/ ${max}`;
    $('ammoBox').querySelector('small').textContent = label;
    $('ammoBox').classList.toggle('empty', n === 0);
    const q = document.querySelector('#slotAk .qty');
    if (q) q.textContent = n;
  },
  syringes(n) { const q = document.querySelector('#slotSyr .qty'); if (!q) return; q.textContent = n ? `×${n}` : ''; $('slotSyr').classList.toggle('used', !n); },
  // sub：比分下面那行小字（生存模式放倒數計時）
  score(me, opp, meName, oppName, target, sub = null) {
    const note = sub ?? (target ? `先 ${target} 殺獲勝` : '練習模式：稻草人擊殺數');
    $('score').innerHTML = target || sub
      ? `<span class="me">${esc(meName)}</span><b>${me}</b>${oppName ? `<i>:</i><b>${opp}</b><span class="op">${esc(oppName)}</span>` : ''}<em>${esc(note)}</em>`
      : `<span class="me">${esc(meName)}</span><b>${me}</b><em>${esc(note)}</em>`;
  },
  interact(text) {
    const el = $('interact');
    if (!text) { el.hidden = true; return; }
    el.hidden = false;
    if (el.dataset.t !== text) { el.dataset.t = text; el.innerHTML = `<kbd>E</kbd> ${esc(text)}`; }
  },
  compass(yaw) {
    const heading = ((-yaw * 180 / Math.PI) % 360 + 360) % 360;
    if (Math.abs(heading - lastHeading) < 0.05) return;
    lastHeading = heading;
    $('compassStrip').style.transform = `translateX(${180 - (heading + 180) * 4}px)`;
    $('heading').textContent = Math.round(heading) % 360;
  },
  killfeed(killer, victim, { head = false, mine = false, weapon = 'ak' } = {}) {
    const el = document.createElement('div');
    el.className = 'kf' + (mine ? ' mine' : '');
    el.innerHTML = `<b>${esc(killer)}</b>${ICON[weapon] || ICON.ak}${head ? ICON.skull : ''}<b class="v">${esc(victim)}</b>`;
    $('killfeed').prepend(el);
    setTimeout(() => el.classList.add('out'), 6000);
    setTimeout(() => el.remove(), 6600);
    while ($('killfeed').children.length > 5) $('killfeed').lastChild.remove();
  },
  hitmarker(head) {
    const h = $('hitmarker');
    h.className = ''; void h.offsetWidth;
    h.className = head ? 'show head' : 'show';
  },
  hurt(deg) {
    const v = $('hurt');
    v.classList.remove('show'); void v.offsetWidth; v.classList.add('show');
    const d = document.createElement('div');
    d.className = 'dmgArc';
    d.style.transform = `translate(-50%,-50%) rotate(${deg}deg)`;
    $('dmgdir').appendChild(d);
    setTimeout(() => d.remove(), 1200);
  },
  action(text, progress) {
    const a = $('action');
    if (!text) { a.hidden = true; return; }
    a.hidden = false;
    $('actionText').textContent = text;
    $('actionBar').style.width = Math.round(progress * 100) + '%';
  },
  crosshair(spreadPx, ads) {
    $('cross').style.setProperty('--gap', spreadPx + 'px');
    $('cross').classList.toggle('ads', ads > 0.6);
  },
  sight(short) { const el = $('slotAk'); if (el) el.dataset.sight = short; },
  scope(on) { $('scopeOverlay').classList.toggle('on', on); },
  // 快捷欄：0=AK 2=石頭 3=木牆
  activeSlot(i) {
    document.querySelectorAll('#hotbar .slot').forEach((el, k) => el.classList.toggle('active', k === i));
  },
  wood(n, cost) {
    if (!$('slotWood')) return;
    document.querySelector('#slotWood .qty').textContent = n;
    document.querySelector('#slotWall .qty').textContent = cost;
    $('slotWall').classList.toggle('used', n < cost);
    $('slotWood').classList.toggle('used', n <= 0);
  },
  look(text) {
    const el = $('lookInfo');
    if (el.textContent !== (text || '')) el.textContent = text || '';
    el.hidden = !text;
  },
  hint(text, ok) {
    const el = $('buildHint');
    if (!text) { el.hidden = true; return; }
    el.hidden = false;
    if (el.textContent !== text) el.textContent = text;
    el.classList.toggle('bad', !ok);
  },
  // 右下角的撿取通知（rust 的 +25 Wood）
  pickup(name, amount) {
    const box = $('pickups');
    const el = document.createElement('div');
    el.className = 'pick';
    el.innerHTML = `<span>${esc(name)}</span><b>${esc(amount)}</b>`;
    box.appendChild(el);
    setTimeout(() => el.classList.add('out'), 1600);
    setTimeout(() => el.remove(), 2100);
    while (box.children.length > 4) box.firstChild.remove();
  },
  toast(text, ms = 2500) {
    const t = $('toast');
    t.textContent = text; t.classList.add('show');
    clearTimeout(t._tm);
    t._tm = setTimeout(() => t.classList.remove('show'), ms);
  },
  ping(ms) { $('ping').textContent = ms == null ? '' : `${Math.round(ms)} ms`; },
};
