/**
 * 사이트 전체 입력창에서 브라우저 저장 아이디/자동완성 비활성화.
 * 기존 입력요소 + 동적으로 추가되는 input/textarea 모두 적용.
 */
(function () {
  function apply(el) {
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {
      el.setAttribute('autocomplete', 'off');
    }
  }

  function applyAll(root) {
    if (!root) root = document;
    root.querySelectorAll('input, textarea').forEach(apply);
  }

  function init() {
    applyAll();
    var observer = new MutationObserver(function (mutations) {
      mutations.forEach(function (m) {
        m.addedNodes.forEach(function (node) {
          if (node.nodeType !== 1) return;
          apply(node);
          if (node.querySelectorAll) applyAll(node);
        });
      });
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
