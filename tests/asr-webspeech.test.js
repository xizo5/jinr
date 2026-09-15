/*
 * 记哪儿 —— 自带语音识别的「收尾契约」
 *
 * 防的就是那个把界面永久卡死的 bug：
 * 用户松手（stopped）之后引擎一个字都没吐出来，原来的 onend 两个分支
 * 都不走，promise 既不 resolve 也不 reject → 上层 cleanupMic() 永不执行
 * → 状态栏一直"在听…"、计时器一直涨、按钮一直"松开 结束"。
 *
 * 契约：webSpeechStart() 返回的 promise，无论发生什么，都必须有个了结。
 */
var test = require('node:test');
var assert = require('node:assert');

/* asr.js 会读 window / global.Settings，先在 Node 里把环境摆好再加载 */
var fakeWindow = {};
global.window = fakeWindow;
global.Settings = { asrConfigured: function () { return false; } };

var ASR = require('../app/js/asr.js');

/* 可控的假识别引擎：每次 new 出来记在 last 上，测试手动喂事件 */
var last = null;
function FakeSR() {
  last = this;
  this.lang = '';
  this.interimResults = false;
  this.maxAlternatives = 1;
  this.startCalled = false;
  this.stopCalled = false;
}
FakeSR.prototype.start = function () { this.startCalled = true; };
FakeSR.prototype.stop = function () { this.stopCalled = true; };
fakeWindow.SpeechRecognition = FakeSR;

/* 造一条 onresult 事件 */
function resultEvent(items) {
  var list = items.map(function (it) {
    var alt = { transcript: it.text };
    return { 0: alt, isFinal: !!it.final, length: 1 };
  });
  list.length = items.length;
  return { resultIndex: 0, results: list };
}

test('引擎必须真的被 start（曾经漏过这一行，任何事件都不来）', function () {
  ASR.webSpeechStart();
  assert.equal(last.startCalled, true);
});

test('说得出话：松手后 resolve 出文本', async function () {
  var handle = ASR.webSpeechStart();
  last.onresult(resultEvent([{ text: '钥匙', final: true }]));
  handle.stop();
  last.onend();
  assert.equal(await handle.promise, '钥匙');
});

test('一个字都没吐出来 + 用户已松手：必须 reject，绝不能悬挂', async function () {
  var handle = ASR.webSpeechStart();
  handle.stop();
  last.onend(); // 引擎结束，但什么也没识别到（就是卡死界面那条路）
  await assert.rejects(handle.promise, /没听到声音/);
});

test('stop 之后引擎不派发 onend：1.2 秒兜底了结', async function () {
  var handle = ASR.webSpeechStart();
  handle.stop(); // 故意不再触发 onend
  await assert.rejects(handle.promise, /没听到声音/);
});

test('临时结果也算数（用户还没等到 final 就松手）', async function () {
  var handle = ASR.webSpeechStart();
  last.onresult(resultEvent([{ text: '大门的钥匙放在', final: false }]));
  handle.stop();
  last.onend();
  assert.equal(await handle.promise, '大门的钥匙放在');
});

test('权限被拒：带 fatal 标记 + 原始错误名，交给上层弹排查指引', async function () {
  var handle = ASR.webSpeechStart();
  last.onerror({ error: 'not-allowed' });
  await assert.rejects(handle.promise, function (e) {
    return e.fatal === true && e.raw && e.raw.name === 'not-allowed';
  });
});

test('网络类错误不算 fatal（重试可能就好，别弹排查）', async function () {
  var handle = ASR.webSpeechStart();
  last.onerror({ error: 'network' });
  await assert.rejects(handle.promise, function (e) {
    return !e.fatal && /腾讯云/.test(e.message);
  });
});

test('settle 只生效一次：先出错再来 onend，不会重复了结', async function () {
  var handle = ASR.webSpeechStart();
  last.onerror({ error: 'aborted' });
  last.onend(); // 多余的一次，必须被忽略
  await assert.rejects(handle.promise, /识别被中断/);
});
