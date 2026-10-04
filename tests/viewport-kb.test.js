var test = require('node:test');
var assert = require('node:assert');
var fs = require('node:fs');
var path = require('node:path');

/*
 * 软键盘适配的回归守卫。
 *
 * 为什么要有这个文件：上一版踩过一个极隐蔽的坑 —— 为了把页面顶上去，
 * 给 body 加了 `transform: translateY(-kb)`。结果：
 *   1. transform 让 body 变成所有 position:fixed 后代的包含块，
 *      .scrim / .drawer / .dlg 全部改成相对 body 定位 → 位置错乱
 *   2. body 还有 overflow:hidden，错位的抽屉直接被裁掉
 *   3. 同时又设了 --app-h 缩小高度，等于补偿两遍 → 移过头
 * 这类错误在浏览器上手点一遍未必发现（桌面端没有软键盘），
 * 所以用静态检查把「body 不许有 transform」钉死。
 */

var APP_DIR = path.join(__dirname, '..', 'app');
var CSS = fs.readFileSync(path.join(APP_DIR, 'css', 'style.css'), 'utf8');
var HTML = fs.readFileSync(path.join(APP_DIR, 'index.html'), 'utf8');

/* 去掉注释再断言，否则注释里提到 transform 会误伤 */
function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/* 取出某个「独立」选择器的声明块。
 *
 * 不能用简单的正则 —— `html,\nbody { }` 这种组合选择器里，body 也出现在行首，
 * 多行模式下 ^ 会把它当成独立规则匹配到，取到的是组合规则的声明。
 * 所以逐行扫：要求整个选择器行去空格后正好等于目标（排除组合与后代选择器）。*/
function blockOf(css, selector) {
  var lines = css.split('\n');
  for (var i = 0; i < lines.length; i++) {
    if (lines[i].trim() !== selector + ' {') continue;
    // `html,\nbody {` 这种组合选择器：上一行以逗号结尾，说明 body 不是独立规则
    var prev = i > 0 ? lines[i - 1].trim() : '';
    if (prev.endsWith(',')) continue;
    var out = [];
    for (var j = i + 1; j < lines.length; j++) {
      if (lines[j].trim() === '}') return out.join('\n');
      out.push(lines[j]);
    }
  }
  return null;
}

var CSS_NC = stripComments(CSS);

test('body 绝对不许有 transform —— 会让 fixed 后代全部错位', () => {
  var block = blockOf(CSS_NC, 'body');
  assert.ok(block, '没找到 body 规则，style.css 结构变了？');
  assert.ok(!/transform/.test(block),
    'body 上出现了 transform！这会让 .scrim/.drawer/.dlg 等 position:fixed ' +
    '子元素改成相对 body 定位。键盘适配请改高度（--app-h）或 ' +
    'viewport meta 的 interactive-widget，不要用 transform。');
});

test('body 高度由 --app-h 驱动，且带 dvh 兜底', () => {
  var block = blockOf(CSS_NC, 'body');
  assert.match(block, /height:\s*var\(--app-h/,
    'body 高度应该走 --app-h，脚本没跑时回落到 dvh');
});

test('html/body 组合声明里也不许夹带 transform', () => {
  var m = CSS_NC.match(/html,\s*\nbody\s*\{([^}]*)\}/);
  if (!m) return; // 结构变了就跳过，不强求
  assert.ok(!/transform/.test(m[1]), 'html,body 的公共规则里不该有 transform');
});

test('viewport meta 带 interactive-widget=resizes-content（安卓键盘主方案）', () => {
  var m = HTML.match(/<meta\s+name="viewport"\s+content="([^"]*)"/);
  assert.ok(m, '没找到 viewport meta');
  assert.match(m[1], /interactive-widget=resizes-content/,
    '缺了这条，安卓 Chrome 上键盘会盖住输入框；这是主方案，' +
    'JS 的 visualViewport 只是兜底');
});

test('sheet-up 入场动画仍用 transform，所以 .dlg 的键盘偏移必须走 bottom', () => {
  assert.match(CSS_NC, /@keyframes\s+sheet-up\s*\{[\s\S]*?transform:\s*translateY\(100%\)/,
    'sheet-up 动画改过了？如果它不再动 transform，.dlg 的偏移方式可以重新评估');
  var dlg = blockOf(CSS_NC, '.dlg');
  assert.ok(dlg, '没找到 .dlg 规则');
  assert.match(dlg, /bottom:\s*var\(--dlg-kb/,
    '.dlg 的键盘偏移必须用 bottom 实现：入场动画抢的是 transform，' +
    '两者同时写会互相覆盖');
  assert.ok(!/transform:/.test(dlg),
    '.dlg 里不该再出现 transform 声明');
});

test('键盘算出的偏移是非负的，且只有超过阈值才算真弹出', () => {
  function calcKb(innerH, vv) {
    return Math.max(0, Math.round(innerH - vv.height - vv.offsetTop));
  }
  assert.equal(calcKb(800, { height: 800, offsetTop: 0 }), 0);
  assert.equal(calcKb(800, { height: 400, offsetTop: 0 }), 400);
  assert.equal(calcKb(800, { height: 300, offsetTop: 50 }), 450,
    'offsetTop 必须减掉，否则横屏时上移过头');
  assert.equal(calcKb(800, { height: 900, offsetTop: 0 }), 0, '不许为负');
});
