# RUST DUEL

rust 風格的 1v1 網頁射擊小遊戲：兩個裸男、兩把 AK、一張小地圖。
純前端（three.js + PeerJS/WebRTC），不用架伺服器，丟 GitHub Pages 就能跟朋友玩。

## 本機跑起來

ES module 不能用 `file://` 直接開，要起一個靜態伺服器：

```bash
cd rust-duel
npm start          # = npx serve -l 8080 .
```

開 http://localhost:8080 。單人練習模式可以直接玩；雙人要開兩個瀏覽器視窗，或丟給朋友。

## 怎麼連線

1. 一個人按「建立房間」，拿到 6 碼房間碼（或按「複製邀請連結」）
2. 另一個人輸入房間碼按「加入」，或直接開邀請連結
3. 連上就自動開打，先拿 5 殺的贏

### TURN（選用）

預設只用 Google 的公開 STUN。同一個 Wi-Fi、一般家用網路通常這樣就夠了，
但如果有人用手機行動網路（電信級 NAT），可能會卡在連線中。

要開 TURN 的話：把 `js/turn-config.example.js` 複製成 `js/turn-config.js`，填入帳密。
戰艦專案 `battleship/js/net.js` 裡的 `ICE_CONFIG` 可以整段照搬。
有這個檔案，遊戲就會自動使用；沒有的話，大廳會跳提示。

> 放上 GitHub Pages 之後，`turn-config.js` 是公開的，誰都看得到帳密（跟戰艦專案現在的狀況一樣）。
> 如果不想公開，就把它加進 `.gitignore`，只在本機用。

## 部署到 GitHub Pages

```bash
cd rust-duel
git init && git add . && git commit -m "rust duel"
git branch -M main
git remote add origin https://github.com/<你的帳號>/rust-duel.git
git push -u origin main
```

GitHub repo → Settings → Pages → Source 選 `main` / `(root)`，等一分鐘就有網址了。

## 遊戲規則與數值

| 項目 | 數值 |
| --- | --- |
| 射速 | 450 RPM，全自動 |
| 彈匣 | 30 發，換彈 3 秒（rust 原版是 4.4 秒，太痛苦就縮短了） |
| 傷害 | 身體 30、爆頭 ×2、腿 ×0.75（滿血 100） |
| 後座力 | rust AK 的 S 型路徑：先往上偏左、再甩右、再甩左，不會自己回正，要自己往下拉 |
| 散布 | 開鏡 + 站定最準；移動、跳躍、連發都會變散 |
| 針筒 | 每條命 2 支，立刻 +15，之後 4 秒再回 20 |
| 重生 | 睡袋（自己基地，冷卻 6 秒），或海灘（離對手最遠的那段，冷卻 3 秒） |

## 地圖

左右對稱的小島切片，大約 110 × 100 公尺：

- **西邊 A 基地（木頭）／東邊 B 基地（鐵皮）**：2x1 小屋，石頭地基，門開著。裡面有 TC、熔爐、大木箱、睡袋
- **中央水泥廢墟**：兩層樓，室內樓梯可以上頂樓，頂樓有女兒牆可以當掩體。西牆塌了半截，跳得過去
- **貨櫃區**：單層貨櫃旁邊疊了箱子，可以爬上去；另一邊是兩層貨櫃牆
- **北邊**：山坡和松樹林，有岩石和礦點（石頭／金屬／硫磺）
- **南邊**：沙灘和海

## 檔案結構

```
index.html          大廳、HUD、死亡畫面等 DOM
style.css           rust 風格 UI
js/main.js          主迴圈、輸入、開槍判定、網路協定、死亡/重生/比分
js/world.js         地形、天空、建築、樹、岩石、子彈射線
js/physics.js       玩家移動與碰撞（可踩 0.5m 以內的台階）
js/weapon.js        AK 數值、後座力表、AK 模型、第一人稱視角
js/avatar.js        對手的身體、動畫、命中框（頭/身/腿）
js/effects.js       曳光、彈孔、火花、血霧
js/audio.js         全部音效都是 WebAudio 現場合成，對手的聲音有 3D 定位
js/hud.js           羅盤、狀態條、快捷欄、擊殺通知
js/net.js           PeerJS 連線（1v1，第三個人會被擋）
js/textures.js      所有貼圖都用 canvas 現畫，沒有外部圖檔
```

## 網路架構

- 判定是「開槍的人判」：射手自己做射線檢測，打中就送 `hit` 給對方；對方扣血，死了回傳 `dead`，射手才加分
- 位置每秒送 20 次，對方畫面延遲 110ms 做內插，換取不抖
- 雙方各自計分：自己的擊殺數 = 收到幾次 `dead`，對手的擊殺數 = 自己死幾次

## 已知限制

- 只支援鍵盤滑鼠（Pointer Lock），手機不能玩
- 蹲下用 `C`，不用 Ctrl，因為 Ctrl+W 會直接關掉分頁
- 射手判定的代價是延遲很高時，可能會出現「已經躲到牆後還是被打死」
