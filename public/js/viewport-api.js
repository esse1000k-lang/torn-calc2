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
  var chatPage = document.querySelector('.chat-page');
  var isActive = false;
  
  /**
   * 화면 높이 억지 고정 및 레이아웃 조정
   */
  function handleViewportChange() {
    if (!window.visualViewport || !chatPage) return;

    // 1. 화면 높이 억지 고정 (visualViewport.height)
    const vvHeight = window.visualViewport.height;
    const vvOffsetTop = window.visualViewport.offsetTop;
    
    console.log('[ViewportAPI] 뷰포트 변경:', {
      height: vvHeight,
      offsetTop: vvOffsetTop
    });

    // 2. 채팅 페이지 높이 조정
    chatPage.style.height = `${vvHeight}px`;
    
    // 3. iOS offsetTop 보정
    if (vvOffsetTop > 0) {
      chatPage.style.transform = `translateY(${vvOffsetTop}px)`;
    } else {
      chatPage.style.transform = '';
    }

    // 4. 메시지 스크롤 유지
    const chatMessages = document.getElementById('chatMessages');
    if (chatMessages) {
      setTimeout(() => {
        chatMessages.scrollTop = chatMessages.scrollHeight;
      }, 100);
    }
  }
  
  // Viewport API 이벤트 등록
  vv.addEventListener('resize', handleViewportChange);
  vv.addEventListener('scroll', handleViewportChange);
  
  // 초기 실행
  handleViewportChange();
  
  console.log('[ViewportAPI] 채팅 1번 수정 완료: 화면 높이 억지 고정 + flex-item');
  
  // 전역 함수 등록
  window.setupKeyboardHandler = function setupKeyboardHandler(inputSelector, containerSelector) {
    var input = document.querySelector(inputSelector);
    if (!input) return;
    
    var container = containerSelector ? document.querySelector(containerSelector) : input;
    var chatMessages = document.querySelector('#chatMessages');
    var isActive = false;
    var originalStyles = {};
    var originalMessagesStyles = {};
    
    function saveOriginalStyles() {
      originalStyles = {
        position: container.style.position || '',
        bottom: container.style.bottom || '',
        zIndex: container.style.zIndex || ''
      };
      
      if (chatMessages) {
        originalMessagesStyles = {
          paddingBottom: chatMessages.style.paddingBottom || ''
        };
      }
    }
    
    function restoreOriginalStyles() {
      Object.keys(originalStyles).forEach(function(key) {
        container.style[key] = originalStyles[key];
      });
      
      if (chatMessages) {
        Object.keys(originalMessagesStyles).forEach(function(key) {
          chatMessages.style[key] = originalMessagesStyles[key];
        });
      }
    }
    
    function handleKeyboard() {
      var keyboardHeight = window.innerHeight - vv.height;
      var isKeyboardOpen = keyboardHeight > 150;
      
      if (isKeyboardOpen && !isActive) {
        saveOriginalStyles();
        
        // 채팅바 위치 조정
        container.style.position = 'fixed';
        container.style.bottom = keyboardHeight + 'px';
        container.style.zIndex = '1000';
        
        // 채팅 메시지 영역 조정
        if (chatMessages) {
          var currentPadding = window.getComputedStyle(chatMessages).paddingBottom;
          var currentPaddingNum = parseFloat(currentPadding) || 0;
          chatMessages.style.paddingBottom = (currentPaddingNum + keyboardHeight) + 'px';
        }
        
        isActive = true;
        
        // 스크롤을 맨 아래로
        setTimeout(function() {
          if (chatMessages) {
            chatMessages.scrollTop = chatMessages.scrollHeight;
          }
        }, 100);
        
      } else if (!isKeyboardOpen && isActive) {
        restoreOriginalStyles();
        isActive = false;
        
        // 스크롤을 맨 아래로
        setTimeout(function() {
          if (chatMessages) {
            chatMessages.scrollTop = chatMessages.scrollHeight;
          }
        }, 100);
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
  
  console.log('[ViewportAPI] Module loaded');
})();
