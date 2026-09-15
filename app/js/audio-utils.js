/*
 * 记哪儿 —— 音频纯工具（浏览器和 Node 测试共用）
 * 浮点采样 → 16 位 PCM；降采样到 16k（腾讯云实时语音识别要求 16k 16bit 单声道 PCM）。
 */
(function (global) {
  'use strict';

  var TARGET_RATE = 16000;

  /* Float32 [-1,1] → Int16，超出范围裁剪 */
  function floatTo16BitPCM(input) {
    var out = new Int16Array(input.length);
    for (var i = 0; i < input.length; i++) {
      var s = input[i];
      if (s > 1) s = 1;
      else if (s < -1) s = -1;
      out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return out;
  }

  /* 线性插值降采样（也支持升采样） */
  function downsample(input, fromRate, toRate) {
    if (!fromRate || !toRate || fromRate === toRate) return input;
    var ratio = fromRate / toRate;
    var outLength = Math.max(1, Math.round(input.length / ratio));
    var out = new Float32Array(outLength);
    for (var i = 0; i < outLength; i++) {
      var pos = i * ratio;
      var i0 = Math.floor(pos);
      var i1 = Math.min(i0 + 1, input.length - 1);
      var frac = pos - i0;
      out[i] = input[i0] * (1 - frac) + input[i1] * frac;
    }
    return out;
  }

  /* 多声道 Float32 混合成单声道 */
  function toMono(buffers) {
    // buffers: Float32Array[]（decodeAudioData 的多个声道）
    if (buffers.length === 1) return buffers[0];
    var len = buffers[0].length;
    var out = new Float32Array(len);
    for (var i = 0; i < len; i++) {
      var sum = 0;
      for (var c = 0; c < buffers.length; c++) sum += buffers[c][i];
      out[i] = sum / buffers.length;
    }
    return out;
  }

  /* 一条音频的完整转换：Float32(某采样率) → 16k Int16 */
  function toPcm16k(monoFloat32, fromRate) {
    var down = downsample(monoFloat32, fromRate, TARGET_RATE);
    return floatTo16BitPCM(down);
  }

  var AudioUtils = {
    TARGET_RATE: TARGET_RATE,
    floatTo16BitPCM: floatTo16BitPCM,
    downsample: downsample,
    toMono: toMono,
    toPcm16k: toPcm16k
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = AudioUtils;
  else global.AudioUtils = AudioUtils;
})(typeof window !== 'undefined' ? window : globalThis);
