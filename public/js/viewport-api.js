/**
 * Visual Viewport API 기반 키보드 핸들러
 * 깨끗한 상태에서 새로 구현
 */
(function() {
  'use strict';
  
  // Visual Viewport API 지원 확인
  if (!window.visualViewport) {
    console.log('[ViewportAPI] Visual Viewport API not supported');
    return;
  }
  
  var vv = window.visualViewport;
  
  /**
   * 입력창 키보드 핸들러
   * @param {string} inputSelector - 입력창 선택자
   * @param {string} containerSelector - 컨테이너 선택자 (선택사항)
   */
  function setupKeyboardHandler(inputSelector, containerSelector) {
    var input = document.querySelector(inputSelector);
    if (!input) return;
    
    var container = containerSelector ? document.querySelector(containerSelector) : input;
    var isActive = false;
    var originalStyles = {};
    
    function saveOriginalStyles() {
      originalStyles = {
        position: container.style.position || '',
        bottom: container.style.bottom || '',
        zIndex: container.style.zIndex || ''
      };
    }
    
    function restoreOriginalStyles() {
      Object.keys(originalStyles).forEach(function(key) {
        container.style[key] = originalStyles[key];
      });
    }
    
    function handleKeyboard() {
      var keyboardHeight = window.innerHeight - vv.height;
      var isKeyboardOpen = keyboardHeight > 150;
      
      if (isKeyboardOpen && !isActive) {
        saveOriginalStyles();
        container.style.position = 'fixed';
        container.style.bottom = keyboardHeight + 'px';
        container.style.zIndex = '1000';
        isActive = true;
      } else if (!isKeyboardOpen && isActive) {
        restoreOriginalStyles();
        isActive = false;
      }
    }
    
    function attachListeners() {
      vv.addEventListener('resize', handleKeyboard);
      vv.addEventListener('scroll', handleKeyboard);
    }
    
    function detachListeners() {
      vv.removeEventListener('resize', handleKeyboard);
      vv.removeEventListener('scroll', handleKeyboard);
    }
    
    // 포커스/블러 이벤트
    input.addEventListener('focus', function() {
      attachListeners();
      setTimeout(handleKeyboard, 100);
    });
    
    input.addEventListener('blur', function() {
      setTimeout(function() {
        detachListeners();
        handleKeyboard();
      }, 100);
    });
  }
  
  // 전역 함수 등록
  window.setupKeyboardHandler = setupKeyboardHandler;
  
  console.log('[ViewportAPI] Module loaded');
})();
