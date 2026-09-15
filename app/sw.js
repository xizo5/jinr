/*
 * 记哪儿 —— Service Worker：缓存应用外壳，装过之后断网也能打开。
 * 注意：密钥和数据都不在这里，数据在设备本地数据库里。
 *
 * 缓存策略（改过：原来是 cache-first，导致手机上永远跑旧版本，怎么刷新都没用）：
 *  - 页面导航：网络优先 → 拿不到才用缓存。改完部署，手机一开就是新的。
 *  - 静态资源：先给缓存（秒开），同时后台悄悄更新，下次打开即最新。
 * 每次改完代码，记得把 CACHE 的版本号 +1。
 */
var CACHE = 'jinr-v20';

var ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/model.js',
  './js/prompt.js',
  './js/audio-utils.js',
  './js/settings.js',
  './js/theme.js',
  './js/store.js',
  './js/recorder.js',
  './js/asr.js',
  './js/ai.js',
  './js/backup.js',
  './js/app.js',
  './manifest.webmanifest',
  './icons/icon-512.png'
];

function put(req, res) {
  if (!res || !res.ok) return;
  var copy = res.clone();
  caches.open(CACHE).then(function (c) { c.put(req, copy); }).catch(function () {});
}

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE)
      .then(function (c) { return c.addAll(ASSETS); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        return k === CACHE ? null : caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); }).then(function () {
      /*
       * 一次性过渡动作：之前 v13 是 cache-first，装过的手机一直吃旧缓存，
       * 光靠新版页面里的 controllerchange 监听救不回来（旧页面没那段代码）。
       * 所以在接管时把已打开的窗口直接重新导航一次，强制它们换到新版本。
       * 过渡完（确认所有设备都更新到 v14 之后）可以删掉这一段。
       */
      return self.clients.matchAll({ type: 'window' }).then(function (list) {
        list.forEach(function (c) {
          try { c.navigate(c.url); } catch (err) { /* 个别浏览器不支持，忽略 */ }
        });
      });
    })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== location.origin) return; // AI/语音请求一律走网络

  // 页面本身：网络优先，断网才吃缓存
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then(function (res) {
        put(req, res);
        return res;
      }).catch(function () {
        return caches.match(req).then(function (hit) {
          return hit || caches.match('./index.html');
        });
      })
    );
    return;
  }

  // 其它静态资源：缓存优先 + 后台更新（stale-while-revalidate）
  e.respondWith(
    caches.match(req).then(function (hit) {
      var fetching = fetch(req).then(function (res) {
        put(req, res);
        return res;
      }).catch(function () { return hit; });
      return hit || fetching;
    })
  );
});
