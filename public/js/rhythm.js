/**
 * 리듬 패턴 로그인 — 클라이언트 유틸 (서버와 동일한 양자화 규칙)
 */
(function () {
  var RHYTHM_MIN_TAPS = 4;
  var RHYTHM_QUANTIZE_STEP = 0.15;
  var RHYTHM_IDLE_MS = 1500;

  function timestampsToIntervals(timestamps) {
    if (!timestamps || timestamps.length < RHYTHM_MIN_TAPS) return null;
    var intervals = [];
    for (var i = 1; i < timestamps.length; i++) {
      var d = timestamps[i] - timestamps[i - 1];
      if (d < 35) return null;
      intervals.push(d);
    }
    return intervals;
  }

  function normalize(intervals) {
    var sum = 0;
    for (var i = 0; i < intervals.length; i++) sum += intervals[i];
    if (sum <= 0) return null;
    return intervals.map(function (x) { return x / sum; });
  }

  function quantize(ratios) {
    var step = RHYTHM_QUANTIZE_STEP;
    return ratios.map(function (r) { return Math.round(r / step) * step; });
  }

  function toKey(ratios) {
    return quantize(ratios).join(',');
  }

  function rhythmFromTimestamps(timestamps) {
    var intervals = timestampsToIntervals(timestamps);
    if (!intervals) return null;
    var ratios = normalize(intervals);
    if (!ratios) return null;
    return toKey(ratios);
  }

  /**
   * 두 리듬(타임스탬프 배열)이 같은지 비교 (가입 시 1차/2차 일치 확인)
   */
  function rhythmMatch(ts1, ts2) {
    var k1 = rhythmFromTimestamps(ts1);
    var k2 = rhythmFromTimestamps(ts2);
    return k1 && k2 && k1 === k2;
  }

  /**
   * 탭 녹화: 시작 시각을 기록하고, RHYTHM_IDLE_MS 동안 입력이 없으면 완료 콜백 호출
   * @param {HTMLElement} tapEl - 클릭/터치/키 입력을 받을 요소 (또는 document)
   * @param {Object} opts - { onTap: function() {}, onComplete: function(timestamps) {}, onStart: function() {} }
   * @returns {function} stop() 호출하면 녹화 중단
   */
  function recordRhythm(tapEl, opts) {
    var timestamps = [];
    var idleTimer = null;
    var startTime = null;
    var onTap = opts && opts.onTap ? opts.onTap : function () {};
    var onComplete = opts && opts.onComplete ? opts.onComplete : function () {};
    var onStart = opts && opts.onStart ? opts.onStart : function () {};

    function addTap() {
      var now = Date.now();
      if (timestamps.length === 0) {
        startTime = now;
        onStart();
      }
      timestamps.push(now - startTime);
      onTap(timestamps.length);

      clearTimeout(idleTimer);
      idleTimer = setTimeout(function () {
        if (timestamps.length >= RHYTHM_MIN_TAPS) {
          onComplete(timestamps);
        } else {
          onComplete(null);
        }
      }, RHYTHM_IDLE_MS);
    }

    function onPointer(e) {
      e.preventDefault();
      addTap();
    }

    function onKey(e) {
      if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        addTap();
      }
    }

    tapEl.addEventListener('mousedown', onPointer);
    tapEl.addEventListener('touchstart', onPointer, { passive: false });
    document.addEventListener('keydown', onKey);

    return function stop() {
      clearTimeout(idleTimer);
      tapEl.removeEventListener('mousedown', onPointer);
      tapEl.removeEventListener('touchstart', onPointer, { passive: false });
      document.removeEventListener('keydown', onKey);
    };
  }

  window.TornFiRhythm = {
    RHYTHM_MIN_TAPS: RHYTHM_MIN_TAPS,
    RHYTHM_IDLE_MS: RHYTHM_IDLE_MS,
    rhythmFromTimestamps: rhythmFromTimestamps,
    rhythmMatch: rhythmMatch,
    recordRhythm: recordRhythm,
    isValid: function (timestamps) { return !!rhythmFromTimestamps(timestamps || []); },
  };
})();
