/*
 * 记哪儿 —— 提示词与 AI 返回解析（纯逻辑，浏览器和 Node 测试共用）
 */
(function (global) {
  'use strict';

  var SYSTEM = [
    '你是「记哪儿」，帮用户记住生活琐事的助手。用户消息里包含两部分：',
    '①【用户刚刚说】：用户随口说的一句话，可能是一段话里含好几件事；',
    '②【现有记录】：已经存下的记录（JSON 数组）。',
    '',
    '你要判断用户意图并给出结构化结果：',
    '- intent="record"：在陈述新事情（东西放哪儿了、待办、想法）；',
    '- intent="question"：在提问（我的 XX 呢 / 我刚说过什么）。',
    '',
    '记录去重规则（最重要）：',
    '- 说的话与某条现有记录语义相同（同一东西、同一位置，措辞不同也算相同）→ 对那条记录输出 {"action":"ignore","recordId":"该记录id","reason":"同一件事又说了一遍"}，绝不新建；',
    '- 同一东西但位置变了 → 输出 {"action":"update","recordId":"该记录id","place":"新位置"}，绝不新建；',
    '- 确实是新事情 → 输出 create；',
    '- 不是"东西放在哪"的琐事（待办、日程、想法）→ 输出 {"action":"create","kind":"ordinary","text":"原话"}；',
    '- 一段话里有几件事 → 拆成多条 action，按顺序放进 actions 数组。',
    '',
    '回答规则（intent="question" 时）：',
    '- 只能依据【现有记录】回答，绝不编造；answer.text 简短口语化，answer.recordIds 填支持答案的记录 id；',
    '- 现有记录里找不到答案 → answer.text 说明不记得，recordIds 给空数组。',
    '',
    '输出要求（严格遵守）：只输出一个 json 对象（JSON 格式），不要任何解释、不要 markdown 代码块。格式：',
    '{"intent":"record或question","actions":[动作...],"answer":{"text":"...","recordIds":["..."]},"reply":"给用户看的中文确认，15字以内"}',
    'create 动作两种格式：',
    '{"action":"create","kind":"place","item":"大门钥匙","place":"消防阀门里","text":"用户原话"}',
    '{"action":"create","kind":"ordinary","text":"用户原话"}',
    'intent="question" 时 actions 为空数组、answer 必填；intent="record" 时 answer 为 null。'
  ].join('\n');

  /* 把现有记录压缩成给 AI 看的紧凑形式（只给有效记录，限制条数） */
  function compactRecords(records, limit) {
    var cap = limit || 300;
    return (records || [])
      .filter(function (r) { return r.status !== 'ignored'; })
      .slice(0, cap)
      .map(function (r) {
        return r.kind === 'place'
          ? { id: r.id, kind: 'place', item: r.item, place: r.place, saidAt: r.saidAt }
          : { id: r.id, kind: 'ordinary', text: r.text, saidAt: r.saidAt };
      });
  }

  function buildParsePrompt(utterance, records) {
    return [
      '【用户刚刚说】',
      String(utterance || '').trim(),
      '',
      '【现有记录】',
      JSON.stringify(compactRecords(records)),
      '',
      '请按系统要求只输出 JSON。'
    ].join('\n');
  }

  /* 从 AI 回复里抠出 JSON 对象；失败抛 Error（中文说明） */
  function extractJson(text) {
    if (typeof text !== 'string' || !text.trim()) throw new Error('AI 没有返回内容');
    var t = text.trim();
    var fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence && fence[1].trim()) t = fence[1].trim();
    var start = t.indexOf('{');
    if (start === -1) throw new Error('AI 返回里找不到 JSON');
    // 有左括号但没右括号（模型话说到一半断了）：仍当"解析失败"报，别误报成"找不到 JSON"
    var end = t.lastIndexOf('}');
    var slice = end > start ? t.slice(start, end + 1) : t.slice(start);
    var obj;
    try {
      obj = JSON.parse(slice);
    } catch (e) {
      throw new Error('AI 返回的 JSON 解析失败');
    }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
      throw new Error('AI 返回的不是 JSON 对象');
    }
    return obj;
  }

  /* 把 AI 的 JSON 修整成可信形状，缺的补默认值 */
  function normalize(obj) {
    var intent = obj && obj.intent === 'question' ? 'question' : 'record';
    var actions = (obj && Array.isArray(obj.actions) ? obj.actions : [])
      .filter(function (a) { return a && typeof a === 'object'; });
    var answer = null;
    if (intent === 'question' && obj && obj.answer && typeof obj.answer === 'object') {
      answer = {
        text: String(obj.answer.text == null ? '' : obj.answer.text),
        recordIds: Array.isArray(obj.answer.recordIds)
          ? obj.answer.recordIds.map(String)
          : []
      };
    }
    var reply = obj && typeof obj.reply === 'string' ? obj.reply : '';
    return { intent: intent, actions: actions, answer: answer, reply: reply };
  }

  var Prompt = { SYSTEM: SYSTEM, compactRecords: compactRecords, buildParsePrompt: buildParsePrompt, extractJson: extractJson, normalize: normalize };
  if (typeof module !== 'undefined' && module.exports) module.exports = Prompt;
  else global.Prompt = Prompt;
})(typeof window !== 'undefined' ? window : globalThis);
