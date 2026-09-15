/*
 * 记哪儿 —— 设置（存 localStorage，只在本机）
 */
(function (global) {
  'use strict';

  var KEY = 'jinr.settings.v1';

  var DEFAULTS = {
    deepseekKey: '',
    model: 'deepseek-chat',
    baseUrl: '',              // 中转地址，留空直连 https://api.deepseek.com
    tencentAppId: '',
    tencentSecretId: '',
    tencentSecretKey: ''
  };

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return Object.assign({}, DEFAULTS);
      return Object.assign({}, DEFAULTS, JSON.parse(raw));
    } catch (e) {
      return Object.assign({}, DEFAULTS);
    }
  }

  function save(patch) {
    var next = Object.assign({}, load(), patch || {});
    localStorage.setItem(KEY, JSON.stringify(next));
    return next;
  }

  function clear() { localStorage.removeItem(KEY); }

  /* 是否填了大模型的 key（语音识别可以没有，走打字或手机自带识别） */
  function aiConfigured(s) {
    s = s || load();
    return !!(s.deepseekKey && s.deepseekKey.trim());
  }

  /* 是否填了腾讯云 ASR 三件套 */
  function asrConfigured(s) {
    s = s || load();
    return !!(s.tencentAppId && s.tencentSecretId && s.tencentSecretKey);
  }

  var Settings = { load: load, save: save, clear: clear, aiConfigured: aiConfigured, asrConfigured: asrConfigured };
  if (typeof module !== 'undefined' && module.exports) module.exports = Settings;
  else global.Settings = Settings;
})(typeof window !== 'undefined' ? window : globalThis);
