var test = require('node:test');
var assert = require('node:assert');
var Model = require('../app/js/model.js');

var NOW = '2024-06-10T08:00:00.000Z';

function activePlace(item, place) {
  return {
    id: 'r1', kind: 'place', item: item, place: place,
    text: item + '放在' + place,
    saidAt: '2024-06-01T08:00:00.000Z', placedAt: '2024-06-01T08:00:00.000Z',
    updatedAt: '2024-06-01T08:00:00.000Z',
    status: 'active', ignoredReason: null, history: []
  };
}

test('create：位置记录，字段齐全且在最前面', () => {
  var r = Model.applyDecision([], { action: 'create', kind: 'place', item: '大门钥匙', place: '消防阀门里', text: '大门钥匙塞消防阀门里了' }, NOW);
  assert.equal(r.ok, true);
  assert.equal(r.records.length, 1);
  var rec = r.records[0];
  assert.equal(rec.kind, 'place');
  assert.equal(rec.item, '大门钥匙');
  assert.equal(rec.place, '消防阀门里');
  assert.equal(rec.status, 'active');
  assert.deepEqual(rec.history, []);
  assert.equal(rec.saidAt, NOW);
  assert.ok(rec.id);
});

test('create：text 缺省时自动补"item放在place"', () => {
  var r = Model.applyDecision([], { action: 'create', kind: 'place', item: '钥匙', place: '抽屉' }, NOW);
  assert.equal(r.records[0].text, '钥匙放在抽屉');
});

test('create：位置记录缺 place 报错，不改动列表', () => {
  var before = [activePlace('钥匙', '抽屉')];
  var r = Model.applyDecision(before, { action: 'create', kind: 'place', item: '钥匙' }, NOW);
  assert.equal(r.ok, false);
  assert.match(r.error, /放在哪儿/);
  assert.equal(r.records.length, 1);
});

test('create：普通记录只要 text', () => {
  var r = Model.applyDecision([], { action: 'create', kind: 'ordinary', text: '周三要交物业费' }, NOW);
  assert.equal(r.ok, true);
  assert.equal(r.records[0].kind, 'ordinary');
  assert.equal(r.records[0].text, '周三要交物业费');
});

test('ignore：标记被忽略并留原因', () => {
  var before = [activePlace('钥匙', '消防阀门里')];
  var r = Model.applyDecision(before, { action: 'ignore', recordId: 'r1', reason: '同一件事又说了一遍' }, NOW);
  assert.equal(r.ok, true);
  assert.equal(r.applied, true);
  assert.equal(r.records[0].status, 'ignored');
  assert.equal(r.records[0].ignoredReason, '同一件事又说了一遍');
  // 原数组不被修改
  assert.equal(before[0].status, 'active');
});

test('ignore：已经忽略过 → 不重复应用也不报错', () => {
  var before = [Object.assign(activePlace('钥匙', '消防阀门里'), { status: 'ignored', ignoredReason: 'x' })];
  var r = Model.applyDecision(before, { action: 'ignore', recordId: 'r1' }, NOW);
  assert.equal(r.ok, true);
  assert.equal(r.applied, false);
});

test('ignore：找不到记录 → 报错', () => {
  var r = Model.applyDecision([], { action: 'ignore', recordId: 'nope' }, NOW);
  assert.equal(r.ok, false);
});

test('update：位置变化，旧位置进 history', () => {
  var before = [activePlace('钥匙', '消防阀门里')];
  var r = Model.applyDecision(before, { action: 'update', recordId: 'r1', place: '抽屉第二层' }, NOW);
  assert.equal(r.ok, true);
  var rec = r.records[0];
  assert.equal(rec.place, '抽屉第二层');
  assert.equal(rec.placedAt, NOW);
  assert.equal(rec.history.length, 1);
  assert.equal(rec.history[0].place, '消防阀门里');
  assert.equal(rec.saidAt, '2024-06-01T08:00:00.000Z'); // 最初记录时间保留
});

test('update：位置没变 → applied=false', () => {
  var before = [activePlace('钥匙', '消防阀门里')];
  var r = Model.applyDecision(before, { action: 'update', recordId: 'r1', place: '消防阀门里' }, NOW);
  assert.equal(r.ok, true);
  assert.equal(r.applied, false);
  assert.equal(r.records[0].history.length, 0);
});

test('update：普通记录没有位置可更新 → 报错', () => {
  var before = [{ id: 'o1', kind: 'ordinary', item: null, place: null, text: 'x', saidAt: NOW, placedAt: null, updatedAt: NOW, status: 'active', ignoredReason: null, history: [] }];
  var r = Model.applyDecision(before, { action: 'update', recordId: 'o1', place: ' anywhere' }, NOW);
  assert.equal(r.ok, false);
  assert.match(r.error, /普通记录/);
});

test('update：被忽略的记录更新后自动恢复 active', () => {
  var before = [Object.assign(activePlace('钥匙', '消防阀门里'), { status: 'ignored', ignoredReason: 'x' })];
  var r = Model.applyDecision(before, { action: 'update', recordId: 'r1', place: '抽屉' }, NOW);
  assert.equal(r.records[0].status, 'active');
  assert.equal(r.records[0].ignoredReason, null);
});

test('applyDecisions：批量按顺序执行，单个失败不影响后续', () => {
  var before = [activePlace('钥匙', '消防阀门里')];
  var r = Model.applyDecisions(before, [
    { action: 'ignore', recordId: 'r1', reason: '重复' },
    { action: 'ignore', recordId: '不存在', reason: '' },
    { action: 'create', kind: 'ordinary', text: '周三交物业费' }
  ], NOW);
  assert.equal(r.results[0].ok, true);
  assert.equal(r.results[1].ok, false);
  assert.equal(r.results[2].ok, true);
  assert.equal(r.records.length, 2);
  assert.equal(r.records[0].kind, 'ordinary');
  assert.equal(r.records[1].status, 'ignored');
});

test('updateFields：改位置也留 history；改空值报错', () => {
  var before = [activePlace('钥匙', '消防阀门里')];
  var r = Model.updateFields(before, 'r1', { item: '大门钥匙', place: '鞋柜' }, NOW);
  assert.equal(r.ok, true);
  assert.equal(r.records[0].place, '鞋柜');
  assert.equal(r.records[0].history.length, 1);

  var bad = Model.updateFields(before, 'r1', { item: '', place: '鞋柜' }, NOW);
  assert.equal(bad.ok, false);
});

test('setStatus / removeRecord / counts', () => {
  var before = [activePlace('钥匙', '消防阀门里')];
  var ignored = Model.setStatus(before, 'r1', 'ignored', NOW, '手动忽略');
  assert.equal(ignored.records[0].status, 'ignored');
  var restored = Model.setStatus(ignored.records, 'r1', 'active', NOW);
  assert.equal(restored.records[0].ignoredReason, null);
  assert.equal(Model.counts(restored.records).active, 1);
  var removed = Model.removeRecord(restored.records, 'r1');
  assert.deepEqual(Model.counts(removed.records), { active: 0, ignored: 0 });
});
