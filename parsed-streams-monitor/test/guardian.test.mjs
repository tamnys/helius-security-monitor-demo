import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { WebSocketServer } from 'ws';
import bs58 from 'bs58';
import { Connection, Keypair, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import {
  addAdminIx, collateralAddress, connection, customError, DEVNET_GENESIS, ERRORS, freezeIx, LEN,
  MAINNET_GENESIS, readCollateral, send, waitFrozen, withdrawIx,
} from '../src/client.mjs';
import { eventFromParsedEvent, eventFromRpcTransaction, eventFromStreamNotification } from '../src/decoder.mjs';
import { GuardianMonitor } from '../src/monitor.mjs';
import { ParsedEventsRecovery, RpcRecovery } from '../src/recovery.mjs';
import { Store } from '../src/store.mjs';
import { collateralStreamFilter, ParsedStreamsClient } from '../src/stream.mjs';
import { credentialedUrl, publicUrl } from '../src/url.mjs';

const signature = () => bs58.encode(randomBytes(64));

function fixture() {
  const program = Keypair.generate().publicKey;
  const customer = Keypair.generate();
  const guardian = Keypair.generate();
  const attacker = Keypair.generate();
  const seed = randomBytes(32);
  const collateral = collateralAddress(program, customer.publicKey, seed);
  const bump = PublicKey.findProgramAddressSync([Buffer.from('collateral'), customer.publicKey.toBuffer(), seed], program)[1];
  const data = Buffer.alloc(LEN);
  data[0] = 1; data[2] = bump; data[3] = 1;
  seed.copy(data, 4); guardian.publicKey.toBuffer().copy(data, 36); customer.publicKey.toBuffer().copy(data, 68);
  const add = addAdminIx(program, collateral, attacker.publicKey);
  const notification = {
    jsonrpc: '2.0', method: 'parsedTransactionNotification',
    params: { subscription: 7, result: { context: { slot: 120 }, value: {
      transaction: { signature: signature(), slot: 120, status: 'ok', error: null },
      instructions: [{
        instructionIndex: 2, innerInstructionIndex: null, programId: program.toBase58(),
        rawAccounts: [collateral.toBase58(), attacker.publicKey.toBase58()], rawData: bs58.encode(add.data),
      }],
      matchedIndexes: [0],
    } } },
  };
  const rpc = {
    frozen: false, submissions: 0, uncertain: false,
    async getAccountInfo() { data[1] = Number(this.frozen); return { owner: program, data, lamports: 20_000_000 }; },
    async getLatestBlockhash() { return { blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 10 }; },
    async sendRawTransaction(bytes) {
      const tx = Transaction.from(bytes);
      assert.ok(tx.verifySignatures());
      const pause = tx.instructions.find(instruction => instruction.programId.equals(program));
      assert.deepEqual([...pause.data], [3]);
      assert.ok(pause.keys[0].pubkey.equals(collateral));
      assert.ok(pause.keys[1].pubkey.equals(guardian.publicKey));
      this.submissions++; this.frozen = true;
      if (this.uncertain) throw new Error('disconnect after landing');
      return bs58.encode(tx.signature);
    },
    async confirmTransaction() { return { context: { slot: 121 }, value: { err: null } }; },
  };
  return { program, customer, guardian, attacker, seed, collateral, data, add, notification, rpc };
}

test('custom instruction decoding rejects wrong programs, accounts, failed transactions, and invalid admin data', () => {
  const f = fixture();
  const event = eventFromStreamNotification(f.notification, f.program, f.collateral);
  assert.equal(event.signature, f.notification.params.result.value.transaction.signature);
  assert.equal(event.slot, 120);
  assert.equal(event.newAdmin, f.attacker.publicKey.toBase58());
  assert.equal(eventFromStreamNotification(f.notification, Keypair.generate().publicKey, f.collateral), null);

  const failed = structuredClone(f.notification);
  failed.params.result.value.transaction.status = 'error';
  assert.equal(eventFromStreamNotification(failed, f.program, f.collateral), null);
  const wrong = structuredClone(f.notification);
  wrong.params.result.value.instructions[0].rawAccounts[1] = Keypair.generate().publicKey.toBase58();
  assert.equal(eventFromStreamNotification(wrong, f.program, f.collateral), null);

  const inner = structuredClone(f.notification);
  inner.params.result.value.instructions[0].innerInstructionIndex = 3;
  assert.equal(eventFromStreamNotification(inner, f.program, f.collateral).innerInstructionIndex, 3);
});

test('RPC and Parsed Events recovery normalize the same custom admin insertion', () => {
  const f = fixture();
  const raw = {
    slot: 120,
    meta: { err: null, innerInstructions: [] },
    transaction: { message: {
      accountKeys: [{ pubkey: f.customer.publicKey }, { pubkey: f.collateral }, { pubkey: f.attacker.publicKey }],
      instructions: [{ programIdIndex: 0, accounts: [0, 1], data: '' },
        { programIdIndex: 0, accounts: [1, 2], data: bs58.encode(f.add.data) }],
    } },
  };
  raw.transaction.message.accountKeys[0] = { pubkey: f.program };
  const sig = signature();
  assert.equal(eventFromRpcTransaction(raw, sig, f.program, f.collateral).newAdmin, f.attacker.publicKey.toBase58());
  const parsedRpc = {
    slot: 120,
    meta: { err: null, innerInstructions: [] },
    transaction: { message: { accountKeys: [], instructions: [{
      programId: f.program.toBase58(),
      accounts: [f.collateral.toBase58(), f.attacker.publicKey.toBase58()],
      data: bs58.encode(f.add.data), stackHeight: 1,
    }] } },
  };
  assert.equal(eventFromRpcTransaction(parsedRpc, sig, f.program, f.collateral).newAdmin, f.attacker.publicKey.toBase58());
  const parsed = {
    signature: sig, parserStatus: 'OK',
    parsed: { slot: 120, transactionStatus: 'OK', instructions: [{
      programId: f.program.toBase58(), rawAccounts: [f.collateral.toBase58(), f.attacker.publicKey.toBase58()],
      rawData: bs58.encode(f.add.data), instructionIndex: 1, innerInstructionIndex: null,
    }] },
  };
  assert.equal(eventFromParsedEvent(parsed, f.program, f.collateral).newAdmin, f.attacker.publicKey.toBase58());
});

test('account decoding exposes fixed guardian, admins, funds, and frozen state', async () => {
  const f = fixture();
  const state = await readCollateral(f.rpc, f.program, f.collateral);
  assert.equal(state.frozen, false);
  assert.ok(state.guardian.equals(f.guardian.publicKey));
  assert.deepEqual(state.admins.map(admin => admin.toBase58()), [f.customer.publicKey.toBase58()]);
  assert.equal(state.lamports, 20_000_000);
});

test('approved admin changes do not freeze and unauthorized changes alert then freeze once', async () => {
  const f = fixture(), store = new Store(':memory:');
  const approved = structuredClone(f.notification);
  approved.params.result.value.transaction.signature = signature();
  const approvedEvent = eventFromStreamNotification(approved, f.program, f.collateral);
  store.approve(approvedEvent.signature); store.enqueue([approvedEvent]);
  const monitor = new GuardianMonitor({ rpc: f.rpc, program: f.program, collateral: f.collateral, guardian: f.guardian, store, log: () => {} });
  await monitor.tick();
  assert.equal(store.jobs()[0].outcome, 'approved');
  assert.equal(f.rpc.submissions, 0);

  const event = eventFromStreamNotification(f.notification, f.program, f.collateral);
  await monitor.accept(event);
  await monitor.accept(event);
  assert.equal(store.jobs().length, 2);
  assert.equal(store.jobs()[1].outcome, 'frozen');
  assert.equal(store.alerts().length, 1);
  assert.equal(store.alerts()[0].status, 'frozen');
  assert.equal(f.rpc.submissions, 1);
  store.close();
});

test('confirmation API transaction errors are returned for precise custom-error checks', async () => {
  const f = fixture();
  f.rpc.sendRawTransaction = async () => signature();
  f.rpc.confirmTransaction = async () => { throw { InstructionError: [0, { Custom: 0 }] }; };
  const result = await send(f.rpc, f.attacker, [withdrawIx(f.program, f.collateral, f.attacker.publicKey, 1_000)]);
  assert.equal(result.err.InstructionError[1].Custom, 0);
  assert.equal(customError(result, ERRORS.Frozen), true);
});

test('uncertain freeze results reconcile from authoritative account state after restart', async () => {
  const f = fixture(), store = new Store(':memory:');
  f.rpc.uncertain = true;
  const event = eventFromStreamNotification(f.notification, f.program, f.collateral);
  await new GuardianMonitor({ rpc: f.rpc, program: f.program, collateral: f.collateral, guardian: f.guardian, store, log: () => {} }).accept(event);
  assert.equal(store.pending().length, 1);
  await new GuardianMonitor({ rpc: f.rpc, program: f.program, collateral: f.collateral, guardian: f.guardian, store, log: () => {} }).tick();
  assert.equal(store.jobs()[0].outcome, 'already-frozen');
  assert.equal(f.rpc.submissions, 1);
  store.close();
});

test('events arriving during an active freeze are processed in the serial worker queue', async () => {
  const f = fixture(), store = new Store(':memory:');
  const first = eventFromStreamNotification(f.notification, f.program, f.collateral);
  const secondMessage = structuredClone(f.notification);
  secondMessage.params.result.value.transaction.signature = signature();
  secondMessage.params.result.value.instructions[0].rawAccounts[1] = Keypair.generate().publicKey.toBase58();
  secondMessage.params.result.value.instructions[0].rawData = bs58.encode(addAdminIx(
    f.program, f.collateral, new PublicKey(secondMessage.params.result.value.instructions[0].rawAccounts[1]),
  ).data);
  const second = eventFromStreamNotification(secondMessage, f.program, f.collateral);
  const originalSend = f.rpc.sendRawTransaction.bind(f.rpc);
  f.rpc.sendRawTransaction = async bytes => {
    await new Promise(resolve => setTimeout(resolve, 20));
    return originalSend(bytes);
  };
  const monitor = new GuardianMonitor({ rpc: f.rpc, program: f.program, collateral: f.collateral, guardian: f.guardian, store, log: () => {} });
  await Promise.all([monitor.accept(first), monitor.accept(second)]);
  assert.equal(store.pending().length, 0);
  assert.deepEqual(store.jobs().map(job => job.outcome), ['frozen', 'already-frozen']);
  assert.equal(f.rpc.submissions, 1);
  store.close();
});

test('devnet RPC recovery paginates signatures and returns normalized events', async () => {
  const f = fixture();
  const newer = signature(), older = signature();
  const parsed = {
    slot: 120, meta: { err: null, innerInstructions: [] },
    transaction: { message: {
      accountKeys: [{ pubkey: f.program }, { pubkey: f.collateral }, { pubkey: f.attacker.publicKey }],
      instructions: [{ programIdIndex: 0, accounts: [1, 2], data: bs58.encode(f.add.data) }],
    } },
  };
  const rpc = {
    calls: 0,
    async getSignaturesForAddress() { this.calls++; return this.calls === 1 ? [{ signature: newer, slot: 120 }] : [{ signature: older, slot: 99 }]; },
    async getParsedTransaction(sig) { assert.equal(sig, newer); return parsed; },
  };
  const recovery = new RpcRecovery({ rpc, program: f.program, collateral: f.collateral });
  const events = await recovery.eventsBetween(101, 130);
  assert.equal(events.length, 1);
  assert.equal(events[0].signature, newer);
});

test('Parsed Events recovery follows pagination and preserves the slot window', async () => {
  const f = fixture();
  const body = [];
  const endpoint = 'https://mainnet.example/v1/parsed-events/transaction-history';
  const fetchImpl = async (url, options) => {
    body.push(JSON.parse(options.body));
    assert.equal(new URL(url).searchParams.get('api-key'), 'test-key');
    const token = body.length === 1 ? 'next' : undefined;
    const parsed = {
      signature: signature(), parserStatus: 'OK',
      parsed: { slot: 120, transactionStatus: 'OK', instructions: [{
        programId: f.program.toBase58(), rawAccounts: [f.collateral.toBase58(), f.attacker.publicKey.toBase58()],
        rawData: bs58.encode(f.add.data), instructionIndex: 1, innerInstructionIndex: null,
      }] },
    };
    return { ok: true, json: async () => ({ data: body.length === 1 ? [parsed] : [], ...(token ? { paginationToken: token } : {}) }) };
  };
  const recovery = new ParsedEventsRecovery({ rpc: {}, program: f.program, collateral: f.collateral, endpoint, apiKey: 'test-key', fetchImpl });
  const events = await recovery.eventsBetween(101, 130);
  assert.equal(events.length, 1);
  assert.equal(body.length, 2);
  assert.deepEqual(body[0].slot, { gte: 101, lte: 130 });
  assert.equal(body[1].paginationToken, 'next');
});

test('stream client subscribes before reconciliation, buffers events, and reconnects after disconnect', async () => {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise(resolve => server.once('listening', resolve));
  const url = `ws://127.0.0.1:${server.address().port}`;
  let connections = 0, subscriptions = 0;
  server.on('connection', socket => {
    connections++;
    socket.on('message', data => {
      const message = JSON.parse(data.toString());
      if (message.method !== 'parsedTransactionSubscribe') return;
      subscriptions++;
      socket.send(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: subscriptions }));
      socket.send(JSON.stringify({ jsonrpc: '2.0', method: 'parsedTransactionNotification', params: { marker: connections } }));
      if (connections === 1) setTimeout(() => socket.close(), 70);
    });
  });
  const order = [], received = [];
  const client = new ParsedStreamsClient({
    url, filter: { programs: [Keypair.generate().publicKey.toBase58()] },
    reconcile: async () => { order.push('reconcile-start'); await new Promise(resolve => setTimeout(resolve, 30)); order.push('reconcile-end'); },
    mapNotification: message => ({ marker: message.params.marker }),
    onEvent: async event => { order.push('event-' + event.marker); received.push(event.marker); },
    reconnectBaseMs: 10, reconnectMaxMs: 20, idleMs: 10_000, log: () => {},
  });
  client.start();
  const deadline = Date.now() + 2_000;
  while (received.length < 2 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
  client.stop();
  await new Promise(resolve => server.close(resolve));
  assert.deepEqual(order.slice(0, 3), ['reconcile-start', 'reconcile-end', 'event-1']);
  assert.deepEqual(received, [1, 2]);
  assert.equal(connections, 2);
});

test('stream subscription uses the expected custom-program filter and API-key URLs stay private in summaries', () => {
  const f = fixture();
  assert.deepEqual(collateralStreamFilter(f.program, f.collateral), {
    programs: [f.program.toBase58()], accounts: { include: [f.collateral.toBase58()] },
    includeFailed: false, includeCpi: true,
  });
  const url = credentialedUrl('wss://beta.helius-rpc.com/', 'secret');
  assert.equal(new URL(url).searchParams.get('api-key'), 'secret');
  assert.equal(publicUrl(url), 'wss://beta.helius-rpc.com/');
});

test('connection failures keep retrying instead of allowing the monitor process to become idle', async () => {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise(resolve => server.once('listening', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  const logs = [];
  const client = new ParsedStreamsClient({
    url: `ws://127.0.0.1:${port}`,
    filter: { programs: [Keypair.generate().publicKey.toBase58()] },
    reconcile: async () => {},
    mapNotification: () => null,
    onEvent: async () => {},
    reconnectBaseMs: 5,
    reconnectMaxMs: 10,
    log: value => logs.push(JSON.parse(value)),
  });
  client.start();
  await new Promise(resolve => setTimeout(resolve, 80));
  client.stop();
  assert.ok(logs.filter(entry => entry.event === 'stream-reconnecting').length >= 2);
});

test('idle watchdog replaces a quiet WebSocket and resubscribes', async () => {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise(resolve => server.once('listening', resolve));
  let connections = 0;
  server.on('connection', socket => {
    connections++;
    socket.on('message', data => {
      const message = JSON.parse(data.toString());
      socket.send(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: connections }));
    });
  });
  const logs = [];
  const client = new ParsedStreamsClient({
    url: `ws://127.0.0.1:${server.address().port}`,
    filter: { programs: [Keypair.generate().publicKey.toBase58()] },
    reconcile: async () => {},
    mapNotification: () => null,
    onEvent: async () => {},
    reconnectBaseMs: 5,
    reconnectMaxMs: 5,
    idleMs: 20,
    log: value => logs.push(JSON.parse(value)),
  });
  client.start();
  const deadline = Date.now() + 1_000;
  while (connections < 2 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
  client.stop();
  await new Promise(resolve => server.close(resolve));
  assert.ok(connections >= 2);
  assert.ok(logs.some(entry => entry.event === 'stream-idle-timeout'));
});

test('network guard accepts devnet and rejects mainnet unless explicitly allowed', async t => {
  const savedUrl = process.env.RPC_URL, savedLocal = process.env.ALLOW_LOCALNET;
  let genesis = DEVNET_GENESIS;
  t.mock.method(Connection.prototype, 'getGenesisHash', async () => genesis);
  try {
    process.env.RPC_URL = 'https://api.devnet.solana.com';
    await connection();
    genesis = MAINNET_GENESIS;
    await assert.rejects(connection(), /mainnet is explicitly enabled/);
    assert.equal((await connection({ allowMainnet: true })).network, 'mainnet');
  } finally {
    if (savedUrl === undefined) delete process.env.RPC_URL; else process.env.RPC_URL = savedUrl;
    if (savedLocal === undefined) delete process.env.ALLOW_LOCALNET; else process.env.ALLOW_LOCALNET = savedLocal;
  }
});

test('waiting observes freeze state and responds to slot notifications', async () => {
  const f = fixture();
  let notify, removed = false;
  f.rpc.onSlotChange = callback => { notify = callback; return 9; };
  f.rpc.removeSlotChangeListener = async id => { assert.equal(id, 9); removed = true; };
  f.rpc.frozen = true;
  await waitFrozen(f.rpc, f.program, f.collateral);
  assert.equal(removed, true);
  f.rpc.frozen = false;
  const waiting = waitFrozen(f.rpc, f.program, f.collateral);
  await new Promise(resolve => setImmediate(resolve));
  f.rpc.frozen = true; notify();
  await waiting;
});
