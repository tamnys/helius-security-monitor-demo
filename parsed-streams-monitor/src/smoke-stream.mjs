import { pathToFileURL } from 'node:url';
import { required, UserError, safeMessage } from './config.mjs';
import { credentialedUrl } from './url.mjs';

const JUPITER = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4';

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function open(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.addEventListener('open', () => resolve(socket), { once: true });
    socket.addEventListener(
      'error',
      () => reject(new Error('WebSocket connection failed')),
      { once: true },
    );
  });
}

export async function describe(apiKey) {
  // Discovery currently has a separate endpoint from subscriptions (Helius protocol reference).
  const socket = await open(
    credentialedUrl('wss://fs-beta.helius-rpc.com/', apiKey),
  );
  try {
    const response = await new Promise((resolve, reject) => {
      socket.addEventListener('message', (event) => {
        try {
          const value = JSON.parse(String(event.data));
          if (value.id === 1)
            value.error
              ? reject(new Error('describeProgram failed'))
              : resolve(value.result);
        } catch {
          reject(new Error('describeProgram returned invalid JSON'));
        }
      });
      socket.send(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'describeProgram',
          params: [{ program: JUPITER }],
        }),
      );
    });
    if (response.id !== JUPITER || !response.instructions.includes('route')) {
      throw new UserError(
        'describeProgram did not return the expected Jupiter program',
      );
    }
    return response;
  } finally {
    socket.close();
  }
}

export async function firstNotification(apiKey, timeoutMs) {
  const socket = await open(
    credentialedUrl('wss://beta.helius-rpc.com/', apiKey),
  );
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error('Timed out waiting for a Parsed Streams notification'));
    }, timeoutMs);
    timer.unref?.();
    socket.addEventListener('message', (event) => {
      let message;
      try {
        message = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (message.error) {
        clearTimeout(timer);
        socket.close();
        reject(new Error('Parsed Streams subscription failed'));
        return;
      }
      if (message.id === 1 && Number.isInteger(message.result)) {
        console.log(
          JSON.stringify({
            event: 'parsed-streams-subscribed',
            subscription: message.result,
          }),
        );
        return;
      }
      if (message.method !== 'parsedTransactionNotification') return;
      clearTimeout(timer);
      socket.close();
      const value = message.params?.result?.value;
      resolve({
        signature: value?.transaction?.signature,
        slot: value?.transaction?.slot,
      });
    });
    socket.send(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'parsedTransactionSubscribe',
        params: [
          {
            programs: [JUPITER],
            instructionNames: ['route'],
            includeFailed: false,
            includeCpi: true,
          },
          { commitment: 'confirmed', details: 'matched' },
        ],
      }),
    );
  });
}

async function main() {
  const apiKey = required('HELIUS_API_KEY');
  const timeoutMs = Number(process.env.SMOKE_TIMEOUT_MS ?? 60_000);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0)
    throw new UserError('SMOKE_TIMEOUT_MS must be positive');
  const program = await describe(apiKey);
  await wait(1_000);
  const notification = await firstNotification(apiKey, timeoutMs);
  console.log(
    JSON.stringify({
      event: 'parsed-streams-smoke-passed',
      program: program.name,
      instructions: program.instructions.slice(0, 10),
      ...notification,
    }),
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(safeMessage(error));
    process.exitCode = 1;
  });
}
