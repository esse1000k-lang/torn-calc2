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

  function renderComment(c, myId, pid, isAdmin, opts) {
    opts = opts || {};
    var name = (c && c.authorDisplayName) ? c.authorDisplayName : '—';
    var isMine = !!(myId && c && c.authorId === myId);
    var hearts = (c && (c.heartsReceived || 0) > 0) ? c.heartsReceived : 0;
    var lv = (c && c.authorLevel >= 1 && c.authorLevel <= 6) ? c.authorLevel : 0;
    var levelEmoji = LEVEL_EMOJI[lv] || '';
    var avatar = (c && c.authorProfileImageUrl && c.authorProfileImageUrl.trim())
      ? '<img class="feed-comment__avatar feed-card__avatar--img" src="' + escapeHtml(c.authorProfileImageUrl) + '" alt="" loading="lazy">'
      : '<span class="feed-comment__avatar" aria-hidden="true">' + (name.charAt(0) || '?') + '</span>';
    var dateStr = formatDate(c && c.createdAt);
    var replyToLine = (opts.showReplyTo && c && c.replyToCommentId && c.replyToDisplayName)
      ? '<div class="feed-comment__reply-to">답글: <span class="feed-comment__reply-to-name">@' + escapeHtml(c.replyToDisplayName) + '</span></div>'
      : '';
    var heartRow = '';
    if (hearts > 0) heartRow += '<span class="feed-comment__hearts"><span class="icon-heart" aria-hidden="true"></span> ' + hearts + '</span>';
    else if (isMine) heartRow += '<span class="feed-comment__hearts"><span class="icon-heart" aria-hidden="true"></span> 0</span>';
    else if (myId && pid) heartRow += '<button type="button" class="feed-comment-heart-btn" data-post-id="' + escapeHtml(pid) + '" data-comment-id="' + escapeHtml(c.id) + '" data-author-name="' + escapeHtml(name) + '" aria-label="하트 보내기"><span class="icon-heart" aria-hidden="true"></span> 0</button>';
    else heartRow += '<span class="feed-comment__hearts"><span class="icon-heart" aria-hidden="true"></span> 0</span>';
    if (opts.replyCount != null && opts.replyCount > 0) {
      heartRow += '<span class="feed-comment__reply-count">답글 ' + opts.replyCount + '</span>';
    }
    if (heartRow) heartRow = '<div class="feed-comment__footer">' + heartRow + '</div>';
    var canDeleteComment = (isAdmin || isMine) && pid && c && c.id;
    var adminDeleteHtml = canDeleteComment ? '<div class="feed-comment-admin-outer"><button type="button" class="feed-card__admin-delete feed-comment-admin-delete" data-post-id="' + escapeHtml(pid) + '" data-comment-id="' + escapeHtml(c.id) + '" aria-label="댓글 삭제">🗑 삭제</button></div>' : '';
    var imagesHtml = '';
    if (c && c.images && c.images.length > 0) {
      imagesHtml = '<div class="feed-comment__images feed-card__images">' + c.images.map(function (src) {
        return '<div class="feed-card__images-item"><img src="' + escapeHtml(src) + '" alt="" class="feed-card__thumb" loading="lazy"></div>';
      }).join('') + '</div>';
    }
    var liClass = 'feed-comment' + (opts.isThreadHead ? ' feed-comment--thread-head' : '');
    return '<li class="' + liClass + '" data-comment-id="' + escapeHtml(c.id) + '">' + avatar +
      '<div class="feed-comment__body">' + replyToLine +
      '<span class="feed-comment__author">' + escapeHtml(name) + '</span>' +
      (levelEmoji ? ' <span class="feed-card__level" aria-hidden="true">' + levelEmoji + '</span>' : '') +
      ' <span class="feed-comment__date">' + dateStr + '</span>' +
      '<p class="feed-comment__text">' + escapeHtml((c && c.body) ? c.body : '') + '</p>' + imagesHtml + heartRow + '</div>' + adminDeleteHtml + '</li>';
  }

  function renderPost(p) {
    if (!root || !p || !p.id) return;
    var author = (p.authorDisplayName != null && p.authorDisplayName !== '') ? p.authorDisplayName : '—';
    var me = (window.TornFiAuth && window.TornFiAuth.getUser()) || null;
    var myId = me ? (me.id || null) : null;
    var isAdmin = !!(me && me.isAdmin);
    var comments = Array.isArray(p.comments) ? p.comments : [];
    var commentCount = comments.length;
    var topLevel = comments.filter(function (c) { return !c.replyToCommentId || c.replyToCommentId === ''; });
    var commentsListHtml = topLevel.map(function (c) {
      var replyCount = comments.filter(function (r) { return r.replyToCommentId === c.id; }).length;
      var replyCountOpt = replyCount > 0 ? { replyCount: replyCount } : {};
      var html = renderComment(c, myId, p.id, isAdmin, replyCountOpt);
      var replies = comments.filter(function (r) { return r.replyToCommentId === c.id; }).sort(function (a, b) { return new Date(a.createdAt) - new Date(b.createdAt); });
      replies.forEach(function (r) {
        html += renderComment(r, myId, p.id, isAdmin, { showReplyTo: true });
      });
      return html;
    }).join('');
    var postLv = (p.authorLevel >= 1 && p.authorLevel <= 6) ? p.authorLevel : 0;
    var postLevelEmoji = LEVEL_EMOJI[postLv] || '';
    var avatarHtml = (p.authorProfileImageUrl && String(p.authorProfileImageUrl).trim())
      ? '<img class="feed-card__avatar feed-card__avatar--img" src="' + escapeHtml(p.authorProfileImageUrl) + '" alt="" loading="lazy">'
      : '<span class="feed-card__avatar" aria-hidden="true">' + (author.charAt(0) || '?') + '</span>';
    var bodyHtml = (escapeHtml(p.body || '')).replace(/\n/g, '<br>');
    var dateStr = formatDate(p.createdAt);
    var imagesHtml = '';
    if (p.images && p.images.length > 0) {
      imagesHtml = '<div class="feed-card__images">' + p.images.map(function (src) {
        return '<div class="feed-card__images-item"><img src="' + escapeHtml(src) + '" alt="" class="feed-card__thumb" loading="lazy"></div>';
      }).join('') + '</div>';
    }
    var heartsReceived = Number(p.heartsReceived) || 0;
    var isMine = !!(myId && p.authorId != null && String(p.authorId) === String(myId));
    var footer = '<div class="feed-card__footer">';
    if (isMine) {
      footer += '<span class="feed-card__hearts"><span class="icon-heart" aria-hidden="true"></span> ' + heartsReceived + '</span>';
    } else if (heartsReceived > 0) {
      footer += '<span class="feed-card__hearts"><span class="icon-heart" aria-hidden="true"></span> ' + heartsReceived + '</span>';
    } else if (myId) {
      footer += '<button type="button" class="feed-card-heart-btn" data-post-id="' + escapeHtml(p.id) + '" data-author-name="' + escapeHtml(author) + '" aria-label="하트 보내기"><span class="icon-heart" aria-hidden="true"></span> 0</button>';
    } else {
      footer += '<span class="feed-card__hearts"><span class="icon-heart" aria-hidden="true"></span> 0</span>';
    }
    footer += '</div>';
    var commentsHtml = '<span class="feed-card__comments"><span class="icon-comment" aria-hidden="true"></span> ' + commentCount + '</span>';
    var commentsListBlock = '<ul class="feed-card__comments-list">' + commentsListHtml + '</ul>';
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
              '</div></div>' +
            (bodyHtml ? '<div class="feed-card__body"><p class="feed-card__excerpt feed-card__body-full">' + bodyHtml + '</p></div>' : '') +
            (imagesHtml ? imagesHtml : '') +
            '<div class="feed-card__actions">' + footer + commentsHtml + '</div>' +
          '</div></div></div>' +
      '<div class="feed-card__comments">' + commentsListBlock + '</div></article>';
    root.innerHTML = cardInner;
    var feedFloatingBar = document.getElementById('feedFloatingBar');
    if (feedFloatingBar) {
      if (myId) {
        feedFloatingBar.style.display = 'block';
        feedFloatingBar.classList.add('is-visible');
        var feedComposeAvatarImg = document.getElementById('feedComposeAvatarImg');
        var feedComposeAvatar = document.getElementById('feedComposeAvatar');
        var me = (window.TornFiAuth && window.TornFiAuth.getUser()) || null;
        if (me && feedComposeAvatar) {
          if (me.profileImageUrl && String(me.profileImageUrl).trim()) {
            if (feedComposeAvatarImg) { feedComposeAvatarImg.src = me.profileImageUrl; feedComposeAvatarImg.style.display = ''; }
            feedComposeAvatar.style.display = 'none';
          } else {
            if (feedComposeAvatarImg) feedComposeAvatarImg.style.display = 'none';
            feedComposeAvatar.textContent = (me.displayName && me.displayName.charAt(0)) ? me.displayName.charAt(0).toUpperCase() : '?';
            feedComposeAvatar.style.display = '';
          }
        }
      } else {
        feedFloatingBar.style.display = 'none';
        feedFloatingBar.classList.remove('is-visible');
      }
    }
  }

  function showFeedAlert(msg) {
    var layer = document.getElementById('feedAlertLayer');
    var msgEl = document.getElementById('feedAlertMessage');
    if (msgEl) msgEl.textContent = msg || '';
    if (layer) layer.style.display = 'flex';
  }
  window.showFeedAlert = showFeedAlert;

  function attachHandlers() {
    var replyToCommentIdForCompose = '';
    var feedAlertLayer = document.getElementById('feedAlertLayer');
    var feedAlertOk = document.getElementById('feedAlertOk');
    if (feedAlertOk && feedAlertLayer) {
      feedAlertOk.addEventListener('click', function () { feedAlertLayer.style.display = 'none'; });
      feedAlertLayer.addEventListener('click', function (e) { if (e.target === feedAlertLayer) feedAlertLayer.style.display = 'none'; });
    }
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
          console.log('[feed/send-heart] response', data);
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
                  if (he) he.innerHTML = '<span class="icon-heart" aria-hidden="true"></span> ' + n;
                  else { var s = document.createElement('span'); s.className = 'feed-comment__hearts'; s.innerHTML = '<span class="icon-heart" aria-hidden="true"></span> ' + n; f.insertBefore(s, f.firstChild); }
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
                  if (he) he.innerHTML = '<span class="icon-heart" aria-hidden="true"></span> ' + n;
                  else { var s = document.createElement('span'); s.className = 'feed-card__hearts'; s.innerHTML = '<span class="icon-heart" aria-hidden="true"></span> ' + n; f.insertBefore(s, f.firstChild); }
                }
              }
            }
            if (data.message) showFeedAlert(data.message);
          } else if (data.message) showFeedAlert(data.message);
        })
        .catch(function () { feedSendHeartOk.disabled = false; showFeedAlert('하트 전송 중 오류가 발생했습니다.'); });
    });
    if (feedSendHeartLayer && feedSendHeartLayer.querySelector('.feed-send-heart-box')) {
      feedSendHeartLayer.addEventListener('click', function (e) { if (e.target === feedSendHeartLayer) closeHeartModal(); });
    }

    var container = root && root.closest('.feed-post-page') ? root.closest('.feed-post-page') : (root || document.body);
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
      var pendingCommentDelete = null;

      function closeFeedDeleteModal() {
        pendingCommentDelete = null;
        if (feedDeleteLayer) feedDeleteLayer.style.display = 'none';
      }

      function closeFeedAdminPinModal() {
        if (feedAdminPinLayer) feedAdminPinLayer.style.display = 'none';
        if (feedAdminPinErr) { feedAdminPinErr.style.display = 'none'; feedAdminPinErr.textContent = ''; }
        if (feedAdminPinInput) feedAdminPinInput.value = '';
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
              var countEl = root.querySelector('.feed-card__actions .feed-card__comments');
              if (countEl) countEl.innerHTML = '<span class="icon-comment" aria-hidden="true"></span> ' + root.querySelectorAll('.feed-comment').length;
              pendingCommentDelete = null;
            } else if (data.needPin && feedAdminPinLayer) {
              feedAdminPinLayer.style.display = 'flex';
              if (feedAdminPinInput) { feedAdminPinInput.value = ''; feedAdminPinInput.focus(); }
              if (feedAdminPinErr) { feedAdminPinErr.style.display = 'none'; feedAdminPinErr.textContent = ''; }
            } else {
              showFeedAlert(data.message || '댓글 삭제에 실패했습니다.');
              pendingCommentDelete = null;
            }
          })
          .catch(function () { showFeedAlert('댓글 삭제 요청에 실패했습니다.'); pendingCommentDelete = null; });
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
              if (pendingCommentDelete) doCommentDelete();
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
        var imagesWrap = e.target && e.target.closest && e.target.closest('.feed-card__images');
        if (imagesWrap) {
          var img = e.target.tagName === 'IMG' ? e.target : imagesWrap.querySelector('img');
          if (img && img.src) {
            e.preventDefault();
            e.stopPropagation();
            var layer = document.getElementById('feedImageFullscreen');
            var fullImg = document.getElementById('feedImageFullscreenImg');
            if (layer && fullImg) {
              fullImg.src = img.src;
              layer.style.display = 'flex';
            }
            return;
          }
        }
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
        }
      }, true);
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
        heartsEl.innerHTML = '<span class="icon-heart" aria-hidden="true"></span> ' + pts + '개';
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

    container.addEventListener('click', function (e) {
      var heartBtn = e.target.closest && e.target.closest('.feed-card-heart-btn');
      if (heartBtn) {
        e.preventDefault();
        e.stopPropagation();
        if (heartBtn.getAttribute('data-own-post') === '1') {
          showFeedAlert('본인 글에는 하트를 줄 수 없습니다.');
          return;
        }
        var pid = heartBtn.getAttribute('data-post-id');
        var authorName = heartBtn.getAttribute('data-author-name') || '이 사용자';
        if (!pid) return;
        var me = (window.TornFiAuth && window.TornFiAuth.getUser()) || {};
        if (!me.id) { showFeedAlert('로그인 후 하트를 보낼 수 있습니다.'); return; }
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
        if (!me.id) { showFeedAlert('로그인 후 하트를 보낼 수 있습니다.'); return; }
        openHeartModal(pid, authorName, cid);
        return;
      }
      var replyCancelBtn = e.target.closest && e.target.closest('.feed-post-reply-cancel');
      if (replyCancelBtn) {
        e.preventDefault();
        replyToCommentIdForCompose = '';
        var chip = document.querySelector('.feed-post-reply-chip');
        if (chip) chip.style.display = 'none';
        return;
      }
    });

    var feedFloatingBar = document.getElementById('feedFloatingBar');
    var feedFloatingBarTrigger = document.getElementById('feedFloatingBarTrigger');
    var feedComposePlaceholder = document.getElementById('feedComposePlaceholder');
    var feedComposeText = document.getElementById('feedComposeText');
    var feedComposeCollapse = document.getElementById('feedComposeCollapse');
    var feedComposeSubmit = document.getElementById('feedComposeSubmit');
    function expandFloatingCompose() {
      if (feedFloatingBar) feedFloatingBar.classList.add('is-expanded');
      if (feedComposeText) { feedComposeText.style.display = 'block'; feedComposeText.focus(); }
      if (feedComposePlaceholder) feedComposePlaceholder.style.display = 'none';
      if (feedComposeCollapse) feedComposeCollapse.style.display = '';
    }
    function collapseFloatingCompose() {
      if (feedFloatingBar) feedFloatingBar.classList.remove('is-expanded');
      if (feedComposeText) feedComposeText.style.display = 'none';
      if (feedComposePlaceholder) feedComposePlaceholder.style.display = '';
      if (feedComposeCollapse) feedComposeCollapse.style.display = 'none';
    }
    if (feedFloatingBarTrigger) feedFloatingBarTrigger.addEventListener('click', function (e) { e.stopPropagation(); expandFloatingCompose(); });
    if (feedComposePlaceholder) feedComposePlaceholder.addEventListener('click', expandFloatingCompose);
    if (feedComposeCollapse) feedComposeCollapse.addEventListener('click', collapseFloatingCompose);

    var feedComposeImage = document.getElementById('feedComposeImage');
    var feedComposePreview = document.getElementById('feedComposePreview');
    var composeFiles = [];
    var COMMENT_IMAGE_MAX = 3;
    function updateComposePreview() {
      if (!feedComposePreview) return;
      feedComposePreview.innerHTML = '';
      composeFiles.forEach(function (file, i) {
        var url = typeof URL !== 'undefined' && URL.createObjectURL ? URL.createObjectURL(file) : '';
        var item = document.createElement('div');
        item.className = 'feed-compose__preview-item';
        item.innerHTML = '<img src="' + (url || '') + '" alt=""><button type="button" class="feed-compose__remove-img" data-index="' + i + '" aria-label="제거">×</button>';
        feedComposePreview.appendChild(item);
      });
      var inner = document.getElementById('feedComposeInner');
      if (inner) inner.classList.toggle('has-preview', feedComposePreview.children.length > 0);
    }
    function getRemoveBtnFromEvent(e) {
      var t = e.target;
      while (t && t !== feedComposePreview) {
        if (t.classList && t.classList.contains('feed-compose__remove-img')) return t;
        t = t.parentNode;
      }
      return null;
    }
    if (feedComposeImage) {
      feedComposeImage.addEventListener('change', function () {
        var files = this.files ? Array.prototype.slice.call(this.files) : [];
        for (var i = 0; i < files.length && composeFiles.length < COMMENT_IMAGE_MAX; i++) {
          composeFiles.push(files[i]);
        }
        if (composeFiles.length > COMMENT_IMAGE_MAX) composeFiles.length = COMMENT_IMAGE_MAX;
        updateComposePreview();
        this.value = '';
      });
    }
    if (feedComposePreview) {
      feedComposePreview.addEventListener('click', function (e) {
        var btn = getRemoveBtnFromEvent(e);
        if (!btn) return;
        e.preventDefault();
        var idx = parseInt(btn.getAttribute('data-index'), 10);
        if (!isNaN(idx) && idx >= 0 && idx < composeFiles.length) {
          composeFiles.splice(idx, 1);
          updateComposePreview();
        }
      });
    }

    if (feedComposeSubmit && feedComposeText) {
      function updateSubmitState() { feedComposeSubmit.disabled = !feedComposeText.value.trim(); }
      feedComposeText.addEventListener('input', updateSubmitState);
      feedComposeText.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); feedComposeSubmit.click(); } });
      feedComposeSubmit.addEventListener('click', function () {
        if (!currentPost || !currentPost.id) return;
        var body = feedComposeText.value ? feedComposeText.value.trim() : '';
        if (!body) return;
        feedComposeSubmit.disabled = true;
        var url = '/api/feed/' + encodeURIComponent(currentPost.id) + '/comments';
        var hasFiles = composeFiles.length > 0;
        function done(data) {
          feedComposeSubmit.disabled = false;
          if (data.ok && data.comment) {
            feedComposeText.value = '';
            composeFiles.length = 0;
            if (feedComposeImage) feedComposeImage.value = '';
            updateComposePreview();
            replyToCommentIdForCompose = '';
            var chip = document.querySelector('.feed-post-reply-chip');
            if (chip) chip.style.display = 'none';
            var list = root.querySelector('.feed-card__comments-list');
            if (list) {
              var me = (window.TornFiAuth && window.TornFiAuth.getUser()) || null;
              var myId = me ? me.id : null;
              var isAdmin = !!(me && me.isAdmin);
              var isReply = !!(data.comment.replyToCommentId && data.comment.replyToCommentId !== '');
              var html = renderComment(data.comment, myId, currentPost.id, isAdmin, { showReplyTo: isReply });
              list.insertAdjacentHTML('beforeend', html);
            }
            var countEl = root.querySelector('.feed-card__actions .feed-card__comments');
            if (countEl) countEl.innerHTML = '<span class="icon-comment" aria-hidden="true"></span> ' + root.querySelectorAll('.feed-comment').length;
            collapseFloatingCompose();
          } else if (data.message) showFeedAlert(data.message);
        }
        if (hasFiles) {
          var fd = new FormData();
          fd.append('body', body);
          if (replyToCommentIdForCompose) fd.append('replyToCommentId', replyToCommentIdForCompose);
          composeFiles.forEach(function (f) { fd.append('images', f); });
          fetch(url, { method: 'POST', credentials: 'same-origin', body: fd })
            .then(function (r) { return r.json(); })
            .then(done)
            .catch(function () { feedComposeSubmit.disabled = false; showFeedAlert('댓글 전송에 실패했습니다.'); });
        } else {
          var payload = { body: body };
          if (replyToCommentIdForCompose) payload.replyToCommentId = replyToCommentIdForCompose;
          fetch(url, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          })
            .then(function (r) { return r.json(); })
            .then(done)
            .catch(function () { feedComposeSubmit.disabled = false; showFeedAlert('댓글 전송에 실패했습니다.'); });
        }
      });
    }
    document.addEventListener('click', function (e) {
      if (!feedFloatingBar || !feedFloatingBar.classList.contains('is-expanded')) return;
      if (feedFloatingBar.contains(e.target)) return;
      collapseFloatingCompose();
    });
  }

  function showError(msg) {
    if (root) root.innerHTML = '<p class="text-muted">' + escapeHtml(msg) + '</p>';
  }

  function initNav() {
    var navAdminCenter = document.getElementById('navAdminCenter');
    function updateNav(user) {
      if (navAdminCenter) navAdminCenter.style.display = (user && user.isAdmin) ? 'inline-flex' : 'none';
    }
    if (window.TornFiAuth) window.TornFiAuth.onUser(updateNav);
    updateNav(window.TornFiAuth ? window.TornFiAuth.getUser() : null);
  }

  function init() {
    initNav();
    (function setupFullscreenImage() {
      var layer = document.getElementById('feedImageFullscreen');
      var fullImg = document.getElementById('feedImageFullscreenImg');
      var closeBtn = layer && layer.querySelector('.feed-image-fullscreen__close');
      function closeFullscreen() { if (layer) layer.style.display = 'none'; }
      if (closeBtn) closeBtn.addEventListener('click', closeFullscreen);
      if (layer) layer.addEventListener('click', function (e) {
        if (e.target === layer || e.target === fullImg) closeFullscreen();
      });
    })();
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

    fetch('/api/feed/' + encodeURIComponent(postId) + '?t=' + Date.now(), { credentials: 'same-origin', cache: 'no-store' })
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
