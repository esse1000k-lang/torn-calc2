/**
 * Visual Viewport API 기반 키보드 핸들러
 * 채팅 1번 수정: FlexBox 구조로 실시간 찌그러짐 적용
 */
(function() {
  'use strict';
  
  // Visual Viewport API 지원 확인
  if (!window.visualViewport) {
    console.log('[ViewportAPI] Visual Viewport API not supported');
    return;
  }
  
  var vv = window.visualViewport;
  var wrapper = document.querySelector('.chat-page-main');
  var isActive = false;
  
  /**
   * FlexBox 구조로 실시간 찌그러짐 적용 (참고 코드 적용)
   */
  function handleViewportChange() {
    if (!window.visualViewport || !wrapper) return;

    const vv = window.visualViewport;
    
    console.log('[ViewportAPI] 뷰포트 변경:', {
      height: vv.height,
      offsetTop: vv.offsetTop
    });

    // 1. 전체 컨테이너 높이 맞춤
    wrapper.style.height = `${vv.height}px`;
    wrapper.style.top = `${vv.offsetTop}px`;

    // 2. 채팅바 늘어남 방지 및 메시지 하단 유지
    const chatMsgs = document.getElementById('chatMessages');
    if (chatMsgs) {
      // 즉시 스크롤을 바닥으로 이동시켜 말풍선이 처지는 느낌 방지
      chatMsgs.scrollTop = chatMsgs.scrollHeight;
    }
  }
  
  // Viewport API 이벤트 등록
  vv.addEventListener('resize', handleViewportChange);
  vv.addEventListener('scroll', handleViewportChange);
  
  // 초기 실행
  handleViewportChange();
  
  console.log('[ViewportAPI] 채팅 1번 수정 완료: FlexBox 실시간 찌그러짐 (참고 코드 적용)');
})();
