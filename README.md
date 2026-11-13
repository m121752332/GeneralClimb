# 霍將軍爬101大樓（GeneralClimb）

2D 垂直攀爬動作遊戲：從台北 101 的 1F 徒手爬到塔尖，共 14 關。遇到強風、下雨、老鷹就停下來抓牢，一失手就回 1F 重來。

- 引擎：Cocos Creator 3.8 LTS + TypeScript
- 平台：手機與電腦瀏覽器（GitHub Pages）
- 登入：Firebase Authentication（Google）＋ Firestore

## 文件
- [架構決策 ADR](docs/ADR.md)
- [遊戲設計 GDD](docs/GDD.md)
- [遊戲進度流程圖](docs/flowchart.html)（用瀏覽器開）

## 目錄
| 路徑 | 用途 |
| --- | --- |
| `docs/` | ADR、GDD、流程圖 |
| `config/` | `levels.json`（數值）、Firestore 規則與索引 |
| `game/` | Cocos Creator 專案（用 Cocos Dashboard 建立） |
| `site/` | Web Mobile 建置輸出，push 後發布到 GitHub Pages |

## 素材
所有美術與音效均為原創。
