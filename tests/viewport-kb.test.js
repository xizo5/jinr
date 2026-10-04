var test = require('node:test');
var assert = require('node:assert');

/*
 * 软键盘视口适配的计算逻辑。
 *
 * 为什么值得测：`--kb`（键盘盖住的高度）这个减法很容易写错，
 * 而且错了不报错、只是"输入框位置怪怪的"，靠肉眼看很难定位。
 * 纯算术，无DOM 依赖，直接验证。
 */

/* 与 app.js 的 syncViewport 同结构：
 *   kb = innerHeight - visualViewport.height - visualViewport.offsetTop
 * offsetTop 也要减：安卓横屏/某些机型下键盘弹出时视口还会有偏移，
 * 只减 height 会把偏移量算进键盘高度里，导致内容上移过头。*/
function calcKb(innerHeight, vv) {
  return Math.max(0, Math.round(innerHeight - vv.height - vv.offsetTop));
}

function isKbOpen(kb) {
  return kb > 120;
}

test('键盘没弹：kb 为 0', () => {
  assert.equal(calcKb(800, { height: 800, offsetTop: 0 }), 0);
});

test('键盘弹起：kb 等于被盖住的高度', () => {
  // 屏高 800，键盘占 400→视口只剩 400
  assert.equal(calcKb(800, { height: 400, offsetTop: 0 }), 400);
});

test('横屏：offsetTop 偏移量要被减掉，不能算进键盘高度', () => {
  //视口 300 高，但整体下移了 50（offsetTop）
  // 键盘实际只盖了 800-300-50 = 450，而不是 800-300 = 500
  assert.equal(calcKb(800, { height: 300, offsetTop: 50 }), 450);
});

test('kb 永不为负：某些浏览器键盘收起瞬间会给出荒谬的视口高度', () => {
  // height 比 innerHeight 还大（键盘收起动画中会这样）
  assert.equal(calcKb(800, { height: 860, offsetTop: 0 }), 0);
  assert.equal(calcKb(800, { height: 1000, offsetTop: -50 }), 0);
});

test('阈值：抖动不算键盘弹出，真实键盘才算', () => {
  assert.equal(isKbOpen(0), false);
  assert.equal(isKbOpen(60), false);   // 地址栏收起之类
  assert.equal(isKbOpen(119), false);
  assert.equal(isKbOpen(121), true);
  assert.equal(isKbOpen(400), true);
});

test('典型安卓机型：竖屏键盘约占 40% 屏高', () => {
  var kb = calcKb(2340, { height: 1400, offsetTop: 0 });
  assert.equal(kb, 940);
  assert.equal(isKbOpen(kb), true);
});

test('横屏键盘占得更矮（高度不足屏高一半），阈值不能设太高', () => {
  // 屏高 1080，横屏键盘约 300高
  var kb = calcKb(1080, { height: 780, offsetTop: 0 });
  assert.equal(kb, 300);
  assert.equal(isKbOpen(kb), true, '横屏键盘也必须被认出来，否则弹层不上移');
});

test('iOS Safari 行为：键盘弹出时 innerHeight 不变、vv.height 变', () => {
  // 这是本方案要解决的核心场景——vh/dvh 在这种情况下不会缩
  var innerH = 812;
  var dvhWouldBe = innerH;          // 100dvh 依然是812
  var kb = calcKb(innerH, { height: 500, offsetTop: 0 });
  assert.equal(dvhWouldBe, 812);
  assert.equal(kb, 312, 'dvh 靠不住，必须靠 visualViewport');
  assert.ok(kb > 0 && innerH - kb < 600, 'body 实际高度应该等于 vv.height');
});
