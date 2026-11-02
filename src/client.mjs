import { randomInt } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, relative, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import bs58 from 'bs58';
import { ComputeBudgetProgram, Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from '@solana/web3.js';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const LEN = 131;
export const ERRORS = { Paused: 0, Unauthorized: 1, InvalidVault: 2, InvalidAuthorities: 3, InsufficientFunds: 4, AdminCpiForbidden: 5 };
export const DEVNET_GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
export const MAINNET_GENESIS = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
export const SENDER_MIN_TIP_LAMPORTS = 1_000_000;
export const SENDER_MIN_PRIORITY_FEE_LAMPORTS = 5_000;
export const SENDER_DEFAULT_TIP_LAMPORTS = 1_000_000;
export const SENDER_DEFAULT_PRIORITY_MICROLAMPORTS = 200_000;
export const SENDER_DEFAULT_COMPUTE_UNIT_LIMIT = 100_000;
export const SENDER_TIP_ACCOUNTS = [
  '4ACfpUFoaSD9bfPdeu6DBt89gB6ENTeHBXCAi87NhDEE',
  'D2L6yPZ2FmmmTKPgzaMKdhu6EWZcTpLy1Vhx8uvZe7NZ',
  '9bnz4RShgq1hAnLnZbP8kbgBg1kEmcJBYQq3gQbmnSta',
  '5VY91ws6B2hMmBFRsXkoAAdsPHBJwRfBht4DXox3xkwn',
  '2nyhqdwKcJZR2vcqCyrYsaPVdAnFoJjiksCXJ7hfEYgD',
  '2q5pghRs6arqVjRvT5gfgWfWcHWmw1ZuCzphgd5KfWGJ',
  'wyvPkWjVZz1M8fHQnMMCDTQDbkManefNNhweYk5WkcF',
  '3KCKozbAaF75qEU33jtzozcJ29yJuaLJTy2jFdzUY8bT',
  '4vieeGHPYPG2MmyPRcYjdiDmmhN3ww7hsFNap8pVN3Ey',
  '4TQLFNWK8AovT1gFvda5jfw2oJeRMKEmw7aH6MGBJ3or',
].map(address => new PublicKey(address));

export function required(name) {
  const value = process.env[name];
  if (!value) throw new Error('Missing ' + name);
  return value;
}

export function keypair(name) {
  const path = realpathSync(required(name));
  const rel = relative(ROOT, path);
  if (!isAbsolute(rel) && rel !== '..' && !rel.startsWith('../')) {
    throw new Error(name + ' must point outside the repository');
  }
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, 'utf8'))));
}

export async function connection({ allowMainnet = false } = {}) {
  const url = required('RPC_URL');
  const rpc = new Connection(url, 'confirmed');
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname);
  const genesis = await rpc.getGenesisHash();
  const network = genesis === DEVNET_GENESIS ? 'devnet'
    : genesis === MAINNET_GENESIS ? 'mainnet'
    : local && process.env.ALLOW_LOCALNET === '1' ? 'localnet' : null;
  if (!network || (network === 'mainnet' && !allowMainnet)) {
    throw new Error('Only Solana devnet or explicitly enabled loopback localnet is allowed, unless mainnet is explicitly enabled');
  }
  Object.defineProperties(rpc, {
    genesisHash: { value: genesis, enumerable: false },
    network: { value: network, enumerable: false },
  });
  return rpc;
}

export function ids() {
  return { program: new PublicKey(required('PROGRAM_ID')), vault: new PublicKey(required('VAULT')) };
}

export function vaultAddress(program, admin, seed) {
  return PublicKey.findProgramAddressSync([Buffer.from('vault'), admin.toBuffer(), seed], program)[0];
}

export function initializeIx(program, admin, withdrawer, guardian, seed) {
  return new TransactionInstruction({
    programId: program,
    keys: [
      { pubkey: admin, isSigner: true, isWritable: true },
      { pubkey: vaultAddress(program, admin, seed), isSigner: false, isWritable: true },
      { pubkey: withdrawer, isSigner: false, isWritable: false },
      { pubkey: guardian, isSigner: true, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([Buffer.from([0]), seed]),
  });
}

export function actionIx(program, vault, actor, tag, args = Buffer.alloc(0)) {
  return new TransactionInstruction({
    programId: program,
    keys: [
      { pubkey: vault, isSigner: false, isWritable: true },
      { pubkey: actor, isSigner: true, isWritable: tag === 2 },
    ],
    data: Buffer.concat([Buffer.from([tag]), args]),
  });
}

export function amountBytes(amount) {
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64LE(BigInt(amount));
  return bytes;
}

export async function readVault(rpc, program, vault) {
  const account = await rpc.getAccountInfo(vault, 'confirmed');
  if (!account || !account.owner.equals(program) || account.data.length !== LEN || account.data[0] !== 1 || account.data[1] > 1) {
    throw new Error('Invalid vault');
  }
  const d = account.data;
  const state = {
    paused: d[1] === 1, bump: d[2], seed: d.subarray(3, 35),
    admin: new PublicKey(d.subarray(35, 67)),
    withdrawer: new PublicKey(d.subarray(67, 99)),
    guardian: new PublicKey(d.subarray(99, 131)),
    lamports: account.lamports,
  };
  const [expected, bump] = PublicKey.findProgramAddressSync([Buffer.from('vault'), state.admin.toBuffer(), state.seed], program);
  if (!expected.equals(vault) || bump !== state.bump) throw new Error('Invalid vault PDA');
  return state;
}

export async function signedTransaction(rpc, payer, instructions, signers) {
  const block = await rpc.getLatestBlockhash('confirmed');
  const tx = new Transaction({ feePayer: payer.publicKey, ...block }).add(...instructions);
  tx.sign(...new Map([payer, ...signers].map(s => [s.publicKey.toBase58(), s])).values());
  return { tx, block, signature: bs58.encode(tx.signature) };
}

// Records approval before any network submission; signers never grant approval implicitly.
export async function send(rpc, payer, instructions, signers = [], approve) {
  const built = await signedTransaction(rpc, payer, instructions, signers);
  approve?.(built.signature);
  await rpc.sendRawTransaction(built.tx.serialize(), { skipPreflight: true });
  const result = await rpc.confirmTransaction({ signature: built.signature, ...built.block }, 'confirmed');
  return { signature: built.signature, slot: result.context.slot, err: result.value.err, via: 'rpc' };
}

export function senderConfig({
  network,
  url,
  tipLamports = SENDER_DEFAULT_TIP_LAMPORTS,
  priorityFeeMicroLamports = SENDER_DEFAULT_PRIORITY_MICROLAMPORTS,
  computeUnitLimit = SENDER_DEFAULT_COMPUTE_UNIT_LIMIT,
  tipAccount,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (network !== 'mainnet') throw new Error('Helius Sender is available only on mainnet');
  let endpoint;
  try { endpoint = new URL(url); } catch { throw new Error('SENDER_URL must be a valid URL'); }
  if (!['http:', 'https:'].includes(endpoint.protocol)) throw new Error('SENDER_URL must use HTTP or HTTPS');
  if (endpoint.searchParams.get('swqos_only') === 'true') throw new Error('SENDER_URL must select Sender Max, not SWQOS-only');
  if (endpoint.protocol === 'http:' && endpoint.searchParams.has('api-key')) {
    throw new Error('Do not send an API key over HTTP; use a keyless regional URL or HTTPS');
  }
  if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required for Helius Sender');
  for (const [name, value] of [
    ['tipLamports', tipLamports],
    ['priorityFeeMicroLamports', priorityFeeMicroLamports],
    ['computeUnitLimit', computeUnitLimit],
  ]) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(name + ' must be a positive safe integer');
  }
  if (tipLamports < SENDER_MIN_TIP_LAMPORTS) {
    throw new Error('Sender Max tip must be at least ' + SENDER_MIN_TIP_LAMPORTS + ' lamports');
  }
  const priorityFee = (BigInt(priorityFeeMicroLamports) * BigInt(computeUnitLimit) + 999_999n) / 1_000_000n;
  if (priorityFee < BigInt(SENDER_MIN_PRIORITY_FEE_LAMPORTS)) {
    throw new Error('Sender priority fee must be at least ' + SENDER_MIN_PRIORITY_FEE_LAMPORTS + ' lamports');
  }
  const selectedTip = tipAccount
    ? new PublicKey(tipAccount)
    : SENDER_TIP_ACCOUNTS[randomInt(SENDER_TIP_ACCOUNTS.length)];
  if (!SENDER_TIP_ACCOUNTS.some(account => account.equals(selectedTip))) {
    throw new Error('tipAccount must be a Helius Sender tip account');
  }
  return Object.freeze({
    network, url: endpoint.toString(), tipLamports, priorityFeeMicroLamports,
    computeUnitLimit, tipAccount: selectedTip, fetchImpl,
  });
}

export function senderPingUrl(url) {
  const endpoint = new URL(url);
  endpoint.pathname = endpoint.pathname.replace(/\/fast\/?$/, '/ping');
  endpoint.search = '';
  endpoint.hash = '';
  return endpoint.toString();
}

export async function warmSender(sender) {
  try {
    const response = await sender.fetchImpl(senderPingUrl(sender.url));
    return Boolean(response.ok);
  } catch {
    return false;
  }
}

// Sender Max routes the signed pause and its tip across multiple pathways. If
// Sender is unavailable, submit those exact signed bytes through the RPC.
export async function sendViaSender(rpc, payer, instructions, { sender, signers = [], approve } = {}) {
  if (!sender) throw new Error('Sender configuration is required');
  const built = await signedTransaction(rpc, payer, [
    ComputeBudgetProgram.setComputeUnitLimit({ units: sender.computeUnitLimit }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: sender.priorityFeeMicroLamports }),
    ...instructions,
    SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: sender.tipAccount, lamports: sender.tipLamports }),
  ], signers);
  approve?.(built.signature);
  const bytes = built.tx.serialize();
  let via = 'sender';
  try {
    const response = await sender.fetchImpl(sender.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: built.signature,
        method: 'sendTransaction',
        params: [bytes.toString('base64'), { encoding: 'base64', skipPreflight: true, maxRetries: 0 }],
      }),
    });
    const payload = await response.json();
    if (!response.ok || payload.error || payload.result !== built.signature) {
      throw new Error('Sender rejected the transaction');
    }
  } catch {
    await rpc.sendRawTransaction(bytes, { skipPreflight: true });
    via = 'rpc-fallback';
  }
  const result = await rpc.confirmTransaction({ signature: built.signature, ...built.block }, 'confirmed');
  return { signature: built.signature, slot: result.context.slot, err: result.value.err, via };
}

export function customError(result, expected) {
  return result.err?.InstructionError?.[1]?.Custom === expected;
}

export function publicState(state) {
  return { paused: state.paused, admin: state.admin.toBase58(), withdrawer: state.withdrawer.toBase58(), guardian: state.guardian.toBase58(), lamports: state.lamports };
}

// Retry only when chain state advances; no operator-selected polling interval.
export async function waitForPaused(rpc, program, vault) {
  let resolve, reject, checking = false, done = false;
  const waiting = new Promise((yes, no) => { resolve = yes; reject = no; });
  async function check() {
    if (checking || done) return;
    checking = true;
    try {
      if ((await readVault(rpc, program, vault)).paused) { done = true; resolve(); }
    } catch (error) { done = true; reject(error); }
    finally { checking = false; }
  }
  const subscription = rpc.onSlotChange(() => void check());
  try { await check(); await waiting; }
  finally { await rpc.removeSlotChangeListener(subscription); }
}
