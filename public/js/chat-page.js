(function setupChat() {
  const ANON_ID_KEY = 'tornfi-anon-id';
  const ANON_NAME_KEY = 'tornfi-anon-name';
  const POLL_MS = 2000;
  const NAME_PREFIXES = ['고요한', '빠른', '반짝이는', '은밀한', '유쾌한', '날카로운', '느긋한', '대담한'];
  const NAME_SUFFIXES = ['고래', '토네이도', '지갑', '유령', '채굴러', '홀더', '고양이', '늑대'];

  const chatMessages = document.getElementById('chatMessages');
  const chatInput = document.getElementById('chatInput');
  const chatSend = document.getElementById('chatSend');
  const chatReplyBar = document.getElementById('chatReplyBar');
  const chatReplyText = document.getElementById('chatReplyText');
  const chatReplyCancel = document.getElementById('chatReplyCancel');
  const chatImage = document.getElementById('chatImage');
  const chatAttach = document.getElementById('chatAttach');
  const chatPreviewWrap = document.getElementById('chatPreviewWrap');
  const chatPreviewImg = document.getElementById('chatPreviewImg');
  const chatPreviewRemove = document.getElementById('chatPreviewRemove');
  const chatEditModal = document.getElementById('chatEditModal');
  const chatEditModalInput = document.getElementById('chatEditModalInput');
  const chatEditModalCancel = document.getElementById('chatEditModalCancel');
  const chatEditModalConfirm = document.getElementById('chatEditModalConfirm');
  const chatDeleteModal = document.getElementById('chatDeleteModal');
  const chatDeleteModalCancel = document.getElementById('chatDeleteModalCancel');
  const chatDeleteModalConfirm = document.getElementById('chatDeleteModalConfirm');
  const chatSendHeartLayer = document.getElementById('chatSendHeartLayer');
  const chatSendHeartMessage = document.getElementById('chatSendHeartMessage');
  const chatSendHeartCancel = document.getElementById('chatSendHeartCancel');
  const chatSendHeartOk = document.getElementById('chatSendHeartOk');
  const chatMsgDropdown = document.getElementById('chatMsgDropdown');
  const rootStyle = document.documentElement.style;

  let messagesCache = [];
  let replyingTo = null;
  let pendingChatFile = null;
  let pendingEditMessageId = null;
  let pendingDeleteMessageId = null;
  let pendingHeartMessageId = null;
  let openDropdownRow = null;

  function ensureAnonId() {
    let anonId = localStorage.getItem(ANON_ID_KEY);
    if (!anonId) {
      anonId = 'anon-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem(ANON_ID_KEY, anonId);
    }
    return anonId;
  }

  function createRandomAnonName() {
    const anonId = ensureAnonId();
    let seed = 0;
    for (let i = 0; i < anonId.length; i += 1) {
      seed += anonId.charCodeAt(i) * (i + 1);
    }
    const prefix = NAME_PREFIXES[seed % NAME_PREFIXES.length];
    const suffix = NAME_SUFFIXES[Math.floor(seed / NAME_PREFIXES.length) % NAME_SUFFIXES.length];
    const tag = anonId.slice(-3).toUpperCase();
    return (prefix + suffix + '-' + tag).slice(0, 12);
  }

  function getAnonName() {
    const saved = (localStorage.getItem(ANON_NAME_KEY) || '').trim();
    if (saved) return saved;
    const fallback = createRandomAnonName();
    localStorage.setItem(ANON_NAME_KEY, fallback);
    return fallback;
  }

  function authHeaders(extra) {
    return Object.assign({
      'x-anon-id': ensureAnonId(),
      'x-anon-name': encodeURIComponent(getAnonName()),
    }, extra || {});
  }

  function escapeHtml(s) {
    const div = document.createElement('div');
    div.textContent = s == null ? '' : String(s);
    return div.innerHTML;
  }

  function formatTime(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
  }

  function closeDropdown() {
    if (chatMsgDropdown) chatMsgDropdown.style.display = 'none';
    openDropdownRow = null;
  }

  function syncViewportOffset() {
    const vv = window.visualViewport;
    if (!vv) {
      rootStyle.setProperty('--chat-keyboard-offset', '0px');
      return;
    }
    const keyboardHeight = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    rootStyle.setProperty('--chat-keyboard-offset', keyboardHeight > 0 ? keyboardHeight + 'px' : '0px');
  }

  function keepComposerVisible() {
    const active = document.activeElement;
    if (active !== chatInput && active !== chatEditModalInput) return;
    setTimeout(function () {
      if (chatMessages) chatMessages.scrollTop = chatMessages.scrollHeight;
      if (active && typeof active.scrollIntoView === 'function') {
        active.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
    }, 50);
  }

  function openEditModal(messageId, text) {
    pendingEditMessageId = messageId;
    chatEditModalInput.value = text || '';
    chatEditModal.style.display = 'flex';
    chatEditModalInput.focus();
  }

  function closeEditModal() {
    pendingEditMessageId = null;
    chatEditModal.style.display = 'none';
  }

  function openDeleteModal(messageId) {
    pendingDeleteMessageId = messageId;
    chatDeleteModal.style.display = 'flex';
  }

  function closeDeleteModal() {
    pendingDeleteMessageId = null;
    chatDeleteModal.style.display = 'none';
  }

  function openHeartModal(messageId, name) {
    pendingHeartMessageId = messageId;
    chatSendHeartMessage.textContent = (name || '이 메시지') + '에 좋아요를 누르시겠습니까?';
    chatSendHeartLayer.style.display = 'flex';
  }

  function closeHeartModal() {
    pendingHeartMessageId = null;
    chatSendHeartLayer.style.display = 'none';
  }

  function clearPreview() {
    pendingChatFile = null;
    if (chatImage) chatImage.value = '';
    if (chatPreviewWrap) chatPreviewWrap.style.display = 'none';
    if (chatPreviewImg) chatPreviewImg.src = '';
  }

  function renderMessages(messages, me) {
    if (!Array.isArray(messages) || messages.length === 0) {
      chatMessages.innerHTML = '<p class="chat-empty">메시지가 없습니다.</p>';
      return;
    }
    const wasNearBottom = (chatMessages.scrollHeight - chatMessages.scrollTop - chatMessages.clientHeight) < 120;
    chatMessages.innerHTML = messages.map(function (m) {
      const isMine = me && String(m.userId) === String(me.id);
      const rowClass = 'chat-msg ' + (isMine ? 'chat-msg--mine' : 'chat-msg--other');
      const replyLine = m.replyToText ? '<div class="chat-msg__reply">답장: ' + escapeHtml(m.replyToText) + '</div>' : '';
      const imgLine = m.imageUrl ? '<img class="chat-msg__img" src="' + escapeHtml(m.imageUrl) + '" alt="" loading="lazy">' : '';
      const textLine = m.text ? '<p class="chat-msg__text">' + escapeHtml(m.text) + '</p>' : '';
      const hearts = (m.heartsReceived || 0) > 0 ? '<div class="chat-msg__hearts-below"> ' + (m.heartsReceived || 0) + '</div>' : '';
      return '<div class="' + rowClass + '" data-message-id="' + escapeHtml(m.id) + '" data-user-id="' + escapeHtml(m.userId) + '">' +
        '<div class="chat-msg__body">' +
          '<div class="chat-msg__bubble">' +
            '<div class="chat-msg__top-row"><span class="chat-msg__name-line"><span class="chat-msg__name">' + escapeHtml(m.displayName || '익명') + '</span></span><span class="chat-msg__time">' + escapeHtml(formatTime(m.createdAt)) + (m.editedAt ? ' 수정됨' : '') + '</span></div>' +
            replyLine + imgLine + textLine +
          '</div>' + hearts +
        '</div>' +
      '</div>';
    }).join('');
    if (wasNearBottom) chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  function fetchChat() {
    fetch('/api/chat', { headers: authHeaders() })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data.ok) return;
        messagesCache = Array.isArray(data.messages) ? data.messages : [];
        renderMessages(messagesCache, data.me);
      })
      .catch(function () {});
  }

  function sendMessage() {
    const text = (chatInput.value || '').trim();
    if (!text && !pendingChatFile) return;
    const options = { method: 'POST', headers: authHeaders() };
    if (pendingChatFile) {
      const fd = new FormData();
      fd.append('text', text);
      fd.append('image', pendingChatFile);
      if (replyingTo) {
        fd.append('replyToMessageId', replyingTo.id);
        fd.append('replyToText', replyingTo.text);
      }
      options.body = fd;
    } else {
      options.headers = authHeaders({ 'Content-Type': 'application/json' });
      options.body = JSON.stringify({
        text,
        replyToMessageId: replyingTo ? replyingTo.id : undefined,
        replyToText: replyingTo ? replyingTo.text : undefined,
      });
    }
    chatSend.disabled = true;
    fetch('/api/chat', options)
      .then(function (r) { return r.json(); })
      .then(function (data) {
        chatSend.disabled = false;
        if (!data.ok) {
          alert(data.message || '전송에 실패했습니다.');
          return;
        }
        chatInput.value = '';
        replyingTo = null;
        chatReplyBar.style.display = 'none';
        clearPreview();
        fetchChat();
      })
      .catch(function () {
        chatSend.disabled = false;
      });
  }

  function runAction(action, row) {
    const messageId = row && row.getAttribute('data-message-id');
    const userId = row && row.getAttribute('data-user-id');
    const message = messagesCache.find(function (item) { return String(item.id) === String(messageId); });
    const isMine = String(userId) === ensureAnonId();
    closeDropdown();
    if (!message) return;
    if (action === 'copy') {
      navigator.clipboard && navigator.clipboard.writeText(message.text || '');
      return;
    }
    if (action === 'reply') {
      replyingTo = { id: message.id, text: (message.text || '').slice(0, 100) };
      chatReplyText.textContent = '답장: ' + replyingTo.text;
      chatReplyBar.style.display = 'flex';
      chatInput.focus();
      return;
    }
    if (action === 'sendHeart') {
      if (isMine) {
        alert('내 메시지에는 좋아요를 누를 수 없습니다.');
        return;
      }
      openHeartModal(message.id, message.displayName);
      return;
    }
    if (action === 'edit') {
      if (!isMine) return;
      openEditModal(message.id, message.text || '');
      return;
    }
    if (action === 'delete') {
      if (!isMine) return;
      openDeleteModal(message.id);
    }
  }

  ensureAnonId();
  syncViewportOffset();

  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', function () {
      syncViewportOffset();
      keepComposerVisible();
    });
    window.visualViewport.addEventListener('scroll', syncViewportOffset);
  }

  window.addEventListener('resize', syncViewportOffset);

  if (chatSend) {
    chatSend.addEventListener('pointerdown', function (e) {
      e.preventDefault();
    });
    chatSend.addEventListener('mousedown', function (e) {
      e.preventDefault();
    });
  }

  chatSend.addEventListener('click', sendMessage);
  chatInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      sendMessage();
    }
  });
  chatInput.addEventListener('focus', keepComposerVisible);

  if (chatAttach && chatImage) {
    chatAttach.addEventListener('click', function () { chatImage.click(); });
    chatImage.addEventListener('change', function () {
      const file = chatImage.files && chatImage.files[0];
      if (!file) return;
      if (!/^image\/(jpeg|png|gif|webp)$/i.test(file.type || '')) {
        alert('이미지는 JPG, PNG, GIF, WEBP만 가능합니다.');
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        alert('이미지는 5MB 이하만 업로드할 수 있습니다.');
        return;
      }
      pendingChatFile = file;
      chatPreviewImg.src = URL.createObjectURL(file);
      chatPreviewWrap.style.display = 'flex';
    });
  }

  chatPreviewRemove.addEventListener('click', clearPreview);
  chatReplyCancel.addEventListener('click', function () {
    replyingTo = null;
    chatReplyBar.style.display = 'none';
  });

  chatEditModalCancel.addEventListener('click', closeEditModal);
  chatEditModal.querySelector('.chat-edit-modal__backdrop').addEventListener('click', closeEditModal);
  chatEditModalConfirm.addEventListener('click', function () {
    const text = (chatEditModalInput.value || '').trim();
    if (!pendingEditMessageId || !text) return;
    fetch('/api/chat/' + encodeURIComponent(pendingEditMessageId), {
      method: 'PATCH',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ text: text }),
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data.ok) {
          alert(data.message || '수정에 실패했습니다.');
          return;
        }
        closeEditModal();
        fetchChat();
      });
  });

  chatDeleteModalCancel.addEventListener('click', closeDeleteModal);
  chatDeleteModal.querySelector('.chat-delete-modal__backdrop').addEventListener('click', closeDeleteModal);
  chatDeleteModalConfirm.addEventListener('click', function () {
    if (!pendingDeleteMessageId) return;
    fetch('/api/chat/' + encodeURIComponent(pendingDeleteMessageId), {
      method: 'DELETE',
      headers: authHeaders(),
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data.ok) {
          alert(data.message || '삭제에 실패했습니다.');
          return;
        }
        closeDeleteModal();
        fetchChat();
      });
  });

  chatSendHeartCancel.addEventListener('click', closeHeartModal);
  chatSendHeartLayer.addEventListener('click', function (e) {
    if (e.target === chatSendHeartLayer) closeHeartModal();
  });
  chatSendHeartOk.addEventListener('click', function () {
    if (!pendingHeartMessageId) return;
    fetch('/api/chat/' + encodeURIComponent(pendingHeartMessageId) + '/send-heart', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ amount: 1 }),
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data.ok) {
          alert(data.message || '좋아요 전송에 실패했습니다.');
          return;
        }
        closeHeartModal();
        fetchChat();
      });
  });

  chatMessages.addEventListener('click', function (e) {
    const bubble = e.target.closest('.chat-msg__bubble');
    const dropdownItem = e.target.closest('.chat-msg-dropdown__item');
    if (dropdownItem && openDropdownRow) {
      runAction(dropdownItem.getAttribute('data-action'), openDropdownRow);
      return;
    }
    if (!bubble) {
      if (!e.target.closest('#chatMsgDropdown')) closeDropdown();
      return;
    }
    const row = bubble.closest('.chat-msg');
    if (!row) return;
    openDropdownRow = row;
    const rect = bubble.getBoundingClientRect();
    chatMsgDropdown.style.left = Math.max(8, rect.left) + 'px';
    chatMsgDropdown.style.top = (rect.bottom + 6) + 'px';
    chatMsgDropdown.style.display = 'block';
  });

  document.addEventListener('click', function (e) {
    if (!e.target.closest('.chat-msg__bubble') && !e.target.closest('#chatMsgDropdown')) closeDropdown();
  });

  fetchChat();
  setInterval(fetchChat, POLL_MS);
})();
