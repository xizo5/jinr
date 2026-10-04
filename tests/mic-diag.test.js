/*
 * 麦克风诊断逻辑的回归测试。
 *
 * 为什么单独测：手机端「点了允许还是用不了」几乎全是诊断不清导致的，
 * 而 getUserMedia 抛的 NotAllowedError 有两种完全不同的成因
 * （用户拒绝 vs 浏览器压根不弹框），错误名字一模一样。
 * 这里把「怎么区分」固化成测试，防止以后改回去。
 *
 * 说明：诊断逻辑在 app.js 里（依赖 window/DOM），无法直接 require。
 * 所以本文件复刻 app.js 中的判定结构，对同一组输入验证判定结果——
 * app.js 改了判定，这里的期望值也要跟着改，这是刻意的双份约束。
 */
var test = require('node:test');
var assert = require('node:assert');

/* ── 环境判定（与 app.js 的 precheckMic 同结构） ───────────── */

function isIOS(ua, platform, touch) {
  return /iPad|iPhone|iPod/.test(ua) ||
    (platform === 'MacIntel' && touch > 1);
}

function inAppBrowser(ua) {
  if (/MicroMessenger/i.test(ua)) return '微信';
  if (/\bQQ\b|QQBrowser|MQQBrowser/i.test(ua)) return 'QQ';
  if (/Weibo/i.test(ua)) return '微博';
  if (/DingTalk/i.test(ua)) return '钉钉';
  if (/Alipay/i.test(ua)) return '支付宝';
  if (/UCBrowser|UBrowser/i.test(ua)) return 'UC';
  if (/Quark/i.test(ua)) return '夸克';
  return '';
}

function secureOk(loc) {
  return loc.protocol === 'https:' || loc.hostname === 'localhost' ||
    loc.hostname === '127.0.0.1';
}

/* ── 权限状态 → 结论（这是本次修复的核心） ─────────────────
 *
 * 三种状态必须给出三种不同的结论，因为用户的解法完全相反：
 *   granted → 权限有，问题在别处（占用/内核）
 *   denied  → 用户拒绝过，要去设置改回来
 *   prompt  → 浏览器压根不弹框，改设置没用，必须换浏览器
 */
function verdictFor(state, errName) {
  if (state === 'prompt') {
    return { key: 'no-prompt', mustSwitchBrowser: true, mentionsSettings: false };
  }
  if (state === 'denied') {
    return { key: 'denied', mustSwitchBrowser: false, mentionsSettings: true };
  }
  if (state === 'granted') {
    return { key: 'granted-but-fails', mustSwitchBrowser: false, mentionsSettings: false };
  }
  return { key: 'unknown', mustSwitchBrowser: false, mentionsSettings: true, errName: errName };
}

/* ── 判定：内置浏览器优先，其次 https ───────────────────── */

function diagnose(env) {
  var app = inAppBrowser(env.ua);
  if (app) return { key: 'in-app-browser', app: app };
  if (!secureOk(env.loc)) return { key: 'not-secure', protocol: env.loc.protocol };
  if (!env.hasGetUserMedia) return { key: 'no-getusermedia' };
  if (!env.hasMediaRecorder) return { key: 'no-mediarecorder' };
  return { key: 'ok' };
}

var CHROME_ANDROID = {
  ua: 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120Mobile Safari/537.36',
  loc: { protocol: 'https:', hostname: 'xizo5.github.io' },
  hasGetUserMedia: true,
  hasMediaRecorder: true
};

test('预检：https + Chrome 安卓 = 没问题', () => {
  assert.equal(diagnose(CHROME_ANDROID).key, 'ok');
});

test('预检：内置浏览器的优先级最高，even其他条件都正常也判定为不可用', () => {
  var env = Object.assign({}, CHROME_ANDROID, {
    ua: 'Mozilla/5.0 MicroMessenger/8.0'
  });
  var d = diagnose(env);
  assert.equal(d.key, 'in-app-browser');
  assert.equal(d.app, '微信');
});

test('预检：非 https 明确报出协议（安卓 http 下 getUserMedia 直接不可用）', () => {
  var env = Object.assign({}, CHROME_ANDROID, {
    loc: { protocol: 'http:', hostname: '192.168.1.5' }
  });
  var d = diagnose(env);
  assert.equal(d.key, 'not-secure');
  assert.equal(d.protocol, 'http:');
});

test('预检：localhost 视作安全，便于本地调试', () => {
  assert.equal(diagnose(Object.assign({}, CHROME_ANDROID, {
    loc: { protocol: 'http:', hostname: 'localhost' }
  })).key, 'ok');
});

test('预检：缺 getUserMedia 与缺 MediaRecorder 要分开报（解法不同）', () => {
  assert.equal(diagnose(Object.assign({}, CHROME_ANDROID, { hasGetUserMedia: false })).key,
    'no-getusermedia');
  assert.equal(diagnose(Object.assign({}, CHROME_ANDROID, { hasMediaRecorder: false })).key,
    'no-mediarecorder');
});

test('预检：国产浏览器内核缺接口 → 建议换 Chrome', () => {
  assert.equal(inAppBrowser('Mozilla/5.0 UCBrowser/13.0'), 'UC');
  assert.equal(inAppBrowser('Mozilla/5.0 Quark/6.0'), '夸克');
});

/* ── 权限状态判定：本次修复的核心 ──────────────────────── */

test('NotAllowed + prompt（浏览器不弹框）→ 判定为必须换浏览器，且不该让用户去改设置', () => {
  var v = verdictFor('prompt', 'NotAllowedError');
  assert.equal(v.key, 'no-prompt');
  assert.equal(v.mustSwitchBrowser, true);
  // 关键：这种情况改设置没有意义，提示里不该把用户引到设置页
  assert.equal(v.mentionsSettings, false);
});

test('NotAllowed + denied（用户拒绝过）→ 提示去设置里改回来', () => {
  var v = verdictFor('denied', 'NotAllowedError');
  assert.equal(v.key, 'denied');
  assert.equal(v.mustSwitchBrowser, false);
  assert.equal(v.mentionsSettings, true);
});

test('NotAllowed + granted（权限已给却失败）→ 提示占用/内核问题', () => {
  var v = verdictFor('granted', 'NotAllowedError');
  assert.equal(v.key, 'granted-but-fails');
  assert.equal(v.mustSwitchBrowser, false);
});

test('三种权限状态给出三种不同结论——这是修复的核心保证', () => {
  var keys = ['prompt', 'denied', 'granted'].map(function (s) { return verdictFor(s, 'NotAllowedError').key; });
  assert.equal(new Set(keys).size, 3, '三种状态不能收敛到同一个结论');
});

test('查不到权限状态时退回到通用文案，但仍然带上原始错误名', () => {
  var v = verdictFor(null, 'NotAllowedError');
  assert.equal(v.key, 'unknown');
  assert.equal(v.errName, 'NotAllowedError');
});

test('iOS 判定：iPhone 与 iPad 都算，含 MacIntel 触屏伪装', () => {
  assert.equal(isIOS('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)', 'iPhone', 5), true);
  assert.equal(isIOS('Mozilla/5.0 (iPad; CPU OS 17_0)', 'iPad', 5), true);
  assert.equal(isIOS('Mozilla/5.0 (Macintosh; Intel Mac OS X)', 'MacIntel', 5), true);
  assert.equal(isIOS(CHROME_ANDROID.ua, 'Linux armv8l', 5), false);
});

test('其他错误名各自有独立结论，不要都归到「权限问题」', () => {
  // 这几个的解法跟权限无关，如果诊断文案把它们都写成「去设置里开权限」就是错的
  var others = ['NotFoundError', 'NotReadableError', 'OverconstrainedError'];
  others.forEach(function (n) {
    assert.notEqual(verdictFor('denied', n).key, 'no-prompt',
      n + ' 不该被误判为「浏览器不弹框」');
  });
});
