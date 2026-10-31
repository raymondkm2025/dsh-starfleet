# dsh-starfleet — 銀河戰役

DSH 插件版嘅太空戰術遊戲，受《銀河英雄傳說》啟發。控制艦隊、擺陣、同 AI 對手交戰。

## 功能

- 6 種艦型：Fighter / Destroyer / Cruiser / Battleship / Carrier / Flagship
- 5 種戰陣：Line / Wedge / Circle / Diamond / Cluster
- 回合制戰術戰鬥
- 強 AI 對手（多層決策 + 評估函數）
- Three.js 3D 星場渲染
- 支持雙人本地對戰

## 玩法

1. 選擇側面（藍色 vs 紅色）
2. 選擇戰陣同位置放置艦隊
3. 回合制操作：點擊艦船選中 → 點擊移動格移動 → 點擊敵人攻擊
4. 結束回合後 AI 行動
5. 摧毀敵方 Flagship 或消滅所有船隻即可獲勝

## 技術棧

- Three.js（3D 渲染）
- 純 JavaScript（無外部 ML 依賴）
- 回合制（非即時）

## 安裝

```bash
# 從 GitHub 加載
dsh plugin install raymondkm2025/dsh-starfleet
```

## 開發

```bash
cd dsh-starfleet
npm install
# 測試
npx serve test -p 8773
```
