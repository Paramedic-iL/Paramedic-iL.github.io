(function () {
  const lesson = window.LESSON;
  if (!lesson) {
    document.body.innerHTML = '<p style="padding:2rem;color:#c00;">Lesson data missing.</p>';
    return;
  }

  document.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  document.addEventListener('selectstart', function (e) {
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    e.preventDefault();
  });
  document.addEventListener('dragstart', function (e) { e.preventDefault(); });
  let score = 0;
  const questionScores = {};
  const questionDisplayOptionIds = {};

  function mediaUrl(path) {
    if (!path) return '';
    return encodeURI(String(path).replace(/\\/g, '/'));
  }

  function cssBackgroundUrl(path) {
    if (!path) return 'none';
    return 'url("' + mediaUrl(path) + '")';
  }

  function getQuestionDisplayOptions(obj) {
    const all = (obj.options || []).slice();
    if (obj.scrambleAnswers !== true) return all;
    if (!questionDisplayOptionIds[obj.id]) {
      questionDisplayOptionIds[obj.id] = shuffleArray(all).map(o => o.id);
    }
    const ids = questionDisplayOptionIds[obj.id];
    return ids.map(id => all.find(o => o.id === id)).filter(Boolean);
  }

  function resetQuestionInputs(optionEls) {
    optionEls.forEach(i => {
      i.checked = false;
      i.disabled = false;
    });
  }
  let maxLessonScore = 0;
  let currentPageIndex = 0;
  let currentObjectEls = new Map();
  const timerStates = new Map();
  const timerDisplays = new Map();
  let timerLoopId = null;

  const stage = document.getElementById('stage');
  const stageWrap = document.getElementById('stage-wrap');

  document.title = lesson.title || 'Lesson';
  stage.style.width = lesson.canvasWidth + 'px';
  stage.style.height = lesson.canvasHeight + 'px';

  let fullscreenAttempted = false;
  function requestFullscreenMode() {
    if (fullscreenAttempted) return;
    const root = document.documentElement;
    const req = root.requestFullscreen || root.webkitRequestFullscreen;
    if (!req) return;
    fullscreenAttempted = true;
    Promise.resolve(req.call(root)).catch(() => { fullscreenAttempted = false; });
  }

  function fitStageToViewport() {
    const ww = stageWrap.clientWidth;
    const wh = stageWrap.clientHeight;
    const cw = lesson.canvasWidth;
    const ch = lesson.canvasHeight;
    if (ww < 1 || wh < 1 || cw < 1 || ch < 1) return;
    const scale = Math.min(ww / cw, wh / ch);
    stage.style.transform = 'scale(' + scale + ')';
  }

  window.addEventListener('resize', fitStageToViewport);
  document.addEventListener('pointerdown', requestFullscreenMode, { once: true });
  requestFullscreenMode();

  function goToPage(index) {
    if (index < 0 || index >= lesson.pages.length) return;
    currentPageIndex = index;
    renderPage();
    fitStageToViewport();
  }

  function endLesson() {
    window.close();
    setTimeout(() => {
      document.body.innerHTML = '<div class="lesson-ended">Lesson ended. You may close this tab.</div>';
    }, 250);
  }

  function applyAction(objId, action) {
    switch (action) {
      case 'show': {
        const el = currentObjectEls.get(objId);
        if (el) setVisible(el, true);
        break;
      }
      case 'hide': {
        const el = currentObjectEls.get(objId);
        if (el) setVisible(el, false);
        break;
      }
      case 'nextSlide':
        goToPage(currentPageIndex + 1);
        break;
      case 'previousSlide':
        goToPage(currentPageIndex - 1);
        break;
      case 'endLesson':
        endLesson();
        break;
    }
  }

  function applyCondition(cond, ownerObjId) {
    if (cond.action === 'stopTimer') {
      if (cond.sourceObjectId) stopTimer(cond.sourceObjectId);
      return;
    }
    if (cond.action === 'startTimer') {
      if (cond.sourceObjectId) startTimer(cond.sourceObjectId);
      return;
    }
    if (cond.action === 'resetTimer') {
      if (cond.sourceObjectId) resetTimer(cond.sourceObjectId);
      return;
    }
    if (cond.action === 'go') {
      if (cond.sourceObjectId) runMultipleActions(cond.sourceObjectId);
      return;
    }
    if (cond.action === 'playMedia') {
      if (cond.sourceObjectId) playMedia(cond.sourceObjectId);
      return;
    }
    if (cond.action === 'animate') {
      if (cond.targetObjectId) animateObject(cond.targetObjectId);
      return;
    }
    if (cond.action === 'show' || cond.action === 'hide') {
      applyAction(cond.targetObjectId || ownerObjId, cond.action);
      return;
    }
    applyAction(ownerObjId, cond.action);
  }

  function findLessonObject(id) {
    for (const page of lesson.pages) {
      const obj = (page.objects || []).find(o => o.id === id);
      if (obj) return obj;
    }
    return null;
  }

  function playMedia(objectId) {
    const el = currentObjectEls.get(objectId);
    if (!el) return;
    const media = el.querySelector('video, audio');
    if (media) Promise.resolve(media.play()).catch(() => {});
  }

  function animateObject(objectId) {
    animateAlongRoute(objectId);
    animateFade(objectId, 'appear');
    animateFade(objectId, 'disappear');
    animateRotate(objectId);
  }

  function animateAlongRoute(objectId) {
    const obj = findLessonObject(objectId);
    if (!obj || !obj.animRoutePoints || obj.animRoutePoints.length < 2) return;
    const el = currentObjectEls.get(objectId);
    if (!el) return;

    const points = obj.animRoutePoints;
    const durationMs = Math.max(100, (obj.animRouteDurationSeconds || 2) * 1000);
    const repeat = !!obj.animRouteRepeat;
    const repeatMode = obj.animRouteRepeatMode || 'fromStart';
    const segments = [];
    let totalLen = 0;
    for (let i = 1; i < points.length; i++) {
      const dx = points[i].x - points[i - 1].x;
      const dy = points[i].y - points[i - 1].y;
      const len = Math.hypot(dx, dy);
      segments.push({ len, from: points[i - 1], to: points[i] });
      totalLen += len;
    }
    if (totalLen <= 0) return;

    function pointAt(dist) {
      let d = dist;
      for (const seg of segments) {
        if (d <= seg.len) {
          const t = seg.len > 0 ? d / seg.len : 0;
          return {
            x: seg.from.x + (seg.to.x - seg.from.x) * t,
            y: seg.from.y + (seg.to.y - seg.from.y) * t
          };
        }
        d -= seg.len;
      }
      return points[points.length - 1];
    }

    function distanceAtElapsed(elapsedMs) {
      if (!repeat) {
        const t = Math.min(1, elapsedMs / durationMs);
        return t * totalLen;
      }
      if (repeatMode === 'pingPong') {
        const period = durationMs * 2;
        const phase = (elapsedMs % period) / period;
        const t = phase <= 0.5 ? phase * 2 : (1 - phase) * 2;
        return t * totalLen;
      }
      const t = (elapsedMs % durationMs) / durationMs;
      return t * totalLen;
    }

    const w = obj.width || 0;
    const h = obj.height || 0;
    const start = performance.now();

    function frame(now) {
      const elapsed = now - start;
      const pos = pointAt(distanceAtElapsed(elapsed));
      el.style.left = (pos.x - w / 2) + 'px';
      el.style.top = (pos.y - h / 2) + 'px';
      if (!repeat && elapsed >= durationMs) return;
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  function animateFade(objectId, mode) {
    const obj = findLessonObject(objectId);
    if (!obj) return;
    const el = currentObjectEls.get(objectId);
    if (!el) return;

    const isAppear = mode === 'appear';
    const enabled = isAppear ? !!obj.animAppearEnabled : !!obj.animDisappearEnabled;
    if (!enabled) return;

    const durationSec = isAppear
      ? (obj.animAppearDurationSeconds || 1)
      : (obj.animDisappearDurationSeconds || 1);
    const durationMs = Math.max(100, durationSec * 1000);
    const repeat = isAppear ? !!obj.animAppearRepeat : !!obj.animDisappearRepeat;
    const repeatMode = isAppear
      ? (obj.animAppearRepeatMode || 'fromStart')
      : (obj.animDisappearRepeatMode || 'fromStart');
    const pingPong = repeat && repeatMode === 'pingPong';

    const animOptions = {
      duration: durationMs,
      iterations: repeat ? Infinity : 1,
      fill: 'forwards',
      easing: 'ease'
    };
    if (pingPong)
      animOptions.direction = 'alternate';

    setVisible(el, true);
    if (isAppear) {
      el.style.opacity = '0';
      el.animate(
        [{ opacity: 0 }, { opacity: 1 }],
        animOptions
      );
    } else {
      el.style.opacity = '1';
      el.animate(
        [{ opacity: 1 }, { opacity: 0 }],
        animOptions
      );
    }
  }

  function animateRotate(objectId) {
    const obj = findLessonObject(objectId);
    if (!obj || !obj.animRotateEnabled) return;
    const el = currentObjectEls.get(objectId);
    if (!el) return;

    function toNum(v, fallback) {
      const n = Number(v);
      return Number.isFinite(n) ? n : fallback;
    }
    function boundsCenter(points) {
      if (!points || points.length === 0) return null;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      points.forEach(p => {
        const px = toNum(p && p.x, NaN);
        const py = toNum(p && p.y, NaN);
        if (!Number.isFinite(px) || !Number.isFinite(py)) return;
        if (px < minX) minX = px;
        if (py < minY) minY = py;
        if (px > maxX) maxX = px;
        if (py > maxY) maxY = py;
      });
      if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY))
        return null;
      return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
    }
    function objectCenter(o) {
      if (o.type === 'line') {
        const x1 = toNum(o.lineX1, 0);
        const y1 = toNum(o.lineY1, 0);
        const x2 = toNum(o.lineX2, x1);
        const y2 = toNum(o.lineY2, y1);
        return { x: (x1 + x2) / 2, y: (y1 + y2) / 2 };
      }
      if (o.type === 'brokenLine')
        return boundsCenter(o.brokenLinePoints) || { x: toNum(o.x, 0) + toNum(o.width, 0) / 2, y: toNum(o.y, 0) + toNum(o.height, 0) / 2 };
      if (o.type === 'freeform')
        return boundsCenter(o.freeformPoints || o.polygonPoints) || { x: toNum(o.x, 0) + toNum(o.width, 0) / 2, y: toNum(o.y, 0) + toNum(o.height, 0) / 2 };
      return { x: toNum(o.x, 0) + toNum(o.width, 0) / 2, y: toNum(o.y, 0) + toNum(o.height, 0) / 2 };
    }

    const durationMs = Math.max(100, toNum(obj.animRotateDurationSeconds, 2) * 1000);
    const repeat = !!obj.animRotateRepeat;
    const repeatMode = obj.animRotateRepeatMode || 'fromStart';
    const clockwise = (obj.animRotateDirection || 'clockwise') !== 'counterClockwise';
    const base = toNum(obj.rotationDegrees, 0);
    const delta = clockwise ? 360 : -360;

    let origin = '50% 50%';
    if (obj.type === 'line' || obj.type === 'brokenLine' || obj.type === 'freeform') {
      const c = objectCenter(obj);
      origin = c.x + 'px ' + c.y + 'px';
    }
    el.style.transformOrigin = origin;
    el.style.transform = 'rotate(' + base + 'deg)';

    const animOptions = {
      duration: durationMs,
      iterations: repeat ? Infinity : 1,
      fill: 'forwards',
      easing: 'linear'
    };
    if (repeat && repeatMode === 'pingPong')
      animOptions.direction = 'alternate';

    try {
      el.animate(
        [
          { transform: 'rotate(' + base + 'deg)' },
          { transform: 'rotate(' + (base + delta) + 'deg)' }
        ],
        animOptions
      );
    } catch (_) {
      // Skip invalid rotate animation values without breaking other animations.
    }
  }

  function executeActionStep(step) {
    const action = step.action;
    const targetId = step.targetObjectId;
    switch (action) {
      case 'show':
      case 'hide':
        if (targetId) applyAction(targetId, action);
        break;
      case 'playMedia':
        if (targetId) playMedia(targetId);
        break;
      case 'stopTimer':
        if (targetId) stopTimer(targetId);
        break;
      case 'startTimer':
        if (targetId) startTimer(targetId);
        break;
      case 'resetTimer':
        if (targetId) resetTimer(targetId);
        break;
      case 'nextSlide':
        goToPage(currentPageIndex + 1);
        break;
      case 'previousSlide':
        goToPage(currentPageIndex - 1);
        break;
      case 'endLesson':
        endLesson();
        break;
    }
  }

  function runMultipleActions(multiActionId) {
    const obj = findLessonObject(multiActionId);
    if (!obj || obj.type !== 'multipleActions') return;
    (obj.actionSteps || []).forEach(step => executeActionStep(step));
  }

  function timerKeyForObject(obj) {
    if (obj.timerLinkId && String(obj.timerLinkId).length > 0) return obj.timerLinkId;
    return obj.id;
  }

  function timerKeyForId(objectId) {
    const obj = findLessonObject(objectId);
    return obj ? timerKeyForObject(obj) : objectId;
  }

  function timerTotalMs(obj) {
    const h = obj.timerCountdownHours || 0;
    const m = obj.timerCountdownMinutes || 0;
    const s = obj.timerCountdownSeconds || 0;
    return ((h * 3600) + (m * 60) + s) * 1000;
  }

  function pad2(n) { return String(n).padStart(2, '0'); }

  function formatTimerTime(displayMs, format) {
    const totalSeconds = Math.floor(displayMs / 1000);
    const ms = displayMs % 1000;
    const seconds = totalSeconds % 60;
    const totalMinutes = Math.floor(totalSeconds / 60);
    const minutes = totalMinutes % 60;
    const hours = Math.floor(totalMinutes / 60);
    if (format === 'hhMm') return pad2(hours) + ':' + pad2(minutes);
    if (format === 'mmSsMs') return pad2(totalMinutes) + ':' + pad2(seconds) + ':' + pad2(Math.floor(ms / 10));
    return pad2(totalMinutes) + ':' + pad2(seconds);
  }

  function getTimerElapsed(state) {
    return state.running
      ? state.offsetMs + (Date.now() - state.startedAt)
      : state.offsetMs;
  }

  function getTimerDisplayMs(state) {
    const elapsed = getTimerElapsed(state);
    if (state.mode === 'countDown') return Math.max(0, state.totalMs - elapsed);
    return elapsed;
  }

  function createPausedTimerState(obj, pageIndex) {
    return {
      running: false,
      mode: obj.timerMode || 'countUp',
      format: obj.timerDisplayFormat || 'mmSs',
      lessonScope: obj.timerForWholeLesson === true,
      homePageIndex: pageIndex,
      totalMs: timerTotalMs(obj),
      startedAt: 0,
      offsetMs: 0,
      zeroFired: false,
      endFired: false
    };
  }

  function ensureTimerRegistered(obj, pageIndex) {
    const key = timerKeyForObject(obj);
    if (!timerStates.has(key))
      timerStates.set(key, createPausedTimerState(obj, pageIndex));
  }

  function preparePageTimers(page, pageIndex) {
    timerStates.forEach((state, key) => {
      if (!state.lessonScope && state.homePageIndex !== pageIndex && state.running)
        stopTimerKey(key);
    });

    (page.objects || []).filter(o => o.type === 'timer').forEach(obj => {
      const key = timerKeyForObject(obj);
      if (obj.timerForWholeLesson)
        ensureTimerRegistered(obj, pageIndex);
      else
        timerStates.set(key, createPausedTimerState(obj, pageIndex));
    });
  }

  function initLessonTimers() {
    lesson.pages.forEach((page, pageIndex) => {
      (page.objects || []).filter(o => o.type === 'timer' && o.timerForWholeLesson).forEach(obj => {
        ensureTimerRegistered(obj, pageIndex);
      });
    });
  }

  function updateTimerDisplaysForKey(key) {
    const state = timerStates.get(key);
    if (!state) return;
    lesson.pages.forEach(page => {
      (page.objects || []).forEach(obj => {
        if (obj.type !== 'timer' || timerKeyForObject(obj) !== key) return;
        const node = timerDisplays.get(obj.id);
        if (node) node.textContent = formatTimerTime(getTimerDisplayMs(state), state.format);
      });
    });
  }

  function stopTimerKey(key) {
    const state = timerStates.get(key);
    if (!state || !state.running) return;
    state.offsetMs = getTimerElapsed(state);
    state.running = false;
    updateTimerDisplaysForKey(key);
    maybeStopTimerLoop();
  }

  function stopTimer(timerId) {
    stopTimerKey(timerKeyForId(timerId));
  }

  function startTimer(timerId) {
    const obj = findLessonObject(timerId);
    if (!obj || obj.type !== 'timer') return;
    const key = timerKeyForObject(obj);
    let state = timerStates.get(key);
    if (!state) {
      const pageIndex = lesson.pages.findIndex(p => (p.objects || []).some(o => o.id === timerId));
      state = createPausedTimerState(obj, Math.max(0, pageIndex));
      timerStates.set(key, state);
    }
    if (state.running) return;
    if (state.mode === 'countDown' && state.zeroFired) {
      state.offsetMs = 0;
      state.zeroFired = false;
    }
    if (state.mode === 'countUp' && state.endFired) {
      state.offsetMs = 0;
      state.endFired = false;
    }
    state.startedAt = Date.now();
    state.running = true;
    updateTimerDisplaysForKey(key);
    ensureTimerLoop();
  }

  function resetTimer(timerId) {
    const obj = findLessonObject(timerId);
    if (!obj || obj.type !== 'timer') return;
    const key = timerKeyForObject(obj);
    let state = timerStates.get(key);
    if (!state) {
      const pageIndex = lesson.pages.findIndex(p => (p.objects || []).some(o => o.id === timerId));
      state = createPausedTimerState(obj, Math.max(0, pageIndex));
      timerStates.set(key, state);
      updateTimerDisplaysForKey(key);
      return;
    }
    const wasRunning = state.running;
    state.offsetMs = 0;
    state.zeroFired = false;
    state.endFired = false;
    if (wasRunning) {
      state.startedAt = Date.now();
      state.running = true;
      ensureTimerLoop();
    } else {
      state.running = false;
    }
    updateTimerDisplaysForKey(key);
  }

  function fireTimerEndEvents(timerKey, state) {
    lesson.pages.forEach(page => {
      (page.objects || []).forEach(obj => {
        (obj.conditions || []).forEach(cond => {
          if (!cond.sourceObjectId) return;
          if (timerKeyForId(cond.sourceObjectId) !== timerKey) return;
          if (state.mode === 'countDown' && cond.trigger === 'whenCountdownReachesZero')
            applyCondition(cond, obj.id);
          if (state.mode === 'countUp' && cond.trigger === 'whenTimerReachesEnd')
            applyCondition(cond, obj.id);
        });
      });
    });
  }

  function updateTimerDisplay(timerId) {
    updateTimerDisplaysForKey(timerKeyForId(timerId));
  }

  function updateAllTimerDisplays() {
    timerStates.forEach((_, key) => updateTimerDisplaysForKey(key));
  }

  function tickTimers() {
    timerStates.forEach((state, key) => {
      if (!state.running) return;
      updateTimerDisplaysForKey(key);
      const elapsed = getTimerElapsed(state);
      if (state.mode === 'countDown') {
        if (elapsed >= state.totalMs && !state.zeroFired) {
          state.zeroFired = true;
          state.running = false;
          state.offsetMs = state.totalMs;
          updateTimerDisplaysForKey(key);
          fireTimerEndEvents(key, state);
          maybeStopTimerLoop();
        }
      } else if (state.totalMs > 0 && elapsed >= state.totalMs && !state.endFired) {
        state.endFired = true;
        state.running = false;
        state.offsetMs = state.totalMs;
        updateTimerDisplaysForKey(key);
        fireTimerEndEvents(key, state);
        maybeStopTimerLoop();
      }
    });
  }

  function ensureTimerLoop() {
    if (timerLoopId != null) return;
    timerLoopId = setInterval(tickTimers, 100);
  }

  function maybeStopTimerLoop() {
    const anyRunning = Array.from(timerStates.values()).some(s => s.running);
    if (!anyRunning && timerLoopId != null) {
      clearInterval(timerLoopId);
      timerLoopId = null;
    }
  }

  function computeLessonMaxScore() {
    let max = 0;
    lesson.pages.forEach(page => {
      (page.objects || []).forEach(obj => {
        if (obj.type === 'question' && obj.includeInTotalScore !== false)
          max += obj.points || 0;
      });
    });
    return max;
  }

  function scorePercent(earned) {
    if (maxLessonScore <= 0) return 0;
    return Math.round((earned / maxLessonScore) * 100);
  }

  function feedbackForPercent(percent, bands) {
    for (const band of bands) {
      if (percent >= band.minPercent && percent <= band.maxPercent)
        return band.message || '';
    }
    return '';
  }

  function formatScoreValue(label, mode, earned) {
    const trimmed = (label || 'Score').trim();
    if (mode === 'outOfHundred') {
      const pct = scorePercent(earned);
      return trimmed + ' ' + pct + '/100';
    }
    return trimmed + ' ' + earned;
  }

  function updateScoreDisplays() {
    const answered = Object.keys(questionScores).length > 0;
    document.querySelectorAll('[data-type="scoreDisplay"]').forEach(el => {
      const label = el.dataset.label || 'Score';
      const mode = el.dataset.mode || 'pointsTotal';
      let bands = [];
      try { bands = JSON.parse(el.dataset.bands || '[]'); } catch (_) { bands = []; }
      const valueEl = el.querySelector('.lesson-score-value');
      const feedbackEl = el.querySelector('.lesson-score-feedback');
      if (valueEl) valueEl.textContent = formatScoreValue(label, mode, score);
      if (feedbackEl) {
        if (answered && maxLessonScore > 0) {
          feedbackEl.textContent = feedbackForPercent(scorePercent(score), bands);
          feedbackEl.style.display = '';
        } else {
          feedbackEl.textContent = '';
          feedbackEl.style.display = 'none';
        }
      }
    });
  }

  function setVisible(el, visible) {
    el.classList.toggle('hidden', !visible);
  }

  function initVisibility(page, objectEls) {
    currentObjectEls = objectEls;

    page.objects.forEach(obj => {
      const el = objectEls.get(obj.id);
      if (!el) return;
      const hidden = obj.startHidden === true;
      setVisible(el, !hidden);
    });

    page.objects.forEach(obj => {
      const el = objectEls.get(obj.id);
      if (!el) return;
      const conds = obj.conditions || [];

      conds.filter(c => c.trigger === 'onPageLoad').forEach(c => applyCondition(c, obj.id));

      conds.filter(c => c.trigger === 'afterDelay').forEach(cond => {
        const ms = Math.max(0, (cond.delaySeconds || 0) * 1000);
        setTimeout(() => applyCondition(cond, obj.id), ms);
      });

      const hasOnClick = conds.some(c => c.trigger === 'onClick');
      const isClickSource = page.objects.some(o =>
        (o.conditions || []).some(c =>
          c.trigger === 'whenObjectClicked'
          && (c.sourceObjectId === obj.id || (!c.sourceObjectId && o.id === obj.id))));
      if (hasOnClick || isClickSource || obj.type === 'text') {
        el.classList.add('clickable');
        el.style.cursor = 'pointer';
      }

      if (hasOnClick) {
        el.addEventListener('click', e => {
          if (obj.type === 'question') return;
          e.stopPropagation();
          conds.filter(c => c.trigger === 'onClick').forEach(c => applyCondition(c, obj.id));
        });
      }

      conds.filter(c => c.trigger === 'whenObjectClicked').forEach(cond => {
        const srcId = cond.sourceObjectId || obj.id;
        const src = objectEls.get(srcId);
        if (!src) return;
        src.classList.add('clickable');
        src.style.cursor = 'pointer';
        src.addEventListener('click', e => {
          e.stopPropagation();
          applyCondition(cond, obj.id);
        });
      });
    });
  }

  function collectAnswerFeedbackMessages(obj, selectedIds) {
    if (obj.showFeedback === false) return [];
    const messages = [];
    selectedIds.forEach(id => {
      const opt = (obj.options || []).find(o => o.id === id);
      const fb = ((opt && opt.answerFeedback) || '').trim();
      if (fb) messages.push(fb);
    });
    return messages;
  }

  function setupPromptMediaPlayback(wrap, obj) {
    const kind = (obj.questionPromptKind || 'text').toLowerCase();
    if (kind !== 'video' && kind !== 'audio') return;
    const media = wrap.querySelector('.q-prompt video, .q-prompt audio');
    if (!media) return;
    if (obj.questionPromptStartWhenVisible === false) return;

    const lessonObj = wrap.closest('.lesson-obj') || wrap;
    const tryPlay = () => {
      if (lessonObj.classList.contains('hidden')) return;
      media.play().catch(() => {});
    };
    const pauseMedia = () => { media.pause(); };

    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) tryPlay();
        else pauseMedia();
      });
    }, { threshold: 0.2 });
    observer.observe(lessonObj);
  }

  function gradeQuestion(obj, selectedIds) {
    const correctIds = (obj.options || []).filter(o => o.isCorrect).map(o => o.id);
    const points = obj.points || 0;
    if (obj.questionMode === 'singleChoice') {
      const ok = selectedIds.length === 1 && correctIds.includes(selectedIds[0]);
      return { earned: ok ? points : 0, max: points, fullyCorrect: ok };
    }
    const selected = new Set(selectedIds);
    const correct = new Set(correctIds);
    let wrong = 0;
    selected.forEach(id => { if (!correct.has(id)) wrong++; });
    let correctCount = 0;
    correct.forEach(id => { if (selected.has(id)) correctCount++; });
    const allCorrect = correctCount === correct.size && wrong === 0 && selected.size === correct.size;
    if (allCorrect) return { earned: points, max: points, fullyCorrect: true };
    if (wrong > 0) return { earned: 0, max: points, fullyCorrect: false };
    const partial = correct.size > 0 ? Math.round((correctCount / correct.size) * points) : 0;
    return { earned: partial, max: points, fullyCorrect: false };
  }

  function shuffleArray(items) {
    const copy = items.slice();
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = copy[i];
      copy[i] = copy[j];
      copy[j] = tmp;
    }
    return copy;
  }

  function fireQuestionAnswerConditions(obj, selectedIds, result) {
    const conds = obj.conditions || [];
    const correctIds = new Set((obj.options || []).filter(o => o.isCorrect).map(o => o.id));
    if (result.fullyCorrect) {
      conds.filter(c => c.trigger === 'onCorrectAnswer').forEach(c => applyCondition(c, obj.id));
      return;
    }
    if (obj.questionMode === 'singleChoice' && selectedIds.length === 1) {
      const selId = selectedIds[0];
      if (!correctIds.has(selId)) {
        conds.filter(c => c.trigger === 'onIncorrectAnswer' && c.sourceObjectId === selId)
          .forEach(c => applyCondition(c, obj.id));
      }
      return;
    }
    selectedIds.forEach(selId => {
      if (!correctIds.has(selId)) {
        conds.filter(c => c.trigger === 'onIncorrectAnswer' && c.sourceObjectId === selId)
          .forEach(c => applyCondition(c, obj.id));
      }
    });
  }

  const DEFAULT_FILL = '#0078FF';
  const DEFAULT_STROKE = '#000000';
  const DEFAULT_TEXT = '#000000';
  const DEFAULT_STROKE_WIDTH = 1;
  const PLACEHOLDER_TEXT = 'Write text here';

  function shouldShowLabel(obj) {
    const t = (obj.text || '').trim();
    if (!t) return false;
    return t.toLowerCase() !== PLACEHOLDER_TEXT.toLowerCase();
  }

  function labelDisplayText(obj) {
    return shouldShowLabel(obj) ? (obj.text || '') : '';
  }

  function pointsCenter(points) {
    if (!points || points.length === 0) return { x: 0, y: 0 };
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    points.forEach(p => {
      const x = p.x != null ? p.x : 0;
      const y = p.y != null ? p.y : 0;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    });
    return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
  }

  function createLabelTextEl(obj) {
    const span = document.createElement('span');
    span.className = 'shape-label-text';
    span.textContent = labelDisplayText(obj);
    applyTextStyle(span, obj);
    return span;
  }

  function appendCenteredShapeLabel(container, obj) {
    if (!shouldShowLabel(obj)) return;
    const label = document.createElement('div');
    label.className = 'shape-label shape-label--centered';
    const txt = createLabelTextEl(obj);
    // Span the full shape width so left/center/right alignment is visible.
    txt.style.width = '100%';
    label.appendChild(txt);
    container.appendChild(label);
  }

  function appendPointCenteredLabel(container, obj, points) {
    if (!shouldShowLabel(obj) || !points || points.length === 0) return;
    const c = pointsCenter(points);
    const label = document.createElement('div');
    label.className = 'shape-label shape-label--point';
    label.style.left = c.x + 'px';
    label.style.top = c.y + 'px';
    if (obj.rotationDegrees != null && obj.rotationDegrees !== 0)
      label.style.transform = 'translate(-50%, -50%) rotate(' + obj.rotationDegrees + 'deg)';
    label.appendChild(createLabelTextEl(obj));
    container.appendChild(label);
  }

  function appendLineLabel(container, obj) {
    if (!shouldShowLabel(obj)) return;
    const x1 = obj.lineX1 != null ? obj.lineX1 : 0;
    const y1 = obj.lineY1 != null ? obj.lineY1 : 0;
    const x2 = obj.lineX2 != null ? obj.lineX2 : 0;
    const y2 = obj.lineY2 != null ? obj.lineY2 : 0;
    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;
    const angle = Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI;
    const label = document.createElement('div');
    label.className = 'shape-label shape-label--line';
    label.style.left = midX + 'px';
    label.style.top = midY + 'px';
    label.style.transform = 'translate(-50%, -50%) rotate(' + angle + 'deg)';
    const fill = obj.fillColor;
    if (fill && fill !== 'transparent' && fill !== 'none')
      label.style.backgroundColor = fill;
    label.appendChild(createLabelTextEl(obj));
    container.appendChild(label);
  }

  function shapeStroke(obj) {
    return obj.strokeColor || DEFAULT_STROKE;
  }
  function shapeFill(obj) {
    const c = obj.fillColor;
    if (!c || c === 'transparent' || c === 'none') return 'none';
    return c;
  }
  function shapeStrokeWidth(obj) {
    return obj.strokeWidth != null ? obj.strokeWidth : DEFAULT_STROKE_WIDTH;
  }

  function applyShapeRotation(svg, obj) {
    const rot = obj.rotationDegrees;
    if (rot == null || rot === 0) return;
    const cx = (obj.x != null ? obj.x : 0) + (obj.width != null ? obj.width : 0) / 2;
    const cy = (obj.y != null ? obj.y : 0) + (obj.height != null ? obj.height : 0) / 2;
    svg.setAttribute('transform', 'rotate(' + rot + ' ' + cx + ' ' + cy + ')');
  }

  function buildShapeSvg(obj) {
    const fill = shapeFill(obj);
    const stroke = shapeStroke(obj);
    const sw = shapeStrokeWidth(obj);
    const w = obj.width != null && obj.width > 0 ? obj.width : 100;
    const h = obj.height != null && obj.height > 0 ? obj.height : 100;
    const inset = sw > 0 ? sw / 2 : 0;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');
    svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
    svg.setAttribute('preserveAspectRatio', 'none');
    if (obj.type === 'rectangle') {
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('x', String(inset)); rect.setAttribute('y', String(inset));
      rect.setAttribute('width', String(Math.max(0, w - sw)));
      rect.setAttribute('height', String(Math.max(0, h - sw)));
      rect.setAttribute('fill', fill);
      rect.setAttribute('stroke', stroke);
      rect.setAttribute('stroke-width', String(sw));
      svg.appendChild(rect);
    } else if (obj.type === 'circle') {
      const ell = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse');
      ell.setAttribute('cx', String(w / 2)); ell.setAttribute('cy', String(h / 2));
      ell.setAttribute('rx', String(Math.max(0, w / 2 - inset)));
      ell.setAttribute('ry', String(Math.max(0, h / 2 - inset)));
      ell.setAttribute('fill', fill);
      ell.setAttribute('stroke', stroke);
      ell.setAttribute('stroke-width', String(sw));
      svg.appendChild(ell);
    } else if (obj.type === 'diamond') {
      const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
      poly.setAttribute('points', (w / 2) + ',' + inset + ' ' + (w - inset) + ',' + (h / 2) + ' ' + (w / 2) + ',' + (h - inset) + ' ' + inset + ',' + (h / 2));
      poly.setAttribute('fill', fill);
      poly.setAttribute('stroke', stroke);
      poly.setAttribute('stroke-width', String(sw));
      svg.appendChild(poly);
    } else if (obj.type === 'roundedRectangle') {
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('x', String(inset)); rect.setAttribute('y', String(inset));
      rect.setAttribute('width', String(Math.max(0, w - sw)));
      rect.setAttribute('height', String(Math.max(0, h - sw)));
      const rx = obj.cornerRadius != null ? obj.cornerRadius : 0;
      const ry = obj.cornerRadius != null ? obj.cornerRadius : 0;
      rect.setAttribute('rx', String(rx));
      rect.setAttribute('ry', String(ry));
      rect.setAttribute('fill', fill);
      rect.setAttribute('stroke', stroke);
      rect.setAttribute('stroke-width', String(sw));
      svg.appendChild(rect);
    }
    return svg;
  }

  function buildBrokenLineSvg(obj, cw, ch) {
    const pts = obj.brokenLinePoints && obj.brokenLinePoints.length > 1 ? obj.brokenLinePoints : [];
    if (pts.length < 2) return null;
    const stroke = shapeStroke(obj);
    const sw = shapeStrokeWidth(obj);
    const points = pts.map(p => p.x + ',' + p.y).join(' ');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');
    svg.setAttribute('viewBox', '0 0 ' + cw + ' ' + ch);
    const pl = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    pl.setAttribute('points', points);
    pl.setAttribute('fill', 'none');
    pl.setAttribute('stroke', stroke);
    pl.setAttribute('stroke-width', String(sw));
    pl.setAttribute('stroke-linecap', 'round');
    pl.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(pl);
    const a = pts[0], b = pts[1], y = pts[pts.length - 1], z = pts[pts.length - 2];
    appendArrowMarker(svg, obj.beginArrowType, { x: a.x, y: a.y }, { x: b.x, y: b.y }, sw, stroke);
    appendArrowMarker(svg, obj.endArrowType, { x: y.x, y: y.y }, { x: z.x, y: z.y }, sw, stroke);
    return svg;
  }

  function buildFreeformSvg(obj, cw, ch) {
    const pts = (obj.freeformPoints && obj.freeformPoints.length > 1)
      ? obj.freeformPoints
      : (obj.polygonPoints && obj.polygonPoints.length > 1 ? obj.polygonPoints : []);
    if (pts.length < 2) return null;
    const closed = obj.freeformClosed !== false;
    const fill = closed ? shapeFill(obj) : 'none';
    const stroke = shapeStroke(obj);
    const sw = shapeStrokeWidth(obj);
    const points = pts.map(p => p.x + ',' + p.y).join(' ');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');
    svg.setAttribute('viewBox', '0 0 ' + cw + ' ' + ch);
    if (closed && pts.length >= 3) {
      const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
      poly.setAttribute('points', points);
      poly.setAttribute('fill', fill);
      poly.setAttribute('stroke', stroke);
      poly.setAttribute('stroke-width', String(sw));
      poly.setAttribute('stroke-linejoin', 'round');
      svg.appendChild(poly);
    } else {
      const pl = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
      pl.setAttribute('points', points);
      pl.setAttribute('fill', 'none');
      pl.setAttribute('stroke', stroke);
      pl.setAttribute('stroke-width', String(sw));
      pl.setAttribute('stroke-linecap', 'round');
      pl.setAttribute('stroke-linejoin', 'round');
      svg.appendChild(pl);
    }
    return svg;
  }

  function arrowMarkerSize(sw) {
    return Math.max(11, Math.max(1, sw) * 3.2);
  }

  function appendArrowMarker(svg, type, tip, from, sw, color) {
    if (!type || type === 'none') return;
    const NS = 'http://www.w3.org/2000/svg';
    const size = arrowMarkerSize(sw);
    let dx = tip.x - from.x, dy = tip.y - from.y;
    const len = Math.hypot(dx, dy);
    const ux = len > 0.0001 ? dx / len : 1, uy = len > 0.0001 ? dy / len : 0;
    const px = -uy, py = ux;
    if (type === 'arrow') {
      const back = size, half = size * 0.6;
      const bx = tip.x - ux * back, by = tip.y - uy * back;
      const p = document.createElementNS(NS, 'polygon');
      p.setAttribute('points',
        tip.x + ',' + tip.y + ' ' +
        (bx + px * half) + ',' + (by + py * half) + ' ' +
        (bx - px * half) + ',' + (by - py * half));
      p.setAttribute('fill', color);
      svg.appendChild(p);
    } else if (type === 'circle') {
      const r = size * 0.5;
      const c = document.createElementNS(NS, 'circle');
      c.setAttribute('cx', tip.x);
      c.setAttribute('cy', tip.y);
      c.setAttribute('r', r);
      c.setAttribute('fill', color);
      svg.appendChild(c);
    } else if (type === 'diamond') {
      const r = size * 0.62;
      const p = document.createElementNS(NS, 'polygon');
      p.setAttribute('points',
        (tip.x + ux * r) + ',' + (tip.y + uy * r) + ' ' +
        (tip.x + px * r) + ',' + (tip.y + py * r) + ' ' +
        (tip.x - ux * r) + ',' + (tip.y - uy * r) + ' ' +
        (tip.x - px * r) + ',' + (tip.y - py * r));
      p.setAttribute('fill', color);
      svg.appendChild(p);
    } else if (type === 'square') {
      const h = size * 0.5;
      const p = document.createElementNS(NS, 'polygon');
      p.setAttribute('points',
        (tip.x + ux * h + px * h) + ',' + (tip.y + uy * h + py * h) + ' ' +
        (tip.x + ux * h - px * h) + ',' + (tip.y + uy * h - py * h) + ' ' +
        (tip.x - ux * h - px * h) + ',' + (tip.y - uy * h - py * h) + ' ' +
        (tip.x - ux * h + px * h) + ',' + (tip.y - uy * h + py * h));
      p.setAttribute('fill', color);
      svg.appendChild(p);
    }
  }

  function buildLineSvg(obj, cw, ch) {
    const stroke = shapeStroke(obj);
    const sw = shapeStrokeWidth(obj);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');
    svg.setAttribute('viewBox', '0 0 ' + cw + ' ' + ch);
    const x1 = obj.lineX1 != null ? obj.lineX1 : 0;
    const y1 = obj.lineY1 != null ? obj.lineY1 : 0;
    const x2 = obj.lineX2 != null ? obj.lineX2 : 100;
    const y2 = obj.lineY2 != null ? obj.lineY2 : 0;
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', String(x1));
    line.setAttribute('y1', String(y1));
    line.setAttribute('x2', String(x2));
    line.setAttribute('y2', String(y2));
    line.setAttribute('stroke', stroke);
    line.setAttribute('stroke-width', String(sw));
    line.setAttribute('stroke-linecap', 'round');
    svg.appendChild(line);
    appendArrowMarker(svg, obj.beginArrowType, { x: x1, y: y1 }, { x: x2, y: y2 }, sw, stroke);
    appendArrowMarker(svg, obj.endArrowType, { x: x2, y: y2 }, { x: x1, y: y1 }, sw, stroke);
    return svg;
  }

  function applyTextStyle(el, obj) {
    const size = obj.fontSize != null ? obj.fontSize : 20;
    const family = obj.fontFamily || 'Calibri';
    el.style.fontSize = size + 'px';
    el.style.fontFamily = family.indexOf(' ') >= 0 ? '"' + family + '", sans-serif' : family + ', sans-serif';
    el.style.color = obj.textColor || DEFAULT_TEXT;
    el.style.fontWeight = obj.textBold ? 'bold' : 'normal';
    el.style.fontStyle = obj.textItalic ? 'italic' : 'normal';
    el.style.textDecoration = obj.textUnderline ? 'underline' : 'none';
    if (obj.textShadow) {
      const d = Math.max(2, Math.round(size * 0.06));
      el.style.textShadow = d + 'px ' + d + 'px ' + d + 'px rgba(128,128,128,0.85)';
    } else {
      el.style.textShadow = 'none';
    }
    const align = (obj.textAlign || 'left').toLowerCase();
    el.style.textAlign = align;
    el.style.direction = obj.textDirection === 'rtl' ? 'rtl' : 'ltr';
    el.style.whiteSpace = 'pre-wrap';
    if (obj.textShaded)
      el.style.backgroundColor = obj.textShadeColor || '#E8E8E8';
    else
      el.style.backgroundColor = '';
    if (obj.textSuperscript) {
      el.style.verticalAlign = 'super';
      el.style.fontSize = Math.max(8, size * 0.75) + 'px';
    } else if (obj.textSubscript) {
      el.style.verticalAlign = 'sub';
      el.style.fontSize = Math.max(8, size * 0.75) + 'px';
    }
  }

  function applyTextBoxStyle(el, obj) {
    const fill = obj.fillColor;
    const sw = obj.strokeWidth != null ? Number(obj.strokeWidth) : 0;
    const stroke = obj.strokeColor;
    const hasFill = fill && fill !== 'transparent' && fill !== 'none';
    if (hasFill)
      el.style.backgroundColor = fill;
    else if (!obj.textShaded)
      el.style.backgroundColor = '';

    if (sw > 0 && stroke && stroke !== 'transparent' && stroke !== 'none') {
      el.style.border = sw + 'px solid ' + stroke;
      el.style.boxSizing = 'border-box';
    } else {
      el.style.border = '';
    }
  }

  function mediaAlignClass(align) {
    const a = (align || 'left').toLowerCase();
    if (a === 'center') return 'align-center';
    if (a === 'right') return 'align-right';
    return 'align-left';
  }

  function clampMediaScale(scale) {
    const n = Number(scale);
    if (!Number.isFinite(n)) return 100;
    return Math.max(10, Math.min(100, Math.round(n)));
  }

  function isTwoColumnGridLayout(obj) {
    const layout = String(obj.mediaQuestionOptionsLayout || 'column').toLowerCase();
    return layout === 'twocolumngrid';
  }

  function mediaQuestionInnerWidth(obj) {
    return Math.max(40, (Number(obj.width) || 200) - 16);
  }

  function mediaQuestionInnerHeight(obj) {
    return Math.max(60, (Number(obj.height) || 80) - 16);
  }

  function estimateMediaPromptHeight(obj) {
    if (!obj.isMediaQuestion) return 0;
    if (String(obj.questionPromptKind || 'text').toLowerCase() === 'text')
      return obj.questionPrompt ? 28 : 0;
    return mediaQuestionInnerHeight(obj) * 0.30 + 4;
  }

  function mediaQuestionOptionsAreaHeight(obj) {
    return Math.max(40, mediaQuestionInnerHeight(obj) - estimateMediaPromptHeight(obj) - 36 - 8);
  }

  function mediaQuestionOptionCellSize(obj, optionCount) {
    const areaHeight = mediaQuestionOptionsAreaHeight(obj);
    const innerWidth = mediaQuestionInnerWidth(obj);
    if (isTwoColumnGridLayout(obj)) {
      const rows = Math.max(1, Math.ceil(optionCount / 2));
      const cellHeight = areaHeight / rows;
      const cellWidth = (innerWidth - 6) / 2;
      return {
        w: Math.max(20, cellWidth - 28),
        h: Math.max(20, cellHeight - 4)
      };
    }
    const rowHeight = areaHeight / Math.max(1, optionCount);
    return {
      w: Math.max(20, innerWidth - 28),
      h: Math.max(20, rowHeight - 6)
    };
  }

  function waitForMediaDimensions(el) {
    return new Promise(resolve => {
      if (el.tagName === 'IMG') {
        if (el.complete && el.naturalWidth > 0) { resolve(); return; }
        el.addEventListener('load', () => resolve(), { once: true });
        el.addEventListener('error', () => resolve(), { once: true });
      } else if (el.tagName === 'VIDEO') {
        if (el.videoWidth > 0) { resolve(); return; }
        el.addEventListener('loadedmetadata', () => resolve(), { once: true });
        el.addEventListener('error', () => resolve(), { once: true });
      } else resolve();
    });
  }

  function collectOptionNaturalSizes(obj, mediaEls) {
    const sizes = [];
    (obj.options || []).forEach(opt => {
      const kind = String(opt.contentKind || 'text').toLowerCase();
      if (kind !== 'image' && kind !== 'video') return;
      if (opt.mediaPixelWidth > 0 && opt.mediaPixelHeight > 0) {
        sizes.push({ w: opt.mediaPixelWidth, h: opt.mediaPixelHeight });
      }
    });
    if (sizes.length > 0) return sizes;

    mediaEls.forEach(el => {
      const w = el.naturalWidth || el.videoWidth || 0;
      const h = el.naturalHeight || el.videoHeight || 0;
      if (w > 0 && h > 0) sizes.push({ w: w, h: h });
    });
    return sizes;
  }

  function applyUniformMediaSizes(wrap, obj, mediaEls) {
    if (!mediaEls.length) return false;

    const isGrid = isTwoColumnGridLayout(obj);
    const cell = mediaQuestionOptionCellSize(obj, mediaEls.length);
    const optionsEl = wrap.querySelector('.q-options');

    if (isGrid && optionsEl) {
      const rows = Math.max(1, Math.ceil(mediaEls.length / 2));
      optionsEl.style.gridTemplateRows = 'repeat(' + rows + ', 1fr)';
    }

    let dw = Number(obj.uniformOptionDisplayWidth) || 0;
    let dh = Number(obj.uniformOptionDisplayHeight) || 0;

    if (dw < 1 || dh < 1) {
      const sizes = collectOptionNaturalSizes(obj, mediaEls);
      if (!sizes.length) return false;

      let minW = Infinity, maxW = 0, minH = Infinity, maxH = 0;
      sizes.forEach(s => {
        minW = Math.min(minW, s.w);
        maxW = Math.max(maxW, s.w);
        minH = Math.min(minH, s.h);
        maxH = Math.max(maxH, s.h);
      });
      const avgW = (minW + maxW) / 2;
      const avgH = (minH + maxH) / 2;
      const fit = Math.min(cell.w / avgW, cell.h / avgH);
      dw = avgW * fit;
      dh = avgH * fit;
    }

    mediaEls.forEach(el => {
      el.style.maxWidth = 'none';
      el.style.maxHeight = 'none';
      el.style.objectFit = 'fill';
      el.classList.add('q-media-uniform');
      const mediaWrap = el.parentElement;
      const label = el.closest('label');

      if (isGrid) {
        if (label) {
          label.style.width = '100%';
          label.style.height = '100%';
        }
        if (mediaWrap) {
          mediaWrap.classList.add('q-media-wrap-uniform');
          mediaWrap.style.flex = '1 1 0';
          mediaWrap.style.minWidth = '0';
          mediaWrap.style.minHeight = '0';
          mediaWrap.style.width = '';
          mediaWrap.style.height = '';
        }
        el.style.width = '100%';
        el.style.height = '100%';
      } else {
        el.style.width = dw + 'px';
        el.style.height = dh + 'px';
        if (mediaWrap) {
          mediaWrap.classList.add('q-media-wrap-uniform');
          mediaWrap.style.width = dw + 'px';
          mediaWrap.style.height = dh + 'px';
          mediaWrap.style.flex = '0 0 auto';
        }
      }
    });
    return true;
  }

  function uniformizeMediaQuestionOptions(wrap, obj) {
    const media = [...wrap.querySelectorAll('.q-options .q-media')];
    if (!media.length) return;

    if (applyUniformMediaSizes(wrap, obj, media)) return;

    Promise.all(media.map(waitForMediaDimensions)).then(() => {
      applyUniformMediaSizes(wrap, obj, media);
    });
    media.forEach(el => {
      if (el.tagName === 'IMG') {
        el.addEventListener('load', () => applyUniformMediaSizes(wrap, obj, media), { once: true });
      } else if (el.tagName === 'VIDEO') {
        el.addEventListener('loadedmetadata', () => applyUniformMediaSizes(wrap, obj, media), { once: true });
      }
    });
  }

  function appendQuestionContent(parent, kind, text, mediaPath, obj, align, scalePercent, isOption) {
    const k = (kind || 'text').toLowerCase();
    if (k === 'text' || !mediaPath) {
      const wrap = document.createElement('div');
      wrap.className = 'q-content';
      const span = document.createElement('span');
      span.textContent = text || '';
      applyTextStyle(span, obj);
      wrap.appendChild(span);
      parent.appendChild(wrap);
      return;
    }

    const scale = clampMediaScale(scalePercent);
    if (k === 'image' || k === 'video') {
      const wrap = document.createElement('div');
      wrap.className = 'q-media-wrap ' + mediaAlignClass(align);
      wrap.style.setProperty('--media-scale', scale + '%');
      let mediaEl;
      if (k === 'image') {
        const img = document.createElement('img');
        img.src = mediaUrl(mediaPath);
        img.alt = text || 'Image';
        img.className = 'q-media' + (isOption ? ' q-media-option' : '');
        mediaEl = img;
      } else {
        const vid = document.createElement('video');
        vid.src = mediaUrl(mediaPath);
        vid.controls = true;
        vid.className = 'q-media' + (isOption ? ' q-media-option' : '');
        vid.preload = 'metadata';
        mediaEl = vid;
      }
      if (isOption) mediaEl.style.maxHeight = '';
      wrap.appendChild(mediaEl);
      parent.appendChild(wrap);
      return;
    }

    const wrap = document.createElement('div');
    wrap.className = 'q-content';
    if (k === 'audio') {
      const aud = document.createElement('audio');
      aud.src = mediaUrl(mediaPath);
      aud.controls = true;
      aud.preload = 'metadata';
      wrap.appendChild(aud);
    } else {
      const span = document.createElement('span');
      span.textContent = text || '';
      wrap.appendChild(span);
    }
    parent.appendChild(wrap);
  }

  function applyQuestionDirection(wrap, obj) {
    const rtl = obj.textDirection === 'rtl';
    wrap.style.direction = rtl ? 'rtl' : 'ltr';
    wrap.style.textAlign = (obj.textAlign || 'left').toLowerCase();
  }

  function buildQuestion(obj, el) {
    const wrap = document.createElement('div');
    wrap.className = 'lesson-question fadeable' + (obj.isMediaQuestion ? ' lesson-question--media' : '');
    if (obj.isMediaQuestion) {
      wrap.classList.add(isTwoColumnGridLayout(obj) ? 'q-options-grid' : 'q-options-column');
    }
    applyQuestionDirection(wrap, obj);
    if (obj.fillColor && obj.fillColor !== 'transparent' && obj.fillColor !== 'none')
      wrap.style.background = obj.fillColor;
    const qStroke = obj.strokeWidth || 0;
    if (qStroke > 0 && obj.strokeColor && obj.strokeColor !== 'transparent' && obj.strokeColor !== 'none')
      wrap.style.border = qStroke + 'px solid ' + obj.strokeColor;
    const prompt = document.createElement('div');
    prompt.className = 'q-prompt';
    if (obj.isMediaQuestion) {
      const promptKind = (obj.questionPromptKind || 'text').toLowerCase();
      if (promptKind === 'text') {
        prompt.classList.add('q-prompt--text');
        if (obj.questionPrompt) {
          const promptText = document.createElement('div');
          promptText.textContent = obj.questionPrompt;
          applyTextStyle(promptText, obj);
          prompt.appendChild(promptText);
        }
      } else {
        prompt.classList.add('q-prompt--media');
        appendQuestionContent(
          prompt,
          obj.questionPromptKind,
          obj.questionPrompt,
          obj.questionPromptMediaPath,
          obj,
          obj.questionPromptMediaAlign,
          obj.questionPromptMediaScalePercent,
          false);
      }
      if (obj.fontSize) wrap.style.fontSize = obj.fontSize + 'px';
    } else {
      prompt.textContent = obj.questionPrompt || 'Question';
      applyTextStyle(prompt, obj);
    }
    wrap.appendChild(prompt);

    const optionsWrap = document.createElement('div');
    optionsWrap.className = obj.isMediaQuestion ? 'q-options' : '';
    const inputName = 'q_' + obj.id;
    const optionEls = [];
    const options = getQuestionDisplayOptions(obj);
    options.forEach(opt => {
      const label = document.createElement('label');
      if (obj.isMediaQuestion) label.className = 'q-option-media';
      const input = document.createElement('input');
      input.type = obj.questionMode === 'singleChoice' ? 'radio' : 'checkbox';
      input.name = inputName;
      input.value = opt.id;
      label.appendChild(input);
      if (obj.isMediaQuestion) {
        appendQuestionContent(label, opt.contentKind, opt.text, opt.mediaPath, obj, opt.mediaAlign, opt.mediaScalePercent, true);
      } else {
        const span = document.createElement('span');
        span.textContent = opt.text || '';
        applyTextStyle(span, obj);
        label.appendChild(span);
      }
      if (obj.isMediaQuestion) optionsWrap.appendChild(label);
      else wrap.appendChild(label);
      optionEls.push(input);
    });
    if (obj.isMediaQuestion) wrap.appendChild(optionsWrap);

    const actions = document.createElement('div');
    actions.className = obj.isMediaQuestion ? 'q-actions' : '';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = obj.questionCheckButtonText || 'Check answer';
    btn.style.background = obj.questionCheckButtonColor || '#4a6cf7';
    btn.style.color = '#fff';
    const feedback = document.createElement('div');
    feedback.className = 'q-feedback';
    if (obj.isMediaQuestion) {
      actions.appendChild(btn);
      actions.appendChild(feedback);
      wrap.appendChild(actions);
    } else {
      wrap.appendChild(btn);
      wrap.appendChild(feedback);
    }

    btn.addEventListener('click', () => {
      const allowRetry = obj.allowMultipleAttempts === true;
      if (!allowRetry && questionScores[obj.id] !== undefined) return;
      const selected = optionEls.filter(i => i.checked).map(i => i.value);
      if (obj.questionMode === 'singleChoice' && selected.length === 0) return;
      if (obj.questionMode === 'multipleChoice' && selected.length === 0) return;
      const result = gradeQuestion(obj, selected);
      fireQuestionAnswerConditions(obj, selected, result);
      const feedbackMessages = collectAnswerFeedbackMessages(obj, selected);
      feedback.textContent = feedbackMessages.join('\n\n');
      wrap.classList.remove('correct', 'partial', 'wrong');
      if (feedbackMessages.length && obj.showFeedback !== false) {
        wrap.classList.add(result.fullyCorrect ? 'correct' : 'wrong');
      }
      const countScore = obj.includeInTotalScore !== false;
      if (countScore && result.fullyCorrect && questionScores[obj.id] === undefined) {
        questionScores[obj.id] = result.earned;
        score += result.earned;
        updateScoreDisplays();
      } else if (!allowRetry && questionScores[obj.id] === undefined) {
        questionScores[obj.id] = result.earned;
        if (countScore) {
          score += result.earned;
          updateScoreDisplays();
        }
        optionEls.forEach(i => { i.disabled = true; });
        btn.disabled = true;
      }
      if (allowRetry) resetQuestionInputs(optionEls);
    });

    el.appendChild(wrap);
    if (obj.isMediaQuestion) {
      setupPromptMediaPlayback(wrap, obj);
      uniformizeMediaQuestionOptions(wrap, obj);
      requestAnimationFrame(() => uniformizeMediaQuestionOptions(wrap, obj));
    }
  }

  function applyPageBackground(stage, page) {
    stage.style.backgroundColor = page.backgroundColor || '#fff';
    if (page.backgroundImagePath) {
      stage.style.backgroundImage = cssBackgroundUrl(page.backgroundImagePath);
      stage.style.backgroundSize = 'cover';
      stage.style.backgroundPosition = 'center';
      stage.style.backgroundRepeat = 'no-repeat';
    } else {
      stage.style.backgroundImage = 'none';
    }
  }

  function collectInteractionLeaderIds(page) {
    const leaders = new Set();
    (page.objects || []).forEach(obj => {
      const conds = obj.conditions || [];
      if (conds.some(c => c.trigger === 'onClick')) leaders.add(obj.id);
      conds.filter(c => c.trigger === 'whenObjectClicked').forEach(c => {
        leaders.add(c.sourceObjectId || obj.id);
      });
    });
    return leaders;
  }

  function applyGroupClickThrough(page, objectEls) {
    const leaders = collectInteractionLeaderIds(page);
    const membersByGroup = new Map();
    (page.objects || []).forEach(obj => {
      if (!obj.groupId) return;
      if (!membersByGroup.has(obj.groupId)) membersByGroup.set(obj.groupId, []);
      membersByGroup.get(obj.groupId).push(obj.id);
    });

    (page.objects || []).forEach(obj => {
      if (!obj.groupId) return;
      const members = membersByGroup.get(obj.groupId) || [];
      if (!members.some(id => leaders.has(id))) return;
      if (leaders.has(obj.id)) return;
      const el = objectEls.get(obj.id);
      if (!el) return;
      el.style.pointerEvents = 'none';
      el.classList.add('group-decor');
    });
  }

  function renderPage() {
    timerDisplays.clear();
    stage.innerHTML = '';
    const page = lesson.pages[currentPageIndex];
    preparePageTimers(page, currentPageIndex);
    applyPageBackground(stage, page);
    const objectEls = new Map();

    const sorted = [...(page.objects || [])].sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0));
    sorted.forEach(obj => {
      if (obj.type === 'line') {
        const el = document.createElement('div');
        el.className = 'lesson-obj fadeable line-obj';
        el.dataset.id = obj.id;
        el.dataset.type = 'line';
        el.style.left = '0';
        el.style.top = '0';
        el.style.width = lesson.canvasWidth + 'px';
        el.style.height = lesson.canvasHeight + 'px';
        el.style.zIndex = String(obj.zIndex || 0);
        el.style.pointerEvents = 'auto';
        el.appendChild(buildLineSvg(obj, lesson.canvasWidth, lesson.canvasHeight));
        appendLineLabel(el, obj);
        stage.appendChild(el);
        objectEls.set(obj.id, el);
        return;
      }

      if (obj.type === 'brokenLine') {
        const svg = buildBrokenLineSvg(obj, lesson.canvasWidth, lesson.canvasHeight);
        if (svg) {
          const el = document.createElement('div');
          el.className = 'lesson-obj fadeable brokenline-obj';
          el.dataset.id = obj.id;
          el.dataset.type = 'brokenLine';
          el.style.left = '0';
          el.style.top = '0';
          el.style.width = lesson.canvasWidth + 'px';
          el.style.height = lesson.canvasHeight + 'px';
          el.style.zIndex = String(obj.zIndex || 0);
          el.appendChild(svg);
          appendPointCenteredLabel(el, obj, obj.brokenLinePoints);
          stage.appendChild(el);
          objectEls.set(obj.id, el);
        }
        return;
      }

      if (obj.type === 'freeform') {
        const svg = buildFreeformSvg(obj, lesson.canvasWidth, lesson.canvasHeight);
        if (svg) {
          const el = document.createElement('div');
          el.className = 'lesson-obj fadeable freeform-obj';
          el.dataset.id = obj.id;
          el.dataset.type = 'freeform';
          el.style.left = '0';
          el.style.top = '0';
          el.style.width = lesson.canvasWidth + 'px';
          el.style.height = lesson.canvasHeight + 'px';
          el.style.zIndex = String(obj.zIndex || 0);
          el.appendChild(svg);
          applyShapeRotation(svg, obj);
          appendPointCenteredLabel(el, obj, obj.freeformPoints);
          stage.appendChild(el);
          objectEls.set(obj.id, el);
        }
        return;
      }

      const el = document.createElement('div');
      el.className = 'lesson-obj fadeable';
      el.dataset.id = obj.id;
      el.dataset.type = obj.type;
      el.style.left = obj.x + 'px';
      el.style.top = obj.y + 'px';
      el.style.width = obj.width + 'px';
      el.style.height = obj.height + 'px';
      el.style.zIndex = String(obj.zIndex || 0);
      if (obj.rotationDegrees != null && obj.rotationDegrees !== 0) {
        el.style.transformOrigin = '50% 50%';
        el.style.transform = 'rotate(' + obj.rotationDegrees + 'deg)';
      }

      switch (obj.type) {
        case 'text': {
          const inner = document.createElement('div');
          inner.className = 'lesson-text';
          inner.textContent = labelDisplayText(obj);
          applyTextStyle(inner, obj);
          applyTextBoxStyle(inner, obj);
          el.appendChild(inner);
          break;
        }
        case 'image': {
          const img = document.createElement('img');
          img.className = 'lesson-media';
          img.src = mediaUrl(obj.mediaPath || '');
          img.alt = '';
          if (obj.flipHorizontal) img.style.transform = 'scaleX(-1)';
          el.appendChild(img);
          break;
        }
        case 'video': {
          const v = document.createElement('video');
          v.className = 'lesson-media';
          v.src = mediaUrl(obj.mediaPath || '');
          if (obj.autoplay) v.autoplay = true;
          if (obj.loop) v.loop = true;
          if (obj.showControls !== false) v.controls = true;
          el.appendChild(v);
          break;
        }
        case 'audio': {
          const a = document.createElement('audio');
          a.className = 'lesson-media';
          a.src = mediaUrl(obj.mediaPath || '');
          if (obj.autoplay) a.autoplay = true;
          if (obj.loop) a.loop = true;
          if (obj.showControls !== false) a.controls = true;
          el.appendChild(a);
          break;
        }
        case 'question':
          buildQuestion(obj, el);
          break;
        case 'scoreDisplay': {
          const s = document.createElement('div');
          s.className = 'lesson-score';
          s.dataset.type = 'scoreDisplay';
          s.dataset.label = obj.scoreLabelText || 'Score';
          s.dataset.mode = obj.scoreDisplayMode || 'pointsTotal';
          s.dataset.bands = JSON.stringify(obj.scoreFeedbackBands || []);
          const value = document.createElement('div');
          value.className = 'lesson-score-value';
          value.textContent = formatScoreValue(s.dataset.label, s.dataset.mode, 0);
          const feedback = document.createElement('div');
          feedback.className = 'lesson-score-feedback';
          feedback.style.display = 'none';
          s.appendChild(value);
          s.appendChild(feedback);
          applyTextStyle(s, obj);
          if (obj.fillColor && !obj.textShaded) s.style.background = obj.fillColor;
          el.appendChild(s);
          break;
        }
        case 'timer': {
          const t = document.createElement('div');
          t.className = 'lesson-timer';
          applyTextStyle(t, obj);
          if (obj.fillColor && obj.fillColor !== 'transparent' && obj.fillColor !== 'none')
            t.style.background = obj.fillColor;
          const sw = obj.strokeWidth != null ? obj.strokeWidth : 0;
          if (sw > 0 && obj.strokeColor && obj.strokeColor !== 'transparent' && obj.strokeColor !== 'none') {
            t.style.border = sw + 'px solid ' + obj.strokeColor;
          }
          const key = timerKeyForObject(obj);
          const state = timerStates.get(key);
          const displayMs = state ? getTimerDisplayMs(state) : (obj.timerMode === 'countDown' ? timerTotalMs(obj) : 0);
          const fmt = obj.timerDisplayFormat || 'mmSs';
          t.textContent = formatTimerTime(displayMs, fmt);
          timerDisplays.set(obj.id, t);
          el.appendChild(t);
          break;
        }
        case 'multipleActions': {
          const wrap = document.createElement('div');
          wrap.className = 'lesson-multi-action';
          const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
          svg.setAttribute('width', '100%');
          svg.setAttribute('height', '100%');
          svg.setAttribute('viewBox', obj.iconViewBox || '0 -960 960 960');
          svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
          const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          path.setAttribute('d', obj.iconPathData || 'M240-320h360v-200H240v200Zm420-120h60v-200H360v60h300v140ZM160-160q-33 0-56.5-23.5T80-240v-480q0-33 23.5-56.5T160-800h640q33 0 56.5 23.5T880-720v480q0 33-23.5 56.5T800-160H160Zm0-80h640v-480H160v480Zm0 0v-480 480Z');
          path.setAttribute('fill', obj.fillColor || '#555555');
          svg.appendChild(path);
          wrap.appendChild(svg);
          el.appendChild(wrap);
          break;
        }
        case 'rectangle':
        case 'roundedRectangle':
        case 'diamond':
        case 'circle': {
          const svg = buildShapeSvg(obj);
          if (svg) el.appendChild(svg);
          appendCenteredShapeLabel(el, obj);
          break;
        }
        case 'icon': {
          const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
          svg.setAttribute('width', '100%');
          svg.setAttribute('height', '100%');
          svg.setAttribute('viewBox', obj.iconViewBox || '0 -960 960 960');
          svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
          const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          path.setAttribute('d', obj.iconPathData || '');
          path.setAttribute('fill', obj.fillColor || '#000000');
          const sw = shapeStrokeWidth(obj);
          if (sw > 0) {
            path.setAttribute('stroke', shapeStroke(obj));
            path.setAttribute('stroke-width', String(sw));
          }
          svg.appendChild(path);
          el.appendChild(svg);
          appendCenteredShapeLabel(el, obj);
          break;
        }
      }
      stage.appendChild(el);
      objectEls.set(obj.id, el);
    });

    applyGroupClickThrough(page, objectEls);
    initVisibility(page, objectEls);
    updateScoreDisplays();
    updateAllTimerDisplays();
  }

  initLessonTimers();
  maxLessonScore = computeLessonMaxScore();
  goToPage(0);
  fitStageToViewport();
})();