/*
 * AI 模型名的配置守卫。
 *
 * 为什么值得钉：模型名写错不会报语法错，只会在真正调用时报
 * "Model not exist"，而且用户在手机上未必看得出是模型名的问题。
 * 用户明确用的是 DeepSeek V4.1-Flash，API 模型名是 deepseek-flash；
 * deepseek-chat 是旧别名，已不适用。
 *
 * 权威来源：DeepSeek 更新日志（2026-09-10）
 *   "Change the model name to deepseek-flash to call the latest V4.1 Flash model."
 *
 * 注意：本文件刻意不用正则，全部用字符串查找，避免转义踩坑。
 */
var test = require('node:test');
var assert = require('node:assert');
var fs = require('node:fs');
var path = require('node:path');

var APP = path.join(__dirname, '..', 'app');
function read(rel) { return fs.readFileSync(path.join(APP, rel), 'utf8'); }

var FILES = ['js/ai.js', 'js/app.js', 'js/settings.js', 'index.html'];
var OLD = 'deepseek-chat';
var NEW = 'deepseek-flash';

test('默认模型是 deepseek-flash（不是过时的 deepseek-chat）', () => {
  var settings = read('js/settings.js');
  assert.ok(settings.indexOf("model: '" + NEW + "'") !== -1,
    'settings.js 的默认模型应为 ' + NEW);

  var ai = read('js/ai.js');
  assert.ok(ai.indexOf("settings.model || '" + NEW + "'") !== -1,
    'ai.js 请求时的兜底模型也应为 ' + NEW);
});

test('代码里不该再出现过时的 deepseek-chat', () => {
  FILES.forEach(function (f) {
    assert.ok(read(f).indexOf(OLD) === -1,
      f + ' 里还有 ' + OLD + ' —— 那是旧别名，会走到已废弃的模型');
  });
});

test('输入框占位符提示的是正确模型名', () => {
  var html = read('index.html');
  var anchor = html.indexOf('id="setModel"');
  assert.ok(anchor !== -1, '没找到 setModel 输入框');

  var ph = html.indexOf('placeholder="', anchor);
  assert.ok(ph !== -1, 'setModel 没有 placeholder');

  var start = ph + 'placeholder="'.length;
  var end = html.indexOf('"', start);
  var value = html.slice(start, end);

  assert.equal(value, NEW, '占位符要写对，否则用户照着填就填错了');
});

test('保存设置时的兜底也不能漏（用户清空时要有回落值）', () => {
  var app = read('js/app.js');
  assert.ok(app.indexOf("els.setModel.value.trim() || '" + NEW + "'") !== -1,
    '用户清空模型名时要回落到 ' + NEW + '，不能回落成空的或旧名');
});
