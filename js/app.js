// WorkChat Application
'use strict';

const RELAY_URL = 'wss://relay.archerlab.dev';
const LOBBY_GAME_ID = 'workchat-lobby';
const LOBBY_ROOM_ID = 'global';
const MAX_PLAYERS_DEFAULT = 10;
const MAX_PLAYERS_LIMIT = 100;

// ─── PWA: Service Worker Registration ───
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').catch(() => {});
    });
}

// ─── PWA: Install Prompt ───
let _pwaInstallPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    _pwaInstallPrompt = e;
    // Show install button in settings
    const g = document.getElementById('pwa-install-group');
    if (g) g.style.display = '';
});

class WorkChat {
    constructor() {
        this.network = new NetworkClient('workchat');       // Regular rooms
        this.lobbyNet = new NetworkClient(LOBBY_GAME_ID);  // Lobby chat

        // Settings
        this.nickname = localStorage.getItem('wc_nickname') || '';
        this.theme = localStorage.getItem('wc_theme') || 'midnight';
        this.opacity = parseFloat(localStorage.getItem('wc_opacity') || '1');

        // Room state
        this.currentRoomId = null;
        this.currentRoomName = '';
        this.currentRoomTopic = '';
        this.currentPassword = null;
        this.isPrivateRoom = false;
        this.maxPlayers = MAX_PLAYERS_DEFAULT;
        this.isHost = false;
        this.displayHostId = null;
        this.users = [];
        this.lobbyUsers = [];

        // Lobby state
        this.roomListTimer = null;
        this.pendingJoinRoom = null;

        // Typing indicator
        this.typingUsers = {};
        this._typingDebounce = null;

        // Unread lobby badge
        this.unreadLobby = 0;

        // Pinned message
        this.pinnedMessage = null;

        // Emoji reactions
        this.reactions = {};

        // DM pending invite
        this._pendingDMInvite = null;

        // Reconnection state
        this._lastRoomId = null;
        this._lastRoomPassword = null;
        this._reconnectTimer = null;

        this.init();
    }

    // ─────────────────── Init ───────────────────

    init() {
        this.applyTheme(this.theme);
        this.applyOpacity(this.opacity);
        this.setupEventListeners();
        this.setupNetworkHandlers();
        this.setupLobbyNetworkHandlers();

        // Hide notification permission button if already granted or not supported
        if (!('Notification' in window) || Notification.permission === 'granted') {
            const g = document.getElementById('notif-permission-group');
            if (g) g.style.display = 'none';
        }

        // 모바일 백그라운드 복귀 시 재접속 처리
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState !== 'visible') return;
            // 방에 있었는데 연결이 끊긴 경우 → 재접속
            if (this._lastRoomId && !this.currentRoomId && !this.network.connected) {
                this.showToast('재접속 중...');
                this.doJoinRoom(this._lastRoomId, this._lastRoomPassword);
                return;
            }
            // 로비에 있는 경우 → 로비 채팅 재연결 + 방 목록 갱신
            if (!this.currentRoomId) {
                if (!this.lobbyNet.connected) this.connectToLobbyChat();
                this.fetchAndRenderRooms();
            }
        });

        const inviteHandled = this.handleInviteUrl();
        if (!inviteHandled) {
            if (this.nickname) {
                this.showLobby();
            } else {
                this.showSetupModal();
            }
        }
    }

    // ─────────────────── Settings ───────────────────

    applyTheme(theme) {
        this.theme = theme;
        document.documentElement.dataset.theme = theme;
        localStorage.setItem('wc_theme', theme);

        // Sync PWA theme-color to sidebar color
        const colors = { dark: '#1a1d21', light: '#e8eaed', midnight: '#0d1117', vscode: '#1e1e1e', terminal: '#000000', excel: '#217346' };
        const meta = document.getElementById('meta-theme-color');
        if (meta) meta.content = colors[theme] || colors.dark;

        // Disguise: change document title
        const titles = {
            vscode: 'chat.ts - WorkChat - Visual Studio Code',
            terminal: `${this.nickname || 'user'}@chat-server: ~`,
            excel: 'Book1 - Excel',
        };
        document.title = titles[theme] || 'Chat';

        // Update terminal title bar text
        const termTitle = document.getElementById('term-title-text');
        if (termTitle) termTitle.textContent = `${this.nickname || 'user'}@chat-server: ~`;

        // Generate Excel column headers (once)
        const colhdr = document.getElementById('excel-colhdr');
        if (colhdr && !colhdr.hasChildNodes()) {
            for (const c of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
                const s = document.createElement('span');
                s.textContent = c;
                colhdr.appendChild(s);
            }
        }

        // Disguise: change placeholders
        const placeholders = { vscode: '$ ', terminal: '$ ', excel: '입력...' };
        const ph = placeholders[theme] || null;
        const lobbyInput = document.getElementById('lobby-msg-input');
        const msgInput = document.getElementById('msg-input');
        if (ph) {
            if (lobbyInput) lobbyInput.placeholder = ph;
            if (msgInput) msgInput.placeholder = ph;
        } else {
            if (lobbyInput) lobbyInput.placeholder = '로비에서 메시지 입력...';
            if (msgInput) msgInput.placeholder = '메시지를 입력하세요...';
        }

        // Reset terminal users panel when switching themes
        const usersPanel = document.getElementById('users-panel');
        if (usersPanel) {
            usersPanel.classList.remove('term-open');
            usersPanel.style.display = '';
        }

        // Update active state on theme buttons
        document.querySelectorAll('.theme-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.theme === theme);
        });
    }

    applyOpacity(val) {
        this.opacity = val;
        document.documentElement.style.setProperty('--app-opacity', val);
        localStorage.setItem('wc_opacity', val);
        const pct = Math.round(val * 100);
        const slider = document.getElementById('opacity-slider');
        const display = document.getElementById('opacity-value');
        if (slider) slider.value = pct;
        if (display) display.textContent = pct + '%';
    }

    updateAvatar(name) {
        const el = document.getElementById('my-avatar');
        if (el) el.textContent = name ? name.charAt(0).toUpperCase() : '?';
    }

    // ─────────────────── Screens ───────────────────

    showSetupModal() {
        document.getElementById('setup-modal').classList.add('active');
        setTimeout(() => document.getElementById('setup-name').focus(), 100);
    }

    hideSetupModal() {
        document.getElementById('setup-modal').classList.remove('active');
    }

    showLobby() {
        document.getElementById('app').style.display = '';
        document.getElementById('my-name-display').textContent = this.nickname;
        document.getElementById('settings-name').value = this.nickname;
        this.updateAvatar(this.nickname);
        this.fetchAndRenderRooms();
        this.startRoomListRefresh();
        this.showWelcomeState();
        this.setMobileView('rooms');
        this.connectToLobbyChat();
    }

    showWelcomeState() {
        document.getElementById('welcome-state').style.display = '';
        document.getElementById('chat-state').style.display = 'none';
        document.getElementById('users-panel').classList.add('visible');
        const titleEl = document.getElementById('users-panel-title');
        if (titleEl) titleEl.textContent = '로비 참여자';
        document.getElementById('room-info-panel').style.display = 'none';
        this.currentRoomId = null;
        this.currentRoomName = '';
        this.currentRoomTopic = '';
        this.currentPassword = null;
        this.isPrivateRoom = false;
        this.maxPlayers = MAX_PLAYERS_DEFAULT;
        this.isHost = false;
        this.displayHostId = null;
        this.users = [];
        this.unreadLobby = 0;
        this.updateLobbyBadge();
        this.renderLobbyUsers();
    }

    showChatState(roomName, topic, isPrivate) {
        document.getElementById('welcome-state').style.display = 'none';
        document.getElementById('chat-state').style.display = '';
        document.getElementById('users-panel').classList.add('visible');
        const titleEl = document.getElementById('users-panel-title');
        if (titleEl) titleEl.textContent = '참여자';
        document.getElementById('current-room-name').textContent = roomName;
        document.getElementById('room-lock-icon').textContent = isPrivate ? '🔒' : '';

        const topicEl = document.getElementById('current-room-topic');
        if (topicEl) {
            topicEl.textContent = topic ? ` · ${topic}` : '';
            topicEl.className = this.isHost ? 'room-topic-display room-topic-host' : 'room-topic-display';
            topicEl.title = this.isHost ? '클릭하여 주제 변경' : '';
        }

        // Reset typing indicator
        this.typingUsers = {};
        this.updateTypingDisplay();

        // Reset pinned message
        this.setPinnedMessage(null);

        this.clearMessages();
        this.updateRoomInfoPanel();
        this.setMobileView('chat');
    }

    updateRoomInfoPanel() {
        const panel = document.getElementById('room-info-panel');
        const topicEl = document.getElementById('room-topic-panel');
        const capEl = document.getElementById('room-capacity-panel');
        const hasTopic = !!this.currentRoomTopic;

        if (hasTopic || this.maxPlayers) {
            panel.style.display = '';
            if (topicEl) topicEl.textContent = this.currentRoomTopic || '';
            if (capEl) capEl.textContent = `최대 ${this.maxPlayers}명`;
        } else {
            panel.style.display = 'none';
        }
    }

    // ─────────────────── Mobile ───────────────────

    setMobileView(view) {
        const app = document.getElementById('app');
        app.dataset.mobileView = view;
        document.querySelectorAll('.mobile-nav-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.view === view);
        });
        const backBtn = document.getElementById('chat-back-btn');
        if (backBtn) backBtn.style.display = (view === 'chat' || view === 'members') ? '' : 'none';
    }

    // ─────────────────── Room List ───────────────────

    startRoomListRefresh() {
        this.stopRoomListRefresh();
        this.roomListTimer = setInterval(() => this.fetchAndRenderRooms(), 5000);
    }

    stopRoomListRefresh() {
        if (this.roomListTimer) { clearInterval(this.roomListTimer); this.roomListTimer = null; }
    }

    async fetchAndRenderRooms() {
        try {
            const data = await this.network.fetchRooms(RELAY_URL);
            this.renderRooms(data.rooms || []);
        } catch {
            const el = document.getElementById('room-list-el');
            if (el) el.innerHTML = '<div class="room-list-empty">서버 연결 실패</div>';
        }
    }

    renderRooms(rooms) {
        const el = document.getElementById('room-list-el');
        if (!el) return;

        if (rooms.length === 0) {
            el.innerHTML = '<div class="room-list-empty">채팅방이 없습니다.<br>새 방을 만들어보세요.</div>';
            return;
        }

        el.innerHTML = '';
        for (const room of rooms) {
            const isPrivate = room.metadata?.password;
            const roomName = room.metadata?.roomName || room.hostName + '의 방';
            const topic = room.metadata?.topic || '';
            const maxP = room.metadata?.maxPlayers || MAX_PLAYERS_DEFAULT;
            const isFull = room.playerCount >= maxP;
            const isCurrent = room.roomId === this.currentRoomId;

            const item = document.createElement('div');
            item.className = `room-item${isCurrent ? ' active' : ''}${isFull && !isCurrent ? ' room-full' : ''}`;

            item.innerHTML = `
                <span class="room-item-icon">${isPrivate ? '🔒' : '#'}</span>
                <div class="room-item-info">
                    <span class="room-item-name">${this.escapeHtml(roomName)}</span>
                    <span class="room-item-meta">${room.playerCount}/${maxP}명${topic ? ' · ' + this.escapeHtml(topic.slice(0, 20)) : ''}</span>
                    ${isFull && !isCurrent ? '<span class="room-item-full">가득 참</span>' : ''}
                </div>
            `;

            if (!isCurrent && !isFull) {
                item.addEventListener('click', () => this.tryJoinRoom(room));
            }
            el.appendChild(item);
        }
    }

    // ─────────────────── Lobby Chat ───────────────────

    async connectToLobbyChat() {
        if (this.lobbyNet.connected) return;
        this.addLobbyMessage('', '로비에 연결 중...', 'system');
        try {
            await this.lobbyNet.joinRoom(RELAY_URL, LOBBY_ROOM_ID, this.nickname, null);
        } catch {
            // Lobby room may not exist yet - try creating it (first user ever)
            try {
                await this.lobbyNet.createRoom(RELAY_URL, this.nickname, null);
            } catch {
                this.addLobbyMessage('', '로비 채팅 연결 실패. 새로고침 해주세요.', 'system');
            }
        }
    }

    disconnectFromLobbyChat() {
        if (this.lobbyNet.connected) {
            this.lobbyNet.leaveRoom();
            this.lobbyNet.disconnect();
        }
        this.lobbyUsers = [];
        this.updateLobbyCount();
    }

    // ─────────────────── Nickname Colors ───────────────────

    nicknameColor(name) {
        let hash = 0;
        for (let i = 0; i < name.length; i++) {
            hash = name.charCodeAt(i) + ((hash << 5) - hash);
        }
        const h = Math.abs(hash) % 360;
        return `hsl(${h}, 60%, 45%)`;
    }

    // ─────────────────── Mention Rendering ───────────────────

    renderMentions(text) {
        const escaped = this.escapeHtml(text);
        return escaped.replace(/@(\S+)/g, (match, word) => {
            const isMe = word === this.nickname || this.escapeHtml(word) === this.escapeHtml(this.nickname);
            const cls = isMe ? 'mention mention-me' : 'mention';
            return `<span class="${cls}">@${this.escapeHtml(word)}</span>`;
        });
    }

    // ─────────────────── Typing Indicator ───────────────────

    sendTypingIndicator() {
        if (!this.currentRoomId || this._typingDebounce) return;
        this.network.send({ type: 'typing', name: this.nickname });
        this._typingDebounce = setTimeout(() => { this._typingDebounce = null; }, 2000);
    }

    showTypingIndicator(name) {
        if (this.typingUsers[name]) clearTimeout(this.typingUsers[name]);
        this.typingUsers[name] = setTimeout(() => {
            delete this.typingUsers[name];
            this.updateTypingDisplay();
        }, 3000);
        this.updateTypingDisplay();
    }

    updateTypingDisplay() {
        const el = document.getElementById('typing-indicator');
        if (!el) return;
        const names = Object.keys(this.typingUsers);
        if (names.length === 0) {
            el.style.display = 'none';
            el.textContent = '';
        } else {
            el.style.display = '';
            el.textContent = names.join(', ') + '님이 입력 중...';
        }
    }

    // ─────────────────── Unread Lobby Badge ───────────────────

    updateLobbyBadge() {
        const el = document.getElementById('lobby-unread-badge');
        if (!el) return;
        if (this.unreadLobby > 0) {
            el.textContent = this.unreadLobby;
            el.style.display = '';
        } else {
            el.style.display = 'none';
        }
    }

    // ─────────────────── Pinned Message ───────────────────

    setPinnedMessage(text) {
        this.pinnedMessage = text || null;
        const el = document.getElementById('pinned-message');
        if (!el) return;
        if (this.pinnedMessage) {
            el.textContent = '📌 ' + this.pinnedMessage;
            el.style.display = '';
        } else {
            el.style.display = 'none';
        }
    }

    pinCurrentMessage(text) {
        if (!this.isHost) return;
        this.network.send({ type: 'pinMessage', text });
        this.setPinnedMessage(text);
    }

    // ─────────────────── Topic Change ───────────────────

    changeTopicInline() {
        if (!this.isHost) return;
        const newTopic = prompt('새 주제를 입력하세요:', this.currentRoomTopic || '');
        if (newTopic === null) return;
        const topic = newTopic.trim().slice(0, 60);
        this.currentRoomTopic = topic;
        this.network.send({ type: 'topicChange', topic });
        this.network.setMetadata({
            roomName: this.currentRoomName,
            topic,
            password: !!this.currentPassword,
            maxPlayers: this.maxPlayers,
        });
        const topicEl = document.getElementById('current-room-topic');
        if (topicEl) topicEl.textContent = topic ? ` · ${topic}` : '';
        this.updateRoomInfoPanel();
    }

    // ─────────────────── Emoji Reactions ───────────────────

    showReactionBar(msgEl, msgId) {
        const existing = msgEl.querySelector('.reaction-bar');
        if (existing) return;
        const bar = document.createElement('div');
        bar.className = 'reaction-bar';
        const emojis = ['👍', '❤️', '😂', '😮', '😢', '🔥'];
        for (const emoji of emojis) {
            const btn = document.createElement('button');
            btn.className = 'reaction-pick';
            btn.textContent = emoji;
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.sendReaction(msgId, emoji);
                bar.remove();
            });
            bar.appendChild(btn);
        }
        bar.addEventListener('mouseleave', () => bar.remove());
        msgEl.appendChild(bar);
    }

    sendReaction(msgId, emoji) {
        this.network.send({ type: 'reaction', msgId, emoji, name: this.nickname });
        this.applyReaction(msgId, emoji, this.nickname);
    }

    applyReaction(msgId, emoji, name) {
        if (!this.reactions[msgId]) this.reactions[msgId] = {};
        if (!this.reactions[msgId][emoji]) this.reactions[msgId][emoji] = new Set();
        this.reactions[msgId][emoji].add(name);
        this.renderReactions(msgId);
    }

    renderReactions(msgId) {
        const msgEl = document.querySelector(`[data-msg-id="${msgId}"]`);
        if (!msgEl) return;
        const container = msgEl.querySelector('.msg-reactions');
        if (!container) return;
        container.innerHTML = '';
        const emojiMap = this.reactions[msgId] || {};
        for (const [emoji, names] of Object.entries(emojiMap)) {
            if (names.size === 0) continue;
            const badge = document.createElement('button');
            badge.className = 'reaction-badge' + (names.has(this.nickname) ? ' me' : '');
            badge.textContent = `${emoji} ${names.size}`;
            badge.title = [...names].join(', ');
            badge.addEventListener('click', () => this.sendReaction(msgId, emoji));
            container.appendChild(badge);
        }
    }

    // ─────────────────── Push Notifications ───────────────────

    requestNotificationPermission() {
        if (!('Notification' in window)) {
            this.showToast('이 브라우저는 알림을 지원하지 않습니다.');
            return;
        }
        Notification.requestPermission().then(result => {
            if (result === 'granted') {
                this.showToast('알림이 허용되었습니다.');
                const btn = document.getElementById('btn-notif-permission');
                if (btn) btn.closest('.setting-group').style.display = 'none';
            } else if (result === 'denied') {
                this.showToast('알림이 차단되었습니다. 브라우저 설정에서 변경할 수 있습니다.');
            } else {
                this.showToast('알림 권한이 설정되지 않았습니다.');
            }
        });
    }

    showBrowserNotification(title, body) {
        if (!document.hidden) return;
        if (!('Notification' in window)) return;
        if (Notification.permission !== 'granted') return;
        try {
            new Notification(title, { body, icon: '/icons/icon.svg' });
        } catch {}
    }

    playMentionSound() {
        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.frequency.value = 880;
            osc.type = 'sine';
            gain.gain.setValueAtTime(0.3, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
            osc.start(ctx.currentTime);
            osc.stop(ctx.currentTime + 0.3);
        } catch {}
    }

    // ─────────────────── DM ───────────────────

    startDM(targetUser) {
        if (!this.lobbyNet.connected) {
            this.showToast('로비에 연결되어 있어야 DM을 보낼 수 있습니다.');
            return;
        }
        if (!confirm(`${targetUser.name}님에게 1:1 DM을 시작하시겠습니까?`)) return;
        const dmPassword = String(crypto.getRandomValues(new Uint16Array(1))[0]).slice(-4).padStart(4, '0');
        const dmRoomName = `DM: ${this.nickname} ↔ ${targetUser.name}`;
        // Resolve lobbyNet id for the target
        const lobbyUser = this.lobbyUsers.find(lu => lu.name === targetUser.name) || targetUser;
        this._pendingDMInvite = { targetId: lobbyUser.id, targetName: targetUser.name, password: dmPassword };
        this.createRoom(dmRoomName, '', dmPassword, 2);
    }

    isDisguiseTheme() {
        return this.theme === 'vscode' || this.theme === 'terminal' || this.theme === 'excel';
    }

    addLobbyMessage(name, text, type = 'chat') {
        const el = document.getElementById('lobby-messages');
        if (!el) return;

        const msg = document.createElement('div');
        if (type === 'system') {
            msg.className = 'msg msg-system';
            msg.textContent = text;
        } else if (this.isDisguiseTheme()) {
            const isMe = name === this.nickname;
            msg.className = `msg ${isMe ? 'msg-self' : 'msg-other'}`;
            msg.innerHTML = `<div class="msg-text">${this.escapeHtml(text)}</div>`;
        } else {
            const isMe = name === this.nickname;
            msg.className = `msg ${isMe ? 'msg-self' : 'msg-other'}`;
            const now = new Date();
            const time = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');
            const color = this.nicknameColor(name);
            msg.innerHTML = `
                <div class="msg-header">
                    <span class="msg-name" style="color:${color}">${this.escapeHtml(name)}</span>
                    <span class="msg-time">${time}</span>
                </div>
                <div class="msg-text">${this.renderMentions(text)}</div>
            `;
        }

        el.appendChild(msg);
        el.scrollTop = el.scrollHeight;
        while (el.children.length > 100) el.removeChild(el.firstChild);
    }

    sendLobbyMessage() {
        const input = document.getElementById('lobby-msg-input');
        const text = input.value.trim();
        if (!text || !this.lobbyNet.connected) return;
        if (text === '/clear') {
            document.getElementById('lobby-messages').innerHTML = '';
            input.value = '';
            return;
        }
        this.lobbyNet.sendChat(text);
        input.value = '';
        input.focus();
    }

    updateLobbyCount() {
        const el = document.getElementById('lobby-user-count');
        if (el) el.textContent = `${this.lobbyUsers.length}명 온라인`;
        if (!this.currentRoomId) this.renderLobbyUsers();
    }

    renderLobbyUsers() {
        const el = document.getElementById('user-list');
        if (!el) return;
        el.innerHTML = '';
        for (const u of this.lobbyUsers) {
            const isMe = u.id === this.lobbyNet.playerId;
            const color = this.nicknameColor(u.name);
            const item = document.createElement('div');
            item.className = `user-item${isMe ? ' me' : ''}`;
            item.innerHTML = `
                <span class="user-avatar">👤</span>
                <div class="user-info">
                    <span class="user-name" style="color:${color}">${this.escapeHtml(u.name)}${isMe ? ' (나)' : ''}</span>
                </div>
                ${!isMe ? `<button class="btn-dm" title="1:1 DM">💬</button>` : ''}
            `;
            if (!isMe) {
                item.querySelector('.btn-dm').addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.startDM(u);
                });
            }
            el.appendChild(item);
        }
        const countEl = document.getElementById('user-count');
        if (countEl) countEl.textContent = this.lobbyUsers.length;
    }

    setupLobbyNetworkHandlers() {
        this.lobbyNet.on('roomCreated', (msg) => {
            this.lobbyUsers = msg.players || [];
            this.updateLobbyCount();
            this.addLobbyMessage('', '로비에 연결되었습니다.', 'system');
            this.addLobbyMessage('', '첫 번째 사용자입니다! 채팅방을 만들거나 로비에서 대화를 시작해보세요.', 'system');
        });

        this.lobbyNet.on('joined', (msg) => {
            this.lobbyUsers = msg.players || [];
            this.updateLobbyCount();
            this.addLobbyMessage('', '로비에 연결되었습니다.', 'system');
            if (this.lobbyUsers.length <= 1) {
                this.addLobbyMessage('', '현재 로비에 다른 사용자가 없습니다. 채팅방을 만들거나 기다려보세요.', 'system');
            }
        });

        this.lobbyNet.on('playerJoined', (msg) => {
            if (msg.players) { this.lobbyUsers = msg.players; this.updateLobbyCount(); }
            if (msg.player) {
                this.addLobbyMessage('', `${msg.player.name}님이 로비에 입장했습니다.`, 'system');
            }
        });

        this.lobbyNet.on('playerLeft', (msg) => {
            const leftUser = this.lobbyUsers.find(u => !msg.players?.find(p => p.id === u.id));
            if (leftUser) this.addLobbyMessage('', `${leftUser.name}님이 로비에서 나갔습니다.`, 'system');
            if (msg.players) { this.lobbyUsers = msg.players; this.updateLobbyCount(); }
        });

        this.lobbyNet.on('roomState', (msg) => {
            if (msg.players) { this.lobbyUsers = msg.players; this.updateLobbyCount(); }
        });

        this.lobbyNet.on('chat', (msg) => {
            this.addLobbyMessage(msg.name, msg.message, 'chat');
            if (this.currentRoomId) {
                this.unreadLobby++;
                this.updateLobbyBadge();
            }
        });

        this.lobbyNet.on('roomInvite', (msg) => {
            if (msg.targetId !== this.lobbyNet.playerId) return;
            // DM 초대는 자동 수락
            if (msg.roomName && msg.roomName.startsWith('DM:')) {
                this.showToast(`${msg.fromName}님의 DM에 자동 입장합니다.`);
                if (this.currentRoomId) {
                    this.network.leaveRoom();
                    this.network.disconnect();
                    this.showWelcomeState();
                }
                this.doJoinRoom(msg.roomId, msg.password);
                return;
            }
            this.showInviteDialog(msg.fromName, msg.roomId, msg.roomName, msg.password);
        });

        this.lobbyNet.on('disconnected', () => {
            this.lobbyUsers = [];
            this.updateLobbyCount();
        });
    }

    // ─────────────────── Room Actions ───────────────────

    tryJoinRoom(room) {
        if (!this.nickname) { this.showSetupModal(); return; }

        const maxP = room.metadata?.maxPlayers || MAX_PLAYERS_DEFAULT;
        if (room.playerCount >= maxP) {
            this.showToast('채팅방이 가득 찼습니다.');
            return;
        }

        if (room.metadata?.password) {
            this.pendingJoinRoom = room;
            document.getElementById('join-password').value = '';
            document.getElementById('password-modal').classList.add('active');
            setTimeout(() => document.getElementById('join-password').focus(), 100);
        } else {
            this.doJoinRoom(room.roomId, null);
        }
    }

    async doJoinRoom(roomId, password) {
        if (this.currentRoomId) {
            this.network.leaveRoom();
            this.network.disconnect();
        }
        this.stopRoomListRefresh();

        try {
            await this.network.joinRoom(RELAY_URL, roomId, this.nickname, password);
        } catch (e) {
            const msg = (e.message || '').toLowerCase();
            if (msg.includes('password') || msg.includes('wrong')) {
                this.showToast('비밀번호가 틀렸습니다.');
            } else {
                this.showToast('방에 입장할 수 없습니다.');
            }
            this.startRoomListRefresh();
            this.fetchAndRenderRooms();
            // Reconnect to lobby
            this.connectToLobbyChat();
        }
    }

    async createRoom(roomName, topic, password, maxPlayers) {
        if (this.currentRoomId) {
            this.network.leaveRoom();
            this.network.disconnect();
        }
        this.stopRoomListRefresh();

        try {
            await this.network.createRoom(RELAY_URL, this.nickname, password);
            this.currentPassword = password || null;
            this.network.setMetadata({
                roomName,
                topic: topic || '',
                password: !!password,
                maxPlayers: maxPlayers || MAX_PLAYERS_DEFAULT,
            });
        } catch {
            this.showToast('방 생성에 실패했습니다. 잠시 후 다시 시도해주세요.');
            this.startRoomListRefresh();
            this.connectToLobbyChat();
        }
    }

    leaveRoom() {
        // 의도적 퇴장 시 재접속 상태 초기화
        this._lastRoomId = null;
        this._lastRoomPassword = null;
        clearTimeout(this._reconnectTimer);
        this.network.leaveRoom();
        this.network.disconnect();
        this.showWelcomeState();
        this.fetchAndRenderRooms();
        this.startRoomListRefresh();
        // Reconnect to lobby
        this.connectToLobbyChat();
        this.setMobileView('rooms');
    }

    // ─────────────────── Nickname uniqueness check ───────────────────

    checkNicknameUniqueness(players) {
        const myId = this.network.playerId;
        const duplicate = players.find(p => p.id !== myId && p.name === this.nickname);
        if (duplicate) {
            this.showToast(`이미 "${this.nickname}" 닉네임을 사용 중인 사람이 있습니다.`);
            this.network.leaveRoom();
            this.network.disconnect();
            this.showWelcomeState();
            this.fetchAndRenderRooms();
            this.startRoomListRefresh();
            this.connectToLobbyChat();
            return false;
        }
        return true;
    }

    // ─────────────────── Room Chat ───────────────────

    clearMessages() {
        const el = document.getElementById('messages');
        if (el) el.innerHTML = '';
    }

    addMessage(name, text, type = 'chat', msgId = null) {
        const el = document.getElementById('messages');
        if (!el) return;

        const msg = document.createElement('div');
        if (type === 'system') {
            msg.className = 'msg msg-system';
            msg.textContent = text;
        } else if (this.isDisguiseTheme()) {
            const isMe = name === this.nickname;
            msg.className = `msg ${isMe ? 'msg-self' : 'msg-other'}`;
            msg.innerHTML = `<div class="msg-text">${this.escapeHtml(text)}</div>`;
        } else {
            const isMe = name === this.nickname;
            const mentionsMe = !isMe && text.includes('@' + this.nickname);
            msg.className = `msg ${isMe ? 'msg-self' : 'msg-other'}${mentionsMe ? ' msg-mention' : ''}`;
            if (msgId) msg.dataset.msgId = msgId;
            const now = new Date();
            const time = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');
            const color = this.nicknameColor(name);
            msg.innerHTML = `
                <div class="msg-header">
                    <span class="msg-name" style="color:${color}">${this.escapeHtml(name)}</span>
                    <span class="msg-time">${time}</span>
                </div>
                <div class="msg-text">${this.renderMentions(text)}</div>
                <div class="msg-reactions"></div>
            `;

            if (mentionsMe) {
                this.playMentionSound();
                this.showBrowserNotification(name, text);
            }

            if (msgId) {
                msg.addEventListener('mouseenter', () => this.showReactionBar(msg, msgId));
            }
        }

        el.appendChild(msg);
        el.scrollTop = el.scrollHeight;
        while (el.children.length > 200) el.removeChild(el.firstChild);
    }

    sendMessage() {
        const input = document.getElementById('msg-input');
        const text = input.value.trim();
        if (!text || !this.currentRoomId) return;
        if (text === '/clear') {
            document.getElementById('messages').innerHTML = '';
            input.value = '';
            return;
        }
        if (!this.network.connected) {
            this.showToast('서버 연결이 끊어졌습니다.');
            return;
        }
        const msgId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        this.network.send({ type: 'chat', message: text.slice(0, 500), msgId });
        this._typingDebounce = null;
        input.value = '';
        input.focus();
    }

    // ─────────────────── User List ───────────────────

    renderUsers(users) {
        this.users = users;
        const el = document.getElementById('user-list');
        if (!el) return;

        el.innerHTML = '';
        for (const u of users) {
            const isDisplayHost = u.id === this.displayHostId || u.isHost;
            const isMe = u.id === this.network.playerId;
            const color = this.nicknameColor(u.name);

            const item = document.createElement('div');
            item.className = `user-item${isMe ? ' me' : ''}`;

            let hostActions = '';
            if (this.isHost && !isMe) {
                hostActions = `
                    <div class="user-actions">
                        <button class="btn-user-action btn-transfer" data-id="${u.id}" title="방장 넘기기">👑</button>
                        <button class="btn-user-action btn-kick" data-id="${u.id}" title="내보내기">✕</button>
                    </div>
                `;
            }

            item.innerHTML = `
                <span class="user-avatar">${isDisplayHost ? '👑' : '👤'}</span>
                <div class="user-info">
                    <span class="user-name" style="color:${color}">${this.escapeHtml(u.name)}${isMe ? ' (나)' : ''}</span>
                    ${isDisplayHost ? '<span class="user-role">방장</span>' : ''}
                </div>
                ${!isMe ? `<button class="btn-dm" title="1:1 DM">💬</button>` : ''}
                ${hostActions}
            `;

            if (!isMe) {
                item.querySelector('.btn-dm').addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.startDM(u);
                });
            }

            if (this.isHost && !isMe) {
                item.querySelector('.btn-kick')?.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.kickUser(u.id, u.name);
                });
                item.querySelector('.btn-transfer')?.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.transferHostTo(u.id, u.name);
                });
            }

            el.appendChild(item);
        }

        const countEl = document.getElementById('user-count');
        if (countEl) countEl.textContent = `${users.length}/${this.maxPlayers}`;

        const inviteBtn = document.getElementById('btn-copy-invite');
        if (inviteBtn) inviteBtn.style.display = (this.isHost && this.isPrivateRoom) ? '' : 'none';

        const inviteUserBtn = document.getElementById('btn-invite-user');
        if (inviteUserBtn) inviteUserBtn.style.display = this.isHost ? '' : 'none';

        const headerInviteBtn = document.getElementById('btn-header-invite-user');
        if (headerInviteBtn) headerInviteBtn.style.display = this.isHost ? '' : 'none';

        const pinBtn = document.getElementById('btn-pin-message');
        if (pinBtn) pinBtn.style.display = this.isHost ? '' : 'none';

        // Update topic clickability when host status changes
        const topicEl = document.getElementById('current-room-topic');
        if (topicEl) {
            topicEl.className = this.isHost ? 'room-topic-display room-topic-host' : 'room-topic-display';
            topicEl.title = this.isHost ? '클릭하여 주제 변경' : '';
        }
    }

    // ─────────────────── Invite ───────────────────

    openInviteUserModal() {
        const roomMemberNames = new Set(this.users.map(u => u.name));
        const candidates = this.lobbyUsers.filter(u => !roomMemberNames.has(u.name));

        const list = document.getElementById('invite-user-list');
        if (!list) return;
        list.innerHTML = '';

        if (candidates.length === 0) {
            list.innerHTML = '<div class="invite-empty">초대할 수 있는 온라인 사용자가 없습니다.</div>';
        } else {
            for (const u of candidates) {
                const item = document.createElement('div');
                item.className = 'invite-user-item';
                item.innerHTML = `
                    <span class="user-avatar">👤</span>
                    <span class="invite-user-name">${this.escapeHtml(u.name)}</span>
                    <button class="btn-send-invite" data-id="${u.id}" data-name="${this.escapeHtml(u.name)}">초대</button>
                `;
                item.querySelector('.btn-send-invite').addEventListener('click', (e) => {
                    const id = e.target.dataset.id;
                    const name = e.target.dataset.name;
                    this.sendRoomInvite(id, name);
                    document.getElementById('invite-user-modal').classList.remove('active');
                });
                list.appendChild(item);
            }
        }
        document.getElementById('invite-user-modal').classList.add('active');
    }

    sendRoomInvite(targetId, targetName) {
        this.lobbyNet.send({
            type: 'roomInvite',
            targetId,
            fromName: this.nickname,
            roomId: this.currentRoomId,
            roomName: this.currentRoomName,
            password: this.currentPassword,
        });
        this.showToast(`${targetName}님에게 초대장을 보냈습니다.`);
    }

    showInviteDialog(fromName, roomId, roomName, password) {
        const existing = document.getElementById('invite-dialog');
        if (existing) existing.remove();

        const d = document.createElement('div');
        d.id = 'invite-dialog';
        d.className = 'invite-dialog';
        d.innerHTML = `
            <div class="invite-dialog-box">
                <div class="invite-dialog-title">📨 초대</div>
                <div class="invite-dialog-body">
                    <strong>${this.escapeHtml(fromName)}</strong>님이<br>
                    <strong>'${this.escapeHtml(roomName)}'</strong>에 초대했습니다.
                </div>
                <div class="invite-dialog-actions">
                    <button class="btn-secondary" id="btn-invite-decline">거절</button>
                    <button class="btn-confirm" id="btn-invite-accept">수락</button>
                </div>
            </div>
        `;
        document.body.appendChild(d);

        const autoCloseTimer = setTimeout(() => d.remove(), 30000);
        document.getElementById('btn-invite-accept').addEventListener('click', () => {
            clearTimeout(autoCloseTimer);
            d.remove();
            if (this.currentRoomId) {
                this.network.leaveRoom();
                this.network.disconnect();
                this.showWelcomeState();
            }
            this.doJoinRoom(roomId, password);
        });
        document.getElementById('btn-invite-decline').addEventListener('click', () => {
            clearTimeout(autoCloseTimer);
            d.remove();
        });
    }

    // ─────────────────── Host Actions ───────────────────

    kickUser(userId, userName) {
        if (!this.isHost) return;
        if (!confirm(`${userName}님을 채팅방에서 내보내시겠습니까?`)) return;
        this.network.kick(userId);
    }

    transferHostTo(targetId, targetName) {
        if (!this.isHost) return;
        if (!confirm(`${targetName}님에게 방장 권한을 넘기시겠습니까?`)) return;

        this.network.transferHost(targetId);
        this.displayHostId = targetId;
        this.isHost = false;
        this.network.isHost = false;

        this.renderUsers(this.users);
        this.updateHostUI();
        this.addMessage('', `${targetName}님에게 방장 권한이 이전되었습니다.`, 'system');
    }

    updateHostUI() {
        const inviteBtn = document.getElementById('btn-copy-invite');
        if (inviteBtn) inviteBtn.style.display = (this.isHost && this.isPrivateRoom) ? '' : 'none';
    }

    // ─────────────────── Invite ───────────────────

    generateInviteLink() {
        const base = window.location.origin + window.location.pathname;
        const params = new URLSearchParams({ room: this.currentRoomId });
        if (this.currentPassword) params.set('pw', this.currentPassword);
        return `${base}?${params.toString()}`;
    }

    handleInviteUrl() {
        const params = new URLSearchParams(window.location.search);
        const roomId = params.get('room');
        const password = params.get('pw');
        if (!roomId) return false;

        window.history.replaceState({}, '', window.location.pathname);

        if (!this.nickname) {
            sessionStorage.setItem('wc_pending_room', roomId);
            if (password) sessionStorage.setItem('wc_pending_pw', password);
            this.showSetupModal();
            return true;
        }

        setTimeout(() => {
            this.showLobby();
            this.doJoinRoom(roomId, password || null);
        }, 100);
        return true;
    }

    // ─────────────────── Room Network Handlers ───────────────────

    setupNetworkHandlers() {
        this.network.on('roomCreated', (msg) => {
            this._lastRoomId = null;
            this._lastRoomPassword = null;
            clearTimeout(this._reconnectTimer);
            this.currentRoomId = msg.roomId;
            const meta = msg.metadata || {};
            this.currentRoomName = meta.roomName || this.nickname + '의 방';
            this.currentRoomTopic = meta.topic || '';
            this.isPrivateRoom = !!meta.password;
            this.maxPlayers = meta.maxPlayers || MAX_PLAYERS_DEFAULT;
            this.isHost = true;
            this.displayHostId = this.network.playerId;

            this.showChatState(this.currentRoomName, this.currentRoomTopic, this.isPrivateRoom);
            this.renderUsers(msg.players || []);
            this.addMessage('', `${this.currentRoomName}을(를) 개설했습니다.`, 'system');
            this.fetchAndRenderRooms();

            if (this._pendingDMInvite) {
                const { targetId, targetName, password } = this._pendingDMInvite;
                this._pendingDMInvite = null;
                this.lobbyNet.send({
                    type: 'roomInvite',
                    targetId,
                    fromName: this.nickname,
                    roomId: this.currentRoomId,
                    roomName: this.currentRoomName,
                    password,
                });
                this.addMessage('', `${targetName}님에게 DM 초대를 보냈습니다.`, 'system');
            }
        });

        this.network.on('joined', (msg) => {
            // 재접속 성공 시 상태 초기화
            this._lastRoomId = null;
            this._lastRoomPassword = null;
            clearTimeout(this._reconnectTimer);

            const meta = msg.metadata || {};
            this.currentRoomId = msg.roomId;
            this.currentRoomName = meta.roomName || '채팅방';
            this.currentRoomTopic = meta.topic || '';
            this.isPrivateRoom = !!meta.password;
            this.maxPlayers = meta.maxPlayers || MAX_PLAYERS_DEFAULT;
            this.isHost = false;

            const players = msg.players || [];
            const hostPlayer = players.find(p => p.isHost);
            this.displayHostId = hostPlayer?.id || null;

            if (!this.checkNicknameUniqueness(players)) return;

            this.showChatState(this.currentRoomName, this.currentRoomTopic, this.isPrivateRoom);
            this.renderUsers(players);
            this.addMessage('', `${this.currentRoomName}에 입장했습니다.`, 'system');
            this.fetchAndRenderRooms();
        });

        this.network.on('playerJoined', (msg) => {
            if (msg.player) {
                if (msg.player.name === this.nickname && msg.player.id !== this.network.playerId) {
                    this.showToast(`닉네임 중복: "${this.nickname}" 사용자가 입장했습니다.`);
                }
                this.addMessage('', `${msg.player.name}님이 입장했습니다.`, 'system');
            }
            if (msg.players) this.renderUsers(msg.players);
            // Update room list to reflect new count
            this.fetchAndRenderRooms();
        });

        this.network.on('playerLeft', (msg) => {
            const leftUser = this.users.find(u => !msg.players?.find(p => p.id === u.id));
            if (leftUser) this.addMessage('', `${leftUser.name}님이 퇴장했습니다.`, 'system');

            if (msg.players) {
                const newHost = msg.players.find(p => p.isHost);
                const wasHostChanged = newHost && newHost.id !== this.displayHostId;

                if (wasHostChanged) {
                    this.displayHostId = newHost.id;
                    if (newHost.id === this.network.playerId && !this.isHost) {
                        this.isHost = true;
                        this.network.isHost = true;
                        this.addMessage('', '방장이 되었습니다.', 'system');
                        this.updateHostUI();
                    } else if (!this.isHost) {
                        this.addMessage('', `${newHost.name}님이 방장이 되었습니다.`, 'system');
                    }
                }
                this.renderUsers(msg.players);
            }
            // Update room list
            this.fetchAndRenderRooms();
        });

        this.network.on('roomState', (msg) => {
            if (msg.players) {
                const hostPlayer = msg.players.find(p => p.isHost);
                if (hostPlayer) this.displayHostId = hostPlayer.id;
                this.renderUsers(msg.players);
            }
            if (msg.metadata) {
                const meta = msg.metadata;
                if (meta.roomName) {
                    this.currentRoomName = meta.roomName;
                    document.getElementById('current-room-name').textContent = meta.roomName;
                }
                if (meta.topic !== undefined) {
                    this.currentRoomTopic = meta.topic;
                    const topicEl = document.getElementById('current-room-topic');
                    if (topicEl) topicEl.textContent = meta.topic ? ` · ${meta.topic}` : '';
                }
                if (meta.maxPlayers) this.maxPlayers = meta.maxPlayers;
                this.updateRoomInfoPanel();
            }
        });

        this.network.on('chat', (msg) => {
            this.addMessage(msg.name, msg.message, 'chat', msg.msgId || null);
        });

        this.network.on('typing', (msg) => {
            if (msg.name !== this.nickname) this.showTypingIndicator(msg.name);
        });

        this.network.on('topicChange', (msg) => {
            this.currentRoomTopic = msg.topic;
            const topicEl = document.getElementById('current-room-topic');
            if (topicEl) topicEl.textContent = msg.topic ? ` · ${msg.topic}` : '';
            this.updateRoomInfoPanel();
            this.addMessage('', '주제가 변경되었습니다: ' + msg.topic, 'system');
        });

        this.network.on('pinMessage', (msg) => {
            this.setPinnedMessage(msg.text);
            this.addMessage('', '📌 공지가 등록되었습니다.', 'system');
        });

        this.network.on('reaction', (msg) => {
            this.applyReaction(msg.msgId, msg.emoji, msg.name);
        });

        this.network.on('kicked', () => {
            this.network.disconnect();
            this.showWelcomeState();
            this.fetchAndRenderRooms();
            this.startRoomListRefresh();
            this.connectToLobbyChat();
            this.showToast('채팅방에서 내보내기 되었습니다.');
        });

        // Host transfer (server broadcasts to all via default case)
        this.network.on('hostTransfer', (msg) => {
            const targetUser = this.users.find(u => u.id === msg.targetId);
            if (!targetUser) return;

            this.displayHostId = msg.targetId;
            if (msg.targetId === this.network.playerId && !this.isHost) {
                this.isHost = true;
                this.addMessage('', '방장 권한을 받았습니다.', 'system');
                this.updateHostUI();
            }
            this.renderUsers(this.users);
        });

        this.network.on('disconnected', () => {
            if (this.currentRoomId) {
                // 재접속을 위해 방 정보 저장
                this._lastRoomId = this.currentRoomId;
                this._lastRoomPassword = this.currentPassword;
                this.showWelcomeState();
                this.fetchAndRenderRooms();
                this.startRoomListRefresh();
                this.connectToLobbyChat();
                this.showToast('연결이 끊어졌습니다. 재접속 시도 중...');
                // 2초 후 자동 재접속 시도
                clearTimeout(this._reconnectTimer);
                this._reconnectTimer = setTimeout(() => {
                    if (this._lastRoomId && !this.currentRoomId) {
                        this.doJoinRoom(this._lastRoomId, this._lastRoomPassword);
                    }
                }, 2000);
            }
        });
    }

    // ─────────────────── Event Listeners ───────────────────

    setupEventListeners() {
        // Setup modal
        document.getElementById('btn-setup-start').addEventListener('click', () => this.handleSetupSubmit());
        document.getElementById('setup-name').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') this.handleSetupSubmit();
        });

        // New room
        document.getElementById('btn-new-room').addEventListener('click', () => this.openCreateModal());
        document.getElementById('btn-welcome-create').addEventListener('click', () => this.openCreateModal());

        // Create modal - room type toggle
        document.querySelectorAll('.room-type-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.room-type-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const isPvt = btn.dataset.type === 'private';
                document.getElementById('password-group').style.display = isPvt ? '' : 'none';
                if (isPvt) document.getElementById('create-password').focus();
            });
        });

        // Capacity slider
        document.getElementById('create-capacity').addEventListener('input', (e) => {
            document.getElementById('capacity-display').textContent = e.target.value + '명';
        });

        document.getElementById('btn-create-cancel').addEventListener('click', () => this.closeCreateModal());
        document.getElementById('btn-create-confirm').addEventListener('click', () => this.handleCreateRoom());
        document.getElementById('create-room-modal').addEventListener('click', (e) => {
            if (e.target === e.currentTarget) this.closeCreateModal();
        });

        // Password modal
        document.getElementById('btn-pw-cancel').addEventListener('click', () => this.closePasswordModal());
        document.getElementById('btn-pw-confirm').addEventListener('click', () => this.handlePasswordJoin());
        document.getElementById('join-password').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') this.handlePasswordJoin();
        });
        document.getElementById('password-modal').addEventListener('click', (e) => {
            if (e.target === e.currentTarget) this.closePasswordModal();
        });

        // Leave room
        document.getElementById('btn-leave').addEventListener('click', () => {
            if (confirm('채팅방을 나가시겠습니까?')) this.leaveRoom();
        });

        // Room chat
        document.getElementById('btn-send').addEventListener('click', () => this.sendMessage());
        document.getElementById('msg-input').addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.sendMessage(); }
            else this.sendTypingIndicator();
        });

        // Topic change (host)
        document.getElementById('current-room-topic')?.addEventListener('click', () => {
            if (this.isHost) this.changeTopicInline();
        });

        // Pin message button
        document.getElementById('btn-pin-message')?.addEventListener('click', () => {
            const text = prompt('공지 메시지를 입력하세요:');
            if (text && text.trim()) this.pinCurrentMessage(text.trim().slice(0, 200));
        });

        // Notification permission button
        document.getElementById('btn-notif-permission')?.addEventListener('click', () => {
            this.requestNotificationPermission();
        });

        // Lobby chat
        document.getElementById('btn-lobby-send').addEventListener('click', () => this.sendLobbyMessage());
        document.getElementById('lobby-msg-input').addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.sendLobbyMessage(); }
        });

        // Invite
        document.getElementById('btn-copy-invite').addEventListener('click', () => {
            const link = this.generateInviteLink();
            navigator.clipboard?.writeText(link).then(() => {
                this.showToast('초대 링크가 클립보드에 복사되었습니다.');
            }).catch(() => {
                prompt('초대 링크 (복사해서 공유하세요):', link);
            });
        });

        // Settings panel
        document.getElementById('btn-settings').addEventListener('click', () => {
            document.getElementById('settings-panel').classList.toggle('open');
        });
        document.getElementById('btn-settings-close').addEventListener('click', () => {
            document.getElementById('settings-panel').classList.remove('open');
        });
        document.getElementById('btn-settings-close2').addEventListener('click', () => {
            document.getElementById('settings-panel').classList.remove('open');
        });

        // Theme buttons
        document.querySelectorAll('.theme-btn').forEach(btn => {
            btn.addEventListener('click', () => this.applyTheme(btn.dataset.theme));
        });

        // Opacity slider
        document.getElementById('opacity-slider')?.addEventListener('input', (e) => {
            this.applyOpacity(parseInt(e.target.value) / 100);
        });

        // PWA install button
        document.getElementById('btn-install-pwa')?.addEventListener('click', async () => {
            if (!_pwaInstallPrompt) return;
            _pwaInstallPrompt.prompt();
            const { outcome } = await _pwaInstallPrompt.userChoice;
            _pwaInstallPrompt = null;
            if (outcome === 'accepted') {
                document.getElementById('pwa-install-group').style.display = 'none';
                this.showToast('앱으로 설치되었습니다! 앱을 실행하면 주소창 없이 사용할 수 있습니다.');
            }
        });

        // Name change
        document.getElementById('btn-name-save').addEventListener('click', () => this.handleNameSave());
        document.getElementById('settings-name').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') this.handleNameSave();
        });

        // Mobile navigation
        document.querySelectorAll('.mobile-nav-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const view = btn.dataset.view;
                if ((view === 'chat' || view === 'members') && !this.currentRoomId) {
                    this.showToast('채팅방에 먼저 입장해주세요.');
                    return;
                }
                this.setMobileView(view);
            });
        });

        document.getElementById('chat-back-btn')?.addEventListener('click', () => {
            this.setMobileView('rooms');
        });

        document.getElementById('btn-toggle-members')?.addEventListener('click', () => {
            document.getElementById('users-panel').classList.toggle('visible');
        });

        // Theme cycle shortcut: Ctrl+Alt+T
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.altKey && e.key === 't') {
                e.preventDefault();
                const themes = ['dark', 'light', 'midnight', 'vscode', 'terminal', 'excel'];
                const idx = themes.indexOf(this.theme);
                this.applyTheme(themes[(idx + 1) % themes.length]);
            }
        });

        // Disguise chrome: click certain items to open settings
        document.querySelectorAll('.disguise-settings-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.getElementById('settings-panel').classList.toggle('open');
            });
        });
        document.getElementById('btn-disguise-settings')?.addEventListener('click', () => {
            document.getElementById('settings-panel').classList.toggle('open');
        });
        document.getElementById('btn-term-users')?.addEventListener('click', () => {
            const panel = document.getElementById('users-panel');
            const isOpen = panel.classList.toggle('term-open');
            if (this.theme === 'terminal') {
                panel.style.display = isOpen ? 'flex' : 'none';
            }
        });

        // Invite user modal
        document.getElementById('btn-invite-user')?.addEventListener('click', () => this.openInviteUserModal());
        document.getElementById('btn-header-invite-user')?.addEventListener('click', () => this.openInviteUserModal());
        document.getElementById('btn-invite-modal-close')?.addEventListener('click', () => {
            document.getElementById('invite-user-modal').classList.remove('active');
        });
        document.getElementById('invite-user-modal')?.addEventListener('click', (e) => {
            if (e.target === e.currentTarget) document.getElementById('invite-user-modal').classList.remove('active');
        });
    }

    // ─────────────────── Modal Handlers ───────────────────

    handleSetupSubmit() {
        const input = document.getElementById('setup-name');
        const name = input.value.trim();
        if (!name) { this.showToast('닉네임을 입력해주세요.'); input.focus(); return; }
        if (name.length < 2) { this.showToast('닉네임은 2자 이상이어야 합니다.'); input.focus(); return; }

        this.nickname = name;
        localStorage.setItem('wc_nickname', name);
        this.hideSetupModal();

        const pendingRoom = sessionStorage.getItem('wc_pending_room');
        const pendingPw = sessionStorage.getItem('wc_pending_pw');
        sessionStorage.removeItem('wc_pending_room');
        sessionStorage.removeItem('wc_pending_pw');

        this.showLobby();
        if (pendingRoom) this.doJoinRoom(pendingRoom, pendingPw || null);
    }

    openCreateModal() {
        if (!this.nickname) { this.showSetupModal(); return; }
        document.getElementById('create-room-name').value = '';
        document.getElementById('create-room-topic').value = '';
        document.getElementById('create-password').value = '';
        document.getElementById('create-capacity').value = MAX_PLAYERS_DEFAULT;
        document.getElementById('capacity-display').textContent = MAX_PLAYERS_DEFAULT + '명';
        document.querySelectorAll('.room-type-btn').forEach(b => b.classList.remove('active'));
        document.querySelector('.room-type-btn[data-type="public"]').classList.add('active');
        document.getElementById('password-group').style.display = 'none';
        document.getElementById('create-room-modal').classList.add('active');
        setTimeout(() => document.getElementById('create-room-name').focus(), 100);
    }

    closeCreateModal() {
        document.getElementById('create-room-modal').classList.remove('active');
    }

    handleCreateRoom() {
        const name = document.getElementById('create-room-name').value.trim();
        if (!name) { this.showToast('방 이름을 입력해주세요.'); document.getElementById('create-room-name').focus(); return; }

        const topic = document.getElementById('create-room-topic').value.trim();
        const maxPlayers = parseInt(document.getElementById('create-capacity').value) || MAX_PLAYERS_DEFAULT;

        const isPrivate = document.querySelector('.room-type-btn.active')?.dataset.type === 'private';
        let password = null;
        if (isPrivate) {
            password = document.getElementById('create-password').value.trim();
            if (!password || !/^\d{4}$/.test(password)) {
                this.showToast('비밀번호는 숫자 4자리로 입력해주세요.');
                document.getElementById('create-password').focus();
                return;
            }
        }

        this.closeCreateModal();
        this.createRoom(name, topic, password, maxPlayers);
    }

    closePasswordModal() {
        document.getElementById('password-modal').classList.remove('active');
        this.pendingJoinRoom = null;
    }

    handlePasswordJoin() {
        const pw = document.getElementById('join-password').value.trim();
        if (!pw || !/^\d{4}$/.test(pw)) { this.showToast('숫자 4자리를 입력해주세요.'); return; }
        if (!this.pendingJoinRoom) return;

        const room = this.pendingJoinRoom;
        this.closePasswordModal();
        this.doJoinRoom(room.roomId, pw);
    }

    handleNameSave() {
        const newName = document.getElementById('settings-name').value.trim();
        if (!newName) { this.showToast('닉네임을 입력해주세요.'); return; }
        if (newName.length < 2) { this.showToast('닉네임은 2자 이상이어야 합니다.'); return; }

        this.nickname = newName;
        localStorage.setItem('wc_nickname', newName);
        document.getElementById('my-name-display').textContent = newName;
        this.updateAvatar(newName);
        this.showToast('닉네임이 변경되었습니다. 다음 입장부터 적용됩니다.');
    }

    // ─────────────────── Utilities ───────────────────

    escapeHtml(str) {
        const d = document.createElement('div');
        d.textContent = String(str || '');
        return d.innerHTML;
    }

    showToast(msg) {
        const toast = document.getElementById('toast');
        toast.textContent = msg;
        toast.classList.add('show');
        clearTimeout(this._toastTimer);
        this._toastTimer = setTimeout(() => toast.classList.remove('show'), 3000);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.app = new WorkChat();
});

// ============================================================================
// 【글로벌 에러 핸들러】 프론트엔드 에러를 D1에 기록
// ============================================================================

(function() {
    var ERROR_ENDPOINT = 'https://chatbot-api.yama5993.workers.dev/error-logs';
    var APP_ID = 'workchat';
    var _lastError = '';
    var _errorCount = 0;
    var _session = Math.random().toString(36).substring(2, 8);

    function _getContext() {
        try {
            var parts = ['sess:' + _session];
            var p = window.location.pathname;
            parts.push('path:' + p);
            parts.push('online:' + navigator.onLine);
            if (window.__game) {
                var g = window.__game;
                if (g.stateManager) {
                    if (g.stateManager.currentDay) parts.push('day:' + g.stateManager.currentDay);
                    if (g.stateManager.currentScene) parts.push('scene:' + g.stateManager.currentScene);
                }
            }
            parts.push('vw:' + window.innerWidth + 'x' + window.innerHeight);
            return parts.join(' | ');
        } catch (_) { return 'ctx-error'; }
    }

    function _isNoise(msg, stack, src) {
        if (!msg) return true;
        if (msg === 'Script error.' && !stack) return true;
        if (/Can't find variable: (gmo|__gCrWeb|ytcfg|__)/.test(msg)) return true;
        if (/ResizeObserver loop|Loading chunk|dynamically imported module/.test(msg)) return true;
        // External scripts (GA, Cloudflare, browser extensions)
        if (src && /googletagmanager|google-analytics|gtag\/js|cloudflare|chrome-extension|moz-extension|safari-extension/.test(src)) return true;
        // Unknown source with no relevant stack trace
        if (src && /^undefined:/.test(src) && !(stack || '').match(/\/(assets|js|modules)\//)) return true;
        return false;
    }

    function _sendError(type, msg, stack, src) {
        if (_isNoise(msg, stack, src)) return;
        var key = msg + '|' + src;
        if (key === _lastError) { _errorCount++; if (_errorCount > 5) return; }
        else { _lastError = key; _errorCount = 1; }

        var ctx = _getContext();
        var payload = {
            appId: APP_ID, userId: '',
            message: ('[' + type + '] ' + (msg || '')).substring(0, 500),
            stack: (
                '[ctx] ' + ctx +
                '\n[src] ' + (src || 'N/A') +
                '\n[ua] ' + navigator.userAgent.substring(0, 150) +
                '\n[ref] ' + (document.referrer || 'direct') +
                '\n[time] ' + new Date().toISOString() +
                '\n[trace]\n' + (stack || 'no stack')
            ).substring(0, 2000),
            url: (src || window.location.href).substring(0, 500)
        };

        try { navigator.sendBeacon(ERROR_ENDPOINT, JSON.stringify(payload)); } catch (_) {}
    }

    window.addEventListener('error', function(e) {
        var src = (e.filename || '') + ':' + e.lineno + ':' + e.colno;
        _sendError(e.error?.name || 'Error', e.message, e.error?.stack || '', src);
    });

    window.addEventListener('unhandledrejection', function(e) {
        var reason = e.reason;
        var msg = reason?.message || String(reason || 'Unhandled rejection');
        var stack = reason?.stack || '';
        _sendError('UnhandledRejection', msg, stack, window.location.href);
    });
})();
