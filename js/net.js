// P2P 連線層（PeerJS / WebRTC），從戰艦專案那套改成只收 1v1。
// 房主用房間碼當 peer id，朋友只要知道 6 碼就能連；第三個人進來直接被請出去。

const ID_PREFIX = 'rustduel-';
// 拿掉 0/O/1/I 這種肉眼會看錯的字，房間碼是要唸給朋友聽的
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export const makeRoomCode = () =>
  Array.from({ length: 6 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('');

function loadPeerJS() {
  if (window.Peer) return Promise.resolve();
  const sources = [
    'https://cdnjs.cloudflare.com/ajax/libs/peerjs/1.5.5/peerjs.min.js',
    'https://cdn.jsdelivr.net/npm/peerjs@1.5.5/dist/peerjs.min.js',
  ];
  return new Promise((resolve, reject) => {
    const tryNext = (i) => {
      if (i >= sources.length) return reject(new Error('PeerJS 載入失敗'));
      const el = document.createElement('script');
      el.src = sources[i];
      el.onload = () => resolve();
      el.onerror = () => { el.remove(); tryNext(i + 1); };
      document.head.appendChild(el);
    };
    tryNext(0);
  });
}

// 手機走行動網路常躲在電信級 NAT 後面，光靠 STUN 打不穿，要 TURN 幫忙轉送。
// TURN 帳密不寫死在這裡：有 js/turn-config.js（export default { iceServers: [...] }）就用它，
// 沒有就退回公開 STUN —— 一般家用網路、同一個 Wi-Fi 通常這樣就連得上。
const FALLBACK_ICE = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};
let iceConfig = null;
async function loadIce() {
  if (iceConfig) return iceConfig;
  try {
    const mod = await import('./turn-config.js');
    iceConfig = mod.default?.iceServers ? mod.default : FALLBACK_ICE;
  } catch {
    iceConfig = FALLBACK_ICE;
  }
  return iceConfig;
}
export const hasTurn = async () => (await loadIce()) !== FALLBACK_ICE;

const ERR_TEXT = {
  'peer-unavailable': '找不到這個房間（碼打錯，或房主已經關掉了）',
  'unavailable-id': '房間碼撞名了，再按一次建立房間',
  network: '連不上配對伺服器，檢查一下網路',
  'browser-incompatible': '這個瀏覽器不支援 WebRTC',
};
export const errText = (e) => ERR_TEXT[e?.type] || e?.message || String(e);

export function createNet({ onMessage, onOpen, onClose, onError }) {
  let peer = null, conn = null, role = null, closed = false;

  function wire(c) {
    conn = c;
    c.on('open', () => onOpen?.());
    c.on('data', (d) => { if (d && typeof d === 'object') onMessage?.(d); });
    c.on('close', () => { if (conn === c) { conn = null; if (!closed) onClose?.(); } });
    c.on('error', (e) => onError?.(e));
  }

  async function makePeer(id) {
    const [config] = await Promise.all([loadIce(), loadPeerJS()]);
    return new Promise((resolve, reject) => {
      const opts = { config };
      const p = id ? new window.Peer(id, opts) : new window.Peer(opts);
      const fail = (err) => reject(err);
      p.once('open', () => { p.off('error', fail); resolve(p); });
      p.once('error', fail);
    });
  }

  return {
    get role() { return role; },
    get connected() { return !!conn?.open; },

    async host(code) {
      role = 'host';
      peer = await makePeer(ID_PREFIX + code);
      peer.on('connection', (c) => {
        if (conn?.open) {
          c.on('open', () => { c.send({ t: 'full' }); setTimeout(() => c.close(), 400); });
          return;
        }
        wire(c);
      });
      peer.on('disconnected', () => { if (!closed) peer.reconnect(); });
      peer.on('error', (e) => onError?.(e));
    },

    async join(code) {
      role = 'guest';
      peer = await makePeer(null);
      const c = peer.connect(ID_PREFIX + code.toUpperCase(), { reliable: true });
      wire(c);
      await new Promise((resolve, reject) => {
        const tm = setTimeout(() => reject(new Error('連線逾時：房間不存在或房主已離線')), 15000);
        c.on('open', () => { clearTimeout(tm); resolve(); });
        peer.on('error', (e) => { clearTimeout(tm); reject(e); });
      });
      peer.on('error', (e) => onError?.(e));
    },

    send(msg) { if (conn?.open) conn.send(msg); },

    destroy() { closed = true; conn?.close(); peer?.destroy(); },
  };
}
