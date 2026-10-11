import "@fontsource/fusion-pixel-12px-proportional-sc/400.css";
import "./style.css";
import { startApp } from "./ui/app";
import { PIXEL_FONT } from "./world/sprites";

// 像素画里的字会缓存成贴图，先等像素字体到位再开场；网络慢时最多等三秒。
const fontLoaded = document.fonts.load(`12px ${PIXEL_FONT}`, "天马行空家马厩赌测序市赵报名").catch(() => []);
const timeout = new Promise((r) => setTimeout(r, 3000));

void Promise.race([fontLoaded, timeout]).then(() => {
  const root = document.getElementById("app");
  if (root) startApp(root);
});
