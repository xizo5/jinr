var test = require('node:test');
var assert = require('node:assert');
var Backup = require('../app/js/backup.js');
var AudioUtils = require('../app/js/audio-utils.js');

/* ── 备份 ─────────────────────────── */

var sample = [{
  id: 'r1', kind: 'place', item: '钥匙', place: '消防阀门里', text: '钥匙在消防阀门里',
  saidAt: '2024-06-01T08:00:00.000Z', placedAt: '2024-06-01T08:00:00.000Z',
  updatedAt: '2024-06-01T08:00:00.000Z', status: 'active', ignoredReason: null, history: []
}];

test('导出→导入 round-trip', () => {
  var payload = Backup.exportPayload(sample, '2024-06-10T08:00:00.000Z');
  assert.equal(payload.app, '记哪儿');
  var back = Backup.validateImport(JSON.parse(JSON.stringify(payload)));
  assert.equal(back.length, 1);
  assert.equal(back[0].place, '消防阀门里');
});

test('导入校验：不是本应用的文件 / 缺记录 / 重复 id / 坏记录', () => {
  assert.throws(function () { Backup.validateImport({ app: '别的' }); }, /记哪儿/);
  assert.throws(function () { Backup.validateImport({ app: '记哪儿' }); }, /记录列表/);
  assert.throws(function () {
    Backup.validateImport({ app: '记哪儿', records: [sample[0], sample[0]] });
  }, /重复 id/);
  assert.throws(function () {
    Backup.validateImport({ app: '记哪儿', records: [{ id: 'x' }] });
  }, /类型不对/);
  assert.throws(function () { Backup.validateImport(null); }, /格式不对/);
});

/* ── 音频纯工具 ───────────────────── */

test('floatTo16BitPCM：长度一致、范围裁剪', () => {
  var input = new Float32Array([0, 0.5, -0.5, 2, -2]);
  var out = AudioUtils.floatTo16BitPCM(input);
  assert.equal(out.length, 5);
  assert.equal(out[0], 0);
  assert.equal(out[1], Math.round(0.5 * 0x7fff));
  assert.equal(out[2], Math.round(-0.5 * 0x8000));
  assert.equal(out[3], 0x7fff);   // 超出裁剪
  assert.equal(out[4], -0x8000);
});

test('downsample：48k → 16k，长度为 1/3', () => {
  var input = new Float32Array(4800);
  for (var i = 0; i < input.length; i++) input[i] = Math.sin(i / 10);
  var out = AudioUtils.downsample(input, 48000, 16000);
  assert.equal(out.length, 1600);
  // 中间的值应夹在原始值范围内（插值不产生新极值）
  var min = Math.min.apply(null, input), max = Math.max.apply(null, input);
  out.forEach(function (v) {
    assert.ok(v >= min - 1e-6 && v <= max + 1e-6);
  });
});

test('toPcm16k：48k 输入得到 16k 的 Int16Array', () => {
  var input = new Float32Array(48000);
  var pcm = AudioUtils.toPcm16k(input, 48000);
  assert.equal(pcm.length, 16000);
  assert.ok(pcm instanceof Int16Array);
});

test('toMono：双声道取平均', () => {
  var l = new Float32Array([1, 0]);
  var r = new Float32Array([0, -1]);
  var m = AudioUtils.toMono([l, r]);
  assert.deepEqual(Array.from(m), [0.5, -0.5]);
});
