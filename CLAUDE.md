# 天马行空

## 视觉设计原则

- 美术参照星露谷物语：2D 俯视像素画面，界面是像素木框，不是网页。
- 界面要有游戏的感觉：多用数字、图标、道具格、进度条表达状态，少用段落和表格式说明。
- 文字说明尽量少，保持简洁。能看出来的就不写；实在需要解释的放进悬停提示（title），不占屏幕。
- 不要用「·」连接几段信息。并列的信息用间距（`parts()`）、标签（`.tag`）或分组排开。
- 不用毛玻璃（`backdrop-filter`）、半透明卡片和圆角渐变。边框用 `src/ui/pixelui.ts` 画的九宫格（`--f-menu` 木框、`--f-slot` 道具格、`--f-btn` 按钮、`--f-plank` 木牌、`--f-paper` 纸条）。
- 像素美术全部用代码画（`src/world/sprites.ts`），没有外部图片。一个美术像素在屏幕上是 3px（`--u`），画布用 `imageSmoothingEnabled = false`，图片用 `image-rendering: pixelated`。
- 字体只用缝合像素 12px（`PIXEL_FONT`）。CSS 字号用 12 的倍数（12/24/36px）；画布里的字用 `textSprite()`，不要直接 `fillText`，否则会糊。
- 赛场和相扑台先画进 1/3 大小的缓冲再放大（`src/ui/pixelCanvas.ts`），名牌和计时用像素字画在屏幕上。

## 常用命令

```bash
npm test               # 单元测试
npm run sim:stability  # 1000 匹随机马稳定性检查
npm run sim:economy    # 模拟玩家过 28 天，调奖金和债务
npm run build          # 类型检查 + 打包
```
