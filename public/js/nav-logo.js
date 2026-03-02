(function () {
  var el = document.querySelector('.nav-logo');
  if (!el) return;

  if (!el.querySelector('.nav-logo-fi')) {
    el.innerHTML = '<span class="nav-logo-torn">Torn</span><span class="nav-logo-fi">Fi</span>';
  }
  var tornEl = el.querySelector('.nav-logo-torn');
  var fiEl = el.querySelector('.nav-logo-fi');

  var stepDelay = 450;
  var blinkDelay = 120;
  var colorTransitionMs = 2500; // CSS transition --fill 2.5s 와 동일

  function show(text) {
    var torn = text.endsWith('Fi') ? text.slice(0, -2) : text;
    var fi = text.endsWith('Fi') ? 'Fi' : '';
    if (tornEl) tornEl.textContent = torn;
    if (fiEl) fiEl.textContent = fi;
  }

  function setGreen(on) {
    if (on) {
      el.classList.remove('nav-logo--fill');
      el.classList.add('nav-logo--tfi');
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          el.classList.add('nav-logo--fill');
        });
      });
    } else {
      el.classList.remove('nav-logo--fill');
      setTimeout(function () {
        el.classList.remove('nav-logo--tfi');
      }, colorTransitionMs);
    }
  }

  function blinkThree(callback) {
    el.style.opacity = '0';
    setTimeout(function () {
      el.style.opacity = '1';
      setTimeout(function () {
        el.style.opacity = '0';
        setTimeout(function () {
          el.style.opacity = '1';
          setTimeout(function () {
            el.style.opacity = '0';
            setTimeout(function () {
              el.style.opacity = '1';
              setTimeout(callback || function () {}, blinkDelay);
            }, blinkDelay);
          }, blinkDelay);
        }, blinkDelay);
      }, blinkDelay);
    }, blinkDelay);
  }

  // 전체 순서: 페이지 로드 시 한 번만 실행
  var steps = [
    { show: 'TornFi' },             // TornFi 표시
    { show: 'TorFi' },              // TorFi 표시
    { show: 'ToFi' },               // ToFi 표시
    { show: 'TFi' },                // TFi 표시
    { pause: true },                // 멈춤
    { green: true },                // T 스멀스멀 녹색으로 변경
    { wait: colorTransitionMs },   // 다 변경되면
    { blink: true },                // 깜빡임 3번
    { green: false },               // 스멀스멀 다시 흰색으로 변경
    { wait: colorTransitionMs },   // 다 변경되면
    { show: 'ToFi' },               // ToFi
    { show: 'TorFi' },              // TorFi
    { show: 'TornFi' }              // TornFi
  ];

  function runStep(index) {
    if (index >= steps.length) return;
    var step = steps[index];
    if (step.green === true) setGreen(true);
    if (step.green === false) setGreen(false);
    if (step.show) show(step.show);
    if (step.blink) {
      blinkThree(function () {
        runStep(index + 1);
      });
      return;
    }
    if (step.pause) {
      setTimeout(function () { runStep(index + 1); }, stepDelay);
      return;
    }
    if (step.wait) {
      setTimeout(function () { runStep(index + 1); }, step.wait);
      return;
    }
    setTimeout(function () {
      runStep(index + 1);
    }, stepDelay);
  }

  function run() {
    runStep(0);
  }

  run();
})();
