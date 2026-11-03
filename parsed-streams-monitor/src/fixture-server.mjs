import { WebSocketServer } from 'ws';
import { connection, ids, required } from './client.mjs';
import { eventFromRpcTransaction } from './decoder.mjs';

function notification(event, subscription) {
  const newAdmin = event.newAdmin;
  return {
    jsonrpc: '2.0',
    method: 'parsedTransactionNotification',
    params: {
      subscription,
      result: {
        context: { slot: event.slot },
        value: {
          transaction: {
            signature: event.signature, slot: event.slot, status: 'ok', error: null,
          },
          instructions: [{
            instructionIndex: event.instructionIndex,
            innerInstructionIndex: event.innerInstructionIndex,
            programId: event.programId,
            rawAccounts: [event.collateral, newAdmin],
            rawData: event.rawData,
          }],
          matchedIndexes: [0],
        },
      },
    },
  };
}

async function main() {
  const rpc = await connection();
  const { program, collateral } = ids();
  const port = Number(required('FIXTURE_PORT'));
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('FIXTURE_PORT must be a TCP port');
  const server = new WebSocketServer({ host: '127.0.0.1', port });
  let nextSubscription = 1;
  const clients = new Map();
  server.on('connection', socket => {
    socket.on('message', data => {
      try {
        const message = JSON.parse(data.toString());
        if (message.method !== 'parsedTransactionSubscribe') return;
        const subscription = nextSubscription++;
        clients.set(socket, subscription);
        socket.send(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: subscription }));
      } catch {
        socket.send(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid request' } }));
      }
    });
    socket.on('close', () => clients.delete(socket));
  });

  const subscription = rpc.onLogs(collateral, log => {
    void (async () => {
      const transaction = await rpc.getParsedTransaction(log.signature, {
        commitment: 'confirmed', maxSupportedTransactionVersion: 0,
      });
      if (!transaction) return;
      const event = eventFromRpcTransaction(transaction, log.signature, program, collateral);
      if (!event) return;
      console.log(JSON.stringify({ event: 'fixture-notification', signature: event.signature, slot: event.slot }));
      for (const [socket, id] of clients) {
        if (socket.readyState === 1) socket.send(JSON.stringify(notification(event, id)));
      }
    })().catch(() => {
      console.log(JSON.stringify({ event: 'fixture-transaction-pending', at: new Date().toISOString() }));
    });
  }, 'confirmed');

  console.log(JSON.stringify({
    event: 'fixture-listening', url: `ws://127.0.0.1:${port}`,
    collateral: collateral.toBase58(), program: program.toBase58(),
  }));

  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
    void rpc.removeLogsListener(subscription).finally(() => server.close(() => process.exit(0)));
  });
}

main().catch(() => {
  console.error('Fixture startup failed. Check the network and external configuration.');
  process.exitCode = 1;
});
