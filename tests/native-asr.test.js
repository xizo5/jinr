/*
 * 记哪儿 —— 安卓原生语音识别（Capacitor 壳）
 *
 * 为什么要认真测这条：它把「手机能不能语音输入」从"看运气"变成"看实现"。
 * Web Speech API 必须连谷歌服务器，国内必挂；原生 SpeechRecognizer 用手机
 * 厂商自带的引擎，国内能用 —— 这是打包成 App 的**唯一真正理由**。
 *
 * 另外这里钉住一批"逆向得来"的约定：插件名、方法名、参数名、返回结构、
 * 错误文案，全是从插件的 Android 源码里读出来的，没有文档保证。
 * 万一升级插件改了这些，测试会直接报出来，而不是等装到手机上才发现。
 */
var test = require('node:test');
var assert = require('node:assert');
var fs = require('node:fs');
var path = require('node:path');

/* asr.js 的 `global` 参数等于 window，所以桥要挂在 window 上 */
var fakeWindow = {};
global.window = fakeWindow;
fakeWindow.Settings = { asrConfigured: function () { return false; } };

/* ── 可控的假原生桥 ─────────────────────────────── */

var calls = [];      // 记录所有跨桥调用，用来断言方法名
var responses = {};  // key: '插件.方法' → 返回值 / 函数 / Error

var fakeCap = {
  isNativePlatform: function () { return true; },
  nativePromise: function (plugin, method, opts) {
    calls.push({ plugin: plugin, method: method, opts: opts });
    var r = responses[plugin + '.' + method];
    if (typeof r === 'function') return r(opts);
    if (r instanceof Error) return Promise.reject(r);
    return Promise.resolve(r === undefined ? {} : r);
  }
};
fakeWindow.Capacitor = fakeCap;

var ASR = require('../app/js/asr.js');

function reset() { calls = []; responses = {}; }
function lastCall(method) {
  for (var i = calls.length - 1; i >= 0; i--) if (calls[i].method === method) return calls[i];
  return null;
}

/* ── 环境探测 ───────────────────────────────────── */

test('普通浏览器里 nativeBridge() 返回 null（不能误判成原生）', () => {
  var saved = fakeWindow.Capacitor;
  delete fakeWindow.Capacitor;
  assert.equal(ASR.nativeBridge(), null);
  fakeWindow.Capacitor = saved;
});

test('有 nativePromise 但不是原生平台时，也算没有原生', () => {
  var saved = fakeCap.isNativePlatform;
  fakeCap.isNativePlatform = function () { return false; };
  assert.equal(ASR.nativeBridge(), null);
  fakeCap.isNativePlatform = saved;
});

test('probeNative 真去问原生侧，按 available 结果定论', () => {
  reset();
  responses['SpeechRecognition.available'] = { available: true };
  return ASR.probeNative().then(function (ok) {
    assert.equal(ok, true);
    var c = lastCall('available');
    assert.ok(c, '没调用 available');
    assert.equal(c.plugin, 'SpeechRecognition', '插件名必须是注册时的名字');
    assert.equal(ASR.nativeReady(), true);
  });
});

test('设备没有识别引擎时如实返回 false（不假装能用）', () => {
  reset();
  responses['SpeechRecognition.available'] = { available: false };
  return ASR.probeNative().then(function (ok) {
    assert.equal(ok, false);
    assert.equal(ASR.nativeReady(), false);
  });
});

test('探测抛异常时不崩，按"不可用"处理', () => {
  reset();
  responses['SpeechRecognition.available'] = new Error('bridge gone');
  return ASR.probeNative().then(function (ok) {
    assert.equal(ok, false, '桥挂了也必须给出结论，不能让界面卡在未知状态');
  });
});

/* ── 方案优先级 ─────────────────────────────────── */

test('原生可用时优先级最高，压过腾讯云和自带识别', () => {
  reset();
  fakeWindow.SpeechRecognition = function () {}; // 假装自带识别也有
  responses['SpeechRecognition.available'] = { available: true };
  var settings = { tencentAppId: 'x', tencentSecretId: 'y', tencentSecretKey: 'z' };

  return ASR.probeNative().then(function () {
    var saved = fakeWindow.Settings.asrConfigured;
    fakeWindow.Settings.asrConfigured = function () { return true; }; // 腾讯云也配了
    assert.equal(ASR.mode(settings), 'native',
      '原生免费又最快，配了腾讯云也该先走原生');
    fakeWindow.Settings.asrConfigured = saved;
    delete fakeWindow.SpeechRecognition;
  });
});

/* ── 识别流程 ───────────────────────────────────── */

test('start 的参数必须对（否则原生侧读不到，会走错分支）', () => {
  reset();
  responses['SpeechRecognition.requestPermissions'] = { speechRecognition: 'granted' };
  responses['SpeechRecognition.start'] = { status: 'success', matches: ['钥匙在消防阀门里'] };

  return ASR.nativeStart().promise.then(function (text) {
    assert.equal(text, '钥匙在消防阀门里');

    var c = lastCall('start');
    assert.ok(c, '没调用 start');
    assert.equal(c.opts.language, 'zh-CN');
    assert.equal(c.opts.partialResults, false,
      'partialResults 必须 false —— 只有 false 时原生才在结束时 resolve 出结果' +
      '（true 是走 partialResults 事件、不 resolve）');
    assert.equal(c.opts.popup, false, '别弹系统识别面板，用自己的界面');
    assert.equal(c.opts.maxResults, 1);
  });
});

test('先要权限再 start（顺序反了会被直接拒绝）', () => {
  reset();
  responses['SpeechRecognition.requestPermissions'] = { speechRecognition: 'granted' };
  responses['SpeechRecognition.start'] = { status: 'success', matches: ['嗯'] };

  return ASR.nativeStart().promise.then(function () {
    var pi = -1, si = -1;
    calls.forEach(function (c, i) {
      if (c.method === 'requestPermissions') pi = i;
      if (c.method === 'start') si = i;
    });
    assert.ok(pi !== -1 && si !== -1, '两步都要有');
    assert.ok(pi < si, 'requestPermissions 必须在 start 之前');
  });
});

test('权限被拒时给出中文指引，且算致命错误（要弹排查）', () => {
  reset();
  responses['SpeechRecognition.requestPermissions'] = { speechRecognition: 'denied' };

  return ASR.nativeStart().promise.then(function () {
    assert.fail('权限被拒时不该 resolve');
  }, function (err) {
    assert.equal(err.fatal, true);
    assert.match(err.message, /麦克风/);
    assert.equal(lastCall('start'), null, '权限没过就不该发起识别');
  });
});

test('引擎没听清（No match / No speech input）算温和情况，不弹排查框', () => {
  var soft = ['No match', 'No speech input', "Didn't understand, please try again."];
  return Promise.all(soft.map(function (msg) {
    reset();
    responses['SpeechRecognition.requestPermissions'] = { speechRecognition: 'granted' };
    responses['SpeechRecognition.start'] = new Error(msg);
    return ASR.nativeStart().promise.then(function () {
      assert.fail(msg + ' 应走 reject');
    }, function (err) {
      assert.equal(err.silent, true, msg + ' 属于"没说话/没听懂"，应温和提示');
      assert.equal(err.fatal, false);
    });
  }));
});

test('真故障（网络/权限/服务不可用）算致命，要给排查指引', () => {
  var hard = ['Network error', 'Insufficient permissions',
    'Speech recognition service is not available.', 'Audio recording error'];
  return Promise.all(hard.map(function (msg) {
    reset();
    responses['SpeechRecognition.requestPermissions'] = { speechRecognition: 'granted' };
    responses['SpeechRecognition.start'] = new Error(msg);
    return ASR.nativeStart().promise.then(function () {
      assert.fail(msg + ' 应走 reject');
    }, function (err) {
      assert.equal(err.fatal, true, msg + ' 是真故障，要弹排查');
      assert.equal(err.silent, false);
    });
  }));
});

test('stopt 会调到原生 stop（松手要能真的停住）', () => {
  reset();
  responses['SpeechRecognition.requestPermissions'] = { speechRecognition: 'granted' };
  responses['SpeechRecognition.start'] = function () { return new Promise(function () {}); };
  var h = ASR.nativeStart();
  h.stop();
  return new Promise(function (r) { setTimeout(r, 0); }).then(function () {
    assert.ok(lastCall('stop'), '松手时必须调原生 stop，否则麦克风会一直开着');
  });
});

/* ── 原生壳里的其他约束 ─────────────────────────── */

var APP_JS = fs.readFileSync(path.join(__dirname, '..', 'app', 'js', 'app.js'), 'utf8');

test('原生壳里不注册 Service Worker（会和外壳的资源加载打架）', () => {
  var i = APP_JS.indexOf('function registerSW');
  assert.ok(i !== -1, '没找到 registerSW');
  var body = APP_JS.slice(i, i + 700);
  assert.ok(/ASR\.nativeBridge\(\)\)\s*return/.test(body),
    '原生壳里要跳过 SW 注册：外壳已把资源打进安装包，SW 缓存没意义，' +
    '而且会导致改完代码 App 里还是旧的、又没有刷新按钮可救');
});

test('启动时会探测原生可用性，并据此刷新界面', () => {
  assert.ok(/ASR\.probeNative\(\)/.test(APP_JS), 'boot 里要探测原生');
  assert.ok(/probeNative\(\)\.then/.test(APP_JS), '探测是异步的，要等结果再刷新界面');
});

test('原生与自带识别共用一套收尾逻辑（handle 形态一致）', () => {
  assert.ok(/mode === 'native'\) \? ASR\.nativeStart\(\) : ASR\.webSpeechStart\(\)/.test(APP_JS),
    '原生 handle 要和 webSpeechStart 同形态，否则 holdEnd 收尾会漏掉它');
});
