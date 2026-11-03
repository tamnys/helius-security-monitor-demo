import test from 'node:test';
import assert from 'node:assert/strict';
import { describe, firstNotification } from '../src/smoke-stream.mjs';

test('smoke discovers Jupiter before subscribing on the documented separate endpoints', async (t) => {
  const urls = [];
  const requests = [];
  const jupiter = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4';
  class Socket extends EventTarget {
    constructor(url) {
      super();
      urls.push(url);
      setImmediate(() => this.dispatchEvent(new Event('open')));
    }
    send(raw) {
      const request = JSON.parse(raw);
      requests.push(request);
      setImmediate(() => {
        const result =
          request.method === 'describeProgram'
            ? { id: jupiter, name: 'jupiter', instructions: ['route'] }
            : 42;
        this.dispatchEvent(
          new MessageEvent('message', {
            data: JSON.stringify({ id: 1, result }),
          }),
        );
        if (request.method === 'parsedTransactionSubscribe')
          this.dispatchEvent(
            new MessageEvent('message', {
              data: JSON.stringify({
                method: 'parsedTransactionNotification',
                params: {
                  result: {
                    value: {
                      transaction: { signature: 'public-signature', slot: 123 },
                    },
                  },
                },
              }),
            }),
          );
      });
    }
    close() {}
  }
  const originalWebSocket = globalThis.WebSocket;
  globalThis.WebSocket = Socket;
  t.after(() => {
    globalThis.WebSocket = originalWebSocket;
  });
  assert.equal((await describe('test-key')).id, jupiter);
  assert.deepEqual(await firstNotification('test-key', 60_000), {
    signature: 'public-signature',
    slot: 123,
  });
  assert.equal(new URL(urls[0]).hostname, 'fs-beta.helius-rpc.com');
  assert.equal(new URL(urls[1]).hostname, 'beta.helius-rpc.com');
  assert.deepEqual(
    requests.map((request) => request.method),
    ['describeProgram', 'parsedTransactionSubscribe'],
  );
});
