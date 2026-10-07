/*
 * 记哪儿 —— 「语音没开通」的判定与引导
 *
 * 背景：用户报「手机上没办法语音输入」，查下来根因是——
 *   安卓 Chrome 没有 window.webkitSpeechRecognition，国内又连不上谷歌的识别服务，
 *   所以没填腾讯云密钥时 ASR.mode() 返回 null。
 *   而旧代码遇到 null 是「静默禁用」按住说话按钮：
 *       els.micBtn.disabled = state.busy || !mode;
 *   禁用 = 点了完全没反应、也没有任何提示，用户根本不知道要去配密钥。
 *
 * 这个文件钉两件事：
 *   ① ASR.mode() 在「无密钥 + 无自带识别」时确实返回 null（安卓的真实处境）
 *   ② 界面不能再回到「静默禁用」的老路，必须给出可执行的指引
 */
var test = require('node:test');
var assert = require('node:assert');
var fs = require('node:fs');
var path = require('node:path');

/* ── ① 核心判定逻辑（真的加载 asr.js 跑） ─────────────── */

/* asr.js 会读 window / Settings，先在 Node 里把环境摆好再加载。
 *
 * ⚠ 注意挂载位置：asr.js 结尾是
 *     })(typeof window !== 'undefined' ? window : globalThis);
 * 所以它的 `global` 参数等于 window（浏览器里就是这样）。
 * 既然我们造了 window，Settings 就得挂在 window 上，
 * 挂到 globalThis.Settings 是读不到的。*/
var fakeWindow = {};
global.window = fakeWindow;

var asrConfigured = false;
fakeWindow.Settings = {
  asrConfigured: function () { return asrConfigured; }
};

var ASR = require('../app/js/asr.js');

test('安卓处境：没有自带识别 + 没填密钥 → mode 返回 null', () => {
  // 安卓 Chrome 不提供这两个构造函数，这正是国内安卓的默认情况
  delete fakeWindow.SpeechRecognition;
  delete fakeWindow.webkitSpeechRecognition;
  asrConfigured = false;

  assert.equal(ASR.mode({}), null,
    '这种情况下没有可用方案——界面必须给出「怎么开通」的指引，不能静默禁用按钮');
});

test('有自带识别（桌面 Chrome / 部分浏览器）→ webspeech', () => {
  fakeWindow.SpeechRecognition = function () {};
  asrConfigured = false;
  assert.equal(ASR.mode({}), 'webspeech');
});

test('webkit 前缀的也算（Safari 老写法）', () => {
  delete fakeWindow.SpeechRecognition;
  fakeWindow.webkitSpeechRecognition = function () {};
  asrConfigured = false;
  assert.equal(ASR.mode({}), 'webspeech');
  delete fakeWindow.webkitSpeechRecognition;
});

test('填了腾讯云密钥 → tencent，且优先级高于自带识别', () => {
  fakeWindow.SpeechRecognition = function () {};
  asrConfigured = true;
  assert.equal(ASR.mode({}), 'tencent',
    '腾讯云在国内更可靠，填了就该优先走它');
  asrConfigured = false;
  delete fakeWindow.SpeechRecognition;
});

test('webSpeechSupported 如实反映环境（安卓为 false）', () => {
  delete fakeWindow.SpeechRecognition;
  __resetWebkit();
  assert.equal(ASR.webSpeechSupported(), false);
  fakeWindow.SpeechRecognition = function () {};
  assert.equal(ASR.webSpeechSupported(), true);
  delete fakeWindow.SpeechRecognition;
});

/* webkit 前缀的清理小工具，避免上一条测试的残留影响下一条 */
function __resetWebkit() { delete fakeWindow.webkitSpeechRecognition; }

/* ── ② 界面不能回到「静默禁用」 ──────────────────────── */

var APP_JS = fs.readFileSync(path.join(__dirname, '..', 'app', 'js', 'app.js'), 'utf8');
var HTML = fs.readFileSync(path.join(__dirname, '..', 'app', 'index.html'), 'utf8');

test('refreshMic 不许再按「有没有语音方案」来禁用按钮', () => {
  assert.ok(!/els\.micBtn\.disabled\s*=\s*state\.busy\s*\|\|\s*!mode/.test(APP_JS),
    '又回到静默禁用了！没有语音方案时必须让按钮可点并给出指引，' +
    '禁用等于用户点了没反应、完全不知道该做什么。');
});

test('没有语音方案时会走 openAsrHelp() 给指引', () => {
  assert.ok(/function\s+openAsrHelp\s*\(/.test(APP_JS), '缺少 openAsrHelp()');
  assert.ok(/if\s*\(!mode\)\s*\{\s*openAsrHelp\(\)/.test(APP_JS),
    'holdStart 里 mode 为空时必须调用 openAsrHelp()，不能只 toast 一句就返回');
  assert.ok(/!ASR\.mode\(state\.settings\)\)\s*\{\s*openAsrHelp\(\)/.test(APP_JS),
    '切换语音模式时也要给指引');
});

test('按钮在未开通时是「开启语音」而不是灰掉的「按住 说话」', () => {
  assert.ok(/need-setup/.test(APP_JS), '缺少 need-setup 状态类');
  assert.ok(/'开启语音'/.test(APP_JS), '未开通时按钮文案应为「开启语音」');
});

test('状态行不再对未开通的用户承诺「随口说一句」', () => {
  assert.ok(/function\s+defaultStatus\s*\(/.test(APP_JS), '状态行默认文案应随语音可用性变化');
  assert.ok(/语音还没开通/.test(APP_JS), '未开通时应有明确提示文案');
});

test('引导弹层存在，且两条路都有', () => {
  var m = HTML.match(/<dialog[^>]*id="asrHelpDlg"[\s\S]*?<\/dialog>/);
  assert.ok(m, '缺少 asrHelpDlg 弹层');
  var block = m[0];
  assert.ok(/麦克风/.test(block), '要写明「用键盘自带麦克风」这条零配置路径');
  assert.ok(/腾讯云/.test(block), '也要写明填腾讯云密钥这条路径');
  assert.ok(/asrGoSettingsBtn/.test(block), '要有跳去设置填密钥的按钮');
  assert.ok(/asrLaterBtn/.test(block), '要有「先打字」的出口');
});

test('零配置路径必须排在需要开云账号的路径前面', () => {
  var m = HTML.match(/<dialog[^>]*id="asrHelpDlg"[\s\S]*?<\/dialog>/);
  var block = m[0];
  var kbIdx = block.indexOf('键盘');
  var txIdx = block.indexOf('腾讯云');
  assert.ok(kbIdx !== -1 && txIdx !== -1, '两条路都得写');
  assert.ok(kbIdx < txIdx,
    '「用键盘自带麦克风」不需要任何配置、当场能用，应排在前面；' +
    '不该让用户为了试一下功能先去注册云账号');
});

test('设置里不再宣称「不填则用手机自带识别」（安卓上是假的）', () => {
  assert.ok(!/不填则用手机自带识别/.test(HTML),
    '安卓浏览器没有自带识别、国内也连不上谷歌服务，这句是误导');
});
