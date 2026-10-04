/*
 * 记哪儿 —— 界面与流程组装
 */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var els = {
    micBtn: $('micBtn'), inputBar: $('inputBar'), modeBtn: $('modeBtn'),
    micHelpDlg: $('micHelpDlg'), micRetryBtn: $('micRetryBtn'), micDiag: $('micDiag'),
    micReloadBtn: $('micReloadBtn'),
    statusLine: $('statusLine'), textInput: $('textInput'), sendTextBtn: $('sendTextBtn'),
    resultArea: $('resultArea'),
    recordList: $('recordList'), ignoredList: $('ignoredList'),
    activeCount: $('activeCount'), ignoredCount: $('ignoredCount'), ignoredDetails: $('ignoredDetails'),
    exportBtn: $('exportBtn'), importBtn: $('importBtn'), importFile: $('importFile'),
    settingsDlg: $('settingsDlg'), settingsMsg: $('settingsMsg'),
    setDeepseekKey: $('setDeepseekKey'), setModel: $('setModel'), setBaseUrl: $('setBaseUrl'),
    setTencentAppId: $('setTencentAppId'), setTencentSecretId: $('setTencentSecretId'), setTencentSecretKey: $('setTencentSecretKey'),
    saveSettingsBtn: $('saveSettingsBtn'),
    appVersion: $('appVersion'), checkUpdateBtn: $('checkUpdateBtn'),
    updateBar: $('updateBar'),
    micTestBtn: $('micTestBtn'), micDiagBtn: $('micDiagBtn'), micTestOut: $('micTestOut'),
    editDlg: $('editDlg'), editTitle: $('editTitle'), editMeta: $('editMeta'),
    editItemWrap: $('editItemWrap'), editItem: $('editItem'),
    editPlaceWrap: $('editPlaceWrap'), editPlace: $('editPlace'),
    editTextWrap: $('editTextWrap'), editText: $('editText'),
    editSaveBtn: $('editSaveBtn'), editDeleteBtn: $('editDeleteBtn'), editToggleBtn: $('editToggleBtn'),
    pages: $('pages'), asst: $('asst'), navTitle: $('navTitle'),
    menuBtn: $('menuBtn'), menuDot: $('menuDot'), drawer: $('drawer'), scrim: $('scrim'),
    navTalkBtn: $('navTalkBtn'), navMemBtn: $('navMemBtn'), navSetBtn: $('navSetBtn'), memCount: $('memCount'),
    digestList: $('digestList'), digestMeta: $('digestMeta'),
    summaryBtn: $('summaryBtn'), summaryText: $('summaryText'),
    updateBar: $('updateBar'),
    toast: $('toast')
  };

  /* 版本号：跟 sw.js 里的 CACHE 保持一致。改代码后要同时改这两处 + sw.js 的 CACHE，
     改完手机上的旧缓存才会换掉。 */
  var APP_VERSION = '23';

  var state = {
    records: [],
    settings: Settings.load(),
    recording: false,
    busy: false,
    wsHandle: null,
    editingId: null,
    tickTimer: null,
    levelRaf: null,
    lvl: 0,
    page: 0,
    drawerOpen: false,
    holdStartAt: 0,
    startingHold: false,
    cancelHold: false,
    releaseAt: 0,          // 启动录音期间用户提前松手的时刻（0 = 没松）
    holdId: 0,             // 第几次录音，定时器靠它判归属
    maxTimer: null
  };

  /* ── 小工具 ─────────────────────────────── */

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function fmtTime(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return '';
    var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    var hm = pad(d.getMonth() + 1) + '月' + d.getDate() + '日 ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    return d.getFullYear() === new Date().getFullYear() ? hm : d.getFullYear() + '年' + hm;
  }

  var toastTimer = null;
  function toast(msg, isErr) {
    els.toast.textContent = msg;
    els.toast.className = 'toast' + (isErr ? ' err' : '');
    els.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { els.toast.hidden = true; }, 2800);
  }

  function setStatus(text, busy) {
    els.statusLine.textContent = text || '随口说一句，我来记';
    els.statusLine.className = 'status' + (busy ? ' busy' : '');
  }

  /* 录音计时：在听… 0:07 */
  function startTick() {
    stopTick();
    var t0 = Date.now();
    var show = function () {
      var s = Math.floor((Date.now() - t0) / 1000);
      setStatus('在听… ' + Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2), true);
    };
    show();
    state.tickTimer = setInterval(show, 250);
  }

  function stopTick() {
    if (state.tickTimer) { clearInterval(state.tickTimer); state.tickTimer = null; }
  }

  /* 声控红点：说话时助理“竖起耳朵”，音量越大越亮 */
  function startLevelLoop() {
    if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (!Recorder.getLevel) return;
    stopLevelLoop();
    var step = function () {
      var target = Recorder.getLevel();
      state.lvl = state.lvl * 0.7 + target * 0.3; // 平滑一点，不贼头贼脑地抖
      els.asst.style.setProperty('--lvl', state.lvl.toFixed(3));
      state.levelRaf = requestAnimationFrame(step);
    };
    state.levelRaf = requestAnimationFrame(step);
  }

  function stopLevelLoop() {
    if (state.levelRaf) { cancelAnimationFrame(state.levelRaf); state.levelRaf = null; }
    state.lvl = 0;
    els.asst.style.removeProperty('--lvl');
  }

  /* ── 小助理的状态机：idle / listening / thinking / happy ── */
  var asstTimer = null;

  function setAsstState(s) { els.asst.dataset.state = s; }

  function asstMoment(s, ms) {
    setAsstState(s);
    clearTimeout(asstTimer);
    asstTimer = setTimeout(function () {
      setAsstState(state.busy ? 'thinking' : 'idle');
    }, ms || 1000);
  }

  /* ── 双页路由：#/ 说话 ⇄ #/mem 记忆，浏览器前进后退可用 ── */
  function routePage() { return location.hash === '#/mem' ? 1 : 0; }

  function showPage(i, animate) {
    state.page = i;
    if (!animate) els.pages.classList.add('no-anim');
    els.pages.classList.toggle('at-mem', i === 1);
    els.pages.classList.toggle('at-talk', i !== 1);
    if (!animate) {
      void els.pages.offsetWidth; // 先把无动画的瞬间渲染出去，再恢复转场
      els.pages.classList.remove('no-anim');
    }
    els.navTitle.textContent = i ? '记忆' : '记哪儿';
    paintNavCurrent(i);
    if (i) renderDigest();
  }

  /* 侧边栏里标出当前在哪一页。用 aria-current 挂样式，语义和视觉同源 */
  function paintNavCurrent(i) {
    var on = i ? els.navMemBtn : els.navTalkBtn;
    var off = i ? els.navTalkBtn : els.navMemBtn;
    on.setAttribute('aria-current', 'page');
    off.removeAttribute('aria-current');
  }

  function goPage(i) {
    if (routePage() === i) { showPage(i, false); return; }
    location.hash = i ? '#/mem' : '#/';
  }

  /* ── 侧边栏：主导航（说话 / 记忆）都收在这里 ──
     inert 管住键盘 Tab：抽屉关着的时候它在屏幕外，不能被 Tab 摸到。
     旧浏览器不认识 inert，会当普通属性忽略掉，不影响使用。 */
  function openDrawer() {
    if (state.drawerOpen) return;
    state.drawerOpen = true;
    els.drawer.classList.add('open');
    els.scrim.classList.add('show');
    els.drawer.removeAttribute('inert');
    els.drawer.setAttribute('aria-hidden', 'false');
    els.menuBtn.setAttribute('aria-expanded', 'true');
    els.menuDot.hidden = true; // 看过了，蓝点就该灭
    var cur = state.page ? els.navMemBtn : els.navTalkBtn;
    try { cur.focus({ preventScroll: true }); } catch (e) { cur.focus(); }
  }

  function closeDrawer() {
    if (!state.drawerOpen) return;
    state.drawerOpen = false;
    els.drawer.classList.remove('open');
    els.scrim.classList.remove('show');
    els.drawer.setAttribute('inert', '');
    els.drawer.setAttribute('aria-hidden', 'true');
    els.menuBtn.setAttribute('aria-expanded', 'false');
    if (!state.recording) els.menuBtn.focus();
  }

  function initPager() {
    window.addEventListener('hashchange', function () {
      closeDrawer(); // 浏览器前进后退时，别把侧边栏晾在屏幕上
      showPage(routePage(), true);
    });

    els.menuBtn.addEventListener('click', function () {
      if (state.drawerOpen) closeDrawer(); else openDrawer();
    });
    els.scrim.addEventListener('click', function () { closeDrawer(); });
    els.navTalkBtn.addEventListener('click', function () { closeDrawer(); goPage(0); });
    els.navMemBtn.addEventListener('click', function () { closeDrawer(); goPage(1); });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && state.drawerOpen) { closeDrawer(); return; }
      var tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (state.drawerOpen) return; // 侧边栏开着，方向键别在背后偷偷切页
      if (e.key === 'ArrowRight') goPage(1);
      if (e.key === 'ArrowLeft') goPage(0);
    });
  }

  function now() { return new Date().toISOString(); }

  function findRecord(id) {
    for (var i = 0; i < state.records.length; i++) {
      if (state.records[i].id === id) return state.records[i];
    }
    return null;
  }

  /* ── 列表渲染 ───────────────────────────── */

  function recordLine(r) {
    return r.kind === 'place'
      ? '<span>' + esc(r.item) + '</span><span class="arrow">▸</span><span>' + esc(r.place) + '</span>'
      : '<span>' + esc(r.text) + '</span>';
  }

  function recordSub(r) {
    var parts = [fmtTime(r.saidAt)];
    if (r.kind === 'place' && r.history && r.history.length) parts.push('搬过 ' + r.history.length + ' 次');
    if (r.status === 'ignored' && r.ignoredReason) parts.push(r.ignoredReason);
    return parts.join(' · ');
  }

  function rowHtml(r, isNew) {
    return '<li class="record-row' + (r.kind === 'ordinary' ? ' record-ordinary' : '') + (isNew ? ' row-new' : '') + '" data-id="' + esc(r.id) + '">' +
      '<div class="record-main">' +
        '<div class="record-line">' + recordLine(r) + '</div>' +
        '<div class="record-sub">' + esc(recordSub(r)) + '</div>' +
      '</div>' +
      '<span class="arrow">›</span>' +
    '</li>';
  }

  /* 导航栏「记忆」入口上的条数徽标：入口自己说明"我替你记着几件"。
     只有数字真的变多才弹一下——改位置、忽略、删除都不该弹，
     否则就变成"随便动一下就抖"，反而廉价。第一次绘制也不弹。 */
  var memCountLast = null; // null = 还没画过第一次

  /* 侧边栏里的记忆入口：
     - 条数徽标说明"我替你记着几件"，数字长大时弹一下；
     - 记忆入口搬进侧边栏后，徽标平时看不见，所以「有新东西」改由
       汉堡上的小蓝点提示：记下新的一条就亮，点开侧边栏看过就灭。
     两者都不在首次加载时触发——一打开就闪，那叫骚扰不叫提示。 */
  function paintMemCount(n) {
    els.memCount.hidden = !n;
    els.memCount.textContent = n > 99 ? '99+' : String(n);
    var prev = memCountLast;
    memCountLast = n;
    if (prev === null || !n || n <= prev) return;
    els.memCount.classList.remove('pop');
    void els.memCount.offsetWidth; // 强制重排，否则第二次不会重放动画
    els.memCount.classList.add('pop');
    els.menuDot.hidden = false;
  }

  function renderList(newIds) {
    newIds = newIds || {};
    var active = state.records.filter(function (r) { return r.status !== 'ignored'; });
    var ignored = state.records.filter(function (r) { return r.status === 'ignored'; });
    var c = Model.counts(state.records);
    els.activeCount.textContent = c.active ? c.active + ' 条' : '';
    els.ignoredCount.textContent = c.ignored ? '(' + c.ignored + ')' : '';
    paintMemCount(c.active);

    els.recordList.innerHTML = active.length
      ? active.map(function (r) { return rowHtml(r, newIds[r.id]); }).join('')
      : '<li class="empty">还什么都没有，随口说一句试试</li>';
    els.ignoredList.innerHTML = ignored.length
      ? ignored.map(function (r) { return rowHtml(r, newIds[r.id]); }).join('')
      : '<li class="empty">没有重复说过的话</li>';
    els.ignoredDetails.open = false;
    renderDigest();
    renderSummary();
  }

  /* 助理的总结：本地实时摘要，不花 token、永远最新 */
  function renderDigest() {
    var active = state.records.filter(function (r) { return r.status !== 'ignored'; });
    els.digestMeta.textContent = active.length ? active.length + ' 条在记' : '';
    if (!active.length) {
      els.digestList.innerHTML = '<li class="empty">还什么都没记，去说话页说一句吧</li>';
      return;
    }
    var lines = [];
    active.forEach(function (r) {
      if (r.kind === 'place') {
        lines.push('<li class="digest-row"><div class="record-main">' +
          '<div class="record-line">' + esc(r.item) + '<span class="arrow">▸</span>' + esc(r.place) + '</div>' +
          '<div class="record-sub">' + esc(fmtTime(r.placedAt || r.saidAt)) +
          (r.history && r.history.length ? ' · 搬过 ' + r.history.length + ' 次' : '') + '</div>' +
          '</div></li>');
      }
    });
    var ordinary = active.filter(function (r) { return r.kind === 'ordinary'; });
    if (ordinary.length) {
      lines.push('<li class="digest-row"><div class="record-main">' +
        '<div class="record-line">' + ordinary.length + ' 条待办类的话</div>' +
        '<div class="record-sub">还没归位，翻翻下面的原记录</div></div></li>');
    }
    els.digestList.innerHTML = lines.length ? lines.join('') : '<li class="empty">还没有东西要记位置</li>';
  }

  /* AI 成段总结：点了按钮才花 token，按内容版本缓存 */
  var summaryCache = { key: '', text: '', at: '' };

  function summaryKey() {
    var last = 0;
    state.records.forEach(function (r) {
      var t = Date.parse(r.updatedAt || '') || 0;
      if (t > last) last = t;
    });
    return state.records.length + ':' + last;
  }

  function renderSummary() {
    if (summaryCache.key === summaryKey() && summaryCache.text) {
      els.summaryText.hidden = false;
      els.summaryText.textContent = summaryCache.text + '\n—— 总结于 ' + summaryCache.at;
      els.summaryBtn.textContent = '重新总结';
    } else {
      els.summaryText.hidden = true;
      els.summaryText.textContent = '';
      els.summaryBtn.textContent = '让助理写段总结';
    }
    els.summaryBtn.disabled = state.busy;
  }

  function doSummarize() {
    if (state.busy) return;
    if (!Settings.aiConfigured(state.settings)) {
      toast('先在设置里填 DeepSeek 的 Key 才能总结', true);
      openSettings();
      return;
    }
    var active = state.records.filter(function (r) { return r.status !== 'ignored'; });
    if (!active.length) { toast('还没有可总结的记录', true); return; }
    state.busy = true;
    els.summaryBtn.disabled = true;
    els.summaryBtn.textContent = '我想想…';
    AI.summarize(active, state.settings).then(function (text) {
      summaryCache = { key: summaryKey(), text: String(text || '').trim(), at: fmtTime(now()) };
      renderSummary();
    }).catch(function (e) {
      toast(e.message || '总结失败了，再试一次', true);
    }).then(function () {
      state.busy = false;
      els.summaryBtn.disabled = false;
      renderSummary();
    });
  }

  /* ── AI 结果卡片 ────────────────────────── */

  function quoteHtml(r) {
    if (!r) return '';
    var main = r.kind === 'place' ? esc(r.item) + ' ▸ ' + esc(r.place) : esc(r.text);
    return '<div class="ai-quote">' + main + '<div class="q-time">' + esc(fmtTime(r.saidAt)) + '的原话</div></div>';
  }

  function resultCard(inner) {
    els.resultArea.innerHTML = '<section class="card ai-card">' + inner + '</section>';
    requestAnimationFrame(function () {
      try { els.resultArea.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } catch (e) { /* 旧浏览器忽略 */ }
    });
  }

  function actionLine(action, result) {
    if (!result.ok) return '<div class="ai-body">⚠️ 有一样没存上：' + esc(result.error) + '</div>';
    if (!result.applied) return null;
    var a = action;
    if (a.action === 'create' && a.kind === 'place') return '<div>记下了：<b>' + esc(a.item) + '</b> ▸ ' + esc(a.place) + '</div>';
    if (a.action === 'create') return '<div>记下了：' + esc(a.text) + '</div>';
    if (a.action === 'ignore') return '<div>这事先前记过，就不重复记啦</div>';
    if (a.action === 'update') {
      var rec = result.changedId ? findRecord(result.changedId) : null;
      return '<div>位置有变：<b>' + esc(rec ? rec.item : a.recordId) + '</b> 现在在 ▸ ' + esc(a.place) + '</div>';
    }
    return null;
  }

  function showResult(parsed, results) {
    if (parsed.intent === 'question' && parsed.answer) {
      var quotes = parsed.answer.recordIds.map(function (id) { return findRecord(id); }).filter(Boolean);
      var body = parsed.answer.text || '这个我还真不记得。';
      resultCard(
        '<div class="ai-head"><span class="ai-badge ok">回答</span></div>' +
        '<div class="ai-body">' + esc(body) + '</div>' +
        quotes.map(quoteHtml).join('')
      );
      return;
    }

    var lines = [];
    var appliedCount = 0;
    var errorCount = 0;
    (results || []).forEach(function (r, i) {
      if (!r.ok) errorCount++;
      if (r.applied) appliedCount++;
      var line = actionLine(parsed.actions[i], r);
      if (line) lines.push(line);
    });

    var badge = errorCount ? '<span class="ai-badge warn">有没存上的</span>'
      : appliedCount ? '<span class="ai-badge">记好了</span>'
      : '<span class="ai-badge ok">知道了</span>';
    var body = parsed.reply
      ? '<div class="ai-body">' + esc(parsed.reply) + '</div>'
      : (lines.length ? '' : '<div class="ai-body">嗯，听到了。</div>');

    resultCard('<div class="ai-head">' + badge + '</div>' + body + lines.join(''));
  }

  function showErrorCard(msg) {
    resultCard('<div class="ai-head"><span class="ai-badge warn">出了点问题</span></div>' +
      '<div class="ai-body">' + esc(msg) + '</div>');
  }

  /* ── 主流程：一句话进来 ─────────────────── */

  function persistChanged(results) {
    var ids = {};
    (results || []).forEach(function (r) { if (r.ok && r.applied && r.changedId) ids[r.changedId] = true; });
    var changed = state.records.filter(function (r) { return ids[r.id]; });
    if (changed.length) Store.putMany(changed).catch(function (e) { toast('存到本机失败：' + e.message, true); });
  }

  /* 核心解析流程：调用时 busy 必须已是 true，结束时负责解锁 */
  function runParse(text) {
    setStatus('我想想…', true);
    setAsstState('thinking');
    AI.parse(text, state.records, state.settings).then(function (parsed) {
      var applied = Model.applyDecisions(state.records, parsed.actions, now());
      state.records = applied.records;
      persistChanged(applied.results);
      // 新建的那几条，进场时滑一下：助理“递纸条”的感觉
      var freshIds = {};
      applied.results.forEach(function (r, i) {
        if (r.ok && r.applied && r.changedId &&
            parsed.actions[i] && parsed.actions[i].action === 'create') {
          freshIds[r.changedId] = true;
        }
      });
      renderList(freshIds);
      showResult(parsed, applied.results);
      if (Object.keys(freshIds).length) asstMoment('happy', 1200);
      else setAsstState('idle');
    }).catch(function (e) {
      setAsstState('idle');
      showErrorCard(e && e.message ? e.message : '出了点问题，再试一次');
    }).then(function () {
      if (els.asst.dataset.state === 'thinking') setAsstState('idle');
      state.busy = false;
      refreshMic();
      setStatus('');
    });
  }

  function handleUtterance(text) {
    text = String(text || '').trim();
    if (!text || state.busy) return;
    if (!Settings.aiConfigured(state.settings)) {
      toast('先在设置里填 DeepSeek 的 Key 才能用 AI', true);
      openSettings();
      return;
    }
    state.busy = true;
    refreshMic();
    runParse(text);
  }

  /* ── 语音入口 ───────────────────────────── */

  function refreshMic() {
    var mode = ASR.mode(state.settings);
    els.micBtn.disabled = state.busy || !mode;
    els.micBtn.classList.toggle('holding', state.recording && !state.busy);
    if (state.busy) els.micBtn.textContent = '我想想…';
    else if (state.recording) els.micBtn.textContent = '松开 结束';
    else els.micBtn.textContent = '按住 说话';
  }

  /* 最长说 60 秒；若语音服务没响应，8 秒后强制收尾 */
  function armMaxHold() {
    clearTimeout(state.maxTimer);
    var id = state.holdId;
    state.maxTimer = setTimeout(function () {
      if (state.holdId !== id || !state.recording) return;
      toast('说了好久啦，自动结束', false);
      holdEnd();
      setTimeout(function () {
        if (state.holdId !== id) return; // 已经换了一次录音，别误杀
        if (state.recording) {
          cleanupMic();
          toast('语音服务没响应，已结束，再试一次', true);
        }
      }, 8000);
    }, 60000);
  }

  /* ── 环境体检 ─────────────────────────────
   *
   * ⚠ 为什么要单独做「逐项预检」（安卓上尤其重要）：
   * getUserMedia 失败时抛的 NotAllowedError 既可能是「用户拒绝」，
   * 也可能是「浏览器/系统压根不给弹授权框」——两者错误名字完全一样，
   * 光看 err.name 分不出来，用户就只能在一堆提示里瞎试。
   * 所以这里先把每一条前置条件逐项查一遍，直接告诉用户缺的是哪一条。*/

  function isIOS() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }

  /* 内置浏览器：这些 WebView 拿不到麦克风，必须换真正的浏览器打开 */
  function inAppBrowser() {
    var ua = navigator.userAgent;
    if (/MicroMessenger/i.test(ua)) return '微信';
    if (/\bQQ\b|QQBrowser|MQQBrowser/i.test(ua)) return 'QQ';
    if (/Weibo/i.test(ua)) return '微博';
    if (/DingTalk/i.test(ua)) return '钉钉';
    if (/Alipay/i.test(ua)) return '支付宝';
    if (/UCBrowser|UBrowser/i.test(ua)) return 'UC';
    if (/Quark/i.test(ua)) return '夸克';
    return '';
  }

  function secureOk() {
    return location.protocol === 'https:' || location.hostname === 'localhost' ||
      location.hostname === '127.0.0.1';
  }

  /* 逐项体检，返回第一个卡住的地方。没卡住返回 null。*/
  function precheckMic() {
    if (inAppBrowser()) {
      return '你现在是用「' + inAppBrowser() + '」内置浏览器打开的，它根本不给网页麦克风。' +
        '点右上角 ⋯ →「在浏览器打开」（安卓用 Chrome），再按住说话。';
    }
    if (!secureOk()) {
      return '当前地址不是 https（' + location.protocol + '//' + location.host + '），' +
        '浏览器在非 https 下不给麦克风权限。请用部署后的 https 网址打开。';
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return '这个浏览器没提供录音接口（navigator.mediaDevices 缺失）。' +
        (isIOS() ? 'iOS 需 Safari 且系统 14.3 以上。' : '安卓建议换 Chrome 或 Edge。') +
        '国产浏览器内核常常不带这个接口。';
    }
    if (!window.MediaRecorder) {
      return '这个浏览器不支持 MediaRecorder（录音接口），无法录音。安卓建议换 Chrome。';
    }
    return null;
  }

  /* 权限查询：Chrome 系支持 permissions API，能直接问出当前授权状态。
   * 关键用途：区分「用户拒绝了」和「浏览器压根不给弹框」——这两者 getUserMedia
   * 抛的错名字一样，但用户的解法完全不同。*/
  function micPermissionState(cb) {
    if (!navigator.permissions || !navigator.permissions.query) { cb(null); return; }
    try {
      navigator.permissions.query({ name: 'microphone' }).then(function (r) {
        cb(r.state); // 'granted' | 'denied' | 'prompt'
      }).catch(function () { cb(null); });
    } catch (e) { cb(null); }
  }

  /* 返回一条能直接读的"为什么开不了"——按可能性从高到低排。
   * 返回 Promise：权限状态是异步查的，只有拿到它才能区分
   * 「用户拒绝了」和「浏览器压根不弹授权框」——这两者错误名字一模一样。*/
  function micDiagText(err) {
    var pre = precheckMic();
    if (pre) return Promise.resolve(pre);

    if (err && (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError')) {
      return new Promise(function (resolve) {
        micPermissionState(function (state) {
          var hint;
          if (state === 'prompt') {
            hint = '【这是最可能的原因】你的浏览器从未弹出麦克风授权框——' +
              '这不是你拒绝了，而是这个浏览器不给网页麦克风权限，改设置也没用。' +
              '请把网址复制到 Chrome 或 Edge 里打开。';
          } else if (state === 'denied') {
            hint = '【原因】麦克风权限已被拒绝。' +
              '点地址栏左侧 🔒 / ⓘ → 麦克风 → 允许 → 刷新页面。';
          } else if (state === 'granted') {
            hint = '【原因】权限显示是「已允许」但仍打不开：' +
              '多半是麦克风被别的 App 占用（通话/录音/游戏），' +
              '关掉它们再重开一次页面；或浏览器内核限制，换 Chrome 试试。';
          } else {
            hint = '麦克风权限没拿到（浏览器报 ' + err.name + '，但查不到具体权限状态）。';
          }
          resolve(hint + '　另外按顺序也检查：① 地址栏左侧 🔒 → 麦克风 → 允许 → 刷新；' +
            '② ' + (isIOS()
              ? '手机「设置 → App → Safari → 麦克风」设为允许'
              : '系统「设置 → 应用 → ' + (inAppBrowser() || '浏览器') + ' → 权限 → 麦克风」允许；' +
                '国产浏览器还要去「权限管理 → 麦克风」单独打开'));
        });
      });
    }
    if (err && err.name === 'NotFoundError') return Promise.resolve('没找到麦克风设备，检查一下有没有插着耳机/蓝牙。');
    if (err && err.name === 'NotReadableError') return Promise.resolve('麦克风被别的 App 占用了，关掉正在录音的 App 再试。');
    if (err && err.name === 'OverconstrainedError') return Promise.resolve('麦克风不支持要求的参数，重开一次页面试试。');
    if (err && err.name) return Promise.resolve('麦克风打不开（' + err.name + '）：' + ((err.message || '') || '无更多信息'));
    return Promise.resolve('');
  }

  /* 出一行技术底细，方便对着屏幕排查 */
  function envLine() {
    return [
      location.protocol + '//' + location.host,
      'getUserMedia:' + (navigator.mediaDevices && navigator.mediaDevices.getUserMedia ? '有' : '无'),
      'MediaRecorder:' + (window.MediaRecorder ? '有' : '无'),
      '语音识别:' + ((window.SpeechRecognition || window.webkitSpeechRecognition) ? '自带' : '无')
    ].join(' · ');
  }

  function openMicHelp(err) {
    if (els.micHelpDlg.open) return; // 已经在弹了，别重复 showModal
    els.micHelpDlg.showModal();
    if (!els.micDiag) return;
    els.micDiag.hidden = false;
    els.micDiag.textContent = '正在判断原因…';

    /* 权限状态是异步的，所以诊断文案也异步出：先渲染环境底细，
       拿到权限状态后再覆盖成针对性的结论。 */
    envLineAsync().then(function (line) {
      if (!els.micDiag) return;
      if (!els.micDiag.textContent.match(/判断中|判断原因/)) return; // 已被别处改写
      els.micDiag.textContent = line;
    });
    Promise.resolve(micDiagText(err)).then(function (d) {
      if (!els.micDiag) return;
      els.micDiag.textContent = d || envLine();
    });
  }

  /* 带权限状态的完整底细，用来核实真实环境 */
  function envLineAsync() {
    return new Promise(function (resolve) {
      var base = [
        location.protocol + '//' + location.host,
        'getUserMedia:' + (navigator.mediaDevices && navigator.mediaDevices.getUserMedia ? '有' : '无'),
        'MediaRecorder:' + (window.MediaRecorder ? '有' : '无')
      ];
      micPermissionState(function (state) {
        base.push('麦克风权限:' + (state === 'granted' ? '已允许'
          : state === 'denied' ? '已拒绝'
            : state === 'prompt' ? '未询问(浏览器不给弹框)'
              : '查不到'));
        resolve(base.join(' · '));
      });
    });
  }

  /* 「测试麦克风」：真的去要一次权限 + 录1 秒，立刻告诉用户结果。
   * 放在设置里而不是等到按住说话才报错，是因为「按住说话」那条路要同时
   * 经过手势、权限、录音格式三关，失败时用户看不到是哪一关。 */
  function testMic() {
    if (!els.micTestOut) return;
    var out = els.micTestOut;
    out.hidden = false;
    out.textContent = '正在请求麦克风权限…';

    var pre = precheckMic();
    if (pre) { out.textContent = '✗ ' + pre; return; }

    var stream = null;
    navigator.mediaDevices.getUserMedia({ audio: true })
      .then(function (s) {
        stream = s;
        // 真的录一小段，确认 MediaRecorder 也能用（有些设备授权过但录不了）
        var mime = '';
        try { mime = Recorder.pickMime ? Recorder.pickMime() : ''; } catch (e) { /* ignore */ }
        var rec;
        try {
          rec = mime ? new MediaRecorder(s, { mimeType: mime }) : new MediaRecorder(s);
        } catch (e) {
          rec = new MediaRecorder(s);
        }
        var chunks = [];
        rec.ondataavailable = function (ev) { if (ev.data && ev.data.size) chunks.push(ev.data); };
        rec.start();
        setTimeout(function () {
          try { rec.stop(); } catch (e) { /* ignore */ }
        }, 1000);
        rec.onstop = function () {
          stopStream(stream);
          var ms = chunks.reduce(function (n, c) { return n + c.size; }, 0);
          out.textContent = ms > 0
            ? '✓ 麦克风正常。已录到 ' + ms + ' 字节音频（' +
              (mime ? mime.split(';')[0] : '默认格式') + '），可以按住说话。'
            : '⚠ 拿到了权限，但没录到声音。检查手机是否被静音、或麦克风被别的 App 占用。';
        };
        rec.onerror = function () {
          stopStream(stream);
          out.textContent = '✗ 录音出错：' + ((rec.error && rec.error.name) || '未知');
        };
      })
      .catch(function (e) {
        stopStream(stream);
        Promise.resolve(micDiagText(e)).then(function (d) {
          out.textContent = '✗ ' + (d || ('麦克风打不开（' + ((e && e.name) || '未知') + '）'));
        });
      });
  }

  function stopStream(s) {
    try {
      if (s && s.getTracks) s.getTracks().forEach(function (t) { t.stop(); });
    } catch (e) { /* ignore */ }
  }

  /* 「诊断环境」：只读检查，不碰权限、不弹框 */
  function showDiag() {
    if (!els.micTestOut) return;
    var out = els.micTestOut;
    out.hidden = false;
    out.textContent = '检查中…';
    envLineAsync().then(function (line) {
      out.textContent = line;
      var mode = ASR.mode(state.settings);
      var speech = (window.SpeechRecognition || window.webkitSpeechRecognition)
        ? '有（但国内常连不上谷歌服务）' : '无';
      out.textContent += ' · 语音识别:' + speech + ' · 当前方案:' +
        (mode === 'tencent' ? '腾讯云（密钥已填）'
          : mode === 'webspeech' ? '浏览器自带（国内安卓常不可用）'
            : '无（只能打字）');
    });
  }

  /* 按住说话（微信式）：按下录音，松开识别并发送；若松手事件丢失，再按一次也能结束
   *
   * ⚠️ 关键约束（手机端踩过的坑）：getUserMedia / SpeechRecognition.start()
   * 必须在用户手势的同步调用栈里发起。中间只要跨一个 Promise.then，
   * iOS Safari 就认为手势失效，直接拒掉——表现就是"点了允许还是用不了"。
   * 所以这里不再做异步权限预检，先直接发起，失败了再用 micDiagText 告诉用户原因。
   */
  function holdStart(e) {
    if (e.cancelable) e.preventDefault();
    if (state.startingHold) { state.cancelHold = true; return; } // 启动中又按一下 = 取消这次
    if (state.recording) { holdEnd(); return; } // 保底：点一下也能停
    if (state.busy) return;
    try { els.micBtn.setPointerCapture(e.pointerId); } catch (err) { /* 老浏览器忽略 */ }
    var mode = ASR.mode(state.settings);
    if (!mode) { toast('语音识别还没配置好，先打字，或去设置里填密钥', true); return; }
    holdStartGo(mode); // 同步发起，手势不过期
  }

  /* 录音真正启动后，还要再录这么久才允许停：太快停会拿不到音频数据 */
  var MIN_RECORD_MS = 500;

  /* 启动期间用户就松手了：等凑够最短时长再收尾，而不是把这次录音废掉 */
  function settleEarlyRelease() {
    var at = state.releaseAt;
    var id = state.holdId;
    state.releaseAt = 0;
    if (!at) return;
    var wait = Math.max(0, MIN_RECORD_MS - (Date.now() - at));
    setTimeout(function () {
      if (state.holdId !== id) return; // 已经换了一次录音，别误杀这一次
      if (state.recording) holdEnd();
    }, wait);
  }

  function holdStartGo(mode) {
    state.holdId++; // 每次录音一个号，防止上一轮的定时器打到这一轮
    state.holdStartAt = Date.now();
    state.cancelHold = false;
    state.releaseAt = 0;
    if (mode === 'tencent') {
      state.startingHold = true;
      Recorder.start().then(function () {
        state.startingHold = false;
        if (state.cancelHold) { // 用户明确又按了一下：取消
          state.cancelHold = false;
          state.releaseAt = 0;
          Recorder.stop().catch(function () {});
          toast('这次不录了');
          return;
        }
        state.recording = true;
        state.holdStartAt = Date.now(); // 以真正开录的时刻计时
        refreshMic();
        startTick();
        startLevelLoop();
        armMaxHold();
        setAsstState('listening');
        settleEarlyRelease();
      }).catch(function (err) {
        state.startingHold = false;
        state.releaseAt = 0;
        setStatus('');
        setAsstState('idle');
        refreshMic();
        openMicHelp(err.raw || err); // 一律给可执行的排查指引，不丢原始错误
      });
    } else {
      var handle = ASR.webSpeechStart();
      state.wsHandle = handle;
      state.recording = true;
      state.holdStartAt = Date.now();
      refreshMic();
      startTick();
      armMaxHold();
      setAsstState('listening');
      handle.promise.then(function (text) {
        state.busy = false;
        cleanupMic();
        handleUtterance(text); // 里面会重新把 busy 置 true
      }).catch(function (err) {
        state.busy = false;
        cleanupMic();
        if (err && err.fatal) { openMicHelp(err.raw || err); return; }
        if (err && err.silent) { toast(err.message, false); return; } // 松手太快/没出声，温和提示
        toast(err.message || '没听清，再试一次', true);
      });
    }
  }

  function holdEnd() {
    // 录音还在启动就松手了：记下时刻，等启动完成后自动补齐收尾（不再直接取消）
    if (state.startingHold) { if (!state.releaseAt) state.releaseAt = Date.now(); return; }
    if (!state.recording) return;
    clearTimeout(state.maxTimer);
    var mode = ASR.mode(state.settings);
    if (mode === 'tencent') {
      var tooShort = Date.now() - state.holdStartAt < 400;
      state.recording = false;
      state.busy = true;
      stopTick();
      stopLevelLoop();
      refreshMic();
      setAsstState('thinking'); // 识别+解析期间它低头写小本本
      setStatus('识别中……', true);
      Recorder.stop().then(function (r) {
        if (tooShort) throw new Error('__short__');
        return ASR.tencentRecognize(r.pcm, state.settings);
      }).then(function (text) {
        runParse(text);
      }).catch(function (err) {
        state.busy = false;
        refreshMic();
        setAsstState('idle');
        setStatus('');
        if (err && err.message === '__short__') toast('按住别松，说完再松开', true);
        else toast(err.message || '识别失败了', true);
      });
    } else if (state.wsHandle) {
      /* 自带识别：立刻把界面从"在听"切出来，别等引擎回话。
       * 之前这里只调了 stop()，界面状态全靠 promise 回调收拾，
       * 而 promise 存在永不 settle 的路径 → 松手后状态栏一直停在"在听…"。 */
      var handle = state.wsHandle;
      state.recording = false;
      state.busy = true;
      stopTick();
      stopLevelLoop();
      refreshMic();
      setAsstState('thinking');
      setStatus('识别中……', true);
      handle.stop(); // 真正的收尾交给 handle.promise 的 then/catch

      // 最后一道保险：引擎连兜底都不触发的话，别让按钮永久按不动
      var guardId = state.holdId;
      setTimeout(function () {
        if (state.holdId !== guardId || !state.busy) return;
        state.busy = false;
        cleanupMic();
        refreshMic();
      }, 4000);
    }
  }

  /* 语音 / 键盘模式切换 */
  function toggleMode() {
    var toVoice = !els.inputBar.classList.contains('voice');
    if (toVoice && !ASR.mode(state.settings)) {
      toast('语音识别还没配置好（设置里可填腾讯云密钥）', true);
      return;
    }
    els.inputBar.classList.toggle('voice', toVoice);
    els.micBtn.hidden = !toVoice;
    els.modeBtn.setAttribute('aria-label', toVoice ? '切换到键盘' : '切换到语音');
    refreshMic();
  }

  function cleanupMic() {
    stopTick();
    stopLevelLoop();
    clearTimeout(state.maxTimer);
    state.recording = false;
    state.startingHold = false;
    state.cancelHold = false;
    state.releaseAt = 0;
    state.wsHandle = null;
    refreshMic();
    setAsstState('idle');
    setStatus('');
  }

  /* 录音卡住了/权限死活不行：给用户一个能自愈的出口 */
  function hardResetMic() {
    try { if (state.wsHandle && state.wsHandle.stop) state.wsHandle.stop(); } catch (e) { /* ignore */ }
    try { Recorder.stop().catch(function () {}); } catch (e) { /* ignore */ }
    cleanupMic();
    state.busy = false;
    refreshMic();
  }

  /* 底部弹层：带下滑退场，不再“啪”地消失 */
  function closeSheet(dlg) {
    dlg.classList.add('closing');
    setTimeout(function () {
      dlg.close();
      dlg.classList.remove('closing');
    }, 180);
  }

  /* ── 编辑弹窗 ───────────────────────────── */

  function openEdit(id) {
    var r = findRecord(id);
    if (!r) return;
    state.editingId = id;
    els.editTitle.textContent = r.kind === 'place' ? '改位置' : '改内容';
    els.editMeta.textContent = '记于 ' + fmtTime(r.saidAt) + ' · 原话：' + (r.text || '');
    var isPlace = r.kind === 'place';
    els.editItemWrap.style.display = isPlace ? '' : 'none';
    els.editPlaceWrap.style.display = isPlace ? '' : 'none';
    els.editTextWrap.style.display = isPlace ? 'none' : '';
    els.editItem.value = r.item || '';
    els.editPlace.value = r.place || '';
    els.editText.value = r.text || '';
    els.editToggleBtn.textContent = r.status === 'ignored' ? '恢复' : '忽略';
    els.editDlg.showModal();
  }

  function closeEdit() { closeSheet(els.editDlg); state.editingId = null; }

  function saveEdit() {
    var r = findRecord(state.editingId);
    if (!r) { closeEdit(); return; }
    var fields = r.kind === 'place'
      ? { item: els.editItem.value, place: els.editPlace.value }
      : { text: els.editText.value };
    var res = Model.updateFields(state.records, state.editingId, fields, now());
    if (!res.ok) { toast(res.error, true); return; }
    state.records = res.records;
    Store.put(findRecord(state.editingId)).catch(function () {});
    renderList();
    closeEdit();
    toast('改好了');
  }

  function toggleEditStatus() {
    var r = findRecord(state.editingId);
    if (!r) { closeEdit(); return; }
    var to = r.status === 'ignored' ? 'active' : 'ignored';
    var res = Model.setStatus(state.records, state.editingId, to, now());
    if (!res.ok) { toast(res.error, true); return; }
    state.records = res.records;
    Store.put(findRecord(state.editingId)).catch(function () {});
    renderList();
    closeEdit();
    toast(to === 'ignored' ? '已忽略，可以在下面恢复' : '已恢复');
  }

  function deleteEdit() {
    if (!confirm('彻底删除这条记录？想留痕的话用「忽略」更好。')) return;
    var res = Model.removeRecord(state.records, state.editingId);
    state.records = res.records;
    Store.delete(state.editingId).catch(function () {});
    renderList();
    closeEdit();
    toast('删掉了');
  }

  /* ── 设置 ───────────────────────────────── */

  function openSettings() {
    var s = state.settings;
    els.setDeepseekKey.value = s.deepseekKey || '';
    els.setModel.value = s.model || 'deepseek-chat';
    els.setBaseUrl.value = s.baseUrl || '';
    els.setTencentAppId.value = s.tencentAppId || '';
    els.setTencentSecretId.value = s.tencentSecretId || '';
    els.setTencentSecretKey.value = s.tencentSecretKey || '';
    els.settingsMsg.textContent = '';
    els.settingsDlg.showModal();
  }

  function saveSettings() {
    state.settings = Settings.save({
      deepseekKey: els.setDeepseekKey.value.trim(),
      model: els.setModel.value.trim() || 'deepseek-chat',
      baseUrl: els.setBaseUrl.value.trim(),
      tencentAppId: els.setTencentAppId.value.trim(),
      tencentSecretId: els.setTencentSecretId.value.trim(),
      tencentSecretKey: els.setTencentSecretKey.value.trim()
    });
    els.settingsMsg.textContent = '';
    closeSheet(els.settingsDlg);
    refreshMic();
    toast('设置已保存（只存在这台设备上）');
  }

  /* ── 备份 ───────────────────────────────── */

  function doExport() {
    if (!state.records.length) { toast('还没有记录可导出', true); return; }
    Backup.download(Backup.exportPayload(state.records, now()));
    toast('备份文件已导出，存到相册/文件里保管好');
  }

  function doImport(file) {
    if (!file) return;
    Backup.readFile(file).then(function (obj) {
      var recs = Backup.validateImport(obj);
      if (!confirm('导入 ' + recs.length + ' 条记录，会替换掉现在的 ' + state.records.length + ' 条，确定？')) return;
      return Store.clear().then(function () {
        state.records = recs;
        return Store.putMany(recs);
      }).then(function () {
        renderList();
        toast('导入完成');
      });
    }).catch(function (e) {
      toast(e.message || '导入失败', true);
    }).then(function () {
      els.importFile.value = '';
    });
  }

  /* ── 事件绑定与启动 ─────────────────────── */

  function bind() {
    els.micBtn.addEventListener('pointerdown', holdStart);
    els.micBtn.addEventListener('pointerup', holdEnd);
    els.micBtn.addEventListener('pointercancel', holdEnd);
    els.micBtn.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    // 保底：不管事件被谁吞了，屏幕上任何地方松手都结束录音（启动中松手也要记上）
    window.addEventListener('pointerup', function () { if (state.recording || state.startingHold) holdEnd(); });
    window.addEventListener('pointercancel', function () { if (state.recording || state.startingHold) holdEnd(); });
    els.modeBtn.addEventListener('click', toggleMode);
    els.sendTextBtn.addEventListener('click', function () {
      handleUtterance(els.textInput.value);
      els.textInput.value = '';
    });
    els.textInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        handleUtterance(els.textInput.value);
        els.textInput.value = '';
      }
    });

    els.recordList.addEventListener('click', function (e) {
      var li = e.target.closest('.record-row');
      if (li) openEdit(li.dataset.id);
    });
    els.ignoredList.addEventListener('click', function (e) {
      var li = e.target.closest('.record-row');
      if (li) openEdit(li.dataset.id);
    });

    /* 设置入口在抽屉底部：先收起抽屉，再开设置弹层。
       反过来的话 closeDrawer 会把焦点还给汉堡，抢走弹窗的焦点。 */
    els.navSetBtn.addEventListener('click', function () {
      closeDrawer();
      openSettings();
    });
    els.saveSettingsBtn.addEventListener('click', saveSettings);
    if (els.checkUpdateBtn) els.checkUpdateBtn.addEventListener('click', checkUpdate);
    if (els.micTestBtn) els.micTestBtn.addEventListener('click', testMic);
    if (els.micDiagBtn) els.micDiagBtn.addEventListener('click', showDiag);
    watchNewWorker();
    Array.prototype.forEach.call(document.querySelectorAll('.done-btn'), function (b) {
      b.addEventListener('click', function () {
        var dlg = b.closest('dialog');
        if (dlg && dlg.open) closeSheet(dlg);
      });
    });

    els.editSaveBtn.addEventListener('click', saveEdit);
    els.editToggleBtn.addEventListener('click', toggleEditStatus);
    els.editDeleteBtn.addEventListener('click', deleteEdit);

    els.exportBtn.addEventListener('click', doExport);
    els.importBtn.addEventListener('click', function () { els.importFile.click(); });
    els.importFile.addEventListener('change', function () {
      if (els.importFile.files && els.importFile.files[0]) doImport(els.importFile.files[0]);
    });

    els.summaryBtn.addEventListener('click', doSummarize);
    els.micRetryBtn.addEventListener('click', function () {
      closeSheet(els.micHelpDlg);
      hardResetMic(); // 把可能卡住的录音状态清干净，用户可以直接再按一次
    });
    if (els.micReloadBtn) {
      els.micReloadBtn.addEventListener('click', function () { location.reload(); });
    }
    document.addEventListener('visibilitychange', function () {
      if (document.hidden && state.recording) holdEnd(); // 切后台自动收尾
    });
    initPager();
  }

  function registerSW() {
    if (location.protocol !== 'http:' && location.protocol !== 'https:') return;
    if (!('serviceWorker' in navigator)) return;

    // 已经从旧 SW 接管过页面：等新 SW 上岗时自动刷一次，
    // 否则手机上会一直在跑上一次部署的旧代码（这次改的就是这个坑）。
    var reloaded = false;
    var hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (reloaded || !hadController) return;
      reloaded = true;
      location.reload();
    });

    navigator.serviceWorker.register('sw.js').then(function (reg) {
      if (reg && reg.update) reg.update().catch(function () {}); // 每次打开都查一下有没有新版
    }).catch(function () { /* PWA 失败不影响使用 */ });
  }

  /* 盯着新 SW 装到一半：装完就把提示条亮出来，用户点一下才刷新
   *
   * 为什么需要：页面装到桌面后没有刷新按钮，代码更新不生效时用户毫无办法。
   * 之前只有 activate 时强制 navigate 那招（见 sw.js 注释），属于兜底；
   * 这里给它一个用户能看见、能自主决定的动作。*/
  var watching = false;
  function watchNewWorker() {
    if (watching || !('serviceWorker' in navigator)) return;
    watching = true;
    var guard = 0;
    var poll = setInterval(function () {
      if (++guard > 60) { clearInterval(poll); return; } // 最多等 30 秒
      navigator.serviceWorker.getRegistration().then(function (reg) {
        if (!reg) return;
        if (reg.waiting) {
          clearInterval(poll);
          showUpdateReady(reg);
          return;
        }
        var sw = reg.installing;
        if (!sw) return;
        sw.addEventListener('statechange', function () {
          // installed 且已有 controller = 这次是「更新」而非「首次安装」
          if (sw.state === 'installed' && navigator.serviceWorker.controller) {
            clearInterval(poll);
            showUpdateReady(reg);
          }
        });
      }).catch(function () { clearInterval(poll); });
    }, 2000);
  }

  /* 「检查更新」：主动查一次有没有新 SW，装好就提示用户刷新
   *
   * 存在的理由：PWA 装到桌面后，代码更新不会自己生效，页面上也没有刷新按钮。
   * 之前只能靠 activate 时强制 navigate，用户没有主动手段，只能靠等。*/
  function checkUpdate() {
    if (!('serviceWorker' in navigator)) {
      setStatus('这个浏览器不支持 Service Worker，无法自动更新');
      return;
    }
    if (els.checkUpdateBtn) {
      els.checkUpdateBtn.disabled = true;
      els.checkUpdateBtn.textContent = '检查中…';
    }
    navigator.serviceWorker.getRegistration().then(function (reg) {
      if (!reg) throw new Error('还没有注册 Service Worker');
      return reg.update();
    }).then(function (reg) {
      if (reg && reg.waiting) {
        // 已经有新版本在等着 —— 装好后由下面这句提示用户点一下
        showUpdateReady(reg);
        return;
      }
      return navigator.serviceWorker.getRegistration().then(function (r) {
        setStatus(r && r.active ? '已经是最新版本' : '检查完成，没有新版本');
      });
    }).catch(function (e) {
      setStatus('检查失败：' + (e.message || e));
    }).then(function () {
      if (els.checkUpdateBtn) {
        els.checkUpdateBtn.disabled = false;
        els.checkUpdateBtn.textContent = '检查更新';
      }
    });
  }

  /* 新版本已装好，等用户确认才刷新 —— 不自动刷，避免打断正在说的话 */
  function showUpdateReady(reg) {
    setStatus('有新版本，点「检查更新」旁的按钮刷新');
    if (!els.updateBar) return;
    els.updateBar.hidden = false;
    var btn = els.updateBar.querySelector('button');
    if (btn) {
      btn.textContent = '新版本已就绪，点此刷新';
      btn.onclick = function () {
        if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
        location.reload();
      };
    }
  }

  function boot() {
    bind();
    showPage(routePage(), false);
    refreshMic();
    renderList();
    registerSW();
    if (els.appVersion) els.appVersion.textContent = APP_VERSION;
    Store.getAll().then(function (recs) {
      state.records = recs || [];
      renderList();
    }).catch(function (e) {
      setStatus('本地数据加载失败：' + (e.message || e));
    });
  }

  boot();
})();
