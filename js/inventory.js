// 背包、容器、製作佇列、火爐冶煉的純邏輯。不碰畫面，node 也能直接測。
// 一格的格式：{ id, n, d? }，d 是單一物品自己的資料（例如槍的彈匣剩幾發）。
import { ITEMS, SMELT } from './items.js';

export const HOT = 6, MAIN = 24;
export const stackOf = (id) => ITEMS[id]?.stack || 1;
const freshData = (id) => (ITEMS[id]?.mag ? { mag: ITEMS[id].mag } : null);
export const cloneItem = (it) => (it ? { id: it.id, n: it.n, ...(it.d ? { d: { ...it.d } } : {}) } : null);

export function createInv() {
  return { hot: Array(HOT).fill(null), main: Array(MAIN).fill(null) };
}
export function clearInv(inv) { inv.hot.fill(null); inv.main.fill(null); }

// 放進一排格子（背包或容器）：先疊到同類的堆上，再找空格。回傳放不下的數量
export function addToSlots(slots, id, n, d = null, from = 0, to = slots.length) {
  let left = n;
  const st = stackOf(id);
  if (st > 1) {
    for (let i = from; i < to && left > 0; i++) {
      const s = slots[i];
      if (s && s.id === id && s.n < st) { const k = Math.min(st - s.n, left); s.n += k; left -= k; }
    }
  }
  for (let i = from; i < to && left > 0; i++) {
    if (slots[i]) continue;
    const k = Math.min(st, left);
    const data = d || freshData(id);
    slots[i] = data ? { id, n: k, d: { ...data } } : { id, n: k };
    left -= k;
  }
  return left;
}

// 撿到東西：能疊的先疊，再找空格；工具武器優先放快捷欄，資源優先放背包
export function add(inv, id, n, d = null) {
  let left = n;
  const st = stackOf(id);
  if (st > 1) {
    for (const arr of [inv.hot, inv.main]) {
      for (const s of arr) {
        if (left > 0 && s && s.id === id && s.n < st) { const k = Math.min(st - s.n, left); s.n += k; left -= k; }
      }
    }
  }
  const order = ITEMS[id]?.hold ? [inv.hot, inv.main] : [inv.main, inv.hot];
  for (const arr of order) if (left > 0) left = addToSlots(arr, id, left, d);
  return left;
}

// 背包（快捷欄 + 背包）還放得下幾個
export function roomFor(inv, id) {
  const st = stackOf(id);
  let n = 0;
  for (const arr of [inv.hot, inv.main]) for (const s of arr) {
    if (!s) n += st;
    else if (st > 1 && s.id === id) n += st - s.n;
  }
  return n;
}

export function count(inv, id) {
  let n = 0;
  for (const arr of [inv.hot, inv.main]) for (const s of arr) if (s && s.id === id) n += s.n;
  return n;
}
export const hasCost = (inv, cost, times = 1) => Object.entries(cost).every(([id, n]) => count(inv, id) >= n * times);

// 拿掉 n 個（夠才拿，不夠就什麼都不動）。先從背包拿，快捷欄最後
export function take(inv, id, n) {
  if (count(inv, id) < n) return false;
  let left = n;
  for (const arr of [inv.main, inv.hot]) {
    for (let i = 0; i < arr.length && left > 0; i++) {
      const s = arr[i];
      if (!s || s.id !== id) continue;
      const k = Math.min(s.n, left);
      s.n -= k; left -= k;
      if (s.n <= 0) arr[i] = null;
    }
  }
  return true;
}
export function takeCost(inv, cost, times = 1) {
  if (!hasCost(inv, cost, times)) return false;
  for (const [id, n] of Object.entries(cost)) take(inv, id, n * times);
  return true;
}

// 拖曳：拖到空格就移過去、拖到同類就疊、拖到別的東西就交換。n 有給就只搬那麼多
export function move(a, i, b, j, n = null) {
  if (a === b && i === j) return;
  const s = a[i];
  if (!s) return;
  const t = b[j];
  const amt = n == null ? s.n : Math.max(1, Math.min(n, s.n));
  if (!t) {
    if (amt === s.n) { b[j] = s; a[i] = null; } else { b[j] = { ...cloneItem(s), n: amt }; s.n -= amt; }
    return;
  }
  if (t.id === s.id && stackOf(s.id) > 1) {
    const k = Math.min(stackOf(s.id) - t.n, amt);
    t.n += k; s.n -= k;
    if (s.n <= 0) a[i] = null;
    return;
  }
  if (amt === s.n) { a[i] = t; b[j] = s; }
}

// 一堆拆一半到同一排的空格
export function splitHalf(arr, i) {
  const s = arr[i];
  if (!s || s.n < 2) return false;
  const j = arr.findIndex((x) => !x);
  if (j < 0) return false;
  const half = Math.floor(s.n / 2);
  arr[j] = { ...cloneItem(s), n: half };
  s.n -= half;
  return true;
}

export function allItems(inv) {
  return [...inv.hot, ...inv.main].filter(Boolean).map(cloneItem);
}

// ---------- 容器（死掉的背包、地上的東西、火爐） ----------
// 往容器某一格放東西：空的就放、同類就疊；放不下的部分回傳
export function putInto(slots, j, item) {
  const t = slots[j];
  if (!t) { slots[j] = cloneItem(item); return null; }
  if (t.id === item.id && stackOf(item.id) > 1) {
    const k = Math.min(stackOf(item.id) - t.n, item.n);
    t.n += k;
    return item.n - k > 0 ? { ...cloneItem(item), n: item.n - k } : null;
  }
  return cloneItem(item);
}
export function takeFrom(slots, j) {
  const s = slots[j];
  slots[j] = null;
  return s;
}
export const isEmpty = (slots) => slots.every((s) => !s);

// ---------- 火爐 ----------
// 格子：0 燃料（木頭）、1~2 礦石、3~5 成品
export const FURNACE = { FUEL: 0, IN: [1, 2], OUT: [3, 4, 5], SIZE: 6 };
const PRODUCT = { metal_ore: 'metal', sulfur_ore: 'sulfur' };
export function furnaceAccepts(j, id) {
  if (j === FURNACE.FUEL) return id === 'wood';
  if (FURNACE.IN.includes(j)) return !!PRODUCT[id];
  return false;
}
// 每過 1 秒：燒 1 木頭、煉 2 礦石。沒燃料或沒東西可煉就自動熄火（省得白燒）
export function smeltTick(f, dt) {
  if (!f.on) return false;
  f.acc = (f.acc || 0) + dt;
  let changed = false;
  while (f.acc >= 1 && f.on) {
    f.acc -= 1;
    const fuel = f.slots[FURNACE.FUEL];
    if (!fuel || fuel.n <= 0) { f.on = false; changed = true; break; }
    let did = false;
    for (const k of FURNACE.IN) {
      const s = f.slots[k];
      if (!s || !PRODUCT[s.id]) continue;
      const amt = Math.min(SMELT.orePerSec, s.n);
      const left = addToSlots(f.slots, PRODUCT[s.id], amt, null, FURNACE.OUT[0], FURNACE.OUT[FURNACE.OUT.length - 1] + 1);
      const used = amt - left;
      if (used > 0) { s.n -= used; if (s.n <= 0) f.slots[k] = null; did = true; }
    }
    if (!did) { f.on = false; changed = true; break; }
    fuel.n -= SMELT.fuelPerSec;
    if (fuel.n <= 0) f.slots[FURNACE.FUEL] = null;
    changed = true;
  }
  return changed;
}

// ---------- 製作佇列 ----------
// 一筆：{ id, left, total, count }；材料在排進佇列時就扣掉，取消會退回剩下的份
export function startCraft(inv, queue, recipe, times = 1) {
  if (!takeCost(inv, recipe.cost, times)) return false;
  queue.push({ id: recipe.id, out: recipe.out, left: recipe.time, total: recipe.time, count: times, cost: recipe.cost });
  return true;
}
// canFit(id, n)：有給的話，放不下就停在「做好了」那一步等（q.blocked），不會一直往地上丟；
// 而且一次最多完成一個，讓呼叫的人先放進背包再判斷下一個
export function tickCraft(queue, dt, canFit = null) {
  const done = [];
  let t = dt;
  while (queue.length && t > 0) {
    const q = queue[0];
    const step = Math.min(t, q.left);
    q.left -= step; t -= step;
    if (q.left <= 1e-6) {
      q.left = 0;
      if (canFit && !canFit(q.id, q.out)) { q.blocked = true; break; }
      q.blocked = false;
      done.push({ id: q.id, n: q.out });
      q.count -= 1;
      if (q.count <= 0) queue.shift(); else q.left = q.total;
      if (canFit) break;
    }
  }
  return done;
}
export function cancelCraft(inv, queue, idx) {
  const q = queue[idx];
  if (!q) return [];
  queue.splice(idx, 1);
  const refund = [];
  for (const [id, n] of Object.entries(q.cost)) {
    const left = add(inv, id, n * q.count);
    if (left > 0) refund.push({ id, n: left });
  }
  return refund;   // 背包放不下的部分，由呼叫的人丟在地上
}
