/*
 * 记哪儿 —— IndexedDB 存储（记录）
 * 数据只存在本机浏览器里；导出备份见 backup.js。
 */
(function (global) {
  'use strict';

  var DB_NAME = 'jinr';
  var DB_VERSION = 1;
  var STORE = 'records';

  var dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          var os = db.createObjectStore(STORE, { keyPath: 'id' });
          os.createIndex('status', 'status', { unique: false });
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error('打不开本地数据库')); };
    });
    return dbPromise;
  }

  function tx(db, mode, fn) {
    return new Promise(function (resolve, reject) {
      var t = db.transaction(STORE, mode);
      var os = t.objectStore(STORE);
      var out;
      try { out = fn(os); } catch (e) { reject(e); return; }
      t.oncomplete = function () { resolve(out && out.result !== undefined ? out.result : out); };
      t.onerror = function () { reject(t.error || new Error('本地数据库操作失败')); };
      t.onabort = function () { reject(t.error || new Error('本地数据库操作被中断')); };
    });
  }

  function reqVal(request) { return request; }

  var Store = {
    getAll: function () {
      return open().then(function (db) {
        return tx(db, 'readonly', function (os) { return reqVal(os.getAll()); });
      }).then(function (v) { return v.result || []; });
    },
    put: function (rec) {
      return open().then(function (db) {
        return tx(db, 'readwrite', function (os) { os.put(rec); });
      });
    },
    putMany: function (recs) {
      return open().then(function (db) {
        return tx(db, 'readwrite', function (os) {
          (recs || []).forEach(function (r) { os.put(r); });
        });
      });
    },
    delete: function (id) {
      return open().then(function (db) {
        return tx(db, 'readwrite', function (os) { os.delete(id); });
      });
    },
    clear: function () {
      return open().then(function (db) {
        return tx(db, 'readwrite', function (os) { os.clear(); });
      });
    }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Store;
  else global.Store = Store;
})(typeof window !== 'undefined' ? window : globalThis);
