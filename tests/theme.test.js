/*
 * 记哪儿 —— 主题解析
 *
 * 三档怎么落到「实际用哪个色」是这里最容易出错的地方：
 * 「跟随系统」必须真跟系统走，手动选的档必须能盖过系统——
 * 一旦算错，表现就是"我明明选了浅色它还是黑的"，用户完全没法自查。
 */
var test = require('node:test');
var assert = require('node:assert');

/* theme.js 在 Node 里没有 document / matchMedia，只会导出纯函数 */
var Theme = require('../app/js/theme.js');

test('normalize：认识的档位原样返回，杂物一律归到 system', function () {
  assert.strictEqual(Theme.normalize('system'), 'system');
  assert.strictEqual(Theme.normalize('light'), 'light');
  assert.strictEqual(Theme.normalize('dark'), 'dark');

  assert.strictEqual(Theme.normalize('DARK'), 'system');   // 大小写不认
  assert.strictEqual(Theme.normalize('auto'), 'system');   // 不支持的档位
  assert.strictEqual(Theme.normalize(''), 'system');
  assert.strictEqual(Theme.normalize(null), 'system');
  assert.strictEqual(Theme.normalize(undefined), 'system');
  assert.strictEqual(Theme.normalize({}), 'system');
});

test('resolve：手动选的档位必须盖过系统偏好', function () {
  // 系统是深色，但用户手动选了浅色 → 必须浅色
  assert.strictEqual(Theme.resolve('light', true), 'light');
  assert.strictEqual(Theme.resolve('light', false), 'light');

  // 系统是浅色，但用户手动选了深色 → 必须深色
  assert.strictEqual(Theme.resolve('dark', false), 'dark');
  assert.strictEqual(Theme.resolve('dark', true), 'dark');
});

test('resolve：跟随系统时，系统是什么就是什么', function () {
  assert.strictEqual(Theme.resolve('system', true), 'dark');
  assert.strictEqual(Theme.resolve('system', false), 'light');
});

test('resolve：读不出档位时退回跟随系统，而不是硬给一个', function () {
  assert.strictEqual(Theme.resolve(null, true), 'dark');
  assert.strictEqual(Theme.resolve(undefined, false), 'light');
  assert.strictEqual(Theme.resolve('乱码', true), 'dark');
});

test('resolve 只会吐出 light / dark 两个值', function () {
  ['system', 'light', 'dark', null, '', 'x'].forEach(function (m) {
    [true, false].forEach(function (sys) {
      var out = Theme.resolve(m, sys);
      assert.ok(out === 'light' || out === 'dark', m + ' / ' + sys + ' → ' + out);
    });
  });
});

test('模块在无 DOM 环境下能加载，且不碰全局', function () {
  assert.strictEqual(typeof Theme.set, 'function');
  assert.strictEqual(typeof Theme.apply, 'function');
  assert.strictEqual(typeof Theme.onChange, 'function');
  assert.strictEqual(typeof Theme.get, 'function');
  assert.strictEqual(typeof Theme.actual, 'function');
  assert.deepStrictEqual(Theme.MODES, ['system', 'light', 'dark']);
});
