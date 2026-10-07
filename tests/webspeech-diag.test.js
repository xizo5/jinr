/*
 * 记哪儿 —— 语音诊断的错误码覆盖
 *
 * 这个文件是为一类特定 bug 写的回归守卫：
 *   录音失败有两套完全不同的错误命名，分属两个文件——
 *     getUserMedia   → NotAllowedError / NotFoundError …（驼峰，来自浏览器 DOM）
 *     Web Speech API → not-allowed / audio-capture …（小写连字符，来自 asr.js）
 *   app.js 的诊断函数一开始只认驼峰那套，于是自带识别的失败全部掉进
 *   兜底分支，只显示「麦克风打不开（not-allowed）」这种等于没说的提示。
 *   用户看到的就是这个，排查时无从下手。
 *
 * 所以这里做「两文件一致性」检查：asr.js 能抛出的每一个错误码，
 * app.js 的诊断表都必须能给出针对性结论。加了新错误码却忘了配文案，
 * 这个测试会直接失败。
 */
var test = require('node:test');
var assert = require('node:assert');
var fs = require('node:fs');
var path = require('node:path');

var APP_DIR = path.join(__dirname, '..', 'app');
var APP_JS = fs.readFileSync(path.join(APP_DIR, 'js', 'app.js'), 'utf8');
var ASR_JS = fs.readFileSync(path.join(APP_DIR, 'js', 'asr.js'), 'utf8');

/* 从 `var X = { ... };` 里抠出所有单引号键名 */
function keysOf(source, varName) {
  var re = new RegExp('var\\s+' + varName + '\\s*=\\s*\\{([\\s\\S]*?)\\};');
  var m = source.match(re);
  assert.ok(m, '在源码里没找到 var ' + varName + ' = { … } 结构，测试需要跟着源码结构调整');
  var keys = [];
  var kr = /'([a-zA-Z-]+)'\s*:/g;
  var k;
  while ((k = kr.exec(m[1])) !== null) keys.push(k[1]);
  return keys;
}

/* asr.js 里 Web Speech API 会抛出的错误码 */
var ASR_CODES = keysOf(ASR_JS, 'texts');
/* app.js 的诊断表覆盖的错误码 */
var DIAG_CODES = keysOf(APP_JS, 'map');

test('asr.js 确实会抛出多个错误码（前提检查）', () => {
  assert.ok(ASR_CODES.length >= 4,
    '提取到的错误码太少，可能源码结构变了：' + JSON.stringify(ASR_CODES));
  assert.ok(ASR_CODES.indexOf('not-allowed') !== -1);
});

test('app.js 的诊断表覆盖了 asr.js 会抛出的每一个错误码', () => {
  var missing = ASR_CODES.filter(function (c) { return DIAG_CODES.indexOf(c) === -1; });
  assert.deepEqual(missing, [],
    '这些错误码 asr.js 会抛、但 app.js 没有针对性文案，会掉进兜底分支：' +
    JSON.stringify(missing) + '。加了新错误码要同步补诊断文案。');
});

test('三个 fatal 码必须都有文案（它们才会弹排查框）', () => {
  // asr.js 里 fatal 的定义：只有这三个会走 openMicHelp 弹框
  var fatal = ['not-allowed', 'service-not-allowed', 'audio-capture'];
  var m = ASR_JS.match(/var fatal =([\s\S]*?);/);
  assert.ok(m, '找不到 asr.js 里 fatal 的定义');
  fatal.forEach(function (c) {
    assert.ok(m[1].indexOf("'" + c + "'") !== -1,
      'asr.js 的 fatal 定义里没有 ' + c + '？fatal 列表变了，测试要同步');
    assert.ok(DIAG_CODES.indexOf(c) !== -1,
      c + ' 是 fatal（会弹排查框），app.js 必须有它的文案');
  });
});

test('诊断表不能退化成以驼峰命名为主的写法', () => {
  // 驼峰是 getUserMedia 那套，不该出现在 Web Speech 的诊断表里
  var camel = DIAG_CODES.filter(function (c) { return /[A-Z]/.test(c); });
  assert.deepEqual(camel, [],
    'Web Speech 的错误码是小写连字符格式，诊断表里不该混入驼峰名：' +
    JSON.stringify(camel));
});

test('每一条文案都给出可执行的动作，不是干巴巴一句结论', () => {
  var m = APP_JS.match(/var\s+map\s*=\s*\{([\s\S]*?)\};\s*\n\s*return\s+map/);
  assert.ok(m, '没找到 webSpeechDiag 里的 map 结构');
  var body = m[1];
  // 每条文案至少要有「去哪里点/换什么」之类的指引，长度是粗筛
  DIAG_CODES.forEach(function (code) {
    var re = new RegExp("'" + code + "'\\s*:\\s*'((?:[^'\\\\]|\\\\.)*)'");
    var hit = body.match(re);
    assert.ok(hit, '找不到 ' + code + ' 的文案（可能是跨行拼接，测试正则需同步）');
    assert.ok(hit[1].length >= 12,
      code + ' 的文案太短，等于没说：' + hit[1]);
  });
});

test('自带识别的诊断必须排在通用兜底之前（否则永远走不到）', () => {
  var wsIdx = APP_JS.indexOf('webSpeechDiag(err)');
  var fallbackIdx = APP_JS.indexOf("'麦克风打不开（' + err.name");
  assert.ok(wsIdx !== -1, '没找到 webSpeechDiag 的调用');
  assert.ok(fallbackIdx !== -1, '没找到通用兜底分支');
  assert.ok(wsIdx < fallbackIdx,
    'webSpeechDiag 必须在通用兜底之前调用，否则自带识别的错误码会被兜底吃掉');
});

test('排查框里同时给出环境底细（含原始错误码）', () => {
  assert.ok(/错误码:/.test(APP_JS),
    '底细里要带上原始错误码——不认识的错误只能靠它定位');
  assert.ok(/语音方案:/.test(APP_JS),
    '底细里要说明走的是哪条路（腾讯云 / 自带识别 / 无）');
  assert.ok(/【环境底细】/.test(APP_JS),
    '结论和环境底细要一起展示，只给结论的话用户没法提供线索');
});
