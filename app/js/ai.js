/*
 * 记哪儿 —— DeepSeek 客户端
 * 一次调用同时完成：意图判断 + 解析去重 + 回答。
 * 若被浏览器跨域拦截：在设置里填「API 中转地址」（见 README 的 worker 部署说明）。
 */
(function (global) {
  'use strict';

  var DIRECT_BASE = 'https://api.deepseek.com';

  function endpoint(settings) {
    var base = (settings && settings.baseUrl ? settings.baseUrl : DIRECT_BASE).trim();
    return base.replace(/\/+$/, '') + '/chat/completions';
  }

  function friendlyHttpError(status, serverMsg) {
    if (status === 401) return new Error('DeepSeek 的 Key 不对（设置里检查一下）');
    if (status === 402) return new Error('DeepSeek 账户余额不足，去 platform.deepseek.com 充值');
    if (status === 429) return new Error('请求太频繁了，等几秒再试');
    return new Error('AI 服务出错（' + status + '）：' + (serverMsg || ''));
  }

  /* messages: [{role, content}] → assistant 文本；opts.plain = 不强制 JSON 模式 */
  function chat(messages, settings, opts) {
    if (!settings || !settings.deepseekKey) {
      return Promise.reject(new Error('还没填 DeepSeek 的 API Key，去设置里填'));
    }
    var body = {
      model: (settings.model || 'deepseek-flash').trim(),
      messages: messages,
      temperature: 0.2,
      stream: false
    };
    if (!(opts && opts.plain)) body.response_format = { type: 'json_object' };
    return fetch(endpoint(settings), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + settings.deepseekKey.trim()
      },
      body: JSON.stringify(body)
    }).then(function (res) {
      if (!res.ok) {
        return res.json().catch(function () { return {}; }).then(function (j) {
          throw friendlyHttpError(res.status, j && j.error && j.error.message);
        });
      }
      return res.json();
    }).then(function (j) {
      var choice = j && j.choices && j.choices[0];
      var text = choice && choice.message && choice.message.content;
      if (typeof text !== 'string') throw new Error('AI 返回格式不对');
      return text;
    }, function (e) {
      if (e instanceof TypeError) {
        throw new Error('连不上 AI（可能是网络或跨域限制）。试试在设置里填「API 中转地址」，见 README');
      }
      throw e;
    });
  }

  /* 主入口：一句话 + 现有记录 → { intent, actions, answer, reply } */
  function parse(utterance, records, settings) {
    var messages = [
      { role: 'system', content: global.Prompt.SYSTEM },
      { role: 'user', content: global.Prompt.buildParsePrompt(utterance, records) }
    ];
    return chat(messages, settings).then(function (text) {
      try {
        return global.Prompt.normalize(global.Prompt.extractJson(text));
      } catch (e) {
        // 一次性重试：明确要求只输出 JSON
        messages.push({ role: 'assistant', content: text });
        messages.push({ role: 'user', content: '你上一次的输出不是合法 JSON。请重新回答，只输出一个 JSON 对象，不要任何其他文字。' });
        return chat(messages, settings).then(function (text2) {
          return global.Prompt.normalize(global.Prompt.extractJson(text2));
        });
      }
    });
  }

  /* 记忆页的成段总结：纯文本输出，不走 JSON 模式 */
  function summarize(records, settings) {
    var compact = global.Prompt.compactRecords(records, 300);
    var sys = [
      '你是「记哪儿」的小助理。用户消息里的 JSON 是主人记下的全部有效记录（位置类：item=东西，place=放在哪；ordinary：text=原话）。',
      '请用中文写 2~4 句轻松自然的总结：先说重要的东西现在都在哪，再点一下最近搬动过的，最后如有待办类的话提一句。',
      '只依据记录，绝不编造；不要客套开场白，不要 markdown，直接输出正文。'
    ].join('\n');
    return chat([
      { role: 'system', content: sys },
      { role: 'user', content: JSON.stringify(compact) }
    ], settings, { plain: true });
  }

  var AI = { DIRECT_BASE: DIRECT_BASE, endpoint: endpoint, chat: chat, parse: parse, summarize: summarize };
  if (typeof module !== 'undefined' && module.exports) module.exports = AI;
  else global.AI = AI;
})(typeof window !== 'undefined' ? window : globalThis);
