# 打包成手机 App

这项目是纯静态 PWA，打包成上架应用有三条路。选哪条主要看**要不要上架**、**要不要离线**。

---

## 先说结论

| 目标 | 选谁 | 理由 |
|---|---|---|
| 自己手机上用，不想装商店 | **不用打包**，现有 PWA 加到桌面即可 | 已经能用了，打包没收益 |
| 只想给几个人装，不想走商店审核 | **Capacitor** 出 APK 直传 | 装个文件就行，无需任何账号 |
| 要上 Google Play | **TWA**（本项目已满足全部前提） | 体积 ~800KB，更新即时，Google 官方推荐 |
| 要上 App Store / 需要原生能力 | **Capacitor** | TWA 在 iOS 上不存在 |

本项目**已经满足 TWA 的所有前提**：HTTPS、manifest 完整（`display: standalone` + 512 图标）、Service Worker 已注册。所以 TWA 这条路是通的。

---

## 路线一：TWA（Google 官方推荐，包最小）

TWA 就是"把你的网址套进一个原生壳"，跑的是真 Chrome 引擎，**改完网页立刻生效，不用重新发版**。

```bash
npm i -g @bubblewrap/cli
bubblewrap init --manifest https://xizo5.github.io/jinr/app/manifest.webmanifest
bubblewrap build          # 产出 .aab
```

上传 `.aab` 到 Play Console 即可。

**前提检查清单**（本项目现状）：

- [x] HTTPS — 已有 `https://xizo5.github.io/jinr/app/`
- [x] `display: "standalone"` — manifest 已有
- [x] 512×512 图标 — 已有（真 PNG，见下）
- [x] Service Worker — 已注册，缓存了全部应用外壳
- [ ] `assetlinks.json` — Bubblewrap 会生成，**必须传到 `https://xizo5.github.io/.well-known/assetlinks.json`**，否则 App 里会露出浏览器地址栏

⚠️ `assetlinks.json` 要放在**域名根**（`/.well-known/`），不是 `/jinr/app/` 下面。GitHub Pages 从仓库根发布，所以要放到仓库根目录。

**限制**：TWA 只对 Android 有效，且用户手机必须有 Chrome。系统会显示"由 Chrome 提供"之类的小字。

---

## 路线二：Capacitor（要上架 App Store / 要原生能力时选）

Capacitor 是把网页**打包进 App 本体**，不是每次去服务器取。用到了 `Secure Enclave` 之外还能调原生插件。

```bash
npm i @capacitor/cli
npm i @capacitor/core @capacitor/android @capacitor/ios
npx cap init 记哪儿 com.xizo5.jinr --web-dir=app
npx cap add android
npx cap add ios
npx cap sync
npx cap open android      # 需要 Android Studio
```

`--web-dir=app` 指向本仓库的 `app/` 目录，正好是应用本体。

**打包后必须处理的两件事**（不做会出真 bug）：

1. **Service Worker 会与Capacitor 打架**。Capacitor 自带的 WebView 有自己的资源加载机制，再注册 SW 会出现"改了代码但 App 里还是旧版本"，而且没有刷新按钮可救。打包版本应当**跳过 `sw.js` 注册**（`app.js:963` 那段），改用 `Capacitor` 的版本号机制。
2. **腾讯云 ASR 的 WebSocket**在原生 WebView 里通常可用，但部分国产 ROM 的 WebView 有差异，需要真机验证。兜底路径（`webspeech`）在原生壳里大多不可用，因为没有谷歌服务。

**iOS 门槛**：必须有 Mac + Xcode、Apple 开发者账号（$99/年）。Windows 上做不了 iOS 的最终构建。

---

## 路线三：什么都不做（别低估它）

本项目的 PWA 已经能"添加到主屏幕"独立运行、有图标、无地址栏、断网可开。**在做完上面两条路之前，它在手机上的体验和原生 App 几乎没差别。**

打包真正能多得到的，只��：独立的系统级通知、二维码/分享面板、后台录音、系统分享、以及上架带来的曝光。

如果现在的目标是"自己用着顺手"，那**先别打包，把精力放在准确率上**更值。

---

## 打包前已经修掉的问题

打包会放大图标问题，所以先修了：

- `app/icons/icon-512.png` 原来**名字叫 .png、manifest 声明 `image/png`，实际内容是JPEG**（首字节 `FF D8 FF E0` + JFIF 标记）。扩展名与内容不符会让安装横幅和商店打包的图标识别不稳定。
- 重新生成了四张**真 PNG**：192 / 512（any）、512（maskable，满幅出血 + 86% 安全区）、180（iOS，不透明底）。
- 原图四周有 25% 浅灰白留白，maskable 会被系统再裁一刀导致图形过小，所以另做了满幅出血版。
- 定位器下方的投影在抠图时会连成方形色块，脚本里单独剔除了。
- `sw.js` 缓存版本 `v20` → `v21`，并把新图标加入预缓存。
- 复现命令见 `tools/make_icons.py` 文件头（注意它会覆盖源图，**跑之前先 `git checkout app/icons/icon-512.png`**）。

---

## 一句话建议

**先别打包。** 现在把它当成自己的工具用，把 AI 解析准确率提上去——这是它唯一真正的命门。PWA 已经够用了，等准确率稳住、确实想要系统级通知了，再套 Capacitor。
