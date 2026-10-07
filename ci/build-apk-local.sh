#!/usr/bin/env bash
#
# 在本机构建「记哪儿」的安卓 APK。
#
# 为什么有这个脚本：本机没有 Android Studio，工具链是临时装的，
# 而构建过程踩了一堆坑（见下面每一步的注释）。把这套配方固化下来，
# 下次直接跑，不用再摸一遍。
#
# 用法：
#   bash ci/build-apk-local.sh
#
# 前置（只需一次，已装好）：
#   D:/dev/toolchains/jdk-21.0.12.1+1    JDK 21 —— Capacitor 7 的安卓库要求 Java 21，
#                                        JDK 17 会报「无效的源发行版：21」
#   D:/dev/toolchains/android-sdk        Android SDK（platform-35 + build-tools 35.0.0）
#   D:/dev/toolchains/gradle-8.11.1      Gradle 本体（绕开 wrapper）
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TOOLCHAIN="D:/dev/toolchains"

export JAVA_HOME="$TOOLCHAIN/jdk-21.0.12.1+1"
export ANDROID_HOME="$TOOLCHAIN/android-sdk"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export GRADLE="$TOOLCHAIN/gradle-8.11.1/bin/gradle.bat"

# ── 坑 1：Gradle 的原生服务在这台机器上加载不了 ──────────────────
# 现象：Could not initialize native services → Failed to load native library
#      'native-platform.dll'，跟着是 FileNotFoundException (拒绝访问)。
#      Gradle 往 GRADLE_USER_HOME/native/… 里写 .lock 和 .dll 都被拒。
#
# 注意 -Dorg.gradle.native=false 加在命令行上没用 —— 它只作用于客户端 JVM，
# 守护进程起来照样崩。必须用 JAVA_TOOL_OPTIONS，因为所有 JVM 都会自动读它。
export JAVA_TOOL_OPTIONS="-Dorg.gradle.native=false"

# ── 坑 2：GRADLE_USER_HOME 不能用 D: 盘那个目录 ───────────────────
# 在 D:/dev/toolchains/gradle-home 下，连 daemon/registry.bin.lock 都创建不了
# （同样是「拒绝访问」）。改回默认的用户目录就正常了。
# 所以这里显式 unset，让 Gradle 用 ~/.gradle。
unset GRADLE_USER_HOME

# ── 坑 3：cap sync 会被安全删除机制挡住 ──────────────────────────
# 现象：removePluginsNativeFiles 删除 capacitor-cordova-android-plugins 时报
#      SAFE_DELETE_INVALID_PATH，导致网页资源没同步过去，
#      装出来的 APK 跑的还是旧版代码。
# 绕法：手动把 app/ 覆盖到 assets/public/。
echo "==> 同步网页资源（绕开 cap sync）"
DEST="$ROOT/android/app/src/main/assets/public"
for f in index.html sw.js manifest.webmanifest; do
  cp -f "$ROOT/app/$f" "$DEST/$f"
done
cp -rf "$ROOT/app/js/." "$DEST/js/"
cp -rf "$ROOT/app/css/." "$DEST/css/"
cp -rf "$ROOT/app/icons/." "$DEST/icons/"
echo "    版本：$(grep -o '记哪儿 v[0-9]*' "$DEST/index.html")"

# ── 构建 ─────────────────────────────────────────────────────────
echo "==> 构建 debug APK"
cd "$ROOT/android"
"$GRADLE" assembleDebug --no-daemon --console=plain

APK="$ROOT/android/app/build/outputs/apk/debug/app-debug.apk"
if [ ! -f "$APK" ]; then
  echo "!! 没找到 APK，构建可能失败了" >&2
  exit 1
fi

# ── 产物复制到方便取用的位置 ─────────────────────────────────────
VER="$(grep -o 'v[0-9]*' <<< "$(grep -o '记哪儿 v[0-9]*' "$DEST/index.html")" | head -1)"
OUT_DIR="D:/dev/jinr-apk"
mkdir -p "$OUT_DIR"
cp -f "$APK" "$OUT_DIR/记哪儿-$VER.apk"

echo ""
echo "==> 完成"
ls -lh "$OUT_DIR/"
