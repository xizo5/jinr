/*
 * 记哪儿 —— 外观主题
 * 三档：system（跟随系统）/ light（浅色）/ dark（深色）
 *
 * 约定：
 *  - 存自己的键 `jinr.theme`，不跟设置弹层的「保存」绑。点一下立刻生效、立刻持久化。
 *    （密钥是敏感数据要按保存；外观是显示偏好，多一次确认只会烦人）
 *  - 只认一个最终结果：`<html data-theme="light|dark">`。CSS 里不写媒体查询判断，
 *    连「跟随系统」也由这里解析成具体值，省得两套逻辑打架。
 *  - `data-theme-mode` 存用户选的那一档，纯粹给调试看，样式不依赖它。
 */
(function (global) {
  'use strict';

  var KEY = 'jinr.theme';
  var MODES = ['system', 'light', 'dark'];

  /* 与 index.html 的 <meta name="theme-color"> 保持一致（就两个值，懒得再抽一层） */
  var BAR = { light: '#f2f2f7', dark: '#000000' };

  /* ── 纯逻辑：可以在 Node 里单测 ───────────── */

  function normalize(mode) {
    return MODES.indexOf(mode) >= 0 ? mode : 'system';
  }

  /* 把「用户选的档位 + 系统当前偏好」解成实际主题 */
  function resolve(mode, systemDark) {
    mode = normalize(mode);
    if (mode === 'light' || mode === 'dark') return mode;
    return systemDark ? 'dark' : 'light';
  }

  /* ── 浏览器环境 ──────────────────────────── */

  var doc = global.document;
  var mq = null;
  try {
    mq = global.matchMedia ? global.matchMedia('(prefers-color-scheme: dark)') : null;
  } catch (e) { mq = null; }

  var subs = [];

  function ls() {
    try { return global.localStorage; } catch (e) { return null; } // 隐私模式/沙箱里会抛
  }

  function systemDark() { return !!(mq && mq.matches); }

  function stored() {
    var s = ls();
    try { return normalize(s && s.getItem(KEY)); } catch (e) { return 'system'; }
  }

  function persist(mode) {
    var s = ls();
    try { if (s) s.setItem(KEY, normalize(mode)); } catch (e) { /* 写不进去也不影响当次生效 */ }
  }

  function paintSeg(mode) {
    var seg = doc.getElementById('themeSeg');
    if (!seg) return;
    Array.prototype.forEach.call(seg.querySelectorAll('[data-mode]'), function (b) {
      b.setAttribute('aria-pressed', b.getAttribute('data-mode') === mode ? 'true' : 'false');
    });
  }

  /* 把主题落到 DOM 上；返回实际生效的 light/dark */
  function apply(mode) {
    mode = normalize(mode || stored());
    var actual = resolve(mode, systemDark());
    if (doc) {
      var root = doc.documentElement;
      root.setAttribute('data-theme', actual);
      root.setAttribute('data-theme-mode', mode);
      var meta = doc.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute('content', BAR[actual]);
      paintSeg(mode);
    }
    return actual;
  }

  function notify(mode, actual) {
    subs.slice().forEach(function (fn) {
      try { fn(mode, actual); } catch (e) { /* 订阅方自己炸了不该拖垮切换 */ }
    });
  }

  /* 切换主题：立刻生效 + 立刻记住 */
  function set(mode) {
    persist(mode);
    var m = stored();
    var actual = apply(m);
    notify(m, actual);
    return actual;
  }

  /* 系统深浅色变了：只有「跟随系统」档需要响应 */
  function onSystemChange() {
    if (stored() !== 'system') return;
    var actual = apply('system');
    notify('system', actual);
  }

  if (mq) {
    if (mq.addEventListener) mq.addEventListener('change', onSystemChange);
    else if (mq.addListener) mq.addListener(onSystemChange); // 老 Safari
  }

  if (doc) {
    apply(); // 内联脚本已在首屏前设过，这里只是补齐 meta 与分段控件状态

    var seg = doc.getElementById('themeSeg');
    if (seg) {
      seg.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-mode]');
        if (!btn || !seg.contains(btn)) return;
        set(btn.getAttribute('data-mode'));
      });
    }
  }

  var Theme = {
    MODES: MODES,
    get: stored,          // 用户选的档位
    actual: function () { return resolve(stored(), systemDark()); }, // 实际生效的
    set: set,
    apply: apply,
    onChange: function (fn) { if (typeof fn === 'function') subs.push(fn); },
    /* 下面两个暴露出来给单测用 */
    normalize: normalize,
    resolve: resolve
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Theme;
  else global.Theme = Theme;
})(typeof window !== 'undefined' ? window : globalThis);
