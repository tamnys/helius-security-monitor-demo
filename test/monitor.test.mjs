import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import bs58 from 'bs58';
import { Connection, Keypair, PublicKey, Transaction, SystemProgram } from '@solana/web3.js';
import { Store } from '../src/store.mjs';
import { adminChange, Monitor, receiver, signaturesFromRaw } from '../src/monitor.mjs';
import { actionIx, connection, initializeIx, vaultAddress } from '../src/client.mjs';

const signature = () => bs58.encode(randomBytes(64));
function fixture() {
  const program = Keypair.generate().publicKey, admin = Keypair.generate(), guardian = Keypair.generate(), withdrawer = Keypair.generate();
  const seed = randomBytes(32), vault = vaultAddress(program, admin.publicKey, seed);
  const data = Buffer.alloc(131);
  data[0] = 1;
  data[2] = PublicKey.findProgramAddressSync([Buffer.from('vault'), admin.publicKey.toBuffer(), seed], program)[1];
  seed.copy(data, 3); admin.publicKey.toBuffer().copy(data, 35); withdrawer.publicKey.toBuffer().copy(data, 67); guardian.publicKey.toBuffer().copy(data, 99);
  const change = actionIx(program, vault, admin.publicKey, 1, Keypair.generate().publicKey.toBuffer());
  const tx = {
    meta: { err: null },
    transaction: { message: {
      accountKeys: [{ pubkey: admin.publicKey, signer: true }],
      instructions: [{ programId: SystemProgram.programId, accounts: [], data: '' },
        { programId: change.programId, accounts: change.keys.map(k => k.pubkey), data: bs58.encode(change.data) }],
    } },
  };
  const rpc = {
    transactions: new Map(), submissions: 0, uncertain: false,
    async getParsedTransaction(sig) { return this.transactions.get(sig) ?? null; },
    async getAccountInfo() { return { owner: program, data, lamports: 10000000 }; },
    async getLatestBlockhash() { return { blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 1 }; },
    async sendRawTransaction(bytes) {
      const sent = Transaction.from(bytes);
      assert.ok(sent.verifySignatures());
      assert.equal(sent.instructions.length, 1);
      assert.ok(sent.instructions[0].programId.equals(program));
      assert.ok(sent.instructions[0].keys[0].pubkey.equals(vault));
      assert.ok(sent.instructions[0].keys[1].pubkey.equals(guardian.publicKey));
      assert.deepEqual([...sent.instructions[0].data], [3]);
      this.submissions++; data[1] = 1;
      if (this.uncertain) throw new Error('Simulated RPC disconnect after landing');
      return bs58.encode(sent.signature);
    },
    async confirmTransaction() { return { context: { slot: 1 }, value: { err: null } }; },
  };
  return { program, admin, guardian, withdrawer, vault, seed, data, tx, rpc };
}
function monitor(f, store) { return new Monitor({ ...f, store, log: () => {} }); }

test('client initialize account layout matches program contract', () => {
  const f = fixture();
  const ix = initializeIx(f.program, f.admin.publicKey, f.withdrawer.publicKey, f.guardian.publicKey, f.seed);
  assert.equal(ix.data.length, 33);
  assert.ok(ix.keys[1].pubkey.equals(f.vault));
  assert.equal(ix.keys[0].isSigner, true);
  assert.equal(ix.keys[3].isSigner, true);
});

test('classification checks the program, vault, admin signer, success, and all instructions', () => {
  const f = fixture();
  assert.equal(adminChange(f.tx, f.program, f.vault, f.admin.publicKey), true);
  assert.equal(adminChange(f.tx, Keypair.generate().publicKey, f.vault, f.admin.publicKey), false);
  assert.equal(adminChange(f.tx, f.program, Keypair.generate().publicKey, f.admin.publicKey), false);
  f.tx.transaction.message.accountKeys[0].signer = false;
  assert.equal(adminChange(f.tx, f.program, f.vault, f.admin.publicKey), false);
  f.tx.transaction.message.accountKeys[0].signer = true;
  f.tx.meta.err = { InstructionError: [1, 'MissingRequiredSignature'] };
  assert.equal(adminChange(f.tx, f.program, f.vault, f.admin.publicKey), false);
  f.tx.meta.err = null;
  f.tx.transaction.message.instructions.pop();
  assert.equal(adminChange(f.tx, f.program, f.vault, f.admin.publicKey), false);
});

test('approvals prevent pausing; absent RPC data remains pending', async () => {
  const f = fixture(), store = new Store(':memory:');
  const sig = signature();
  store.approve(sig); store.enqueue([sig]);
  await monitor(f, store).tick();
  assert.equal(store.pending().length, 1);
  f.rpc.transactions.set(sig, f.tx);
  await monitor(f, store).tick();
  assert.equal(store.jobs()[0].outcome, 'approved');
  assert.equal(f.rpc.submissions, 0);
  store.close();
});

test('real HTTP ingress persists authenticated raw notifications and contains the change', async () => {
  const f = fixture(), store = new Store(':memory:'), sig = signature();
  f.rpc.transactions.set(sig, f.tx);
  const m = monitor(f, store);
  const server = receiver({ secret: 'test-secret', store, log: () => {} });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = 'http://127.0.0.1:' + server.address().port + '/webhook';
  const body = JSON.stringify([{ transaction: { signatures: [sig] } }]);
  try {
    assert.equal((await fetch(url, { method: 'POST', body })).status, 403);
    assert.equal(store.jobs().length, 0);
    assert.equal((await fetch(url, { method: 'POST', headers: { authorization: 'test-secret' }, body })).status, 200);
    assert.equal(store.pending().length, 1);
    await m.tick();
    assert.equal(f.data[1], 1);
    assert.equal(store.jobs()[0].outcome, 'paused');
    await fetch(url, { method: 'POST', headers: { authorization: 'test-secret' }, body });
    await m.tick();
    assert.equal(store.jobs().length, 1);
    assert.equal(f.rpc.submissions, 1);
    assert.equal((await fetch(url, { method: 'POST', headers: { authorization: 'test-secret' }, body: '{}' })).status, 400);
  } finally { await new Promise(resolve => server.close(resolve)); store.close(); }
});

test('restart reconciles an uncertain pause without submitting another transaction', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'helius-test-'));
  const path = join(dir, 'monitor.sqlite');
  const f = fixture(), sig = signature();
  f.rpc.transactions.set(sig, f.tx); f.rpc.uncertain = true;
  let store = new Store(path);
  store.enqueue([sig]);
  await monitor(f, store).tick();
  assert.equal(store.pending().length, 1);
  assert.equal(f.data[1], 1);
  store.close();
  store = new Store(path);
  await monitor(f, store).tick();
  assert.equal(store.jobs()[0].outcome, 'paused');
  assert.equal(f.rpc.submissions, 1);
  store.close();
});

test('failed admin transactions and donations complete without a pause', async () => {
  const f = fixture(), store = new Store(':memory:'), sig = signature();
  f.tx.meta.err = { InstructionError: [0, 'InvalidInstructionData'] };
  f.rpc.transactions.set(sig, f.tx); store.enqueue([sig]);
  await monitor(f, store).tick();
  assert.equal(store.jobs()[0].outcome, 'irrelevant-or-failed');
  assert.equal(f.rpc.submissions, 0);
  store.close();
});

test('raw parser rejects malformed payloads and deduplicates signatures', () => {
  const sig = signature();
  assert.deepEqual(signaturesFromRaw([{ transaction: { signatures: [sig] } }, { transaction: { signatures: [sig] } }]), [sig]);
  assert.throws(() => signaturesFromRaw([{ transaction: { signatures: ['bad'] } }]));
  assert.throws(() => signaturesFromRaw({}));
});


test('network guard accepts the real devnet genesis and rejects other clusters', async t => {
  const savedUrl = process.env.RPC_URL;
  const savedLocal = process.env.ALLOW_LOCALNET;
  let genesis = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
  t.mock.method(Connection.prototype, 'getGenesisHash', async () => genesis);
  try {
    process.env.RPC_URL = 'https://api.devnet.solana.com';
    delete process.env.ALLOW_LOCALNET;
    await connection();
    genesis = 'different-cluster';
    await assert.rejects(connection(), /Only Solana devnet/);
    process.env.RPC_URL = 'http://127.0.0.1:8899';
    await assert.rejects(connection(), /Only Solana devnet/);
    process.env.ALLOW_LOCALNET = '1';
    await connection();
    process.env.RPC_URL = 'https://api.mainnet-beta.solana.com';
    await assert.rejects(connection(), /Only Solana devnet/);
  } finally {
    if (savedUrl === undefined) delete process.env.RPC_URL; else process.env.RPC_URL = savedUrl;
    if (savedLocal === undefined) delete process.env.ALLOW_LOCALNET; else process.env.ALLOW_LOCALNET = savedLocal;
  }
});
