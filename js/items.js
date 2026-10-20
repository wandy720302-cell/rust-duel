// 生存模式的物品、配方、建築、掉落表。純資料，不碰 three.js，node 也能直接測。

// ---------- 圖示（64×64 的彩色 SVG） ----------
const svg = (body) => `<svg viewBox="0 0 64 64" class="itemIcon">${body}</svg>`;
export const ICONS = {
  wood: svg('<rect x="8" y="30" width="44" height="12" rx="6" fill="#7a5532"/><rect x="12" y="18" width="44" height="12" rx="6" fill="#8a6038"/><circle cx="52" cy="24" r="6" fill="#c9a26a"/><circle cx="52" cy="24" r="3" fill="none" stroke="#8a6038"/><circle cx="48" cy="36" r="6" fill="#c09660"/><circle cx="48" cy="36" r="3" fill="none" stroke="#7a5532"/>'),
  metal_ore: svg('<path d="M10 44 L16 24 L30 14 L46 18 L56 34 L48 50 L24 52 Z" fill="#8d8a83"/><circle cx="28" cy="30" r="4" fill="#b8622c"/><circle cx="40" cy="38" r="3.5" fill="#a85a28"/><circle cx="36" cy="24" r="2.5" fill="#c06a30"/><circle cx="22" cy="42" r="2.5" fill="#b0602c"/>'),
  sulfur_ore: svg('<path d="M10 44 L16 24 L30 14 L46 18 L56 34 L48 50 L24 52 Z" fill="#8d8a83"/><circle cx="28" cy="30" r="4" fill="#e3c63a"/><circle cx="40" cy="38" r="3.5" fill="#d9bb30"/><circle cx="36" cy="24" r="2.5" fill="#efd24a"/><circle cx="22" cy="42" r="2.5" fill="#d8bc34"/>'),
  metal: svg('<path d="M12 40 L22 22 L30 34 Z" fill="#a9adb2"/><path d="M28 46 L38 20 L48 40 Z" fill="#8f949a"/><path d="M40 50 L50 30 L56 48 Z" fill="#b8bcc0"/><path d="M16 50 L26 38 L34 52 Z" fill="#9aa0a6"/>'),
  sulfur: svg('<path d="M8 50 Q32 10 56 50 Z" fill="#e2c43a"/><path d="M18 50 Q32 24 46 50 Z" fill="#f0d65a"/><circle cx="26" cy="40" r="2" fill="#c7a82a"/><circle cx="38" cy="44" r="2" fill="#c7a82a"/>'),
  rifle_body: svg('<rect x="8" y="24" width="40" height="12" fill="#34363a"/><rect x="12" y="20" width="30" height="5" fill="#45484d"/><path d="M28 36 L34 36 L32 50 L26 50 Z" fill="#5a2c12"/><path d="M38 36 L44 36 L48 48 L42 50 Z" fill="#3a3c40"/><rect x="48" y="27" width="10" height="5" fill="#2a2c30"/>'),
  smg_body: svg('<rect x="12" y="24" width="32" height="12" fill="#34363a"/><rect x="16" y="20" width="22" height="5" fill="#45484d"/><path d="M24 36 L30 36 L28 50 L22 50 Z" fill="#6a3416"/><rect x="34" y="36" width="5" height="14" fill="#2a2c30"/><rect x="44" y="28" width="10" height="4" fill="#2a2c30"/>'),
  rope: svg('<circle cx="32" cy="32" r="20" fill="none" stroke="#b49a64" stroke-width="7"/><circle cx="32" cy="32" r="11" fill="none" stroke="#a08550" stroke-width="6"/><path d="M48 44 L58 54" stroke="#b49a64" stroke-width="6" stroke-linecap="round"/>'),
  rock: svg('<path d="M12 42 L18 24 L32 16 L48 22 L54 38 L44 50 L22 50 Z" fill="#a19d93"/><path d="M18 24 L32 16 L40 26 L26 34 Z" fill="#bdb9af"/>'),
  sword: svg('<path d="M14 52 Q30 28 52 10 Q44 30 20 54 Z" fill="#d4d8dc"/><path d="M16 50 Q30 32 48 16" stroke="#9aa0a6" stroke-width="1.5" fill="none"/><rect x="8" y="46" width="14" height="5" rx="2" transform="rotate(-40 15 48)" fill="#c9a033"/><rect x="4" y="52" width="10" height="5" rx="2" transform="rotate(-40 9 54)" fill="#5a3418"/>'),
  bow: svg('<path d="M18 6 Q52 32 18 58" fill="none" stroke="#7a4a22" stroke-width="5" stroke-linecap="round"/><path d="M18 6 L18 58" stroke="#e8e0cc" stroke-width="1.5"/><rect x="28" y="28" width="5" height="9" fill="#3a2414"/>'),
  arrow: svg('<path d="M8 56 L52 12" stroke="#9a6a3a" stroke-width="3.5" stroke-linecap="round"/><path d="M52 12 L58 6 L54 16 Z" fill="#8a8e94"/><path d="M8 56 L6 46 L14 50 Z M8 56 L18 58 L14 50 Z" fill="#d34a2a"/>'),
  ak: svg('<path d="M4 34 L14 31 L16 29 L40 29 L40 27 L58 27 L58 30 L62 30 L62 32 L40 32 L38 35 L33 35 L30 46 L25 47 L27 35 L21 35 L19 42 L15 42 L16 35 L13 35 L4 39 Z" fill="#2c2e32"/><path d="M4 34 L14 31 L16 35 L13 35 L4 39 Z" fill="#7a3a17"/><rect x="38" y="31" width="12" height="4" fill="#7a3a17"/>'),
  thompson: svg('<path d="M4 33 L16 31 L18 29 L44 29 L44 31 L60 31 L60 33 L44 33 L42 36 L22 36 L20 44 L16 44 L17 36 L4 38 Z" fill="#2c2e32"/><path d="M4 33 L16 31 L17 36 L4 38 Z" fill="#7a3a17"/><rect x="34" y="36" width="5" height="12" fill="#2a2c30"/><path d="M44 33 L52 33 L50 42 L46 42 Z" fill="#7a3a17"/><path d="M46 31 L60 31" stroke="#55585e" stroke-width="2" stroke-dasharray="2 2"/>'),
  grenade: svg('<ellipse cx="30" cy="38" rx="16" ry="18" fill="#4f5a33"/><path d="M18 30 L42 30 M16 38 L44 38 M18 46 L42 46 M30 20 L30 56" stroke="#3a4324" stroke-width="2"/><rect x="26" y="14" width="10" height="7" fill="#6a6e72"/><path d="M36 16 Q48 16 46 34" stroke="#8a8e94" stroke-width="3" fill="none"/><circle cx="22" cy="15" r="4" fill="none" stroke="#c9a033" stroke-width="2"/>'),
  plan: svg('<rect x="10" y="8" width="44" height="48" fill="#2d5f9a"/><path d="M10 20 H54 M10 32 H54 M10 44 H54 M22 8 V56 M34 8 V56 M46 8 V56" stroke="rgba(255,255,255,.18)"/><rect x="18" y="20" width="28" height="22" fill="none" stroke="#fff" stroke-width="2"/><path d="M18 20 L32 12 L46 20" fill="none" stroke="#fff" stroke-width="2"/>'),
  furnace: svg('<rect x="12" y="18" width="40" height="36" rx="3" fill="#8a8579"/><rect x="40" y="6" width="8" height="14" fill="#5a5650"/><rect x="20" y="32" width="24" height="14" rx="2" fill="#2a1a10"/><rect x="23" y="35" width="18" height="9" fill="#ff8a2a"/><path d="M12 26 H52 M12 52 H52" stroke="#6e6a60" stroke-width="2"/>'),
  door: svg('<rect x="16" y="6" width="32" height="52" fill="#8c4f2e"/><rect x="16" y="14" width="32" height="4" fill="#3c3a36"/><rect x="16" y="44" width="32" height="4" fill="#3c3a36"/><circle cx="42" cy="32" r="3" fill="#2a2a28"/><path d="M22 6 V58 M30 6 V58 M38 6 V58" stroke="rgba(0,0,0,.25)"/>'),
  lock: svg('<rect x="18" y="8" width="28" height="48" rx="3" fill="#2e3034"/><rect x="22" y="14" width="20" height="8" fill="#1a3a22"/><circle cx="38" cy="18" r="2.5" fill="#4bd36a"/><g fill="#9aa0a6"><rect x="22" y="26" width="5" height="5"/><rect x="29.5" y="26" width="5" height="5"/><rect x="37" y="26" width="5" height="5"/><rect x="22" y="34" width="5" height="5"/><rect x="29.5" y="34" width="5" height="5"/><rect x="37" y="34" width="5" height="5"/><rect x="22" y="42" width="5" height="5"/><rect x="29.5" y="42" width="5" height="5"/><rect x="37" y="42" width="5" height="5"/></g>'),
  sbag: svg('<rect x="8" y="22" width="48" height="24" rx="10" fill="#5a6438"/><rect x="8" y="22" width="14" height="24" rx="7" fill="#8a7f5c"/><path d="M24 26 H52 M24 42 H52" stroke="#465030" stroke-width="2"/>'),
  ammo_pistol: svg('<g fill="#c9a24a"><rect x="11" y="27" width="10" height="21" rx="1"/><rect x="27" y="27" width="10" height="21" rx="1"/><rect x="43" y="27" width="10" height="21" rx="1"/></g><g fill="#b87333"><path d="M11 27 Q16 13 21 27 Z"/><path d="M27 27 Q32 13 37 27 Z"/><path d="M43 27 Q48 13 53 27 Z"/></g><g fill="#8a6a2a"><rect x="11" y="45" width="10" height="3"/><rect x="27" y="45" width="10" height="3"/><rect x="43" y="45" width="10" height="3"/></g>'),
  ammo_rifle: svg('<g fill="#d3ad52"><rect x="13" y="24" width="8" height="30" rx="1"/><rect x="28" y="24" width="8" height="30" rx="1"/><rect x="43" y="24" width="8" height="30" rx="1"/></g><g fill="#c9a24a"><path d="M13 24 L15 19 L19 19 L21 24 Z"/><path d="M28 24 L30 19 L34 19 L36 24 Z"/><path d="M43 24 L45 19 L49 19 L51 24 Z"/></g><g fill="#b87333"><path d="M15 19 L17 7 L19 19 Z"/><path d="M30 19 L32 7 L34 19 Z"/><path d="M45 19 L47 7 L49 19 Z"/></g><g fill="#8a6a2a"><rect x="13" y="51" width="8" height="3"/><rect x="28" y="51" width="8" height="3"/><rect x="43" y="51" width="8" height="3"/></g>'),
  launcher: svg('<rect x="4" y="24" width="52" height="12" rx="3" fill="#4f5a33"/><rect x="52" y="22" width="9" height="16" rx="2" fill="#3e4728"/><rect x="2" y="23" width="7" height="14" rx="2" fill="#3e4728"/><rect x="24" y="36" width="6" height="12" fill="#2c2e32"/><rect x="34" y="36" width="5" height="9" fill="#2c2e32"/><rect x="28" y="17" width="12" height="7" fill="#2c2e32"/>'),
  rocket: svg('<rect x="10" y="27" width="34" height="10" fill="#6b7340"/><path d="M44 27 L58 32 L44 37 Z" fill="#c43c2c"/><path d="M10 27 L4 21 L14 27 Z M10 37 L4 43 L14 37 Z" fill="#3e4728"/><rect x="20" y="27" width="3" height="10" fill="#d9c23a"/>'),
  hammer: svg('<rect x="29" y="22" width="7" height="36" rx="2" fill="#8a6038"/><rect x="14" y="8" width="36" height="15" rx="2" fill="#5c6066"/><rect x="14" y="8" width="8" height="15" fill="#474b50"/><rect x="29" y="40" width="7" height="3" fill="#3a3a36"/><rect x="29" y="47" width="7" height="3" fill="#3a3a36"/>'),
  c4: svg('<rect x="10" y="22" width="44" height="26" rx="2" fill="#c9b27c"/><rect x="10" y="22" width="44" height="26" rx="2" fill="none" stroke="#8f7a4a" stroke-width="1.5"/><rect x="16" y="22" width="5" height="26" fill="#3a3a36"/><rect x="43" y="22" width="5" height="26" fill="#3a3a36"/><rect x="25" y="14" width="14" height="11" rx="1" fill="#24262a"/><circle cx="35" cy="19" r="2.2" fill="#ff3b2a"/><path d="M28 14 Q26 6 20 8 M36 14 Q40 5 46 9" stroke="#c43c2c" stroke-width="2" fill="none"/>'),
  box: svg('<rect x="8" y="20" width="48" height="32" fill="#8a6038"/><rect x="8" y="14" width="48" height="10" fill="#9c6c40"/><path d="M8 30 H56 M8 41 H56" stroke="#5e3f22" stroke-width="2"/><g fill="#3a3a36"><rect x="8" y="14" width="5" height="38"/><rect x="51" y="14" width="5" height="38"/></g><rect x="28" y="22" width="8" height="7" fill="#b8b2a4"/>'),
  bear_meat: svg('<path d="M12 40 Q8 22 26 15 Q46 9 53 25 Q57 41 41 50 Q23 56 12 40 Z" fill="#b8434a"/><path d="M19 38 Q21 26 33 21" stroke="#efc9c2" stroke-width="3" fill="none"/><path d="M28 44 Q38 40 44 30" stroke="#8e2c34" stroke-width="2" fill="none"/><rect x="43" y="39" width="15" height="6" rx="3" transform="rotate(35 50 42)" fill="#ece6d6"/><circle cx="57" cy="49" r="3.6" fill="#ece6d6"/>'),
  cooked_meat: svg('<path d="M12 40 Q8 22 26 15 Q46 9 53 25 Q57 41 41 50 Q23 56 12 40 Z" fill="#7d4524"/><path d="M16 30 L44 18 M14 38 L50 24 M20 46 L52 32" stroke="#3e1f0e" stroke-width="2.6"/><path d="M19 36 Q22 26 30 22" stroke="#b57a4a" stroke-width="2" fill="none"/><rect x="43" y="39" width="15" height="6" rx="3" transform="rotate(35 50 42)" fill="#e4dcc8"/><circle cx="57" cy="49" r="3.6" fill="#e4dcc8"/>'),
  cloth: svg('<path d="M8 20 L48 13 L56 28 L14 35 Z" fill="#cdbb95"/><path d="M12 33 L54 26 L57 42 L15 49 Z" fill="#b6a27a"/><path d="M10 27 L52 20 M14 41 L55 34" stroke="#8f7d58" stroke-width="1.4" stroke-dasharray="3 2"/>'),
  bandage: svg('<rect x="14" y="19" width="34" height="27" rx="4" fill="#ecebe4"/><ellipse cx="14" cy="32.5" rx="5.5" ry="13.5" fill="#d6d4ca"/><ellipse cx="14" cy="32.5" rx="2.2" ry="5.5" fill="#a6a49a"/><path d="M48 29 L60 33 L58 45 L46 41 Z" fill="#ecebe4"/><rect x="25" y="19" width="5" height="27" fill="#c43c2c" opacity=".75"/><rect x="25" y="30" width="5" height="5" fill="#ecebe4"/>'),
  bearpaw: svg('<ellipse cx="32" cy="41" rx="14" ry="11" fill="#ebe7dc"/><circle cx="15" cy="25" r="6" fill="#ebe7dc"/><circle cx="26" cy="16" r="6" fill="#ebe7dc"/><circle cx="38" cy="16" r="6" fill="#ebe7dc"/><circle cx="49" cy="25" r="6" fill="#ebe7dc"/>'),
  starve: svg('<circle cx="36" cy="35" r="17" fill="none" stroke="#d8d3c6" stroke-width="4"/><path d="M12 10 V26 M7 10 V20 M17 10 V20 M12 26 V54" stroke="#d8d3c6" stroke-width="3" stroke-linecap="round"/>'),
  bagdrop: svg('<path d="M14 54 Q10 30 22 22 L42 22 Q54 30 50 54 Z" fill="#7a6644"/><path d="M22 22 Q32 10 42 22" fill="none" stroke="#5a4a30" stroke-width="4"/>'),
};

// ---------- 物品 ----------
// hold：拿在手上時的型態（gun / melee / bow / throw / build / deploy），沒有就是不能拿在手上
export const ITEMS = {
  wood: { name: '木頭', stack: 1000, cat: '資源', desc: '拿石頭或刀敲樹。蓋房子、做東西、當火爐燃料都靠它' },
  metal_ore: { name: '鐵礦', stack: 500, cat: '資源', desc: '路邊帶橘色斑點的礦石。丟進火爐燒成鐵' },
  sulfur_ore: { name: '硫磺礦', stack: 500, cat: '資源', desc: '路邊帶黃色斑點的礦石。丟進火爐燒成硫磺' },
  metal: { name: '鐵', stack: 1000, cat: '資源', desc: '鐵礦燒出來的。做刀、槍、門、鎖、手雷' },
  sulfur: { name: '硫磺', stack: 1000, cat: '資源', desc: '硫磺礦燒出來的。做手雷' },
  rifle_body: { name: '步槍槍體', stack: 1, cat: '零件', desc: '打破路邊或超市的鐵桶才有機會拿到。做 AK47 用' },
  smg_body: { name: '衝鋒槍槍體', stack: 1, cat: '零件', desc: '打破鐵桶拿到。做湯姆森衝鋒槍用' },
  rope: { name: '繩子', stack: 20, cat: '零件', desc: '打破鐵桶拿到。做弓用' },
  cloth: { name: '布', stack: 100, cat: '資源', desc: '刨北極熊的屍體拿到。做繃帶用' },
  bear_meat: { name: '生熊肉', stack: 20, cat: '食物', hold: 'eat', desc: '刨北極熊的屍體拿到。生吃會吐，丟進火爐烤熟再吃' },
  cooked_meat: { name: '烤熊肉', stack: 20, cat: '食物', hold: 'eat', desc: '左鍵吃掉：飢餓度 +100，慢慢回 20 血' },
  bandage: { name: '繃帶', stack: 10, cat: '醫療', hold: 'heal', desc: '左鍵包紮：馬上回 15 血，之後再慢慢回 10' },
  rock: { name: '石頭', stack: 1, cat: '工具', hold: 'melee', desc: '開局唯一的財產。敲樹、敲礦、敲人' },
  hammer: { name: '槌子', stack: 1, cat: '工具', hold: 'melee', desc: '對著自己蓋的建築左鍵：木頭升級成鐵（血量 3 倍，鐵牆 1200）；已經是鐵、被打壞了就修理' },
  sword: { name: '成吉思汗之刀', stack: 1, cat: '武器', hold: 'melee', desc: '彎刀，砍人很痛，採集比石頭差' },
  bow: { name: '弓', stack: 1, cat: '武器', hold: 'bow', desc: '按住拉弓、放開射出。拉滿傷害最高，需要箭' },
  arrow: { name: '箭', stack: 64, cat: '彈藥', desc: '弓的彈藥' },
  ak: { name: 'AK47', stack: 1, cat: '武器', hold: 'gun', mag: 30, desc: '全自動步槍，後座力大，傷害高。用步槍子彈' },
  thompson: { name: '湯姆森衝鋒槍', stack: 1, cat: '武器', hold: 'gun', mag: 25, desc: '射速快、好控制，傷害比 AK 低，遠距離會衰減。用手槍子彈' },
  launcher: { name: '火箭筒', stack: 1, cat: '武器', hold: 'gun', mag: 1, desc: '一次裝一發火箭彈，打到東西就爆炸。拆家打人都好用，換彈 3.5 秒' },
  rocket: { name: '火箭彈', stack: 6, cat: '彈藥', desc: '火箭筒的彈藥。對建築 320 傷害（木牆 2 發、鐵牆 4 發），對人最高 130' },
  ammo_pistol: { name: '手槍子彈', stack: 128, cat: '彈藥', desc: '湯姆森衝鋒槍用。按 R 換彈時從背包裡拿' },
  ammo_rifle: { name: '步槍子彈', stack: 128, cat: '彈藥', desc: 'AK47 用的 5.56 子彈。按 R 換彈時從背包裡拿' },
  grenade: { name: '手雷', stack: 5, cat: '武器', hold: 'throw', desc: '左鍵丟出，3 秒後爆炸。炸人也炸房子，拆家必備' },
  plan: { name: '建築藍圖', stack: 1, cat: '工具', hold: 'build', desc: '右鍵選要蓋的東西，左鍵蓋。每一塊都要花木頭' },
  furnace: { name: '火爐', stack: 1, cat: '設施', hold: 'deploy', desc: '放在地上，按 E 打開。放木頭當燃料、放礦石，點火就會煉' },
  box: { name: '木箱', stack: 1, cat: '設施', hold: 'deploy', desc: '放在家裡，按 E 打開，可以放 12 格東西。被打爛的話東西會掉出來' },
  c4: { name: 'C4 炸藥', stack: 5, cat: '武器', hold: 'throw', desc: '左鍵丟出去會黏在東西上，嗶 10 秒後爆炸。一顆就能炸掉一面木牆，拆家專用' },
  door: { name: '一般門', stack: 1, cat: '設施', hold: 'deploy', desc: '裝在門框上，按 E 開關' },
  lock: { name: '電子鎖', stack: 1, cat: '設施', hold: 'deploy', desc: '裝在門上，設定 4 位數密碼。沒有密碼的人打不開' },
  sbag: { name: '睡袋', stack: 1, cat: '設施', hold: 'deploy', desc: '放在家裡，死掉之後可以從這裡重生' },
};

// ---------- 配方（內建藍圖，點了就能做） ----------
export const RECIPES = [
  { id: 'plan', out: 1, time: 1, cost: { wood: 10 } },
  { id: 'hammer', out: 1, time: 3, cost: { wood: 100 } },
  { id: 'furnace', out: 1, time: 5, cost: { wood: 150 } },
  { id: 'sbag', out: 1, time: 4, cost: { wood: 60 } },
  { id: 'sword', out: 1, time: 5, cost: { wood: 60, metal: 50 } },
  { id: 'bow', out: 1, time: 4, cost: { wood: 80, rope: 1 } },
  { id: 'arrow', out: 2, time: 1, cost: { wood: 5 } },
  // 子彈：照 rust 的比例，材料一樣但步槍子彈做得比較少（rust 是 4 發 / 3 發，這裡 8 / 6）
  { id: 'ammo_pistol', out: 8, time: 2, cost: { metal: 10, sulfur: 5 } },
  { id: 'ammo_rifle', out: 6, time: 3, cost: { metal: 10, sulfur: 5 } },
  { id: 'launcher', out: 1, time: 12, cost: { metal: 250, wood: 100, rope: 2 } },
  { id: 'rocket', out: 1, time: 5, cost: { metal: 40, sulfur: 80 } },
  { id: 'thompson', out: 1, time: 8, cost: { wood: 100, metal: 100, smg_body: 1 } },
  { id: 'ak', out: 1, time: 10, cost: { wood: 150, metal: 200, rifle_body: 1 } },
  { id: 'grenade', out: 1, time: 3, cost: { metal: 25, sulfur: 40 } },
  { id: 'door', out: 1, time: 5, cost: { wood: 150, metal: 50 } },
  { id: 'lock', out: 1, time: 4, cost: { wood: 50, metal: 100 } },
  { id: 'bandage', out: 1, time: 2, cost: { cloth: 4 } },
  { id: 'box', out: 1, time: 4, cost: { wood: 100 } },
  // rust 的 C4 要炸藥 + 布 + 科技零件；這裡用鐵、硫磺、布（布要打北極熊）
  { id: 'c4', out: 1, time: 10, cost: { metal: 60, sulfur: 120, cloth: 5 } },
];
export const recipeOf = (id) => RECIPES.find((r) => r.id === id);

// ---------- 建築件（用建築藍圖蓋，放下去時扣木頭） ----------
// shape：sq 方形 3m×3m、tri 正三角形邊長 3m；slot：哪一類插座（地基 / 牆 / 樓板）
export const PIECES = {
  found: { name: '地基', shape: 'sq', slot: 'found', cost: 100, hp: 500 },
  tfound: { name: '三角地基', shape: 'tri', slot: 'found', cost: 50, hp: 300 },
  wall: { name: '牆', shape: 'wall', slot: 'wall', cost: 60, hp: 400 },
  doorway: { name: '門框', shape: 'wall', slot: 'wall', cost: 50, hp: 350 },
  floor: { name: '地板', shape: 'sq', slot: 'floor', cost: 50, hp: 250 },
  tfloor: { name: '三角地板', shape: 'tri', slot: 'floor', cost: 25, hp: 150 },
  roof: { name: '屋頂', shape: 'sq', slot: 'floor', cost: 80, hp: 300 },
  troof: { name: '三角屋頂', shape: 'tri', slot: 'floor', cost: 40, hp: 200 },
  window: { name: '玻璃窗', shape: 'wall', slot: 'wall', cost: 70, hp: 350 },
  stairs: { name: '樓梯', shape: 'sq', slot: 'stairs', cost: 75, hp: 250 },
};
// 槌子升級：木頭 → 鐵，血量變 3 倍（鐵牆 1200），花的鐵照 rust 的比例抓
export const UPGRADE = {
  mult: 3,
  metal: { found: 200, tfound: 100, wall: 150, doorway: 125, window: 150, floor: 100, tfloor: 50, roof: 150, troof: 75, stairs: 150 },
  repair: { hp: 100, cost: 10 },   // 修理：一下補 100 血，木造花 10 木頭、鐵造花 10 鐵
};
export const PIECE_ORDER = ['found', 'tfound', 'wall', 'doorway', 'window', 'floor', 'tfloor', 'stairs', 'roof', 'troof'];
export const DEPLOY = {
  furnace: { hp: 200 },
  box: { hp: 150 },
  door: { hp: 300 },
  lock: { hp: 0 },
  sbag: { hp: 50 },
};

// ---------- 武器數值 ----------
export const GUNS = {
  ak: { dmg: 30, mult: { head: 2.0, body: 1.0, legs: 0.75 }, rpm: 450, mag: 30, reload: 3.0, recoil: 1.0, hip: 1.5, adsSpread: 0.1, falloff: [60, 200, 0.7], range: 320, pieceDmg: 2, ammo: 'ammo_rifle' },
  // 火箭筒：不是打射線，是發射一顆火箭彈（傷害在 ROCKET）
  launcher: { launcher: true, dmg: 0, mult: { head: 1, body: 1, legs: 1 }, rpm: 60, mag: 1, reload: 3.5, recoil: 0, hip: 1.2, adsSpread: 0.15, falloff: [999, 1000, 1], range: 300, pieceDmg: 0, ammo: 'rocket' },
  thompson: { dmg: 22, mult: { head: 1.8, body: 1.0, legs: 0.75 }, rpm: 650, mag: 25, reload: 2.6, recoil: 0.55, hip: 1.9, adsSpread: 0.3, falloff: [30, 90, 0.55], range: 200, pieceDmg: 1.5, ammo: 'ammo_pistol' },
};
// meat / cloth：刨屍體一下拿多少（rust：工具越利拿越多）
export const MELEE = {
  rock: { dmg: 20, headMult: 1.6, swing: 0.85, hitAt: 0.3, reach: 2.4, wood: 25, ore: 30, pieceDmg: 4, crateDmg: 15, meat: 1, cloth: 2 },
  sword: { dmg: 38, headMult: 1.5, swing: 0.7, hitAt: 0.25, reach: 2.6, wood: 15, ore: 15, pieceDmg: 8, crateDmg: 25, meat: 2, cloth: 3 },
  hammer: { dmg: 10, headMult: 1.5, swing: 0.6, hitAt: 0.22, reach: 3, wood: 0, ore: 0, pieceDmg: 0, crateDmg: 5, meat: 0, cloth: 0 },
};
// 傷害隨距離衰減：a 公尺內全額，到 b 公尺降到 m 倍
export function falloffMult(G, dist) {
  const [a, b, m] = G.falloff;
  return dist <= a ? 1 : dist >= b ? m : 1 + (m - 1) * (dist - a) / (b - a);
}
export const BOW = { draw: 0.7, minSpeed: 22, maxSpeed: 52, dmg: 50, headMult: 2.0, gravity: 9.8, pieceDmg: 1, crateDmg: 20 };
export const NADE = { fuse: 3.0, speed: 16, radius: 6, playerDmg: 95, pieceDmg: 150, pieceFull: 1.5, pieceRadius: 5, crateDmg: 100 };
// C4：黏在東西上 10 秒後爆。對建築傷害大但範圍小（1.6m 內全額 560：木牆 400、地基 500 都一顆爛）
// 火箭彈：直線飛、有一點下墜，打到東西（或人）就爆。木牆 2 發、鐵牆 4 發
export const ROCKET = { speed: 40, gravity: 2.5, life: 5, radius: 4.5, playerDmg: 130, pieceDmg: 320, pieceFull: 1.5, pieceRadius: 3.5, crateDmg: 200 };
export const C4 = { fuse: 10, speed: 11, up: 1.5, radius: 4, playerDmg: 150, pieceDmg: 560, pieceFull: 1.6, pieceRadius: 3.2, crateDmg: 200 };

// ---------- 世界資源 ----------
export const NODE_ORE = 300;          // 一個礦點能挖多少礦石
export const NODE_RESPAWN = 90;       // 挖完幾秒後重生
export const CRATE = { hp: 40, max: 7, respawn: 40 };
export const SMELT = { fuelPerSec: 1, orePerSec: 2 };
// 火爐裡會變成什麼、每格每秒幾個（熊肉比較慢，3 秒烤好一塊）
export const SMELT_OUT = { metal_ore: ['metal', 2], sulfur_ore: ['sulfur', 2], bear_meat: ['cooked_meat', 1 / 3] };
// 飢餓度（rust 的卡路里）：最多 500；歸零之後開始扣血，也不會自己回血
export const FOOD = {
  max: 500, spawn: [120, 170], drain: 0.18, sprintDrain: 0.18, starveDps: 0.5,
  eat: { bear_meat: { food: 20, hp: -6, time: 1.2 }, cooked_meat: { food: 100, heal: 20, time: 1.2 } },
};
export const BANDAGE = { time: 2.4, hp: 15, heal: 10 };
// 北極熊：只在雪地出沒，看到人就衝過來。打死之後可以刨肉跟布
export const BEAR = {
  hp: 240, dmg: 18, attackCd: 1.4, reach: 2.4, walk: 1.6, run: 6.3, aggro: 16, leash: 48,
  max: 3, respawn: 90, meat: 10, cloth: 16, corpseLife: 180, headMult: 1.5,
};
export const MATCH_SECONDS = 30 * 60;
export const REGEN = { delay: 12, perSec: 1 };

// 鐵桶掉落：一次一樣東西
export function rollLoot(rand = Math.random) {
  const r = rand();
  if (r < 0.17) return [{ id: 'rifle_body', n: 1 }];
  if (r < 0.45) return [{ id: 'smg_body', n: 1 }];
  return [{ id: 'rope', n: rand() < 0.5 ? 1 : 2 }];
}
