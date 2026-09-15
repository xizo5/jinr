var test = require('node:test');
var assert = require('node:assert');
var Prompt = require('../app/js/prompt.js');

test('buildParsePrompt：包含原话与现有记录', () => {
  var records = [
    { id: 'r1', kind: 'place', item: '钥匙', place: '消防阀门里', saidAt: '2024-06-01T08:00:00.000Z', status: 'active' },
    { id: 'r2', kind: 'ordinary', text: '周三交物业费', saidAt: '2024-06-02T08:00:00.000Z', status: 'ignored' }
  ];
  var p = Prompt.buildParsePrompt('我的钥匙呢', records);
  assert.match(p, /我的钥匙呢/);
  assert.match(p, /消防阀门里/);
  // 被忽略的记录不给 AI 看
  assert.ok(!p.includes('物业费'));
});

test('compactRecords：只给有效记录，限制条数', () => {
  var many = [];
  for (var i = 0; i < 400; i++) {
    many.push({ id: 'r' + i, kind: 'place', item: 'i' + i, place: 'p' + i, saidAt: '2024-06-01T08:00:00.000Z', status: i % 2 ? 'ignored' : 'active' });
  }
  var compact = Prompt.compactRecords(many, 300);
  assert.ok(compact.length <= 300);
  compact.forEach(function (c) { assert.equal(c.kind === 'place' ? !!c.item : !!c.text, true); });
});

test('extractJson：直接 JSON', () => {
  var o = Prompt.extractJson('{"intent":"record","actions":[]}');
  assert.equal(o.intent, 'record');
});

test('extractJson：带 markdown 代码块', () => {
  var o = Prompt.extractJson('好的，结果如下：\n```json\n{"intent":"question","actions":[]}\n```\n以上。');
  assert.equal(o.intent, 'question');
});

test('extractJson：前后有闲话也能抠出来', () => {
  var o = Prompt.extractJson('AI: 按要求输出 {"intent":"record","actions":[{"action":"create","kind":"place","item":"钥匙","place":"抽屉","text":"t"}]} 请查收');
  assert.equal(o.actions.length, 1);
});

test('extractJson：没有 JSON / 解析失败 → 中文报错', () => {
  assert.throws(function () { Prompt.extractJson('抱歉我不明白'); }, /找不到 JSON/);
  assert.throws(function () { Prompt.extractJson('{broken json'); }, /解析失败/);
  assert.throws(function () { Prompt.extractJson(''); }, /没有返回内容/);
});

test('normalize：补默认值、过滤非法动作', () => {
  var n = Prompt.normalize({ intent: 'question', actions: [null, { action: 'create' }, '垃圾'], answer: { text: '在抽屉', recordIds: ['r1', 2] }, reply: '好的' });
  assert.equal(n.intent, 'question');
  assert.equal(n.actions.length, 1);
  assert.deepEqual(n.answer.recordIds, ['r1', '2']);
  assert.equal(n.reply, '好的');

  var n2 = Prompt.normalize({});
  assert.equal(n2.intent, 'record');
  assert.deepEqual(n2.actions, []);
  assert.equal(n2.answer, null);
  assert.equal(n2.reply, '');
});
