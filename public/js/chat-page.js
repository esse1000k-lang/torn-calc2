      console.log('[chat-page] script loaded');
      (function setupChat() {
        var chatMessages = document.getElementById('chatMessages');
        var chatInput = document.getElementById('chatInput');
        var chatSend = document.getElementById('chatSend');
        if (!chatMessages) {
          console.log('[chat-page] early return: chatMessages 없음');
          return;
        }
        console.log('[chat-page] setupChat 진행 중, chatMessages 있음');
        var chatGuestNotice = document.getElementById('chatGuestNotice');
        var chatPanel = document.getElementById('chatPanel');
        var chatPinnedWrap = document.getElementById('chatPinnedWrap');
        var pinnedTextEl = document.getElementById('chatPinnedText');
        var pinnedMetaEl = document.getElementById('chatPinnedMeta');
        var chatItemSelectWrap = document.getElementById('chatItemSelectWrap');
        var LEVEL_EMOJI = { 1: '🐚', 2: '🦐', 3: '🐡', 4: '🦭', 5: '🦈', 6: '🐋' };
        var lastMessageCount = 0;
        var chatPageIsAdmin = false;
        var lastShownItemUseAt = null;
        var itemUsedToastTimer = null;
        var itemUsedToastQueue = [];
        var CHAT_ITEM_NAMES = { pinMessage: '고정 메시지', rewardParty: '배당 파티', risePrayer: '떡상 기원', broom: '빗자루' };
        // 채팅 아이템 오버레이 ID 목록 — 애니메이션/수정 시 이 목록과 아래 애니메이션 함수만 손대면 됨. 새 아이템 추가 시 여기에 overlay id 추가.
        var CHAT_ITEM_OVERLAY_IDS = ['chatRewardPartyOverlay', 'chatRisePrayerOverlay', 'chatBroomOverlay'];
        function isAnyChatItemOverlayVisible() {
          for (var i = 0; i < CHAT_ITEM_OVERLAY_IDS.length; i++) {
            var el = document.getElementById(CHAT_ITEM_OVERLAY_IDS[i]);
            if (el && el.style.display === 'flex') return true;
          }
          return false;
        }
        function showItemUsedToast(displayName, itemKey, onDone) {
          var itemName = CHAT_ITEM_NAMES[itemKey] || itemKey || '아이템';
          var name = (displayName || '').trim() || '알 수 없음';
          var html = '<span class="chat-item-used-toast__name">' + escapeHtml(name) + '</span> 님이 <span class="chat-item-used-toast__item">' + escapeHtml(itemName) + '</span> 아이템 사용!';
          var el = document.getElementById('chatItemUsedToast');
          if (!el) { if (onDone) onDone(); return; }
          if (itemUsedToastTimer) clearTimeout(itemUsedToastTimer);
          el.innerHTML = html;
          el.style.display = 'block';
          el.style.opacity = '1';
          el.classList.remove('is-blink');
          el.offsetHeight;
          el.classList.add('is-blink');
          itemUsedToastTimer = setTimeout(function () {
            el.classList.remove('is-blink');
            el.style.transition = 'opacity 5.5s cubic-bezier(0.4, 0, 0.2, 1)';
            el.offsetHeight;
            requestAnimationFrame(function () {
              el.style.opacity = '0';
            });
            itemUsedToastTimer = setTimeout(function () {
              el.style.display = 'none';
              el.style.transition = '';
              el.style.opacity = '1';
              itemUsedToastTimer = null;
              if (typeof onDone === 'function') onDone();
            }, 5600);
          }, 6300);
        }
        function processItemUsedToastQueue() {
          if (itemUsedToastQueue.length === 0 || itemUsedToastTimer) return;
          var next = itemUsedToastQueue.shift();
          showItemUsedToast(next.displayName, next.item, processItemUsedToastQueue);
        }

        function playRewardPartyAnimation() {
          var overlay = document.getElementById('chatRewardPartyOverlay');
          var heliEl = overlay && overlay.querySelector('.reward-party-helicopter');
          var scatterEl = overlay && overlay.querySelector('.reward-party-scatter');
          if (!overlay || !heliEl || !scatterEl) return;
          var size = parseInt(overlay.getAttribute('data-helicopter-size') || '200', 10) || 200;
          var scatterEmoji = overlay.getAttribute('data-scatter-emoji') || '🌪️';
          var flyInMs = parseInt(overlay.getAttribute('data-fly-in-ms') || '2500', 10) || 2500;
          var scatterDurationMs = parseInt(overlay.getAttribute('data-scatter-duration-ms') || '20000', 10) || 20000;
          var flyOutMs = parseInt(overlay.getAttribute('data-fly-out-ms') || '2000', 10) || 2000;
          var fadeOutMs = parseInt(overlay.getAttribute('data-fade-out-ms') || '1000', 10) || 1000;
          var scatterIntervalMs = parseInt(overlay.getAttribute('data-scatter-interval-ms') || '400', 10) || 400;
          var scatterFallDurationS = parseFloat(overlay.getAttribute('data-scatter-fall-duration-s') || '6', 10) || 6;

          heliEl.textContent = '🚁';
          heliEl.style.fontSize = size + 'px';
          heliEl.style.width = size + 'px';
          heliEl.style.height = size + 'px';
          scatterEl.innerHTML = '';
          overlay.style.display = 'block';
          overlay.classList.remove('reward-party-overlay--done');
          heliEl.classList.remove('reward-party-heli--center', 'reward-party-heli--left', 'reward-party-heli--flyoff');
          heliEl.style.transition = 'none';
          heliEl.style.opacity = '1';
          heliEl.offsetHeight;

          /* 등장: 시작 위치를 한 프레임 그린 뒤, 맨 아래·오른쪽 끝 → 최상단 가운데 (ease-out) */
          requestAnimationFrame(function () {
            requestAnimationFrame(function () {
              heliEl.style.transition = 'left ' + (flyInMs / 1000) + 's ease-out, top ' + (flyInMs / 1000) + 's ease-out, transform ' + (flyInMs / 1000) + 's ease-out';
              heliEl.classList.add('reward-party-heli--center');
            });
          });

          var scatterTimer = null;
          setTimeout(function () {
            heliEl.classList.add('reward-party-heli--drifting');
            var scatterStart = Date.now();
            function spawnScatter() {
              if (Date.now() - scatterStart >= scatterDurationMs) {
                if (scatterTimer) clearInterval(scatterTimer);
                /* 퇴장: 드리프트 중인 현재 위치에서 끊김 없이 화면 끝까지 나가며, 막 나갈 때만 페이드 */
                var oRect = overlay.getBoundingClientRect();
                var hRect = heliEl.getBoundingClientRect();
                var centerX = hRect.left - oRect.left + hRect.width / 2;
                var centerY = hRect.top - oRect.top + hRect.height / 2;
                heliEl.classList.remove('reward-party-heli--drifting', 'reward-party-heli--center');
                heliEl.style.left = centerX + 'px';
                heliEl.style.top = centerY + 'px';
                heliEl.style.transform = 'translate(-50%, -50%)';
                heliEl.style.opacity = '1';
                heliEl.style.transition = 'none';
                heliEl.offsetHeight;
                var exitDuration = (flyOutMs + fadeOutMs) / 1000;
                var opacityDelay = Math.max(0, exitDuration - 0.5);
                heliEl.style.transition = 'left ' + exitDuration + 's ease-in, top ' + exitDuration + 's ease-in, opacity 0.4s ease-out ' + opacityDelay + 's';
                requestAnimationFrame(function () {
                  requestAnimationFrame(function () {
                    heliEl.style.left = (-hRect.width * 2) + 'px';
                    heliEl.style.top = (centerY - 40) + 'px';
                    heliEl.style.opacity = '0';
                  });
                });
                var scatterFallMs = scatterFallDurationS * 1000 + 300;
                var closeAfterMs = Math.max(flyOutMs + fadeOutMs, scatterFallMs);
                setTimeout(function () {
                  overlay.style.display = 'none';
                  scatterEl.innerHTML = '';
                  heliEl.classList.remove('reward-party-heli--center', 'reward-party-heli--flyoff');
                  heliEl.style.left = '';
                  heliEl.style.top = '';
                  heliEl.style.transform = '';
                  heliEl.style.opacity = '';
                  heliEl.style.transition = '';
                }, closeAfterMs);
                return;
              }
              var oRect = overlay.getBoundingClientRect();
              var hRect = heliEl.getBoundingClientRect();
              var heliCenterX = (hRect.left - oRect.left + hRect.width / 2) / oRect.width * 100;
              var heliCenterY = (hRect.top - oRect.top + hRect.height / 2) / oRect.height * 100;
              var span = document.createElement('span');
              span.className = 'reward-party-scatter-item';
              span.textContent = scatterEmoji;
              span.style.left = (heliCenterX + (Math.random() * 10 - 5)) + '%';
              span.style.top = (heliCenterY + (Math.random() * 6 - 3)) + '%';
              span.style.animation = 'reward-party-scatter-fall ' + scatterFallDurationS + 's ease-in forwards';
              span.style.animationDelay = (Math.random() * 0.3) + 's';
              span.style.setProperty('--rx', (Math.random() * 40 - 20) + 'deg');
              scatterEl.appendChild(span);
            }
            spawnScatter();
            scatterTimer = setInterval(spawnScatter, scatterIntervalMs);
          }, flyInMs);
        }

        function playRisePrayerAnimation() {
          var overlay = document.getElementById('chatRisePrayerOverlay');
          if (!overlay) return;
          var inner = overlay.querySelector('.rise-prayer-inner');
          var emojiEl = overlay.querySelector('.rise-prayer-emoji');
          var textEl = overlay.querySelector('.rise-prayer-text');
          var upEl = overlay.querySelector('.rise-prayer-up');
          if (!inner) return;
          overlay.style.display = 'flex';
          inner.classList.remove('rise-prayer-inner--show', 'rise-prayer-inner--out');
          emojiEl && (emojiEl.style.animation = '');
          textEl && (textEl.style.animation = '');
          upEl && (upEl.style.animation = '');
          overlay.offsetHeight;
          inner.classList.add('rise-prayer-inner--show');
          emojiEl && (emojiEl.style.animation = 'rise-prayer-emoji 3.2s ease-out forwards');
          textEl && (textEl.style.animation = 'rise-prayer-text 3.2s ease-out 0.25s forwards');
          upEl && (upEl.style.animation = 'rise-prayer-up 2.8s ease-out 0.5s forwards');
          setTimeout(function () {
            inner.classList.add('rise-prayer-inner--out');
            setTimeout(function () {
              overlay.style.display = 'none';
              inner.classList.remove('rise-prayer-inner--show', 'rise-prayer-inner--out');
            }, 600);
          }, 3200);
        }

        function playBroomAnimation() {
          var overlay = document.getElementById('chatBroomOverlay');
          if (!overlay) return;
          var broomEl = overlay.querySelector('.broom-overlay__broom');
          if (!broomEl) return;
          broomEl.style.animation = 'none';
          overlay.offsetHeight;
          overlay.style.display = 'flex';
          broomEl.style.animation = 'broom-sweep 4.5s ease-in-out forwards';
          // 애니메이션 발동 0.5초 후 채팅 영역 비우기 (애니메이션 4.5초는 그대로)
          var hideContentAtMs = 500;
          setTimeout(function () {
            if (chatMessages) {
              chatMessages.innerHTML = '<p class="chat-empty">메시지가 없습니다.</p>';
              lastMessageCount = 0;
            }
          }, hideContentAtMs);
          setTimeout(function () {
            overlay.style.display = 'none';
            broomEl.style.animation = 'none';
            lastMessageCount = 0;
            fetchChat();
          }, 5200);
        }

        function escapeHtml(s) {
          var div = document.createElement('div');
          div.textContent = s;
          return div.innerHTML;
        }

        var urlRegex = /(https?:\/\/[^\s<>"']+)/gi;
        function linkifyText(s) {
          if (!s || typeof s !== 'string') return '';
          var parts = s.split(urlRegex);
          var out = '';
          for (var i = 0; i < parts.length; i++) {
            if (/^https?:\/\//i.test(parts[i])) {
              out += '<a class="chat-msg__link" href="' + escapeHtml(parts[i]) + '" data-href="' + escapeHtml(parts[i]) + '">' + escapeHtml(parts[i]) + '</a>';
            } else {
              out += escapeHtml(parts[i]);
            }
          }
          return out || escapeHtml(s);
        }

        function renderMessages(messages, effectiveMyIdFromServer, isViewerAdmin) {
          if (!Array.isArray(messages) || messages.length === 0) {
            chatMessages.innerHTML = '<p class="chat-empty">메시지가 없습니다.</p>';
            return;
          }
          var me = (window.TornFiAuth && window.TornFiAuth.getUser()) || {};
          var myId = effectiveMyIdFromServer != null ? effectiveMyIdFromServer : me.id;
          var isAdmin = !!isViewerAdmin;
          var existingRows = chatMessages.querySelectorAll('.chat-msg');
          if (messages.length === lastMessageCount && existingRows.length > 0) return;
          var wasNearBottom = (chatMessages.scrollHeight - chatMessages.scrollTop - chatMessages.clientHeight) < 150;
          lastMessageCount = messages.length;
          var placeholderAvatar = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36"><circle fill="%231a1a1e" cx="18" cy="18" r="18"/><circle fill="%236b7280" cx="18" cy="14" r="5"/><path fill="%236b7280" d="M6 32c0-8 5.3-14 12-14s12 6 12 14H6z"/></svg>');
          chatMessages.innerHTML = messages.map(function (m, idx) {
            var time = m.createdAt ? new Date(m.createdAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) : '';
            var name = (m.displayName || '').trim() || '알 수 없음';
            var levelEmoji = LEVEL_EMOJI[(m.level >= 1 && m.level <= 6) ? m.level : 0] || '';
            var isMine = !!(m.userId != null && myId != null && String(m.userId) === String(myId));
            var sideClass = isMine ? 'chat-msg--mine' : 'chat-msg--other';
            var adminClass = m.isAdmin ? ' chat-msg--admin' : '';
            var avatarUrl = (m.profileImageUrl && m.profileImageUrl.trim()) ? m.profileImageUrl : placeholderAvatar;
            var avatarImg = '<img class="chat-msg__avatar" src="' + escapeHtml(avatarUrl) + '" alt="" loading="lazy">';
            if (m.isAdmin) avatarImg = '<span class="chat-msg__avatar-wrap chat-msg__avatar-wrap--admin">' + avatarImg + '</span>';
            var editedLabel = (m.editedAt) ? ' <span class="chat-msg__edited">수정됨</span>' : '';
            var timeLine = '<span class="chat-msg__time">' + escapeHtml(time) + editedLabel + '</span>';
            var namePart = '<span class="chat-msg__name-line">' + (levelEmoji ? '<span class="chat-msg__level" aria-hidden="true">' + levelEmoji + '</span>' : '') + '<span class="chat-msg__name">' + escapeHtml(name) + '</span></span>';
            var topRow = '<div class="chat-msg__top-row">' + namePart + timeLine + '</div>';
            var replyLine = (m.replyToText && m.replyToText.trim()) ? '<div class="chat-msg__reply">답장: ' + escapeHtml((m.replyToText || '').trim()) + '</div>' : '';
            var imgLine = m.imageUrl ? '<img class="chat-msg__img" src="' + escapeHtml(m.imageUrl) + '" alt="" loading="lazy">' : '';
            var textLine = (m.text || '') ? '<p class="chat-msg__text">' + linkifyText(m.text) + '</p>' : '';
            var heartsReceived = (m.heartsReceived || 0) > 0 ? (m.heartsReceived || 0) : 0;
            var heartsBelow = heartsReceived > 0 ? ('<div class="chat-msg__hearts-below" aria-label="받은 하트 ' + heartsReceived + '개">❤️ ' + heartsReceived + '</div>') : '';
            var bubble = '<div class="chat-msg__bubble">' + topRow + replyLine + imgLine + textLine + '</div>';
            var actions = '<button type="button" class="chat-msg__action-btn" data-action="copy">복사</button><button type="button" class="chat-msg__action-btn" data-action="reply">답장</button>';
            if (isMine) {
              actions += '<button type="button" class="chat-msg__action-btn" data-action="edit">수정</button><button type="button" class="chat-msg__action-btn" data-action="delete">삭제</button>';
            } else {
              actions += '<button type="button" class="chat-msg__action-btn" data-action="sendHeart" title="좋아요">❤️</button>';
              if (isAdmin) actions += '<button type="button" class="chat-msg__action-btn" data-action="delete" title="관리자 삭제">삭제</button>';
            }
            var actionsRow = '<div class="chat-msg__actions">' + actions + '</div>';
            var body = '<div class="chat-msg__body">' + bubble + heartsBelow + actionsRow + '</div>';
            var msgIdVal = (m.id != null && m.id !== '') ? String(m.id) : 'idx-' + idx;
            var dataId = ' id="chat-msg-' + escapeHtml(msgIdVal) + '" data-message-id="' + escapeHtml(msgIdVal) + '"';
            var msgClass = 'chat-msg ' + sideClass + adminClass;
            if (isMine) return '<div class="' + msgClass + '"' + dataId + '>' + body + avatarImg + '</div>';
            return '<div class="' + msgClass + '"' + dataId + '>' + avatarImg + body + '</div>';
          }).join('');
          if (wasNearBottom) chatMessages.scrollTop = chatMessages.scrollHeight;
          var imgs = chatMessages.querySelectorAll('.chat-msg__img');
          for (var i = 0; i < imgs.length; i++) {
            (function (img) {
              if (!img.complete) img.addEventListener('load', function () {
                if ((chatMessages.scrollHeight - chatMessages.scrollTop - chatMessages.clientHeight) < 200) chatMessages.scrollTop = chatMessages.scrollHeight;
              });
              img.addEventListener('error', function () {
                if (img._chatImgFailed) return;
                img._chatImgFailed = true;
                img.style.display = 'none';
                var wrap = img.closest('.chat-msg__img-wrap');
                if (wrap) {
                  var fallback = document.createElement('span');
                  fallback.className = 'chat-msg__img-fallback';
                  fallback.textContent = '이미지를 불러올 수 없습니다.';
                  wrap.appendChild(fallback);
                }
              });
            })(imgs[i]);
          }
        }

        function playHeartReceivedSound() {
          try {
            var Ctx = window.AudioContext || window.webkitAudioContext;
            if (!Ctx) return;
            var ctx = new Ctx();
            var play = function (freq, start, duration) {
              var osc = ctx.createOscillator();
              var gain = ctx.createGain();
              osc.connect(gain);
              gain.connect(ctx.destination);
              osc.frequency.value = freq;
              osc.type = 'sine';
              gain.gain.setValueAtTime(0.15, start);
              gain.gain.exponentialRampToValueAtTime(0.01, start + duration);
              osc.start(start);
              osc.stop(start + duration);
            };
            play(523.25, 0, 0.12);
            play(659.25, 0.14, 0.15);
          } catch (e) {}
        }

        var chatPageCanUsePinMessage = false;
        var chatItemCooldownUntil = 0;
        var chatItemCooldownTimer = null;
        var CHAT_ITEM_COOLDOWN_MS = 10000;
        function startChatItemCooldown() {
          chatItemCooldownUntil = Date.now() + CHAT_ITEM_COOLDOWN_MS;
          updateChatItemMenu();
          if (chatItemCooldownTimer) clearInterval(chatItemCooldownTimer);
          chatItemCooldownTimer = setInterval(function () {
            if (Date.now() >= chatItemCooldownUntil) { clearInterval(chatItemCooldownTimer); chatItemCooldownTimer = null; }
            updateChatItemMenu();
          }, 1000);
        }
        function updateChatItemMenu() {
          var menu = document.getElementById('chatItemMenu');
          if (!chatItemSelectWrap || !menu) return;
          var inCooldown = chatItemCooldownUntil > Date.now();
          var cooldownSec = inCooldown ? Math.ceil((chatItemCooldownUntil - Date.now()) / 1000) : 0;
          var html = '';
          if (inCooldown) html += '<div class="chat-item-menu-cooldown">' + cooldownSec + '초 후 사용 가능</div>';
          if (chatPageCanUsePinMessage) {
            html += '<div class="chat-item-row chat-item-row--vertical"><button type="button" class="chat-item-option chat-item-option--icon" data-value="pinMessage" title="고정 메시지 (관리자·지정자 전용)"' + (inCooldown ? ' disabled' : '') + '>📌</button></div>';
            html += '<div class="chat-item-row chat-item-row--vertical"><button type="button" class="chat-item-option chat-item-option--icon" data-value="broom" title="빗자루 (관리자·지정자 전용)"' + (inCooldown ? ' disabled' : '') + '>🧹</button></div>';
          }
          html += '<div class="chat-item-row chat-item-row--vertical"><button type="button" class="chat-item-option chat-item-option--icon" data-value="rewardParty" title="배당 파티"' + (inCooldown ? ' disabled' : '') + '>🚁</button></div>';
          html += '<div class="chat-item-row chat-item-row--vertical"><button type="button" class="chat-item-option chat-item-option--icon" data-value="risePrayer" title="떡상 기원"' + (inCooldown ? ' disabled' : '') + '>🙏</button></div>';
          menu.innerHTML = html;
        }

        function useChatItemAndCooldown(apiPath, wrap, trig) {
          if (trig) trig.textContent = '🎁';
          if (wrap) wrap.dataset.selected = '';
          var menu = wrap && wrap.querySelector('.chat-item-menu');
          if (menu) menu.style.display = 'none';
          fetch(apiPath, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' } })
            .then(function (r) { return r.json(); })
            .then(function (data) {
              if (data.ok) {
                startChatItemCooldown();
              } else if (data.message) {
                var msg = data.message;
                if (msg.indexOf('부족') !== -1) {
                  msg = '채팅 아이템은 이제 무료로 사용할 수 있습니다. 10초 쿨다운이 지났는지 확인한 뒤 다시 눌러 주세요. (서버가 최신이 아닐 수 있습니다.)';
                }
                alert(msg);
              }
            })
            .catch(function () { alert('사용에 실패했습니다.'); });
        }

        function fetchChat() {
          var me = (window.TornFiAuth && window.TornFiAuth.getUser()) || {};
          var myId = me.id;
          var oldHeartsByMsg = {};
          if (chatMessages && myId) {
            chatMessages.querySelectorAll('.chat-msg.chat-msg--mine').forEach(function (row) {
              var mid = row.dataset.messageId;
              if (!mid) return;
              var below = row.querySelector('.chat-msg__hearts-below');
              var num = 0;
              if (below && below.textContent) {
                var match = below.textContent.match(/\d+/);
                if (match) num = parseInt(match[0], 10);
              }
              oldHeartsByMsg[mid] = num;
            });
          }
          fetch('/api/chat', { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                var effectiveMyId = (data.me && data.me.id) || myId;
                if (data.ok && data.messages) {
                if (effectiveMyId && data.messages.length) {
                  var hadNewHeart = false;
                  data.messages.forEach(function (m) {
                    if (m.userId !== effectiveMyId) return;
                    var prev = oldHeartsByMsg[m.id] || 0;
                    var cur = m.heartsReceived || 0;
                    if (cur > prev) hadNewHeart = true;
                  });
                  if (hadNewHeart) playHeartReceivedSound();
                }
                if (data.lastItemUse && data.lastItemUse.at && data.lastItemUse.at !== lastShownItemUseAt) {
                  lastShownItemUseAt = data.lastItemUse.at;
                  itemUsedToastQueue.push({ displayName: data.lastItemUse.displayName, item: data.lastItemUse.itemId });
                  if (data.lastItemUse.itemId === 'rewardParty' && typeof playRewardPartyAnimation === 'function') playRewardPartyAnimation();
                  if (data.lastItemUse.itemId === 'risePrayer' && typeof playRisePrayerAnimation === 'function') playRisePrayerAnimation();
                  if (data.lastItemUse.itemId === 'broom' && typeof playBroomAnimation === 'function') playBroomAnimation();
                }
                processItemUsedToastQueue();
              }
              if (data.ok) {
                chatPageIsAdmin = !!(data.me && data.me.isAdmin);
                chatPageCanUsePinMessage = !!(data.me && data.me.canUsePinMessage);
                updateChatItemMenu();
              }
              if (data.ok && data.messages) {
                if (!isAnyChatItemOverlayVisible()) renderMessages(data.messages, effectiveMyId, chatPageIsAdmin);
              }
              function applyGuestOrLoggedIn(resolvedId) {
                if (chatGuestNotice) {
                  if (resolvedId) { chatGuestNotice.style.display = 'none'; chatGuestNotice.textContent = ''; }
                  else {
                    chatGuestNotice.style.display = 'block';
                    chatGuestNotice.textContent = '회원가입 또는 로그인 후 이용 가능합니다.';
                  }
                }
                if (chatMessages) {
                  if (resolvedId) chatMessages.classList.remove('chat-messages--guest');
                  else chatMessages.classList.add('chat-messages--guest');
                }
                if (chatPanel) {
                  if (resolvedId) chatPanel.classList.remove('chat-panel--guest');
                  else chatPanel.classList.add('chat-panel--guest');
                }
                if (chatPinnedWrap) {
                  if (resolvedId) chatPinnedWrap.classList.remove('chat-pinned-wrap--guest');
                  else chatPinnedWrap.classList.add('chat-pinned-wrap--guest');
                }
                if (chatItemSelectWrap) {
                  if ((resolvedId || me) && data.ok) {
                    chatItemSelectWrap.style.display = 'inline-block';
                    updateChatItemMenu();
                  } else {
                    chatItemSelectWrap.style.display = 'none';
                  }
                }
              }
              if (effectiveMyId) {
                applyGuestOrLoggedIn(effectiveMyId);
              } else {
                fetch('/api/me', { credentials: 'same-origin' })
                  .then(function (r) { return r.json(); })
                  .then(function (meData) {
                    var id = (meData && meData.ok && meData.user && meData.user.id) ? meData.user.id : null;
                    if (meData && meData.ok && meData.user && window.TornFiAuth && window.TornFiAuth.setUser) {
                      window.TornFiAuth.setUser(meData.user);
                    }
                    var isAdminFromMe = !!(meData && meData.ok && meData.user && meData.user.isAdmin);
                    if (id && data.ok && data.messages && !isAnyChatItemOverlayVisible()) renderMessages(data.messages, id, isAdminFromMe);
                    applyGuestOrLoggedIn(id);
                  })
                  .catch(function () { applyGuestOrLoggedIn(null); });
              }
              if (data.pinned && chatPinnedWrap && pinnedTextEl) {
                pinnedTextEl.textContent = data.pinned.text;
                if (pinnedMetaEl) {
                  var levelEmoji = LEVEL_EMOJI[(data.pinned.level >= 1 && data.pinned.level <= 6) ? data.pinned.level : 0] || '';
                  var by = (data.pinned.setByDisplayName || '').trim() || '알 수 없음';
                  var exp = data.pinned.expiresAt ? new Date(data.pinned.expiresAt) : null;
                  var metaStr = (levelEmoji ? levelEmoji + ' ' : '') + by;
                  pinnedMetaEl.textContent = exp ? metaStr + ' · ' + exp.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) + '까지' : metaStr;
                }
                chatPinnedWrap.style.display = 'block';
                var chatPinnedUnpinBtn = document.getElementById('chatPinnedUnpinBtn');
                if (chatPinnedUnpinBtn) chatPinnedUnpinBtn.style.display = chatPageIsAdmin ? 'inline-block' : 'none';
              } else if (chatPinnedWrap) {
                chatPinnedWrap.style.display = 'none';
                var chatPinnedUnpinBtn = document.getElementById('chatPinnedUnpinBtn');
                if (chatPinnedUnpinBtn) chatPinnedUnpinBtn.style.display = 'none';
              }
            })
            .catch(function () {});
        }

        var pendingChatFile = null;
        var replyingTo = null;

        function clearPreview() {
          pendingChatFile = null;
          if (chatImage) chatImage.value = '';
          var wrap = document.getElementById('chatPreviewWrap');
          if (wrap) wrap.style.display = 'none';
        }

        function sendMessage() {
          var text = (chatInput && chatInput.value || '').trim();
          var hasFile = !!pendingChatFile;
          if (!text && !hasFile) return;
          if (!window.TornFiAuth || !window.TornFiAuth.getUser()) {
            alert('로그인 후 메시지를 보낼 수 있습니다.');
            return;
          }
          if (chatSend) chatSend.disabled = true;
          var opts = { method: 'POST', credentials: 'same-origin' };
          var payload = { text: text };
          if (replyingTo) { payload.replyToMessageId = replyingTo.id; payload.replyToText = replyingTo.text.slice(0, 100); }
          if (hasFile) {
            var fd = new FormData();
            fd.append('text', text);
            fd.append('image', pendingChatFile);
            if (replyingTo) { fd.append('replyToMessageId', replyingTo.id); fd.append('replyToText', replyingTo.text.slice(0, 100)); }
            opts.body = fd;
          } else {
            opts.headers = { 'Content-Type': 'application/json' };
            opts.body = JSON.stringify(payload);
          }
          fetch('/api/chat', opts)
            .then(function (r) { return r.json(); })
            .then(function (data) {
              if (chatSend) chatSend.disabled = false;
              if (chatInput) chatInput.value = '';
              clearPreview();
              replyingTo = null;
              var replyBar = document.getElementById('chatReplyBar');
              if (replyBar) replyBar.style.display = 'none';
              if (data.ok && data.message) {
                lastMessageCount = 0;
                if (chatItemSelectWrap) {
                  var trig = chatItemSelectWrap.querySelector('.chat-item-trigger');
                  if (trig) trig.textContent = '🎁';
                  chatItemSelectWrap.dataset.selected = '';
                }
                fetchChat();
              } else if (data.message) alert(data.message);
            })
            .catch(function () { if (chatSend) chatSend.disabled = false; });
        }

        var chatPollIntervalMs = 1000;
        function startChatPoll() {
          if (window._chatPollTimer) clearInterval(window._chatPollTimer);
          window._chatPollTimer = setInterval(fetchChat, chatPollIntervalMs);
        }
        function runFirstFetch() {
          fetchChat();
          startChatPoll();
        }
        if (window.TornFiAuth && window.TornFiAuth.init) {
          window.TornFiAuth.init().then(runFirstFetch).catch(runFirstFetch);
        } else {
          runFirstFetch();
        }

        if (chatItemSelectWrap) {
          chatItemSelectWrap.addEventListener('click', function (e) {
            var btn = e.target && e.target.closest && e.target.closest('.chat-item-option');
            if (!btn || btn.disabled) return;
            var sel = btn.getAttribute('data-value') || '';
            if (sel === 'pinMessage') {
              var pinModal = document.getElementById('chatPinModal');
              var pinInput = document.getElementById('chatPinModalInput');
              if (pinModal && pinInput) { pinInput.value = ''; pinModal.style.display = 'flex'; pinInput.focus(); }
              return;
            }
            if (sel === 'rewardParty') {
              var wrap = btn.closest('.chat-item-dropdown');
              useChatItemAndCooldown('/api/chat/use-reward-party', wrap, wrap && wrap.querySelector('.chat-item-trigger'));
              return;
            }
            if (sel === 'risePrayer') {
              var wrap = btn.closest('.chat-item-dropdown');
              useChatItemAndCooldown('/api/chat/use-rise-prayer', wrap, wrap && wrap.querySelector('.chat-item-trigger'));
              return;
            }
            if (sel === 'broom') {
              var wrap = btn.closest('.chat-item-dropdown');
              useChatItemAndCooldown('/api/chat/use-broom', wrap, wrap && wrap.querySelector('.chat-item-trigger'));
              return;
            }
            var wrap = btn.closest('.chat-item-dropdown');
            var trig = wrap && wrap.querySelector('.chat-item-trigger');
            if (trig) trig.textContent = btn.textContent;
            if (wrap) wrap.dataset.selected = sel;
            updateChatItemMenu();
          });
          chatItemSelectWrap.addEventListener('mouseleave', function () {
            if (!chatItemSelectWrap.dataset.selected || chatItemSelectWrap.dataset.selected === '') {
              var trig = chatItemSelectWrap.querySelector('.chat-item-trigger');
              if (trig) trig.textContent = '🎁';
              updateChatItemMenu();
            }
          });
          chatItemSelectWrap.addEventListener('mouseenter', function () {
            var m = chatItemSelectWrap.querySelector('.chat-item-menu');
            if (m) m.style.display = '';
          });
          var chatItemTrigger = document.getElementById('chatItemTrigger');
          if (chatItemTrigger) chatItemTrigger.textContent = '🎁';
        }

        var chatPinModal = document.getElementById('chatPinModal');
        var chatPinModalInput = document.getElementById('chatPinModalInput');
        var chatPinModalCancel = document.getElementById('chatPinModalCancel');
        var chatPinModalConfirm = document.getElementById('chatPinModalConfirm');
        function closePinModal() {
          if (chatPinModal) chatPinModal.style.display = 'none';
        }
        if (chatPinModal) {
          var pinBackdrop = chatPinModal.querySelector('.chat-pin-modal__backdrop');
          if (pinBackdrop) pinBackdrop.addEventListener('click', closePinModal);
          if (chatPinModalCancel) chatPinModalCancel.addEventListener('click', closePinModal);
          if (chatPinModalConfirm && chatPinModalInput) {
            chatPinModalConfirm.addEventListener('click', function () {
              var text = (chatPinModalInput.value || '').trim();
              if (!text) { alert('고정할 메시지를 입력해 주세요.'); return; }
              chatPinModalConfirm.disabled = true;
              fetch('/api/chat/set-pinned', {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pinnedText: text }),
              })
                .then(function (r) { return r.json(); })
                .then(function (data) {
                  chatPinModalConfirm.disabled = false;
                  closePinModal();
                  if (data.ok) {
                    startChatItemCooldown();
                    if (data.pinned && chatPinnedWrap && pinnedTextEl) {
                      pinnedTextEl.textContent = data.pinned.text;
                      if (pinnedMetaEl && data.pinned.expiresAt) {
                        var levelEmoji = LEVEL_EMOJI[(data.pinned.level >= 1 && data.pinned.level <= 6) ? data.pinned.level : 0] || '';
                        var by = (data.pinned.setByDisplayName || '').trim() || '알 수 없음';
                        var exp = new Date(data.pinned.expiresAt);
                        pinnedMetaEl.textContent = (levelEmoji ? levelEmoji + ' ' : '') + by + ' · ' + exp.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) + '까지';
                      }
                      chatPinnedWrap.style.display = 'block';
                    }
                    fetchChat();
                  } else if (data.message) alert(data.message);
                })
                .catch(function () { chatPinModalConfirm.disabled = false; });
            });
          }
        }

        var chatEditModal = document.getElementById('chatEditModal');
        var chatEditModalInput = document.getElementById('chatEditModalInput');
        var chatEditModalCancel = document.getElementById('chatEditModalCancel');
        var chatEditModalConfirm = document.getElementById('chatEditModalConfirm');
        var pendingEditMsgId = null;
        var pendingEditOriginalText = '';
        function closeEditModal() {
          pendingEditMsgId = null;
          pendingEditOriginalText = '';
          if (chatEditModal) chatEditModal.style.display = 'none';
        }
        function openEditModal(msgId, currentText) {
          pendingEditMsgId = msgId;
          pendingEditOriginalText = currentText || '';
          if (chatEditModalInput) { chatEditModalInput.value = pendingEditOriginalText; chatEditModalInput.focus(); }
          if (chatEditModal) chatEditModal.style.display = 'flex';
        }
        if (chatEditModal) {
          var editBackdrop = chatEditModal.querySelector('.chat-edit-modal__backdrop');
          if (editBackdrop) editBackdrop.addEventListener('click', closeEditModal);
          if (chatEditModalCancel) chatEditModalCancel.addEventListener('click', closeEditModal);
          if (chatEditModalConfirm && chatEditModalInput) {
            chatEditModalConfirm.addEventListener('click', function () {
              var newText = (chatEditModalInput.value || '').trim();
              if (newText === pendingEditOriginalText.trim()) { closeEditModal(); return; }
              if (newText.length === 0) { alert('내용을 입력해 주세요.'); return; }
              if (newText.length > 500) { alert('메시지는 500자 이내로 입력해 주세요.'); return; }
              if (!pendingEditMsgId) { closeEditModal(); return; }
              chatEditModalConfirm.disabled = true;
              fetch('/api/chat/' + encodeURIComponent(pendingEditMsgId), {
                method: 'PATCH',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: newText }),
              })
                .then(function (r) { return r.json(); })
                .then(function (data) {
                  chatEditModalConfirm.disabled = false;
                  closeEditModal();
                  if (data.ok) { lastMessageCount = 0; fetchChat(); }
                  else if (data.message) alert(data.message);
                })
                .catch(function () { chatEditModalConfirm.disabled = false; });
            });
          }
        }

        var chatDeleteModal = document.getElementById('chatDeleteModal');
        var chatDeleteModalCancel = document.getElementById('chatDeleteModalCancel');
        var chatDeleteModalConfirm = document.getElementById('chatDeleteModalConfirm');
        var pendingDeleteMsgId = null;
        var pendingDeleteIsAdmin = false;
        function closeDeleteModal() {
          pendingDeleteMsgId = null;
          pendingDeleteIsAdmin = false;
          if (chatDeleteModal) chatDeleteModal.style.display = 'none';
        }
        function openDeleteModal(msgId, isAdminDelete) {
          pendingDeleteMsgId = msgId;
          pendingDeleteIsAdmin = !!isAdminDelete;
          if (chatDeleteModal) chatDeleteModal.style.display = 'flex';
        }
        if (chatDeleteModal) {
          var deleteBackdrop = chatDeleteModal.querySelector('.chat-delete-modal__backdrop');
          if (deleteBackdrop) deleteBackdrop.addEventListener('click', closeDeleteModal);
          if (chatDeleteModalCancel) chatDeleteModalCancel.addEventListener('click', closeDeleteModal);
          if (chatDeleteModalConfirm) {
            chatDeleteModalConfirm.addEventListener('click', function () {
              if (!pendingDeleteMsgId) { closeDeleteModal(); return; }
              var msgId = pendingDeleteMsgId;
              var byAdmin = pendingDeleteIsAdmin;
              closeDeleteModal();
              var url = byAdmin ? ('/api/admin/chat/' + encodeURIComponent(msgId)) : ('/api/chat/' + encodeURIComponent(msgId));
              fetch(url, { method: 'DELETE', credentials: 'same-origin' })
                .then(function (r) { return r.json(); })
                .then(function (data) {
                  if (data.ok) { lastMessageCount = 0; fetchChat(); }
                  else if (data.message) alert(data.message);
                })
                .catch(function () {});
            });
          }
        }

        var chatAttach = document.getElementById('chatAttach');
        var chatImage = document.getElementById('chatImage');
        var chatPreviewWrap = document.getElementById('chatPreviewWrap');
        var chatPreviewImg = document.getElementById('chatPreviewImg');
        var chatPreviewRemove = document.getElementById('chatPreviewRemove');
        if (chatAttach && chatImage) {
          chatAttach.addEventListener('click', function () { chatImage.click(); });
          chatImage.addEventListener('change', function () {
            var file = chatImage.files && chatImage.files[0];
            if (!file || !file.type.match(/^image\/(jpeg|png|gif|webp)$/)) return;
            if (file.size > 5 * 1024 * 1024) { alert('이미지는 5MB 이하로 선택해 주세요.'); chatImage.value = ''; return; }
            pendingChatFile = file;
            if (chatPreviewWrap && chatPreviewImg) {
              var url = URL.createObjectURL(file);
              chatPreviewImg.src = url;
              chatPreviewWrap.style.display = 'flex';
            }
          });
        }
        if (chatPreviewRemove) chatPreviewRemove.addEventListener('click', clearPreview);

        var chatReplyBar = document.getElementById('chatReplyBar');
        var chatReplyCancel = document.getElementById('chatReplyCancel');
        if (chatReplyCancel) chatReplyCancel.addEventListener('click', function () {
          replyingTo = null;
          if (chatReplyBar) chatReplyBar.style.display = 'none';
        });

        var chatMsgDropdown = document.getElementById('chatMsgDropdown');
        var openDropdownMsgId = null;
        var openDropdownRow = null;

        function closeChatMsgDropdown() {
          if (chatMsgDropdown) chatMsgDropdown.style.display = 'none';
          openDropdownMsgId = null;
          openDropdownRow = null;
        }

        function openChatMsgDropdown(bubbleEl) {
          var row = bubbleEl.closest('.chat-msg');
          if (!row) return;
          var msgId = row.dataset.messageId || row.getAttribute('data-message-id');
          if (!msgId) return;
          var rect = bubbleEl.getBoundingClientRect();
          if (chatMsgDropdown) {
            chatMsgDropdown.classList.toggle('is-other', !row.classList.contains('chat-msg--mine'));
            chatMsgDropdown.classList.toggle('is-admin', !!chatPageIsAdmin);
            var menuWidth = 136;
            var left = row.classList.contains('chat-msg--mine') ? (rect.right - menuWidth) : rect.left;
            if (left < 8) left = 8;
            chatMsgDropdown.style.left = left + 'px';
            chatMsgDropdown.style.top = (rect.bottom + 6) + 'px';
            chatMsgDropdown.style.display = 'block';
            var menuHeight = chatMsgDropdown.offsetHeight;
            var spaceBelow = window.innerHeight - rect.bottom - 6;
            var minSpace = 16;
            if (spaceBelow < menuHeight + minSpace && rect.top >= menuHeight + minSpace) {
              chatMsgDropdown.style.top = (rect.top - menuHeight - 6) + 'px';
            }
          }
          openDropdownMsgId = msgId;
          openDropdownRow = row;
        }

        function runDropdownAction(action) {
          if (!openDropdownMsgId || !openDropdownRow) return;
          var isMine = openDropdownRow.classList.contains('chat-msg--mine');
          if (action === 'edit' && !isMine) return;
          if (action === 'delete' && !isMine && !chatPageIsAdmin) return;
          var textEl = openDropdownRow.querySelector('.chat-msg__text');
          var messageText = textEl ? textEl.textContent : '';
          var msgId = openDropdownMsgId;
          var row = openDropdownRow;
          closeChatMsgDropdown();

          if (action === 'sendHeart') {
            tryOpenSendHeartModal(row);
            return;
          }
          if (action === 'reply') {
            replyingTo = { id: msgId, text: messageText };
            var replyBar = document.getElementById('chatReplyBar');
            var replyTextEl = document.getElementById('chatReplyText');
            if (replyBar && replyTextEl) {
              replyTextEl.textContent = '답장: ' + (messageText.slice(0, 30) + (messageText.length > 30 ? '…' : ''));
              replyBar.style.display = 'flex';
            }
            if (chatInput) chatInput.focus();
            return;
          }
          if (action === 'copy') {
            if (navigator.clipboard && navigator.clipboard.writeText) {
              navigator.clipboard.writeText(messageText || '').then(function () { }).catch(function () {});
            }
            return;
          }
          if (action === 'edit') {
            openEditModal(msgId, messageText);
            return;
          }
          if (action === 'delete') {
            openDeleteModal(msgId, !isMine && chatPageIsAdmin);
            return;
          }
        }

        var chatLinkConfirmDropdown = document.getElementById('chatLinkConfirmDropdown');
        var chatLinkConfirmGo = document.getElementById('chatLinkConfirmGo');
        var chatLinkConfirmCancel = document.getElementById('chatLinkConfirmCancel');
        var pendingLinkHref = null;

        function closeLinkConfirmDropdown() {
          if (chatLinkConfirmDropdown) chatLinkConfirmDropdown.style.display = 'none';
          pendingLinkHref = null;
        }

        function openLinkConfirmDropdown(linkEl) {
          var href = (linkEl.getAttribute('data-href') || linkEl.getAttribute('href') || '').trim();
          if (!href) return;
          pendingLinkHref = href;
          closeChatMsgDropdown();
          var rect = linkEl.getBoundingClientRect();
          if (chatLinkConfirmDropdown) {
            chatLinkConfirmDropdown.style.left = (rect.left + rect.width / 2 - 80) + 'px';
            chatLinkConfirmDropdown.style.top = (rect.bottom + 6) + 'px';
            chatLinkConfirmDropdown.style.display = 'block';
          }
        }

        var chatSendHeartLayer = document.getElementById('chatSendHeartLayer');
        var chatSendHeartMessage = document.getElementById('chatSendHeartMessage');
        var chatSendHeartMyHearts = document.getElementById('chatSendHeartMyHearts');
        var chatSendHeartCancel = document.getElementById('chatSendHeartCancel');
        var chatSendHeartOk = document.getElementById('chatSendHeartOk');
        var pendingSendHeartMessageId = null;

        function openSendHeartModal(messageId, recipientName) {
          pendingSendHeartMessageId = messageId;
          if (chatSendHeartMessage) chatSendHeartMessage.textContent = (recipientName || '이 메시지') + '에 좋아요를 누르시겠습니까?';
          if (chatSendHeartMyHearts) chatSendHeartMyHearts.style.display = 'none';
          if (chatSendHeartLayer) chatSendHeartLayer.style.display = 'flex';
        }
        function closeSendHeartModal() {
          pendingSendHeartMessageId = null;
          if (chatSendHeartLayer) chatSendHeartLayer.style.display = 'none';
        }
        if (chatSendHeartCancel) chatSendHeartCancel.addEventListener('click', closeSendHeartModal);
        if (chatSendHeartOk) chatSendHeartOk.addEventListener('click', function () {
          if (!pendingSendHeartMessageId) return;
          var msgId = pendingSendHeartMessageId;
          chatSendHeartOk.disabled = true;
          fetch('/api/chat/' + encodeURIComponent(msgId) + '/send-heart', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ amount: 1 }),
          })
            .then(function (r) { return r.json(); })
            .then(function (data) {
              chatSendHeartOk.disabled = false;
              closeSendHeartModal();
              if (data.ok) {
                lastMessageCount = 0;
                fetchChat();
                if (data.message) alert(data.message);
              } else if (data.message) {
                alert(data.message);
              }
            })
            .catch(function () { chatSendHeartOk.disabled = false; alert('하트 전송 중 오류가 발생했습니다.'); });
        });
        if (chatSendHeartLayer && chatSendHeartLayer.querySelector('.chat-send-heart-box')) {
          chatSendHeartLayer.addEventListener('click', function (e) {
            if (e.target === chatSendHeartLayer) closeSendHeartModal();
          });
        }

        function tryOpenSendHeartModal(row) {
          if (!row || !row.classList.contains('chat-msg--other')) return;
          var me = (window.TornFiAuth && window.TornFiAuth.getUser()) || {};
          if (!me.id) { alert('로그인 후 좋아요를 누를 수 있습니다.'); return; }
          var msgId = row.dataset.messageId || row.getAttribute('data-message-id');
          if (!msgId && row.id && row.id.indexOf('chat-msg-') === 0) msgId = row.id.slice(9);
          var nameEl = row.querySelector('.chat-msg__name');
          var recipientName = (nameEl && nameEl.textContent) ? nameEl.textContent.trim() : '이 사용자';
          if (!msgId) return;
          openSendHeartModal(msgId, recipientName);
        }

        var lastTouchTime = 0;
        var lastTouchBubble = null;
        var DOUBLE_TAP_MS = 400;
        chatMessages.addEventListener('touchend', function (e) {
          var bubble = e.target.closest && e.target.closest('.chat-msg__bubble');
          var row = bubble && bubble.closest('.chat-msg');
          if (!row || !row.classList.contains('chat-msg--other')) return;
          var now = Date.now();
          if (lastTouchBubble === bubble && (now - lastTouchTime) <= DOUBLE_TAP_MS) {
            e.preventDefault();
            lastTouchTime = 0;
            lastTouchBubble = null;
            tryOpenSendHeartModal(row);
            return;
          }
          lastTouchTime = now;
          lastTouchBubble = bubble;
        }, { passive: false });

        chatMessages.addEventListener('dblclick', function (e) {
          var bubble = e.target.closest && e.target.closest('.chat-msg__bubble');
          var row = bubble && bubble.closest('.chat-msg');
          if (row && row.classList.contains('chat-msg--other')) {
            e.preventDefault();
            e.stopPropagation();
            tryOpenSendHeartModal(row);
          }
        });

        document.addEventListener('click', function (e) {
          if (!chatMessages) return;
          if (!chatMessages.contains(e.target) && !(e.target.closest && e.target.closest('#chatMsgDropdown'))) {
            closeChatMsgDropdown();
            return;
          }
          var bubble = e.target.closest && e.target.closest('.chat-msg__bubble');
          if (bubble && !e.target.closest('.chat-msg__link')) {
            openChatMsgDropdown(bubble);
            return;
          }
          var btn = e.target.closest && e.target.closest('.chat-msg__action-btn');
          if (btn) {
            e.preventDefault();
            e.stopPropagation();
            var row = btn.closest('.chat-msg');
            if (!row) return;
            var msgId = row.dataset.messageId || row.getAttribute('data-message-id');
            if (!msgId && row.id && row.id.indexOf('chat-msg-') === 0) msgId = row.id.slice(9);
            var action = btn.getAttribute('data-action');
            if (!msgId && action !== 'copy') return;
            if (!msgId) {
              var textEl = row.querySelector('.chat-msg__text');
              var text = textEl ? textEl.textContent : '';
              if (action === 'copy' && navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(text || '').then(function () {}).catch(function () {});
              }
              return;
            }
            openDropdownMsgId = msgId;
            openDropdownRow = row;
            if (action) runDropdownAction(action);
            return;
          }
          var linkEl = e.target.closest && e.target.closest('.chat-msg__link');
          if (linkEl) {
            e.preventDefault();
            e.stopPropagation();
            openLinkConfirmDropdown(linkEl);
            return;
          }
          if (!e.target.closest('#chatMsgDropdown')) closeChatMsgDropdown();
        }, true);

        if (chatLinkConfirmGo) chatLinkConfirmGo.addEventListener('click', function () {
          if (pendingLinkHref) {
            window.open(pendingLinkHref, '_blank', 'noopener,noreferrer');
            closeLinkConfirmDropdown();
          }
        });
        if (chatLinkConfirmCancel) chatLinkConfirmCancel.addEventListener('click', closeLinkConfirmDropdown);

        if (chatMsgDropdown) {
          chatMsgDropdown.addEventListener('click', function (e) {
            var dropItem = e.target.closest && e.target.closest('.chat-msg-dropdown__item');
            if (!dropItem || !openDropdownMsgId) return;
            e.preventDefault();
            e.stopPropagation();
            var action = dropItem.getAttribute('data-action');
            if (action) runDropdownAction(action);
          });
        }

        var chatPinnedUnpinBtn = document.getElementById('chatPinnedUnpinBtn');
        if (chatPinnedUnpinBtn) {
          chatPinnedUnpinBtn.addEventListener('click', function () {
            fetch('/api/admin/chat/pinned', { method: 'DELETE', credentials: 'same-origin' })
              .then(function (r) { return r.json(); })
              .then(function (data) {
                if (data.ok) { lastMessageCount = 0; fetchChat(); }
                else if (data.message) alert(data.message);
              })
              .catch(function () {});
          });
        }

        document.addEventListener('click', function (e) {
          if (chatLinkConfirmDropdown && chatLinkConfirmDropdown.contains(e.target)) return;
          if (pendingLinkHref && !e.target.closest('.chat-msg__link')) closeLinkConfirmDropdown();
        });

        if (chatSend) chatSend.addEventListener('click', function () {
          var user = window.TornFiAuth && window.TornFiAuth.getUser();
          if (!user || !user.id) {
            window.location.href = '/login.html';
            return;
          }
          sendMessage();
        });
        if (chatInput) {
          chatInput.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') { e.preventDefault(); sendMessage(); }
          });
        }

        function updateChatSendButton(user) {
          if (chatSend) {
            chatSend.textContent = (user && user.id) ? '전송' : '로그인';
            if (!user || !user.id) chatSend.disabled = false;
          }
        }
        updateChatSendButton(window.TornFiAuth && window.TornFiAuth.getUser());
        if (chatAttach) chatAttach.disabled = !(window.TornFiAuth && window.TornFiAuth.getUser() && window.TornFiAuth.getUser().id);
        if (window.TornFiAuth && window.TornFiAuth.onUser) {
          window.TornFiAuth.onUser(function (user) {
            if (chatInput) chatInput.placeholder = user ? '메시지 입력' : '메시지 입력 (로그인 후 전송)';
            updateChatSendButton(user);
            if (chatAttach) chatAttach.disabled = !user || !user.id;
            if (chatMessages) {
              if (user && user.id) {
                chatMessages.classList.remove('chat-messages--guest');
                fetchChat();
              } else {
                chatMessages.classList.add('chat-messages--guest');
              }
            }
            if (chatPanel) {
              if (user && user.id) chatPanel.classList.remove('chat-panel--guest');
              else chatPanel.classList.add('chat-panel--guest');
            }
            if (chatPinnedWrap) {
              if (user && user.id) chatPinnedWrap.classList.remove('chat-pinned-wrap--guest');
              else chatPinnedWrap.classList.add('chat-pinned-wrap--guest');
            }
          });
        }
      })();