// WorkChat Network Client
// Based on archerlab-games relay server (wss://relay.archerlab.dev)
class NetworkClient {
    constructor(gameId) {
        this.gameId = gameId || 'workchat';
        this.ws = null;
        this.connected = false;
        this.roomId = null;
        this.playerId = null;
        this.isHost = false;
        this.handlers = {};
        this.pingInterval = null;
        this.myPing = 0;
        this.playerPings = {};
    }

    on(event, handler) {
        if (!this.handlers[event]) this.handlers[event] = [];
        this.handlers[event].push(handler);
        return this;
    }

    off(event, handler) {
        if (!this.handlers[event]) return;
        this.handlers[event] = this.handlers[event].filter(h => h !== handler);
    }

    emit(event, data) {
        const handlers = this.handlers[event] || [];
        for (const h of handlers) {
            try { h(data); } catch (e) { console.warn('Handler error:', e); }
        }
    }

    async fetchRooms(baseUrl) {
        const httpUrl = baseUrl.replace('wss://', 'https://').replace('ws://', 'http://');
        const res = await fetch(`${httpUrl}/api/rooms?game=${encodeURIComponent(this.gameId)}`);
        if (!res.ok) throw new Error('Failed to fetch rooms');
        return await res.json();
    }

    createRoom(baseUrl, playerName, password) {
        let url = `${baseUrl}/ws?game=${encodeURIComponent(this.gameId)}&action=create&name=${encodeURIComponent(playerName)}`;
        if (password) url += `&password=${encodeURIComponent(password)}`;
        return this._connect(url);
    }

    joinRoom(baseUrl, roomId, playerName, password) {
        let url = `${baseUrl}/ws?game=${encodeURIComponent(this.gameId)}&action=join&room=${encodeURIComponent(roomId)}&name=${encodeURIComponent(playerName)}`;
        if (password) url += `&password=${encodeURIComponent(password)}`;
        return this._connect(url);
    }

    _connect(wsUrl) {
        return new Promise((resolve, reject) => {
            try {
                this.ws = new WebSocket(wsUrl);
            } catch (e) {
                reject(e);
                return;
            }

            const timeout = setTimeout(() => {
                reject(new Error('Connection timeout'));
                this.ws?.close();
            }, 8000);

            this.ws.onopen = () => {
                this.connected = true;
                this.emit('connected');
                this.startPingLoop();
            };

            this.ws.onmessage = (event) => {
                try {
                    const msg = JSON.parse(event.data);
                    this.handleMessage(msg);
                    if (msg.type === 'roomCreated' || msg.type === 'joined') {
                        clearTimeout(timeout);
                        resolve(msg);
                    } else if (msg.type === 'error') {
                        clearTimeout(timeout);
                        reject(new Error(msg.message || 'Server error'));
                    }
                } catch (e) {
                    console.warn('Invalid message:', e);
                }
            };

            this.ws.onclose = (e) => {
                clearTimeout(timeout);
                this.connected = false;
                this.stopPingLoop();
                this.emit('disconnected', { code: e.code, reason: e.reason });
            };

            this.ws.onerror = (e) => {
                clearTimeout(timeout);
                this.emit('error', e);
                reject(e);
            };
        });
    }

    send(data) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(data));
        }
    }

    handleMessage(msg) {
        switch (msg.type) {
            case 'roomCreated':
                this.roomId = msg.roomId;
                this.playerId = msg.playerId;
                this.isHost = true;
                this.emit('roomCreated', msg);
                break;
            case 'joined':
                this.roomId = msg.roomId;
                this.playerId = msg.playerId;
                this.isHost = false;
                this.emit('joined', msg);
                break;
            case 'pong':
                if (msg.t) {
                    this.myPing = Date.now() - msg.t;
                    this.send({ type: 'reportPing', ping: this.myPing });
                }
                break;
            case 'pingUpdate':
                if (msg.pings) {
                    this.playerPings = msg.pings;
                    this.emit('pingUpdate', msg.pings);
                }
                break;
            default:
                this.emit(msg.type, msg);
                break;
        }
    }

    startPingLoop() {
        this.stopPingLoop();
        this.pingInterval = setInterval(() => {
            if (this.connected) this.send({ type: 'ping', t: Date.now() });
        }, 3000);
    }

    stopPingLoop() {
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
            this.pingInterval = null;
        }
    }

    sendChat(message) {
        this.send({ type: 'chat', message: String(message).slice(0, 500) });
    }

    kick(targetId) {
        this.send({ type: 'kick', targetId });
    }

    // 방장 권한 넘기기 (클라이언트 브로드캐스트 방식)
    // 서버는 메시지를 모든 클라이언트에 broadcast하고, 원래 방장은 퇴장
    transferHost(targetId) {
        this.send({ type: 'hostTransfer', targetId });
    }

    setMetadata(metadata) {
        this.send({ type: 'setMetadata', metadata });
    }

    leaveRoom() {
        this.send({ type: 'leaveRoom' });
        this.roomId = null;
        this.playerId = null;
        this.isHost = false;
    }

    disconnect() {
        this.stopPingLoop();
        this.roomId = null;
        this.playerId = null;
        this.isHost = false;
        this.myPing = 0;
        this.playerPings = {};
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        this.connected = false;
    }
}
