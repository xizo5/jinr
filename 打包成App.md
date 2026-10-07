# 打包成手机 App

> 状态：**已实现**。Capacitor 骨架 + 原生语音识别都已入库，
> 只差把构建流水线文件手动放到 GitHub 上（原因见文末）。

---

## 先说最关键的一件事

**打包本身不会让语音能用。**

很多人以为"装成 App 就能用语音了"，不是的：

| 方式 | 语音能不能用 | 为什么 |
|---|---|---|
| PWA（网页版） | ❌ | Web Speech API 把音频送到**谷歌服务器**识别，国内连不上 |
| TWA | ❌ | 内核还是 Chrome，同一套 API，同一个问题 |
| Capacitor（默认） | ❌ | 还是 WebView，还是那套 API |
| **Capacitor + 原生识别插件** | ✅ | 用**安卓系统的 SpeechRecognizer**，走手机厂商自带引擎 |

所以打包的真正价值，是**拿到调用原生识别的资格**。这也是这个项目走 Capacitor
而不是 TWA 的原因。

---

## 现在的实现

### 目录结构

```
jinr/
├── app/                     网页本体（PWA，没被改造成 App 专属）
├── android/                 Capacitor 生成的安卓工程（已入库）
├── capacitor.config.json    webDir 指向 app/，appId com.xizo5.jinr
├── package.json             Capacitor 7.6.9 + 语音识别插件 7.0.1
├── ci/android.yml           构建流水线副本（见文末，需手动启用）
└── .github/workflows/       真正生效的流水线位置（目前空，见文末）
```

### 语音方案优先级（`app/js/asr.js` 的 `mode()`）

```
① native      安卓原生识别 —— 免费、最快、国内可用   ← 装了 App 才有
② tencent     腾讯云 —— 最准，但要填三件套密钥
③ webspeech   浏览器自带 —— 国内基本作废，仅兜底
   null       只能打字
```

### 三个容易踩的坑（都已处理）

1. **`<queries>` 声明**（`android/app/src/main/AndroidManifest.xml`）
   安卓 11+ 有「包可见性」限制。不声明 `android.speech.RecognitionService`，
   `isRecognitionAvailable()` 会返回 false，表现为"系统没有可用的识别服务"。
   `<queries>` 必须是 `<manifest>` 的**直接子元素**。

2. **原生壳里不能注册 Service Worker**（`app/js/app.js` 的 `registerSW`）
   外壳已经把全部资源打进安装包，SW 缓存没意义；而且 SW 会跟外壳的资源加载
   打架 —— 改完代码 App 里还是旧的，又没有刷新按钮可救。

3. **不加载插件的前端 JS**
   本项目没有打包器（纯 `<script>` 引入），而 Capacitor 插件正常要靠 npm 打包。
   所以直接调原生桥：
   ```js
   Capacitor.nativePromise('SpeechRecognition', 'start', {...})
   ```
   插件名 `SpeechRecognition`、方法名 `available`/`start`/`stop`/`requestPermissions`、
   参数名、返回结构（`{status, matches}`）全部是从插件的 **Android 源码**读出来的，
   没有文档保证 —— 所以 `tests/native-asr.test.js` 用假桥把它们钉住了。

---

## 怎么出 APK

本机没有 JDK / Android SDK / Android Studio（装齐要几个 GB），
所以走 **GitHub Actions 云构建**：仓库是公开的，Actions 额度免费无限，
而且 runner 自带 Android SDK。

### 一次性设置（关键：卡在这里）

把 `ci/android.yml` 的内容放到 `.github/workflows/android.yml`：

1. 打开 https://github.com/xizo5/jinr
2. **Add file → Create new file**
3. 文件名填 `.github/workflows/android.yml`
4. 把 `ci/android.yml` 的内容粘进去（**去掉开头那 9 行说明注释**）
5. 提交

> 为什么不能我直接推？当前用的 Personal Access Token 没有 `workflow` 权限，
> GitHub 会拒绝任何创建/修改 `.github/workflows/` 的推送。
> 想省掉这步的话，给 token 加上 `workflow` 权限即可（但那个 token 本来就该吊销了）。

### 之后每次构建

- 推送到 `main` 就会自动构建（只改了 `app/`、`android/` 等路径时触发）
- 或在仓库 **Actions** 页手动点 **Run workflow**
- 构建完在对应 run 页面底部下载 **jinr-debug-apk** 这个 artifact

### 装到手机

1. 手机上下载那个 `.apk`
2. 安装时系统会提示"未知来源"→ 允许（debug 包没上架，这是正常的）
3. 装好后打开「记哪儿」→ 会问麦克风权限 → 允许

---

## 如果原生识别也用不了

有些精简版系统不预装语音识别引擎，这时 `available()` 会返回 false，
App 里会明确告诉你"这台手机上没找到可用的语音识别服务"。兜底方案：

| 方案 | 说明 |
|---|---|
| 装个带语音的输入法 | 微信键盘 / 搜狗 / 讯飞 / 百度输入法都有 🎤 按钮，点输入框就能用 |
| 填腾讯云密钥 | 设置 → 腾讯云语音识别，走云端，最准 |
| 两者都行 | 输入法零配置；腾讯云体验最好（按住说话、说完自动记） |

---

## 还需要做的

- [ ] 手动创建 `.github/workflows/android.yml`（见上）
- [ ] 构建通过后真机验证语音
- [ ] 应用图标还是 Capacitor 默认的，需要换成本项目的图标
      （`app/icons/` 里有现成的 PNG，用 `npx @capacitor/assets` 可以生成全套）
- [ ] 想上架的话需要签名正式版（debug 包只能自己装）
