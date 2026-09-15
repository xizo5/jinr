/*
 * 记哪儿 —— 备份导出 / 导入
 * 导出函数是纯的（Node 可测），浏览器部分单独封装。
 */
(function (global) {
  'use strict';

  var APP_TAG = '记哪儿';
  var VERSION = 1;

  /* 纯：生成备份对象 */
  function exportPayload(records, exportedAt) {
    return {
      app: APP_TAG,
      version: VERSION,
      exportedAt: exportedAt,
      records: (records || []).slice()
    };
  }

  /* 纯：校验导入内容，返回记录数组；不合法就抛错 */
  function validateImport(obj) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
      throw new Error('备份文件格式不对');
    }
    if (obj.app !== APP_TAG) throw new Error('这不是「记哪儿」的备份文件');
    if (!Array.isArray(obj.records)) throw new Error('备份里没有记录列表');
    var seen = {};
    var out = obj.records.map(function (r, i) {
      if (!r || typeof r !== 'object') throw new Error('第 ' + (i + 1) + ' 条记录格式不对');
      if (!r.id || typeof r.id !== 'string') throw new Error('第 ' + (i + 1) + ' 条记录缺少 id');
      if (seen[r.id]) throw new Error('备份里有重复 id：' + r.id);
      seen[r.id] = true;
      if (r.kind !== 'place' && r.kind !== 'ordinary') {
        throw new Error('第 ' + (i + 1) + ' 条记录类型不对');
      }
      if (r.status !== 'active' && r.status !== 'ignored') {
        throw new Error('第 ' + (i + 1) + ' 条记录状态不对');
      }
      return r;
    });
    return out;
  }

  /* 浏览器：下载 JSON 文件 */
  function download(payload) {
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    var d = new Date(payload.exportedAt || Date.now());
    var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    a.href = url;
    a.download = '记哪儿备份-' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }

  /* 浏览器：读文件为对象 */
  function readFile(file) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () {
        try { resolve(JSON.parse(String(fr.result))); }
        catch (e) { reject(new Error('文件不是合法的 JSON')); }
      };
      fr.onerror = function () { reject(new Error('文件读不出来')); };
      fr.readAsText(file);
    });
  }

  var Backup = { exportPayload: exportPayload, validateImport: validateImport, download: download, readFile: readFile };
  if (typeof module !== 'undefined' && module.exports) module.exports = Backup;
  else global.Backup = Backup;
})(typeof window !== 'undefined' ? window : globalThis);
