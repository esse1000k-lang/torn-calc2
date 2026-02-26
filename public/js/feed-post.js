/**
 * 피드 글 상세 페이지 — 목록에서 클릭 시 캐시로 즉시 표시, API로 갱신
 */
(function () {
  var root = null;
  var currentPost = null;
  var LEVEL_EMOJI = { 1: '🐚', 2: '🦐', 3: '🐡', 4: '🦭', 5: '🦈', 6: '🐋' };
  var LEVEL_NAMES = { 1: '조개', 2: '새우', 3: '문어', 4: '물개', 5: '상어', 6: '고래' };

  function escapeHtml(s) {
    if (s == null || s === '') return '';
    var div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  function formatDate(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    var now = new Date();
    var diff = now - d;
    if (diff < 60000) return '방금 전';
    if (diff < 3600000) return Math.floor(diff / 60000) + '분 전';
    if (diff < 86400000) return Math.floor(diff / 3600000) + '시간 전';
    if (diff < 604800000) return Math.floor(diff / 86400000) + '일 전';
    return d.toLocaleDateString('ko-KR');
  }

  function renderComment(c, myId, pid, isAdmin) {
    var name = (c && c.authorDisplayName) ? c.authorDisplayName : '—';
    var isMine = !!(myId && c && c.authorId === myId);
    var hearts = (c && (c.heartsReceived || 0) > 0) ? c.heartsReceived : 0;
    var lv = (c && c.authorLevel >= 1 && c.authorLevel <= 6) ? c.authorLevel : 0;
    var levelEmoji = LEVEL_EMOJI[lv] || '';
    var avatar = (c && c.authorProfileImageUrl && c.authorProfileImageUrl.trim())
      ? '<img class="feed-comment__avatar feed-card__avatar--img" src="' + escapeHtml(c.authorProfileImageUrl) + '" alt="" loading="lazy">'
      : '<span class="feed-comment__avatar" aria-hidden="true">' + (name.charAt(0) || '?') + '</span>';
    var dateStr = formatDate(c && c.createdAt);
    var replyToLine = (c && c.replyToCommentId && c.replyToDisplayName)
      ? '<div class="feed-comment__reply-to">답글: <span class="feed-comment__reply-to-name">@' + escapeHtml(c.replyToDisplayName) + '</span></div>'
      : '';
    var heartRow = '';
    if (hearts > 0) heartRow += '<span class="feed-comment__hearts">❤️ ' + hearts + '</span>';
    if (!isMine && myId && pid) heartRow += '<button type="button" class="feed-comment-heart-btn" data-post-id="' + escapeHtml(pid) + '" data-comment-id="' + escapeHtml(c.id) + '" data-author-name="' + escapeHtml(name) + '">❤️ 보내기</button>';
    if (myId && pid) heartRow += '<button type="button" class="feed-comment-reply-btn" data-post-id="' + escapeHtml(pid) + '" data-comment-id="' + escapeHtml(c.id) + '" data-author-name="' + escapeHtml(name) + '">답글</button>';
    if (heartRow) heartRow = '<div class="feed-comment__footer">' + heartRow + '</div>';
    var adminDeleteHtml = (isAdmin && pid && c && c.id) ? '<div class="feed-comment-admin-outer"><button type="button" class="feed-card__admin-delete feed-comment-admin-delete" data-post-id="' + escapeHtml(pid) + '" data-comment-id="' + escapeHtml(c.id) + '" aria-label="댓글 삭제">🗑 삭제</button></div>' : '';
    return '<li class="feed-comment" data-comment-id="' + escapeHtml(c.id) + '">' + avatar +
      '<div class="feed-comment__body">' + replyToLine +
      '<span class="feed-comment__author">' + escapeHtml(name) + '</span>' +
      (levelEmoji ? ' <span class="feed-card__level" aria-hidden="true">' + levelEmoji + '</span>' : '') +
      ' <span class="feed-comment__date">' + dateStr + '</span>' +
      '<p class="feed-comment__text">' + escapeHtml((c && c.body) ? c.body : '') + '</p>' + heartRow + '</div>' + adminDeleteHtml + '</li>';
  }

  function renderPost(p) {
    if (!root || !p || !p.id) return;
    var author = (p.authorDisplayName != null && p.authorDisplayName !== '') ? p.authorDisplayName : '—';
    var me = (window.TornFiAuth && window.TornFiAuth.getUser()) || null;
    var myId = me ? (me.id || null) : null;
    var isAdmin = !!(me && me.isAdmin);
    var comments = Array.isArray(p.comments) ? p.comments : [];
    var postLv = (p.authorLevel >= 1 && p.authorLevel <= 6) ? p.authorLevel : 0;
    var postLevelEmoji = LEVEL_EMOJI[postLv] || '';
    var avatarHtml = (p.authorProfileImageUrl && String(p.authorProfileImageUrl).trim())
      ? '<img class="feed-card__avatar feed-card__avatar--img" src="' + escapeHtml(p.authorProfileImageUrl) + '" alt="" loading="lazy">'
      : '<span class="feed-card__avatar" aria-hidden="true">' + (author.charAt(0) || '?') + '</span>';
    var bodyHtml = (escapeHtml(p.body || '')).replace(/\n/g, '<br>');
    var dateStr = formatDate(p.createdAt);
    var img = (p.images && p.images[0]) ? '<img src="' + escapeHtml(p.images[0]) + '" alt="" class="feed-card__thumb" loading="lazy">' : '';
    var heartsReceived = (p.heartsReceived || 0) > 0 ? p.heartsReceived : 0;
    var isMine = !!(myId && p.authorId === myId);
    var footer = '<div class="feed-card__footer">';
    if (heartsReceived > 0) footer += '<span class="feed-card__hearts">❤️ ' + heartsReceived + '</span>';
    footer += '</div>';
    var topActionsHtml = (!isMine && myId) ? '<div class="feed-card__top-actions"><button type="button" class="feed-card-heart-btn" data-post-id="' + escapeHtml(p.id) + '" data-author-name="' + escapeHtml(author) + '">❤️ 보내기</button></div>' : '';
    var commentsHtml = '<div class="feed-card__comments-title">댓글 ' + comments.length + '</div>' +
      '<ul class="feed-card__comments-list">' + comments.map(function (c) { return renderComment(c, myId, p.id, isAdmin); }).join('') + '</ul>';
    if (myId) commentsHtml += '<div class="feed-card__comment-form" data-post-id="' + escapeHtml(p.id) + '">' +
      '<div class="feed-card__reply-to-chip" style="display:none;">답글: <span class="feed-card__reply-to-name"></span> <button type="button" class="feed-card__reply-to-cancel">취소</button></div>' +
      '<input type="text" class="feed-card__comment-input" placeholder="댓글을 입력하세요..." maxlength="1000" data-post-id="' + escapeHtml(p.id) + '">' +
      '<button type="button" class="feed-card__comment-submit">댓글</button></div>';
    var adminDeleteBtn = isAdmin ? '<div class="feed-card-admin-outer"><button type="button" class="feed-card__admin-delete" data-post-id="' + escapeHtml(p.id) + '" aria-label="피드 삭제">🗑 삭제</button></div>' : '';
    currentPost = p;
    var cardInner = '<article class="feed-card" data-post-id="' + escapeHtml(p.id) + '">' +
      '<div class="feed-card__link">' +
        '<div class="feed-card__top">' + avatarHtml +
          '<div class="feed-card__content">' +
            '<div class="feed-card__meta-row">' +
              '<div class="feed-card__meta">' +
                '<span class="feed-card__meta-name">' +
                  '<span class="feed-card__author">' + escapeHtml(author) + '</span>' +
                  (postLevelEmoji ? '<span class="feed-card__level" aria-hidden="true">' + postLevelEmoji + '</span>' : '') +
                '</span><span class="feed-card__meta-sep" aria-hidden="true">·</span>' +
                '<time class="feed-card__date" datetime="' + (p.createdAt || '') + '">' + dateStr + '</time>' +
              '</div>' + topActionsHtml + '</div>' +
            (bodyHtml ? '<div class="feed-card__body"><p class="feed-card__excerpt feed-card__body-full">' + bodyHtml + '</p></div>' : '') +
            (img ? '<div class="feed-card__thumb-wrap">' + img + '</div>' : '') +
            '<div class="feed-card__actions">' + footer + '</div>' +
          '</div></div></div>' +
      '<div class="feed-card__comments">' + commentsHtml + '</div></article>';
    root.innerHTML = isAdmin ? '<div class="feed-card-wrap">' + cardInner + adminDeleteBtn + '</div>' : cardInner;
  }

  function attachHandlers() {
    var feedSendHeartLayer = document.getElementById('feedSendHeartLayer');
    var feedSendHeartMessage = document.getElementById('feedSendHeartMessage');
    var feedSendHeartMyHearts = document.getElementById('feedSendHeartMyHearts');
    var feedSendHeartCancel = document.getElementById('feedSendHeartCancel');
    var feedSendHeartOk = document.getElementById('feedSendHeartOk');
    var pendingPostId = null, pendingCommentId = null;

    function openHeartModal(pid, authorName, commentId) {
      pendingPostId = pid;
      pendingCommentId = commentId || null;
      if (feedSendHeartMessage) feedSendHeartMessage.textContent = (authorName || '이 사용자') + '님에게 하트 1개를 보내시겠습니까?';
      fetch('/api/me', { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (data) {
        if (feedSendHeartMyHearts) feedSendHeartMyHearts.textContent = '보유 하트: ' + (data.ok && data.user && typeof data.user.points === 'number' ? data.user.points : 0) + '개';
      });
      if (feedSendHeartLayer) feedSendHeartLayer.style.display = 'flex';
    }
    function closeHeartModal() {
      pendingPostId = null;
      pendingCommentId = null;
      if (feedSendHeartLayer) feedSendHeartLayer.style.display = 'none';
    }
    if (feedSendHeartCancel) feedSendHeartCancel.addEventListener('click', closeHeartModal);
    if (feedSendHeartOk) feedSendHeartOk.addEventListener('click', function () {
      if (!pendingPostId) return;
      var pid = pendingPostId, cid = pendingCommentId;
      feedSendHeartOk.disabled = true;
      var url = cid
        ? '/api/feed/' + encodeURIComponent(pid) + '/comments/' + encodeURIComponent(cid) + '/send-heart'
        : '/api/feed/' + encodeURIComponent(pid) + '/send-heart';
      fetch(url, { method: 'POST', credentials: 'same-origin' })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          feedSendHeartOk.disabled = false;
          closeHeartModal();
          if (data.ok) {
            if (cid) {
              var li = root.querySelector('.feed-comment[data-comment-id="' + cid + '"]');
              if (li) {
                var f = li.querySelector('.feed-comment__footer');
                if (f) {
                  var he = f.querySelector('.feed-comment__hearts');
                  var n = data.heartsReceived || 0;
                  if (he) he.textContent = '❤️ ' + n;
                  else if (n > 0) { var s = document.createElement('span'); s.className = 'feed-comment__hearts'; s.textContent = '❤️ ' + n; f.insertBefore(s, f.firstChild); }
                  var b = f.querySelector('.feed-comment-heart-btn');
                  if (b) b.remove();
                }
              }
            } else {
              var card = root.querySelector('.feed-card');
              if (card) {
                var b = card.querySelector('.feed-card-heart-btn');
                if (b) b.remove();
                var f = card.querySelector('.feed-card__footer');
                if (f) {
                  var he = f.querySelector('.feed-card__hearts');
                  var n = data.heartsReceived || 0;
                  if (he) he.textContent = '❤️ ' + n;
                  else if (n > 0) { var s = document.createElement('span'); s.className = 'feed-card__hearts'; s.textContent = '❤️ ' + n; f.insertBefore(s, f.firstChild); }
                }
              }
            }
            if (data.message) alert(data.message);
          } else if (data.message) alert(data.message);
        })
        .catch(function () { feedSendHeartOk.disabled = false; alert('하트 전송 중 오류가 발생했습니다.'); });
    });
    if (feedSendHeartLayer && feedSendHeartLayer.querySelector('.feed-send-heart-box')) {
      feedSendHeartLayer.addEventListener('click', function (e) { if (e.target === feedSendHeartLayer) closeHeartModal(); });
    }

    if (root) {
      var feedDeleteLayer = document.getElementById('feedDeleteConfirmLayer');
      var feedDeleteCancel = document.getElementById('feedDeleteConfirmCancel');
      var feedDeleteOk = document.getElementById('feedDeleteConfirmOk');
      var feedDeleteConfirmTitle = document.getElementById('feedDeleteConfirmTitlePost');
      var feedDeleteConfirmMsg = document.querySelector('#feedDeleteConfirmLayer .feed-delete-confirm-msg');
      var feedAdminPinLayer = document.getElementById('feedAdminPinLayer');
      var feedAdminPinInput = document.getElementById('feedAdminPinInput');
      var feedAdminPinErr = document.getElementById('feedAdminPinErr');
      var feedAdminPinCancel = document.getElementById('feedAdminPinCancel');
      var feedAdminPinOk = document.getElementById('feedAdminPinOk');
      var pendingDeletePostId = null;
      var pendingDeleteBtn = null;
      var pendingCommentDelete = null;

      function closeFeedDeleteModal() {
        pendingDeletePostId = null;
        pendingDeleteBtn = null;
        pendingCommentDelete = null;
        if (feedDeleteLayer) feedDeleteLayer.style.display = 'none';
      }

      function closeFeedAdminPinModal() {
        if (feedAdminPinLayer) feedAdminPinLayer.style.display = 'none';
        if (feedAdminPinErr) { feedAdminPinErr.style.display = 'none'; feedAdminPinErr.textContent = ''; }
        if (feedAdminPinInput) feedAdminPinInput.value = '';
        if (pendingDeleteBtn) pendingDeleteBtn.disabled = false;
        pendingDeletePostId = null;
        pendingDeleteBtn = null;
        pendingCommentDelete = null;
      }

      function doCommentDelete() {
        if (!pendingCommentDelete) return;
        if (feedDeleteLayer) feedDeleteLayer.style.display = 'none';
        var postId = pendingCommentDelete.postId;
        var commentId = pendingCommentDelete.commentId;
        var li = pendingCommentDelete.li;
        fetch('/api/feed/' + encodeURIComponent(postId) + '/comments/' + encodeURIComponent(commentId), { method: 'DELETE', credentials: 'same-origin' })
          .then(function (r) { return r.json(); })
          .then(function (data) {
            if (data.ok) {
              if (li && li.parentNode) li.parentNode.removeChild(li);
              var titleEl = root.querySelector('.feed-card__comments-title');
              if (titleEl) titleEl.textContent = '댓글 ' + root.querySelectorAll('.feed-comment').length;
              pendingCommentDelete = null;
            } else if (data.needPin && feedAdminPinLayer) {
              feedAdminPinLayer.style.display = 'flex';
              if (feedAdminPinInput) { feedAdminPinInput.value = ''; feedAdminPinInput.focus(); }
              if (feedAdminPinErr) { feedAdminPinErr.style.display = 'none'; feedAdminPinErr.textContent = ''; }
            } else {
              alert(data.message || '댓글 삭제에 실패했습니다.');
              pendingCommentDelete = null;
            }
          })
          .catch(function () { alert('댓글 삭제 요청에 실패했습니다.'); pendingCommentDelete = null; });
      }

      function doFeedDelete() {
        if (!pendingDeletePostId || !pendingDeleteBtn) return;
        var postId = pendingDeletePostId;
        var btn = pendingDeleteBtn;
        if (feedDeleteLayer) feedDeleteLayer.style.display = 'none';
        btn.disabled = true;
        fetch('/api/feed/' + encodeURIComponent(postId), { method: 'DELETE', credentials: 'same-origin' })
          .then(function (r) { return r.json(); })
          .then(function (data) {
            if (data.ok) {
              window.location.href = '/';
            } else if (data.needPin && feedAdminPinLayer) {
              feedAdminPinLayer.style.display = 'flex';
              if (feedAdminPinInput) { feedAdminPinInput.value = ''; feedAdminPinInput.focus(); }
              if (feedAdminPinErr) { feedAdminPinErr.style.display = 'none'; feedAdminPinErr.textContent = ''; }
            } else {
              alert(data.message || '삭제에 실패했습니다.');
              btn.disabled = false;
              pendingDeletePostId = null;
              pendingDeleteBtn = null;
            }
          })
          .catch(function () {
            alert('삭제 요청에 실패했습니다.');
            btn.disabled = false;
            pendingDeletePostId = null;
            pendingDeleteBtn = null;
          });
      }

      function submitFeedAdminPin() {
        var pin = (feedAdminPinInput && feedAdminPinInput.value) ? feedAdminPinInput.value.trim() : '';
        if (pin.length !== 6 || !/^[0-9]+$/.test(pin)) {
          if (feedAdminPinErr) { feedAdminPinErr.textContent = '숫자 6자리를 입력해 주세요.'; feedAdminPinErr.style.display = 'block'; }
          return;
        }
        if (feedAdminPinErr) feedAdminPinErr.style.display = 'none';
        fetch('/api/admin/verify-pin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ pin: pin }) })
          .then(function (r) { return r.json(); })
          .then(function (data) {
            if (data.ok) {
              if (feedAdminPinLayer) feedAdminPinLayer.style.display = 'none';
              if (feedAdminPinInput) feedAdminPinInput.value = '';
              if (feedAdminPinErr) feedAdminPinErr.style.display = 'none';
              if (pendingCommentDelete) { doCommentDelete(); } else { doFeedDelete(); }
            } else {
              if (feedAdminPinErr) { feedAdminPinErr.textContent = data.message || '비밀번호가 올바르지 않습니다.'; feedAdminPinErr.style.display = 'block'; }
            }
          })
          .catch(function () {
            if (feedAdminPinErr) { feedAdminPinErr.textContent = '요청에 실패했습니다.'; feedAdminPinErr.style.display = 'block'; }
          });
      }

      function onFeedDeleteConfirmOk() {
        if (pendingCommentDelete) doCommentDelete();
        else doFeedDelete();
      }
      if (feedDeleteCancel) feedDeleteCancel.addEventListener('click', closeFeedDeleteModal);
      if (feedDeleteOk) feedDeleteOk.addEventListener('click', onFeedDeleteConfirmOk);
      if (feedDeleteLayer) {
        feedDeleteLayer.addEventListener('click', function (e) { if (e.target === feedDeleteLayer) closeFeedDeleteModal(); });
      }
      if (feedAdminPinCancel) feedAdminPinCancel.addEventListener('click', closeFeedAdminPinModal);
      if (feedAdminPinOk) feedAdminPinOk.addEventListener('click', submitFeedAdminPin);
      if (feedAdminPinLayer) {
        feedAdminPinLayer.addEventListener('click', function (e) { if (e.target === feedAdminPinLayer) closeFeedAdminPinModal(); });
      }
      if (feedAdminPinInput) {
        feedAdminPinInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); submitFeedAdminPin(); } });
      }
      root.addEventListener('click', function (e) {
        var commentDeleteBtn = e.target && e.target.closest && e.target.closest('.feed-comment-admin-delete');
        if (commentDeleteBtn) {
          e.preventDefault();
          e.stopPropagation();
          var postId = commentDeleteBtn.getAttribute('data-post-id');
          var commentId = commentDeleteBtn.getAttribute('data-comment-id');
          var li = commentDeleteBtn.closest('.feed-comment');
          if (!postId || !commentId || !li) return;
          pendingCommentDelete = { postId: postId, commentId: commentId, li: li };
          if (feedDeleteConfirmTitle) feedDeleteConfirmTitle.textContent = '댓글 삭제';
          if (feedDeleteConfirmMsg) feedDeleteConfirmMsg.textContent = '이 댓글을 삭제하시겠습니까? 삭제된 댓글은 관리자 페이지에서 복구할 수 있습니다.';
          if (feedDeleteLayer) feedDeleteLayer.style.display = 'flex';
          return;
        }
        var btn = e.target && e.target.closest && e.target.closest('.feed-card__admin-delete');
        if (btn) {
          e.preventDefault();
          e.stopPropagation();
          var postId = btn.getAttribute('data-post-id');
          if (!postId) return;
          pendingDeletePostId = postId;
          pendingDeleteBtn = btn;
          if (feedDeleteConfirmTitle) feedDeleteConfirmTitle.textContent = '피드 삭제';
          if (feedDeleteConfirmMsg) feedDeleteConfirmMsg.textContent = '이 피드 글을 삭제하시겠습니까?';
          if (feedDeleteLayer) feedDeleteLayer.style.display = 'flex';
        }
      });
    }

    var feedAuthorPopover = document.getElementById('feedAuthorPopover');
    var popoverHideTimeout = null;
    var popoverOpenedByClick = false;
    function clearPopoverHideTimeout() {
      if (popoverHideTimeout) { clearTimeout(popoverHideTimeout); popoverHideTimeout = null; }
    }
    function showAuthorPopover(post, triggerEl) {
      if (!feedAuthorPopover || !post) return;
      var name = post.authorDisplayName || '—';
      var lv = (post.authorLevel >= 1 && post.authorLevel <= 6) ? post.authorLevel : 0;
      var levelEmoji = LEVEL_EMOJI[lv] || '';
      var levelName = LEVEL_NAMES[lv] ? LEVEL_NAMES[lv] + ' (Lv.' + lv + ')' : '';
      var avatarWrap = feedAuthorPopover.querySelector('.feed-author-popover__avatar-wrap');
      var nameEl = feedAuthorPopover.querySelector('.feed-author-popover__name');
      var levelEl = feedAuthorPopover.querySelector('.feed-author-popover__level');
      var bioEl = feedAuthorPopover.querySelector('.feed-author-popover__bio');
      if (avatarWrap) {
        avatarWrap.innerHTML = '';
        if (post.authorProfileImageUrl && post.authorProfileImageUrl.trim()) {
          var img = document.createElement('img');
          img.src = post.authorProfileImageUrl;
          img.alt = '';
          avatarWrap.appendChild(img);
        } else {
          avatarWrap.textContent = name.charAt(0) || '?';
        }
      }
      if (nameEl) nameEl.textContent = name;
      if (levelEl) levelEl.textContent = levelEmoji ? levelEmoji + ' ' + levelName : '';
      if (levelEl) levelEl.style.display = levelEmoji ? '' : 'none';
      var heartsEl = feedAuthorPopover.querySelector('.feed-author-popover__hearts');
      if (heartsEl) {
        var pts = typeof post.authorPoints === 'number' ? post.authorPoints : 0;
        heartsEl.textContent = '❤️ ' + pts + '개';
        heartsEl.style.display = 'block';
      }
      if (bioEl) {
        var bio = (post.authorBio && post.authorBio.trim()) ? post.authorBio.trim() : '';
        bioEl.textContent = bio || '자기소개가 없습니다.';
        bioEl.style.display = 'block';
      }
      if (triggerEl) {
        var rect = triggerEl.getBoundingClientRect();
        feedAuthorPopover.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - 280)) + 'px';
        var top = rect.bottom + 8;
        if (top + 120 > window.innerHeight - 8) top = rect.top - 120;
        feedAuthorPopover.style.top = Math.max(8, top) + 'px';
      }
      feedAuthorPopover.style.display = 'block';
      feedAuthorPopover.classList.add('is-open');
      feedAuthorPopover.setAttribute('aria-hidden', 'false');
    }
    function hideAuthorPopover() {
      if (!feedAuthorPopover) return;
      feedAuthorPopover.classList.remove('is-open');
      feedAuthorPopover.style.display = 'none';
      feedAuthorPopover.setAttribute('aria-hidden', 'true');
      popoverOpenedByClick = false;
    }
    var authorTriggerSel = '.feed-card__top .feed-card__avatar, .feed-card__top .feed-card__author';
    root.addEventListener('mouseover', function (e) {
      var trigger = e.target.closest && e.target.closest(authorTriggerSel);
      if (!trigger) return;
      clearPopoverHideTimeout();
      if (currentPost) { popoverOpenedByClick = false; showAuthorPopover(currentPost, trigger); }
    });
    root.addEventListener('mouseout', function (e) {
      var trigger = e.target.closest && e.target.closest(authorTriggerSel);
      if (!trigger) return;
      var related = e.relatedTarget;
      if (related && feedAuthorPopover && (trigger.contains(related) || feedAuthorPopover.contains(related))) return;
      popoverHideTimeout = setTimeout(hideAuthorPopover, 200);
    });
    if (feedAuthorPopover) {
      feedAuthorPopover.addEventListener('mouseenter', clearPopoverHideTimeout);
      feedAuthorPopover.addEventListener('mouseleave', function () {
        popoverHideTimeout = setTimeout(hideAuthorPopover, 200);
      });
    }
    document.addEventListener('click', function (e) {
      if (!popoverOpenedByClick || !feedAuthorPopover || !feedAuthorPopover.classList.contains('is-open')) return;
      if (feedAuthorPopover.contains(e.target)) return;
      var trigger = e.target.closest && e.target.closest(authorTriggerSel);
      if (trigger && root.contains(trigger)) return;
      hideAuthorPopover();
    });
    root.addEventListener('click', function (e) {
      var authorTrigger = e.target.closest && e.target.closest(authorTriggerSel);
      if (authorTrigger) {
        e.preventDefault();
        e.stopPropagation();
        if (currentPost) {
          popoverOpenedByClick = true;
          if (feedAuthorPopover && feedAuthorPopover.classList.contains('is-open')) hideAuthorPopover();
          else showAuthorPopover(currentPost, authorTrigger);
        }
        return;
      }
    }, true);

    root.addEventListener('click', function (e) {
      var heartBtn = e.target.closest && e.target.closest('.feed-card-heart-btn');
      if (heartBtn) {
        e.preventDefault();
        e.stopPropagation();
        var pid = heartBtn.getAttribute('data-post-id');
        var authorName = heartBtn.getAttribute('data-author-name') || '이 사용자';
        if (!pid) return;
        var me = (window.TornFiAuth && window.TornFiAuth.getUser()) || {};
        if (!me.id) { alert('로그인 후 하트를 보낼 수 있습니다.'); return; }
        openHeartModal(pid, authorName, null);
        return;
      }
      var commentHeartBtn = e.target.closest && e.target.closest('.feed-comment-heart-btn');
      if (commentHeartBtn) {
        e.preventDefault();
        e.stopPropagation();
        var pid = commentHeartBtn.getAttribute('data-post-id');
        var cid = commentHeartBtn.getAttribute('data-comment-id');
        var authorName = commentHeartBtn.getAttribute('data-author-name') || '이 사용자';
        if (!pid || !cid) return;
        var me = (window.TornFiAuth && window.TornFiAuth.getUser()) || {};
        if (!me.id) { alert('로그인 후 하트를 보낼 수 있습니다.'); return; }
        openHeartModal(pid, authorName, cid);
        return;
      }
      var replyToCancel = e.target.closest && e.target.closest('.feed-card__reply-to-cancel');
      if (replyToCancel) {
        e.preventDefault();
        var formWrap = replyToCancel.closest('.feed-card__comment-form');
        if (formWrap) {
          formWrap.dataset.replyToCommentId = '';
          formWrap.dataset.replyToDisplayName = '';
          var chip = formWrap.querySelector('.feed-card__reply-to-chip');
          if (chip) chip.style.display = 'none';
        }
        return;
      }
      var replyBtn = e.target.closest && e.target.closest('.feed-comment-reply-btn');
      if (replyBtn) {
        e.preventDefault();
        var pid = replyBtn.getAttribute('data-post-id');
        var cid = replyBtn.getAttribute('data-comment-id');
        var authorName = replyBtn.getAttribute('data-author-name') || '';
        if (!pid || !cid) return;
        var card = replyBtn.closest('.feed-card');
        var formWrap = card && card.querySelector('.feed-card__comment-form');
        if (formWrap) {
          formWrap.dataset.replyToCommentId = cid;
          formWrap.dataset.replyToDisplayName = authorName;
          var chip = formWrap.querySelector('.feed-card__reply-to-chip');
          var nameSpan = formWrap.querySelector('.feed-card__reply-to-name');
          if (chip) { chip.style.display = 'inline-flex'; if (nameSpan) nameSpan.textContent = authorName || '—'; }
          var input = formWrap.querySelector('.feed-card__comment-input');
          if (input) { input.focus(); input.placeholder = (authorName ? '@' + authorName + '에게 답글...' : '답글 입력...'); }
        }
        return;
      }
      var commentSubmit = e.target.closest && e.target.closest('.feed-card__comment-submit');
      if (commentSubmit) {
        e.preventDefault();
        var formWrap = commentSubmit.closest('.feed-card__comment-form');
        var input = formWrap && formWrap.querySelector('.feed-card__comment-input');
        var pid = formWrap && formWrap.getAttribute('data-post-id');
        var body = input && input.value ? input.value.trim() : '';
        var replyToCommentId = formWrap && formWrap.dataset.replyToCommentId ? formWrap.dataset.replyToCommentId.trim() : '';
        if (!pid || !body) return;
        commentSubmit.disabled = true;
        var payload = { body: body };
        if (replyToCommentId) payload.replyToCommentId = replyToCommentId;
        fetch('/api/feed/' + encodeURIComponent(pid) + '/comments', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
          .then(function (r) { return r.json(); })
          .then(function (data) {
            commentSubmit.disabled = false;
            if (data.ok && data.comment) {
              input.value = '';
              if (formWrap) {
                formWrap.dataset.replyToCommentId = '';
                formWrap.dataset.replyToDisplayName = '';
                var chip = formWrap.querySelector('.feed-card__reply-to-chip');
                if (chip) chip.style.display = 'none';
                if (input) input.placeholder = '댓글을 입력하세요...';
              }
              var list = root.querySelector('.feed-card__comments-list');
              var titleEl = root.querySelector('.feed-card__comments-title');
              if (list) {
                var li = document.createElement('li');
                li.className = 'feed-comment';
                li.setAttribute('data-comment-id', data.comment.id);
                var name = (data.comment.authorDisplayName || '—');
                var av = (data.comment.authorProfileImageUrl && data.comment.authorProfileImageUrl.trim())
                  ? '<img class="feed-comment__avatar feed-card__avatar--img" src="' + String(data.comment.authorProfileImageUrl).replace(/"/g, '&quot;') + '" alt="" loading="lazy">'
                  : '<span class="feed-comment__avatar" aria-hidden="true">' + (name.charAt(0) || '?') + '</span>';
                var dateStr = formatDate(data.comment.createdAt);
                var replyToLine = (data.comment.replyToDisplayName && data.comment.replyToDisplayName.trim())
                  ? '<div class="feed-comment__reply-to">답글: <span class="feed-comment__reply-to-name">@' + String(data.comment.replyToDisplayName || '').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</span></div>'
                  : '';
                li.innerHTML = av + '<div class="feed-comment__body">' + replyToLine +
                  '<span class="feed-comment__author">' + String(name).replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</span>' +
                  '<span class="feed-comment__date">' + dateStr + '</span>' +
                  '<p class="feed-comment__text">' + String(data.comment.body || '').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</p></div>';
                list.appendChild(li);
              }
              if (titleEl) titleEl.textContent = '댓글 ' + root.querySelectorAll('.feed-comment').length;
            } else if (data.message) alert(data.message);
          })
          .catch(function () { commentSubmit.disabled = false; alert('댓글 전송에 실패했습니다.'); });
      }
    });
    root.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      var input = e.target.closest && e.target.closest('.feed-card__comment-input');
      if (!input) return;
      var formWrap = input.closest('.feed-card__comment-form');
      var btn = formWrap && formWrap.querySelector('.feed-card__comment-submit');
      if (btn) { e.preventDefault(); btn.click(); }
    });
  }

  function showError(msg) {
    if (root) root.innerHTML = '<p class="text-muted">' + escapeHtml(msg) + '</p>';
  }

  function initNav() {
    var navAdminCenter = document.getElementById('navAdminCenter');
    var navMenuBtn = document.getElementById('navMenuBtn');
    var navMenuDropdown = document.getElementById('navMenuDropdown');
    function updateNav(user) {
      if (user) {
        if (navMenuBtn) navMenuBtn.style.display = 'none';
        if (navAdminCenter) navAdminCenter.style.display = user.isAdmin ? 'inline-flex' : 'none';
      } else {
        if (navMenuBtn) navMenuBtn.style.display = 'none';
        if (navAdminCenter) navAdminCenter.style.display = 'none';
      }
    }
    if (window.TornFiAuth) window.TornFiAuth.onUser(updateNav);
    updateNav(window.TornFiAuth ? window.TornFiAuth.getUser() : null);
    if (navMenuBtn && navMenuDropdown) {
      navMenuBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        var open = navMenuDropdown.classList.toggle('is-open');
        navMenuBtn.setAttribute('aria-expanded', open);
      });
      navMenuDropdown.addEventListener('click', function (e) { e.stopPropagation(); });
      document.addEventListener('click', function () {
        navMenuDropdown.classList.remove('is-open');
        navMenuBtn.setAttribute('aria-expanded', 'false');
      });
    }
  }

  function init() {
    initNav();
    var params = new URLSearchParams(window.location.search);
    var postId = (params.get('id') || '').trim();
    root = document.getElementById('feedPostRoot');
    if (!root) return;
    if (!postId) {
      showError('글을 찾을 수 없습니다.');
      return;
    }

    var cached = null;
    try {
      var raw = sessionStorage.getItem('feedPost_' + postId);
      if (raw) cached = JSON.parse(raw);
      if (cached && cached.id) sessionStorage.removeItem('feedPost_' + postId);
    } catch (err) {
      cached = null;
    }

    if (cached && cached.id) {
      renderPost(cached);
      attachHandlers();
    }

    fetch('/api/feed/' + encodeURIComponent(postId), { credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data && data.ok && data.post) {
          renderPost(data.post);
          if (!cached || !cached.id) attachHandlers();
        } else if (!cached || !cached.id) {
          showError(data && data.message ? data.message : '글을 불러올 수 없습니다.');
        }
      })
      .catch(function () {
        if (!cached || !cached.id) showError('불러오기에 실패했습니다.');
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
