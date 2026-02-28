
      (function setupChat() {
        var chatMessages = document.getElementById('chatMessages');
        var chatInput = document.getElementById('chatInput');
        var chatSend = document.getElementById('chatSend');
        if (!chatMessages) return;
        var chatGuestNotice = document.getElementById('chatGuestNotice');
        var chatPanel = document.getElementById('chatPanel');
        var chatPinnedWrap = document.getElementById('chatPinnedWrap');
        var pinnedTextEl = document.getElementById('chatPinnedText');
        var pinnedMetaEl = document.getElementById('chatPinnedMeta');
        var chatItemSelectWrap = document.getElementById('chatItemSelectWrap');
        var LEVEL_EMOJI = { 1: '🐚', 2: '🦐', 3: '🐡', 4: '🦭', 5: '🦈', 6: '🐋' };
        var lastMessageCount = 0;
        var lastShownItemUseAt = null;
        var itemUsedToastTimer = null;
        var itemUsedToastQueue = [];
        var CHAT_ITEM_NAMES = { pinMessage: '상단 고정 메시지', rewardParty: '리워드 파티', risePrayer: '떡상 기원', broom: '빗자루' };
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
          var html = '<span class="chat-item-used-toast__name">' + escapeHtml(name) + '</span> 님이 <span class="chat-item-used-toast__item">' + escapeHtml(itemName) + '</span> 아이템을 사용!';
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
            var scatterStart = Date.now();
            function spawnScatter() {
              if (Date.now() - scatterStart >= scatterDurationMs) {
                if (scatterTimer) clearInterval(scatterTimer);
                /* 퇴장: 헬기는 중앙 → 좌측 바깥까지 한 번에 사라짐 */
                var exitDuration = (flyOutMs + fadeOutMs) / 1000;
                heliEl.style.transition = 'left ' + exitDuration + 's ease-in, top ' + exitDuration + 's ease-in, transform ' + exitDuration + 's ease-in, opacity ' + exitDuration + 's ease-out';
                heliEl.classList.remove('reward-party-heli--center');
                heliEl.classList.add('reward-party-heli--flyoff');
                /* 헬기 퇴장 완료 + 마지막 토네이도가 바닥에 다 떨어진 뒤에 오버레이 종료 (토네이도 fall 시간 + delay) */
                var scatterFallMs = scatterFallDurationS * 1000 + 300;
                var closeAfterMs = Math.max(flyOutMs + fadeOutMs, scatterFallMs);
                setTimeout(function () {
                  overlay.style.display = 'none';
                  scatterEl.innerHTML = '';
                  heliEl.classList.remove('reward-party-heli--center', 'reward-party-heli--flyoff');
                }, closeAfterMs);
                return;
              }
              var span = document.createElement('span');
              span.className = 'reward-party-scatter-item';
              span.textContent = scatterEmoji;
              var centerX = 50;
              var centerY = 28;
              span.style.left = (centerX + (Math.random() * 36 - 18)) + '%';
              span.style.top = centerY + '%';
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

        function renderMessages(messages, effectiveMyIdFromServer) {
          if (!Array.isArray(messages) || messages.length === 0) {
            chatMessages.innerHTML = '<p class="chat-empty">메시지가 없습니다.</p>';
            return;
          }
          var me = (window.TornFiAuth && window.TornFiAuth.getUser()) || {};
          var myId = effectiveMyIdFromServer != null ? effectiveMyIdFromServer : me.id;
          var existingRows = chatMessages.querySelectorAll('.chat-msg');
          if (messages.length === lastMessageCount && existingRows.length > 0) return;
          lastMessageCount = messages.length;
          var placeholderAvatar = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36"><circle fill="%231a1a1e" cx="18" cy="18" r="18"/><circle fill="%236b7280" cx="18" cy="14" r="5"/><path fill="%236b7280" d="M6 32c0-8 5.3-14 12-14s12 6 12 14H6z"/></svg>');
          chatMessages.innerHTML = messages.map(function (m) {
            var time = m.createdAt ? new Date(m.createdAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) : '';
            var name = (m.displayName || '').trim() || '알 수 없음';
            var levelEmoji = LEVEL_EMOJI[(m.level >= 1 && m.level <= 6) ? m.level : 0] || '';
            var isMine = !!(m.userId && myId && m.userId === myId);
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
            var body = '<div class="chat-msg__body">' + bubble + heartsBelow + '</div>';
            var dataId = ' id="chat-msg-' + escapeHtml(m.id) + '" data-message-id="' + escapeHtml(m.id) + '"';
            var msgClass = 'chat-msg ' + sideClass + adminClass;
            if (isMine) return '<div class="' + msgClass + '"' + dataId + '>' + body + avatarImg + '</div>';
            return '<div class="' + msgClass + '"' + dataId + '>' + avatarImg + body + '</div>';
          }).join('');
          chatMessages.scrollTop = chatMessages.scrollHeight;
          var imgs = chatMessages.querySelectorAll('.chat-msg__img');
          for (var i = 0; i < imgs.length; i++) {
            if (!imgs[i].complete) imgs[i].addEventListener('load', function scrollToBottom() { chatMessages.scrollTop = chatMessages.scrollHeight; });
          }
        }

        var myHearts = 0;

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

        var lastMyShopItems = {};
        var chatItemCooldownUntil = 0;
        var chatItemCooldownTimer = null;
        var CHAT_ITEM_COOLDOWN_MS = 10000;
        function startChatItemCooldown() {
          chatItemCooldownUntil = Date.now() + CHAT_ITEM_COOLDOWN_MS;
          updateChatItemMenu(lastMyShopItems);
          if (chatItemCooldownTimer) clearInterval(chatItemCooldownTimer);
          chatItemCooldownTimer = setInterval(function () {
            if (Date.now() >= chatItemCooldownUntil) { clearInterval(chatItemCooldownTimer); chatItemCooldownTimer = null; }
            updateChatItemMenu(lastMyShopItems);
          }, 1000);
        }
        function updateChatItemMenu(shopItems) {
          var menu = document.getElementById('chatItemMenu');
          if (!chatItemSelectWrap || !menu) return;
          shopItems = shopItems || {};
          var pinMessageN = (shopItems.pinMessage || 0) || 0;
          var rewardPartyN = (shopItems.rewardParty || 0) || 0;
          var risePrayerN = (shopItems.risePrayer || 0) || 0;
          var broomN = (shopItems.broom || 0) || 0;
          var inCooldown = chatItemCooldownUntil > Date.now();
          var cooldownSec = inCooldown ? Math.ceil((chatItemCooldownUntil - Date.now()) / 1000) : 0;
          var html = '<div class="chat-item-menu-hearts">❤️ ' + myHearts + '</div>';
          if (inCooldown) html += '<div class="chat-item-menu-cooldown">' + cooldownSec + '초 후 사용 가능</div>';
          if (pinMessageN > 0) {
            html += '<div class="chat-item-row chat-item-row--left">';
            for (var p = 0; p < pinMessageN; p++) html += '<button type="button" class="chat-item-option chat-item-option--icon" data-value="pinMessage" title="상단 고정 메시지"' + (inCooldown ? ' disabled' : '') + '>📌</button>';
            html += '</div>';
          }
          if (rewardPartyN > 0) {
            html += '<div class="chat-item-row chat-item-row--left">';
            for (var r = 0; r < rewardPartyN; r++) html += '<button type="button" class="chat-item-option chat-item-option--icon" data-value="rewardParty" title="리워드 파티"' + (inCooldown ? ' disabled' : '') + '>🚁</button>';
            html += '</div>';
          }
          if (risePrayerN > 0) {
            html += '<div class="chat-item-row chat-item-row--left">';
            for (var rp = 0; rp < risePrayerN; rp++) html += '<button type="button" class="chat-item-option chat-item-option--icon" data-value="risePrayer" title="떡상 기원"' + (inCooldown ? ' disabled' : '') + '>🙏</button>';
            html += '</div>';
          }
          if (broomN > 0) {
            html += '<div class="chat-item-row chat-item-row--left">';
            for (var b = 0; b < broomN; b++) html += '<button type="button" class="chat-item-option chat-item-option--icon" data-value="broom" title="빗자루"' + (inCooldown ? ' disabled' : '') + '>🧹</button>';
            html += '</div>';
          }
          menu.innerHTML = html;
        }

        function useChatItemAndCooldown(apiPath, wrap, trig) {
          if (trig) trig.textContent = '❤️';
          if (wrap) wrap.dataset.selected = '';
          fetch(apiPath, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' } })
            .then(function (r) { return r.json(); })
            .then(function (data) {
              if (data.ok) {
                if (typeof data.myHearts === 'number') myHearts = data.myHearts;
                if (data.myShopItems != null && typeof data.myShopItems === 'object') lastMyShopItems = data.myShopItems;
                startChatItemCooldown();
              } else if (data.message) alert(data.message);
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
              if (data.ok && data.messages) {
                if (!isAnyChatItemOverlayVisible()) renderMessages(data.messages, effectiveMyId);
              }
              if (data.ok) {
                if (typeof data.myHearts === 'number') myHearts = data.myHearts;
                if (data.myShopItems != null && typeof data.myShopItems === 'object') lastMyShopItems = data.myShopItems;
                updateChatItemMenu(lastMyShopItems);
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
                    updateChatItemMenu(lastMyShopItems);
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
                    if (id && data.ok && data.messages && !isAnyChatItemOverlayVisible()) renderMessages(data.messages, id);
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
              } else if (chatPinnedWrap) {
                chatPinnedWrap.style.display = 'none';
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
                  if (trig) trig.textContent = '❤️';
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
            updateChatItemMenu(lastMyShopItems);
          });
          chatItemSelectWrap.addEventListener('mouseleave', function () {
            if (!chatItemSelectWrap.dataset.selected || chatItemSelectWrap.dataset.selected === '') {
              var trig = chatItemSelectWrap.querySelector('.chat-item-trigger');
              if (trig) trig.textContent = '❤️';
              updateChatItemMenu(lastMyShopItems);
            }
          });
          var chatItemTrigger = document.getElementById('chatItemTrigger');
          var chatShopConfirmLayer = document.getElementById('chatShopConfirmLayer');
          var chatShopConfirmNo = document.getElementById('chatShopConfirmNo');
          var chatShopConfirmYes = document.getElementById('chatShopConfirmYes');
          if (chatItemTrigger && chatShopConfirmLayer) {
            chatItemTrigger.addEventListener('dblclick', function (e) {
              e.preventDefault();
              e.stopPropagation();
              chatShopConfirmLayer.style.display = 'flex';
            });
          }
          if (chatShopConfirmLayer) {
            chatShopConfirmLayer.addEventListener('click', function (e) {
              if (e.target === chatShopConfirmLayer) chatShopConfirmLayer.style.display = 'none';
            });
          }
          if (chatShopConfirmNo) chatShopConfirmNo.addEventListener('click', function () { if (chatShopConfirmLayer) chatShopConfirmLayer.style.display = 'none'; });
          if (chatShopConfirmYes) chatShopConfirmYes.addEventListener('click', function () { window.location.href = '/shop.html'; });
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
                    if (data.myShopItems != null && typeof data.myShopItems === 'object') lastMyShopItems = data.myShopItems;
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
            if (file.size > 2 * 1024 * 1024) { alert('이미지는 2MB 이하로 선택해 주세요.'); chatImage.value = ''; return; }
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
          var msgId = row.dataset.messageId;
          if (!msgId) return;
          var rect = bubbleEl.getBoundingClientRect();
          if (chatMsgDropdown) {
            chatMsgDropdown.classList.toggle('is-other', !row.classList.contains('chat-msg--mine'));
            chatMsgDropdown.style.left = (rect.right - 100) + 'px';
            chatMsgDropdown.style.top = (rect.bottom + 4) + 'px';
            chatMsgDropdown.style.display = 'block';
          }
          openDropdownMsgId = msgId;
          openDropdownRow = row;
        }

        function runDropdownAction(action) {
          if (!openDropdownMsgId || !openDropdownRow) return;
          var isMine = openDropdownRow.classList.contains('chat-msg--mine');
          if ((action === 'edit' || action === 'delete') && !isMine) return;
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
            var current = messageText || '';
            var newText = prompt('메시지 수정', current);
            if (newText === null || newText.trim() === current.trim()) return;
            if (newText.trim().length === 0) { alert('내용을 입력해 주세요.'); return; }
            if (newText.length > 500) { alert('메시지는 500자 이내로 입력해 주세요.'); return; }
            fetch('/api/chat/' + encodeURIComponent(msgId), {
                method: 'PATCH',
              credentials: 'same-origin',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ text: newText.trim() }),
            })
              .then(function (r) { return r.json(); })
              .then(function (data) {
                if (data.ok) { lastMessageCount = 0; fetchChat(); }
                else if (data.message) alert(data.message);
              })
              .catch(function () {});
            return;
          }
          if (action === 'delete') {
            if (!confirm('이 메시지를 삭제할까요?')) return;
            fetch('/api/chat/' + encodeURIComponent(msgId), { method: 'DELETE', credentials: 'same-origin' })
              .then(function (r) { return r.json(); })
              .then(function (data) {
                if (data.ok) { lastMessageCount = 0; fetchChat(); }
                else if (data.message) alert(data.message);
              })
              .catch(function () {});
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
          if (chatSendHeartMessage) chatSendHeartMessage.textContent = (recipientName || '이 사용자') + '님에게 하트 1개를 보내시겠습니까?';
          if (chatSendHeartMyHearts) chatSendHeartMyHearts.textContent = '보유 하트: ' + myHearts + '개';
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
                if (typeof data.myHearts === 'number') myHearts = data.myHearts;
                if (data.myShopItems != null && typeof data.myShopItems === 'object') lastMyShopItems = data.myShopItems;
                updateChatItemMenu(lastMyShopItems);
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
          if (!me.id) { alert('로그인 후 하트를 보낼 수 있습니다.'); return; }
          if (myHearts < 1) { alert('보유 하트가 없습니다.'); return; }
          var msgId = row.dataset.messageId;
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

        chatMessages.addEventListener('click', function (e) {
          var linkEl = e.target.closest && e.target.closest('.chat-msg__link');
          if (linkEl) {
            e.preventDefault();
            e.stopPropagation();
            openLinkConfirmDropdown(linkEl);
            return;
          }
          var bubble = e.target.closest && e.target.closest('.chat-msg__bubble');
          if (!bubble) return;
          var row = bubble.closest('.chat-msg');
          if (row) {
            e.preventDefault();
            e.stopPropagation();
            var me = (window.TornFiAuth && window.TornFiAuth.getUser()) || {};
            if (!me || !me.id) { return; }
            if (openDropdownMsgId === row.dataset.messageId) { closeChatMsgDropdown(); return; }
            openChatMsgDropdown(bubble);
          }
        });

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

        document.addEventListener('click', function (e) {
          if (chatLinkConfirmDropdown && chatLinkConfirmDropdown.contains(e.target)) return;
          if (pendingLinkHref) {
            if (e.target.closest && e.target.closest('.chat-msg__link')) return;
            closeLinkConfirmDropdown();
          }
          if (!openDropdownMsgId) return;
          if (chatMsgDropdown && chatMsgDropdown.contains(e.target)) return;
          if (e.target.closest && e.target.closest('.chat-msg__bubble')) return;
          closeChatMsgDropdown();
        });

        if (chatSend) chatSend.addEventListener('click', sendMessage);
        if (chatInput) {
          chatInput.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') { e.preventDefault(); sendMessage(); }
          });
        }

        if (chatSend) chatSend.disabled = !(window.TornFiAuth && window.TornFiAuth.getUser() && window.TornFiAuth.getUser().id);
        if (chatAttach) chatAttach.disabled = !(window.TornFiAuth && window.TornFiAuth.getUser() && window.TornFiAuth.getUser().id);
        if (window.TornFiAuth && window.TornFiAuth.onUser) {
          window.TornFiAuth.onUser(function (user) {
            if (chatInput) chatInput.placeholder = user ? '메시지 입력' : '메시지 입력 (로그인 후 전송)';
            if (chatSend) chatSend.disabled = !user || !user.id;
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