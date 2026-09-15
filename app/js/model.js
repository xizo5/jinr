/*
 * 记哪儿 —— 数据模型（纯逻辑，浏览器和 Node 测试共用）
 *
 * 记录（record）结构：
 *   place 类：{ id, kind:'place', item, place, text, saidAt, placedAt, updatedAt,
 *               status:'active'|'ignored', ignoredReason, history:[{place,from,to}] }
 *   ordinary 类：{ id, kind:'ordinary', item:null, place:null, text, saidAt,
 *               placedAt:null, updatedAt, status, ignoredReason, history:[] }
 */
(function (global) {
  'use strict';

  function newId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'r-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  function trim(v) { return String(v == null ? '' : v).trim(); }

  function createRecordFromAction(action, now) {
    var kind = action.kind === 'ordinary' ? 'ordinary' : 'place';
    var base = {
      id: newId(),
      kind: kind,
      item: null,
      place: null,
      text: trim(action.text),
      saidAt: now,
      placedAt: null,
      updatedAt: now,
      status: 'active',
      ignoredReason: null,
      history: []
    };
    if (kind === 'place') {
      base.item = trim(action.item);
      base.place = trim(action.place);
      if (!base.text) base.text = base.item + '放在' + base.place;
    }
    return base;
  }

  /* 校验 create 动作，返回错误信息或 null */
  function validateCreate(action) {
    var kind = action.kind === 'ordinary' ? 'ordinary' : 'place';
    if (kind === 'place') {
      if (!trim(action.item)) return '没听清是什么东西';
      if (!trim(action.place)) return '没听清放在哪儿';
    } else {
      if (!trim(action.text)) return '内容是空的';
    }
    return null;
  }

  /*
   * 把一条 AI 决定应用到记录列表上。
   * 返回 { ok:boolean, records:数组(新数组), applied:boolean, error?:string, changedId?:string }
   * 不修改传入的数组。
   */
  function applyDecision(records, action, now) {
    var list = (records || []).slice();
    if (!action || typeof action !== 'object') {
      return { ok: false, records: list, applied: false, error: '空的决定' };
    }
    var type = action.action;

    if (type === 'create') {
      var err = validateCreate(action);
      if (err) return { ok: false, records: list, applied: false, error: err };
      var rec = createRecordFromAction(action, now);
      list.unshift(rec);
      return { ok: true, records: list, applied: true, changedId: rec.id };
    }

    if (type === 'ignore') {
      var idx = list.findIndex(function (r) { return r.id === action.recordId; });
      if (idx === -1) return { ok: false, records: list, applied: false, error: '找不到要忽略的记录' };
      if (list[idx].status === 'ignored') {
        return { ok: true, records: list, applied: false, reason: '已经是被忽略状态' };
      }
      list[idx] = Object.assign({}, list[idx], {
        status: 'ignored',
        ignoredReason: trim(action.reason) || '同一件事又说了一遍',
        updatedAt: now
      });
      return { ok: true, records: list, applied: true, changedId: list[idx].id };
    }

    if (type === 'update') {
      var i = list.findIndex(function (r) { return r.id === action.recordId; });
      if (i === -1) return { ok: false, records: list, applied: false, error: '找不到要更新的记录' };
      var old = list[i];
      if (old.kind !== 'place') {
        return { ok: false, records: list, applied: false, error: '普通记录没有位置可更新' };
      }
      var newPlace = trim(action.place);
      if (!newPlace) return { ok: false, records: list, applied: false, error: '新位置是空的' };
      if (newPlace === old.place) {
        return { ok: true, records: list, applied: false, reason: '位置没变' };
      }
      var history = (old.history || []).concat([{
        place: old.place, from: old.placedAt || old.saidAt, to: now
      }]);
      list[i] = Object.assign({}, old, {
        place: newPlace,
        placedAt: now,
        updatedAt: now,
        status: 'active',
        ignoredReason: null
      }, { history: history });
      return { ok: true, records: list, applied: true, changedId: list[i].id };
    }

    return { ok: false, records: list, applied: false, error: '未知的动作类型：' + type };
  }

  /* 批量应用（按顺序），返回 { records, results:[...] }；某个失败不影响后面的 */
  function applyDecisions(records, actions, now) {
    var cur = (records || []).slice();
    var results = [];
    (actions || []).forEach(function (a) {
      var r = applyDecision(cur, a, now);
      if (r.ok) cur = r.records;
      results.push(r);
    });
    return { records: cur, results: results };
  }

  /* 手动管理（编辑弹窗用），同样返回新数组 */
  function updateFields(records, id, fields, now) {
    var list = (records || []).slice();
    var i = list.findIndex(function (r) { return r.id === id; });
    if (i === -1) return { ok: false, records: list, error: '找不到这条记录' };
    var rec = list[i];
    var next = Object.assign({}, rec, { updatedAt: now });
    if (rec.kind === 'place') {
      var item = fields.item !== undefined ? trim(fields.item) : rec.item;
      var place = fields.place !== undefined ? trim(fields.place) : rec.place;
      if (!item || !place) return { ok: false, records: list, error: '东西和位置都不能为空' };
      if (place !== rec.place) {
        next.history = (rec.history || []).concat([{
          place: rec.place, from: rec.placedAt || rec.saidAt, to: now
        }]);
        next.placedAt = now;
      }
      next.item = item;
      next.place = place;
    }
    if (fields.text !== undefined && trim(fields.text)) next.text = trim(fields.text);
    list[i] = next;
    return { ok: true, records: list };
  }

  function setStatus(records, id, status, now, reason) {
    var list = (records || []).slice();
    var i = list.findIndex(function (r) { return r.id === id; });
    if (i === -1) return { ok: false, records: list, error: '找不到这条记录' };
    list[i] = Object.assign({}, list[i], {
      status: status,
      ignoredReason: status === 'ignored' ? (reason || '手动忽略') : null,
      updatedAt: now
    });
    return { ok: true, records: list };
  }

  function removeRecord(records, id) {
    return { ok: true, records: (records || []).filter(function (r) { return r.id !== id; }) };
  }

  function counts(records) {
    var active = 0, ignored = 0;
    (records || []).forEach(function (r) {
      if (r.status === 'ignored') ignored++; else active++;
    });
    return { active: active, ignored: ignored };
  }

  var Model = {
    newId: newId,
    validateCreate: validateCreate,
    applyDecision: applyDecision,
    applyDecisions: applyDecisions,
    updateFields: updateFields,
    setStatus: setStatus,
    removeRecord: removeRecord,
    counts: counts
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Model;
  else global.Model = Model;
})(typeof window !== 'undefined' ? window : globalThis);
