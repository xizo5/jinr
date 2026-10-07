/*
 * 记哪儿 —— 语音转文字
 * 路线 A：安卓原生识别（Capacitor 壳里才有）—— 用手机自带引擎，国内可用，无需密钥
 * 路线 B：腾讯云「实时语音识别」WebSocket（填了三件套密钥时用，中文最准）
 * 路线 C：浏览器自带识别（国内安卓连不上谷歌，基本作废，仅作兜底）
 * 都不行：打字。
 *
 * 优先级 A > B > C：A 免费且最快，B 最准但要点配置，C 在国内基本不能用。
 */
(function (global) {
  'use strict';

  /* ── 腾讯云实时语音识别 ─────────────────────────── */

  function uuid() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'v-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
  }

  /* HMAC-SHA1 → base64（WebCrypto 原生，不用引库） */
  function hmacSha1Base64(keyStr, msgStr) {
    var enc = new TextEncoder();
    return crypto.subtle.importKey('raw', enc.encode(keyStr), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign'])
      .then(function (key) { return crypto.subtle.sign('HMAC', key, enc.encode(msgStr)); })
      .then(function (sig) {
        var bytes = new Uint8Array(sig);
        var bin = '';
        for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
        return btoa(bin);
      });
  }

  /* 按腾讯云规则拼签名 URL：参数按 key 字典序排序后整串签名 */
  function buildTencentUrl(settings, nowSec) {
    var params = {
      appid: settings.tencentAppId,
      engine_model_type: '16k_zh',
      expired: nowSec + 3600,
      filter_dirty: 1,
      filter_modal: 2,
      filter_punc: 1,
      convert_num_mode: 1,
      needvad: 1,
      secretid: settings.tencentSecretId,
      timestamp: nowSec,
      voice_format: 1,
      voice_id: uuid()
    };
    var keys = Object.keys(params).sort();
    var qs = keys.map(function (k) { return k + '=' + params[k]; }).join('&');
    return hmacSha1Base64(settings.tencentSecretKey, qs).then(function (sig) {
      return 'wss://asr.cloud.tencent.com/asr/v2/' + settings.tencentAppId + '?' + qs + '&signature=' + encodeURIComponent(sig);
    });
  }

  /* pcm: Int16Array（16k 单声道）→ 识别文本 */
  function tencentRecognize(pcm, settings) {
    if (!global.Settings.asrConfigured(settings)) {
      return Promise.reject(new Error('还没填腾讯云语音识别的密钥'));
    }
    if (!pcm || !pcm.length) return Promise.reject(new Error('没有录到声音'));
    var nowSec = Math.floor(Date.now() / 1000);
    return buildTencentUrl(settings, nowSec).then(function (url) {
      return new Promise(function (resolve, reject) {
        var ws;
        var latest = '';
        var done = false;
        var timer = setTimeout(function () { finish(); }, 15000);

        function finish(err) {
          if (done) return;
          done = true;
          clearTimeout(timer);
          try { if (ws && ws.readyState <= 1) ws.close(); } catch (e) { /* ignore */ }
          if (err) reject(err);
          else if (latest) resolve(latest);
          else reject(new Error('没听清你说的话，请重说一遍'));
        }

        try { ws = new WebSocket(url); } catch (e) { finish(new Error('连不上语音识别服务（需要 https 或 localhost）')); return; }

        ws.onopen = function () {
          var CHUNK = 3200; // 0.2 秒
          var i = 0;
          var sendTimer = setInterval(function () {
            if (ws.readyState !== 1) { clearInterval(sendTimer); return; }
            var end = Math.min(i + CHUNK, pcm.length);
            // 注意：subarray 是视图，.buffer 会带出整块内存；必须按字节范围切片
            ws.send(pcm.buffer.slice(i * 2, end * 2));
            i = end;
            if (i >= pcm.length) {
              clearInterval(sendTimer);
              setTimeout(function () { try { ws.close(); } catch (e) { /* ignore */ } }, 300);
            }
          }, 40);
        };

        ws.onmessage = function (ev) {
          var msg;
          try { msg = JSON.parse(ev.data); } catch (e) { return; }
          if (msg.code !== 0) {
            finish(new Error('语音识别出错：' + (msg.message || ('code ' + msg.code))));
            return;
          }
          if (msg.result && msg.result.voice_text_str) latest = msg.result.voice_text_str;
          if (msg.final === 1) finish();
        };

        ws.onerror = function () { finish(new Error('语音识别连接失败，请检查密钥和网络')); };
        ws.onclose = function () { finish(); };
      });
    });
  }

  /* ── 浏览器自带识别 ─────────────────────────────── */

  function webSpeechSupported() {
    return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  }

  /* 开始听；返回 { promise, stop }，说完自动出结果，也可以提前 stop
   *
   * ⚠️ 这里有一条曾经把界面永久卡死的路径：用户先松手（stopped = true），
   * 而识别引擎结束时没吐出任何文字 —— 原来的 onend 两个分支都不走，
   * promise 既不 resolve 也不 reject，上层 cleanupMic() 永远不执行，
   * 状态栏就一直是"在听…"、定时器一直涨。
   * 所以现在统一走 settle()：任何路径都必须给出结果，只给一次。 */
  function webSpeechStart() {
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      return { promise: Promise.reject(new Error('这个浏览器不支持自带语音识别')), stop: function () {} };
    }
    var rec = new SR();
    rec.lang = 'zh-CN';
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    var settled = false;
    var settle = function () {}; // 下面 Promise 里赋真身

    var promise = new Promise(function (resolve, reject) {
      var finalText = '';
      var interimText = '';
      settle = function (err, text) {
        if (settled) return;
        settled = true;
        if (err) reject(err);
        else resolve(text);
      };

      rec.onresult = function (ev) {
        for (var i = ev.resultIndex; i < ev.results.length; i++) {
          var t = ev.results[i][0].transcript;
          if (ev.results[i].isFinal) finalText += t;
          else interimText = t; // 临时结果会被反复修正，取最后一份
        }
      };

      rec.onerror = function (ev) {
        var code = ev.error;
        // fatal = 环境/权限层面的问题，光重说没用，要弹排查指引
        var fatal = code === 'not-allowed' || code === 'service-not-allowed' ||
          code === 'audio-capture';
        var texts = {
          'not-allowed': '麦克风权限被拒了',
          'service-not-allowed': '这个浏览器不给用自带语音识别',
          'audio-capture': '麦克风打不开',
          'no-speech': '没听到你说话',
          'aborted': '识别被中断了，再试一次',
          'network': '自带识别要走谷歌服务，国内常常连不上——去设置里填腾讯云密钥更稳'
        };
        var err = new Error(texts[code] || ('识别出错：' + code));
        err.name = code || 'Error';
        err.fatal = fatal;
        err.raw = { name: code }; // 交给上层的诊断函数读
        settle(err);
      };

      rec.onend = function () {
        var text = (finalText + interimText).trim();
        if (text) settle(null, text);
        else settle(silentError()); // 没结果也要了结，绝不留悬挂的 Promise
      };

      // 关键：真正启动识别引擎。之前漏了这一行，
      // 导致引擎从未启动、任何事件都不会来，录音状态就永远挂着。
      try {
        rec.start();
      } catch (e) {
        settle(new Error('语音识别启动失败，请再试一次'));
      }
    });

    return {
      promise: promise,
      stop: function () {
        try { rec.stop(); } catch (e) { /* ignore */ }
        // 兜底：个别浏览器 stop() 之后不派发 onend，别让界面一直挂着
        setTimeout(function () { settle(silentError()); }, 1200);
      }
    };
  }

  /* 没识别出内容但也不算故障（松手太快、没出声、环境太吵）：安静收尾，不弹错误 */
  function silentError() {
    var e = new Error('没听到声音，再按住说一次');
    e.name = 'NoSpeech';
    e.silent = true;
    return e;
  }

  /* ── 路线 C：安卓原生识别（Capacitor 壳里才有）───────────
   *
   * 为什么这条最重要：Web Speech API 把音频送到谷歌服务器识别，国内连不上；
   * 而安卓系统的 SpeechRecognizer 用的是**手机厂商自带的引擎**，国内可用。
   * 所以打包成 App 之后，这条路才是真正能让语音跑起来的那条。
   *
   * 实现上不加载插件的前端 JS（本项目没有打包器），而是直接调原生桥：
   *   Capacitor.nativePromise(插件名, 方法名, 参数) → Promise
   *   插件名固定为 'SpeechRecognition'（见 Android 端 @CapacitorPlugin(name=...)）
   * start({partialResults:false}) 会 resolve {status, matches:[...]}；
   * 出错则 reject 一个字符串（如 "No match" / "Network error"）。
   */

  /* 拿到原生桥。不是原生环境（普通浏览器）时返回 null。*/
  function nativeBridge() {
    var cap = global.Capacitor;
    if (!cap || typeof cap.nativePromise !== 'function') return null;
    // isNativePlatform 存在时要确认为 true，避免桌面上误判
    if (typeof cap.isNativePlatform === 'function' && !cap.isNativePlatform()) return null;
    return cap;
  }

  /* 探测结果缓存：null=还没探过，true/false=已探明 */
  var nativeState = null;

  /* 真去问一次原生侧「这台设备有没有可用的识别服务」。
   * 不靠猜 —— 有些安卓机没装任何识别引擎，调用了才知道。*/
  function probeNative() {
    var cap = nativeBridge();
    if (!cap) { nativeState = false; return Promise.resolve(false); }
    return cap.nativePromise('SpeechRecognition', 'available', {})
      .then(function (r) { nativeState = !!(r && r.available); return nativeState; })
      .catch(function () { nativeState = false; return false; });
  }

  function nativeReady() { return nativeState === true; }

  /* 原生识别的启动。返回 {promise, stop}，与 webSpeechStart 同形态，
   * 上层（app.js 的 holdStartGo/holdEnd）可以走同一套收尾逻辑。*/
  function nativeStart() {
    var cap = nativeBridge();
    var settle = {};
    var promise = new Promise(function (resolve, reject) {
      settle.resolve = resolve;
      settle.reject = reject;
    });

    if (!cap) {
      var e0 = new Error('不在原生环境里');
      e0.fatal = true;
      settle.reject(e0);
      return { promise: promise, stop: function () {} };
    }

    var finished = false;
    function fail(msg) {
      if (finished) return;
      finished = true;
      var err = new Error(msg);
      err.name = msg;
      err.raw = { name: msg };
      /* 区分「真故障」和「没说话/没听懂」：
         后者不该弹排查弹层，温和提示一句就够了。*/
      err.silent = /no match|no speech input|didn't understand|no speech/i.test(msg);
      err.fatal = !err.silent;
      settle.reject(err);
    }

    // 先要权限，再开始听。顺序不能反 —— 没权限时 start 会直接 reject。
    cap.nativePromise('SpeechRecognition', 'requestPermissions', {})
      .then(function (r) {
        var st = r && (r.speechRecognition || r.recordAudio);
        if (st && st !== 'granted') {
          fail('麦克风权限没给。请在系统设置里允许「记哪儿」使用麦克风。');
          return null;
        }
        return cap.nativePromise('SpeechRecognition', 'start', {
          language: 'zh-CN',   // 中文优先；引擎不支持时会回退到系统默认
          maxResults: 1,
          partialResults: false, // false 才会在结束时 resolve 出结果
          popup: false          // 别弹系统那个识别面板，我们自己的界面更清楚
        });
      })
      .then(function (r) {
        if (r === null || finished) return; // 已经 fail 过了
        finished = true;
        var m = r && r.matches;
        settle.resolve((m && m.length) ? String(m[0] || '').trim() : '');
      })
      .catch(function (e) {
        fail(typeof e === 'string' ? e : ((e && (e.message || e.errorMessage)) || '识别失败'));
      });

    return {
      promise: promise,
      stop: function () {
        try { cap.nativePromise('SpeechRecognition', 'stop', {}).catch(function () {}); }
        catch (e) { /* 忽略：已经在收尾了 */ }
      }
    };
  }

  /* 当前能用哪条路：'native' | 'tencent' | 'webspeech' | null（只能打字） */
  function mode(settings) {
    // 原生识别优先：用手机自带引擎、不需要密钥、响应最快
    if (nativeReady()) return 'native';
    if (global.Settings.asrConfigured(settings)) return 'tencent';
    if (webSpeechSupported()) return 'webspeech';
    return null;
  }

  var ASR = {
    mode: mode,
    tencentRecognize: tencentRecognize,
    webSpeechStart: webSpeechStart,
    webSpeechSupported: webSpeechSupported,
    nativeStart: nativeStart,
    nativeBridge: nativeBridge,
    probeNative: probeNative,
    nativeReady: nativeReady
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = ASR;
  else global.ASR = ASR;
})(typeof window !== 'undefined' ? window : globalThis);
