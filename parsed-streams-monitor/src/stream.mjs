export class ParsedStreamsClient {
  constructor({
    url,
    filter,
    options = { commitment: 'confirmed', details: 'full' },
    reconcile,
    mapNotification,
    onEvent,
    log = console.log,
    WebSocketImpl = globalThis.WebSocket,
    reconnectBaseMs = 1_000,
    reconnectMaxMs = 30_000,
    idleMs = 60_000,
    setTimeoutImpl = setTimeout,
    clearTimeoutImpl = clearTimeout,
  }) {
    Object.assign(this, {
      url, filter, options, reconcile, mapNotification, onEvent, log, WebSocketImpl,
      reconnectBaseMs, reconnectMaxMs, idleMs, setTimeoutImpl, clearTimeoutImpl,
    });
    this.reconnectMs = reconnectBaseMs;
    this.requestId = 1;
    this.generation = 0;
    this.stopped = false;
    this.ready = false;
    this.buffer = [];
  }

  start() {
    this.stopped = false;
    this.open();
  }

  open() {
    if (this.stopped) return;
    const generation = ++this.generation;
    const previous = this.socket;
    try { previous?.close(); } catch {}
    this.ready = false;
    this.buffer = [];
    const socket = new this.WebSocketImpl(this.url);
    this.socket = socket;
    socket.addEventListener('open', () => {
      if (generation !== this.generation) return;
      this.resetIdle();
      const id = this.requestId++;
      this.subscribeId = id;
      socket.send(JSON.stringify({
        jsonrpc: '2.0', id, method: 'parsedTransactionSubscribe',
        params: [this.filter, this.options],
      }));
    });
    socket.addEventListener('message', message => {
      if (generation === this.generation) void this.message(message.data, generation);
    });
    socket.addEventListener('error', () => {
      if (generation !== this.generation) return;
      this.clearTimers();
      this.ready = false;
      this.scheduleReconnect();
    });
    socket.addEventListener('close', () => {
      if (generation !== this.generation) return;
      this.clearTimers();
      this.ready = false;
      if (!this.stopped) this.scheduleReconnect();
    });
  }

  async message(data, generation) {
    this.resetIdle();
    let message;
    try { message = JSON.parse(String(data)); } catch { return; }
    if (message.id === this.subscribeId && !message.method) {
      if (message.error) {
        if (message.error.code === -32001 || message.error.code === -32002) {
          this.socket?.close();
          return;
        }
        this.log(JSON.stringify({ event: 'stream-subscription-error', code: message.error.code ?? null }));
        this.stop();
        return;
      }
      if (!Number.isInteger(message.result)) {
        this.stop();
        return;
      }
      this.subscription = message.result;
      this.log(JSON.stringify({ event: 'stream-subscribed', subscription: message.result }));
      await this.recover(generation);
      return;
    }
    if (message.method !== 'parsedTransactionNotification') return;
    if (!this.ready) { this.buffer.push(message); return; }
    await this.deliver(message);
  }

  async recover(generation) {
    try {
      await this.reconcile();
      if (generation !== this.generation) return;
      this.ready = true;
      this.reconnectMs = this.reconnectBaseMs;
      const buffered = this.buffer.splice(0);
      for (const message of buffered) await this.deliver(message);
      this.log(JSON.stringify({ event: 'stream-reconciled', at: new Date().toISOString() }));
    } catch {
      this.log(JSON.stringify({ event: 'stream-recovery-pending', at: new Date().toISOString() }));
      this.socket?.close();
    }
  }

  async deliver(message) {
    try {
      const event = this.mapNotification(message);
      if (event) await this.onEvent(event);
    } catch {
      this.log(JSON.stringify({ event: 'stream-notification-pending', at: new Date().toISOString() }));
    }
  }

  scheduleReconnect() {
    if (this.reconnectTimer) return;
    const delay = this.reconnectMs;
    this.reconnectMs = Math.min(this.reconnectMs * 2, this.reconnectMaxMs);
    this.log(JSON.stringify({ event: 'stream-reconnecting', delay_ms: delay, at: new Date().toISOString() }));
    this.reconnectTimer = this.setTimeoutImpl(() => {
      this.reconnectTimer = null;
      this.open();
    }, delay);
  }

  resetIdle() {
    if (this.idleTimer) this.clearTimeoutImpl(this.idleTimer);
    this.idleTimer = this.setTimeoutImpl(() => {
      this.log(JSON.stringify({ event: 'stream-idle-timeout', at: new Date().toISOString() }));
      this.socket?.close();
    }, this.idleMs);
  }

  clearTimers() {
    if (this.idleTimer) this.clearTimeoutImpl(this.idleTimer);
    this.idleTimer = null;
  }

  stop() {
    this.stopped = true;
    this.generation++;
    if (this.reconnectTimer) this.clearTimeoutImpl(this.reconnectTimer);
    this.reconnectTimer = null;
    this.clearTimers();
    this.socket?.close(1000);
  }
}

export function collateralStreamFilter(program, collateral) {
  return {
    programs: [program.toBase58()],
    accounts: { include: [collateral.toBase58()] },
    includeFailed: false,
    includeCpi: true,
  };
}
