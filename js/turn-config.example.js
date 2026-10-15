// TURN 設定範本。複製一份改名成 turn-config.js，把帳密填進去就會自動啟用。
// 沒有 turn-config.js 也能玩，只是朋友如果用手機行動網路（電信級 NAT）可能連不進來。
//
// 戰艦專案 battleship/js/net.js 裡的 ICE_CONFIG 那一段可以整段照搬過來。
// 注意：丟上 GitHub Pages 的話，這個檔案是公開的，任何人都看得到帳密。
export default {
  iceServers: [
    { urls: 'stun:stun.relay.metered.ca:80' },
    { urls: 'turn:global.relay.metered.ca:80', username: '你的帳號', credential: '你的密碼' },
    { urls: 'turn:global.relay.metered.ca:443', username: '你的帳號', credential: '你的密碼' },
    { urls: 'turns:global.relay.metered.ca:443?transport=tcp', username: '你的帳號', credential: '你的密碼' },
  ],
};
