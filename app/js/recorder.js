/*
 * 记哪儿 —— 录音（MediaRecorder → 解码 → 16k 16bit 单声道 PCM）
 * 只支持 https 或 localhost（浏览器限制，见 README）。
 *
 * 手机端的坑（都在这文件里处理掉）：
 *  - iOS Safari 不支持 audio/webm，只给 audio/mp4（AAC），所以要挑格式；
 *  - Safari 老版本 decodeAudioData 只有回调式，没有 Promise 式；
 *  - 按住时间太短时 chunks 可能是空的，要给出人话提示而不是"解码失败"；
 *  - 原始错误的 e.name 必须带上去，否则上层只能干瞪眼。
 */
(function (global) {
  'use strict';

  var stream = null;
  var recorder = null;
  var chunks = [];

  /* 实时音量分析（让界面上的“小助理”听到你说话） */
  var ctxLive = null;
  var analyser = null;
  var timeData = null;

  function supported() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && global.MediaRecorder);
  }

  /* 统一包装错误：保住原始 name / raw，上层才能给具体指引 */
  function wrap(e, msg) {
    var err = new Error(msg);
    err.name = (e && e.name) || 'Error';
    err.raw = e;
    return err;
  }

  /* 挑一个这台设备支持的录音格式：安卓 Chrome → opus/webm；iOS Safari → mp4/aac */
  function pickMime() {
    if (!global.MediaRecorder || !global.MediaRecorder.isTypeSupported) return '';
    var cands = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/mp4;codecs=mp4a.40.2',
      'audio/mp4',
      'audio/ogg;codecs=opus'
    ];
    for (var i = 0; i < cands.length; i++) {
      try { if (MediaRecorder.isTypeSupported(cands[i])) return cands[i]; } catch (e) { /* ignore */ }
    }
    return '';
  }

  /* decodeAudioData 两种签名都兼容 */
  function decode(ctx, ab) {
    return new Promise(function (resolve, reject) {
      var ret;
      try {
        ret = ctx.decodeAudioData(ab, resolve, reject);
      } catch (e) { reject(e); return; }
      if (ret && ret.then) ret.then(resolve, reject); // 新版 Promise 形式
    });
  }

  function safeClose(ctx) {
    try {
      var p = ctx && ctx.close();
      if (p && p.catch) return p.catch(function () {});
    } catch (e) { /* ignore */ }
    return Promise.resolve();
  }

  /* 接一个分析器：只读音量，不录音、不外传。
   * 注意：AudioContext 在非手势上下文里创建会处于 suspended（iOS 尤甚），
   * 那只是音量条不动，不影响录音本身，所以整体 try 住即可。 */
  function attachLevelMeter(s) {
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      ctxLive = new AC();
      if (ctxLive.resume) ctxLive.resume().catch(function () {});
      var src = ctxLive.createMediaStreamSource(s);
      analyser = ctxLive.createAnalyser();
      analyser.fftSize = 512;
      src.connect(analyser);
      timeData = new Uint8Array(analyser.fftSize);
    } catch (e) {
      ctxLive = null; analyser = null; timeData = null;
    }
  }

  function start() {
    if (!supported()) {
      var e0 = new Error('这个浏览器不支持录音，请用 Chrome / Safari 打开，或直接打字');
      e0.name = 'NotSupportedError';
      return Promise.reject(e0);
    }
    if (recorder) return Promise.resolve(); // 已经在录了，别重入

    return navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }
    }).catch(function (e) {
      if (e && (e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError')) {
        throw wrap(e, '麦克风权限被拒了');
      }
      if (e && e.name === 'NotFoundError') throw wrap(e, '没找到麦克风');
      if (e && e.name === 'NotReadableError') throw wrap(e, '麦克风被别的程序占用了');
      throw wrap(e, '麦克风开不了：' + ((e && e.message) || e));
    }).then(function (s) {
      stream = s;
      chunks = [];
      var mime = pickMime();
      try {
        try {
          recorder = mime ? new MediaRecorder(s, { mimeType: mime }) : new MediaRecorder(s);
        } catch (e) {
          recorder = new MediaRecorder(s); // 老浏览器不认 options 参数
        }
        recorder.ondataavailable = function (ev) {
          if (ev.data && ev.data.size > 0) chunks.push(ev.data);
        };
        recorder.start();
      } catch (e) {
        // 启动失败必须把半成品清干净，不然下一次 start 会以为"已经在录了"
        var err = wrap(e, '录音启动失败：' + ((e && e.message) || e));
        recorder = null;
        try { s.getTracks().forEach(function (t) { t.stop(); }); } catch (e2) { /* ignore */ }
        stream = null;
        throw err;
      }
      attachLevelMeter(s);
    });
  }

  /* 当前音量 0..1（无分析器或上下文挂起时恒为 0） */
  function getLevel() {
    if (!analyser || !timeData) return 0;
    if (ctxLive && ctxLive.state === 'suspended' && ctxLive.resume) ctxLive.resume().catch(function () {});
    analyser.getByteTimeDomainData(timeData);
    var sum = 0;
    for (var i = 0; i < timeData.length; i++) {
      var v = (timeData[i] - 128) / 128;
      sum += v * v;
    }
    var rms = Math.sqrt(sum / timeData.length);
    return Math.min(1, rms * 3);
  }

  /* 停止并把录音转成 16k PCM */
  function stop() {
    var rec = recorder;
    if (!rec) return Promise.reject(new Error('还没有在录音'));

    return new Promise(function (resolve) {
      var done = false;
      var fin = function () { if (!done) { done = true; resolve(); } };
      rec.onstop = fin;
      try { rec.stop(); } catch (e) { fin(); }
      // 兜底：个别 WebView 的 onstop 不会来，别让流程永远挂着
      setTimeout(fin, 1500);
    }).then(function () {
      var tracks = stream ? stream.getTracks() : [];
      tracks.forEach(function (t) { try { t.stop(); } catch (e) { /* ignore */ } });
      safeClose(ctxLive);
      ctxLive = null; analyser = null; timeData = null;

      var type = (rec && rec.mimeType) || (chunks[0] && chunks[0].type) || 'audio/webm';
      var data = chunks;
      recorder = null; stream = null; chunks = [];
      if (!data.length) throw new Error('没录到声音，按住多说一会儿再松开');
      var blob = new Blob(data, { type: type });
      return blob.arrayBuffer();
    }).then(function (ab) {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      var ctx = new Ctx();
      return decode(ctx, ab).then(function (buf) {
        var channels = [];
        for (var c = 0; c < buf.numberOfChannels; c++) channels.push(buf.getChannelData(c));
        var mono = global.AudioUtils.toMono(channels);
        var pcm = global.AudioUtils.toPcm16k(mono, buf.sampleRate);
        return safeClose(ctx).then(function () { return { pcm: pcm }; });
      }, function () {
        // iOS 偶发解不出自己刚录的 mp4，重说一遍通常就好了
        return safeClose(ctx).then(function () {
          throw new Error('录音解码失败，请重说一遍');
        });
      });
    });
  }

  var Recorder = { supported: supported, start: start, stop: stop, getLevel: getLevel };
  if (typeof module !== 'undefined' && module.exports) module.exports = Recorder;
  else global.Recorder = Recorder;
})(typeof window !== 'undefined' ? window : globalThis);
