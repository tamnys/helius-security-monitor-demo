import { randomInt } from 'node:crypto';
import {
  ComputeBudgetProgram,
  PublicKey,
  SystemProgram,
} from '@solana/web3.js';
import { signedTransaction } from './client.mjs';
import { UserError } from './config.mjs';

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
].map((address) => new PublicKey(address));

export function senderConfig({
  network,
  url,
  tipLamports = SENDER_DEFAULT_TIP_LAMPORTS,
  priorityFeeMicroLamports = SENDER_DEFAULT_PRIORITY_MICROLAMPORTS,
  computeUnitLimit = SENDER_DEFAULT_COMPUTE_UNIT_LIMIT,
  tipAccount,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (network !== 'mainnet')
    throw new UserError('Helius Sender is available only on mainnet');
  let endpoint;
  try {
    endpoint = new URL(url);
  } catch {
    throw new UserError('SENDER_URL must be a valid URL');
  }
  if (!['http:', 'https:'].includes(endpoint.protocol))
    throw new UserError('SENDER_URL must use HTTP or HTTPS');
  if (endpoint.searchParams.get('swqos_only') === 'true')
    throw new UserError('SENDER_URL must select Sender Max, not SWQOS-only');
  if (endpoint.protocol === 'http:' && endpoint.searchParams.has('api-key')) {
    throw new UserError(
      'Do not send an API key over HTTP; use a keyless regional URL or HTTPS',
    );
  }
  if (typeof fetchImpl !== 'function')
    throw new UserError('A fetch implementation is required for Helius Sender');
  for (const [name, value] of [
    ['tipLamports', tipLamports],
    ['priorityFeeMicroLamports', priorityFeeMicroLamports],
    ['computeUnitLimit', computeUnitLimit],
  ]) {
    if (!Number.isSafeInteger(value) || value <= 0)
      throw new UserError(name + ' must be a positive safe integer');
  }
  if (tipLamports < SENDER_MIN_TIP_LAMPORTS) {
    throw new UserError(
      'Sender Max tip must be at least ' +
        SENDER_MIN_TIP_LAMPORTS +
        ' lamports',
    );
  }
  const priorityFee =
    (BigInt(priorityFeeMicroLamports) * BigInt(computeUnitLimit) + 999_999n) /
    1_000_000n;
  if (priorityFee < BigInt(SENDER_MIN_PRIORITY_FEE_LAMPORTS)) {
    throw new UserError(
      'Sender priority fee must be at least ' +
        SENDER_MIN_PRIORITY_FEE_LAMPORTS +
        ' lamports',
    );
  }
  const selectedTip = tipAccount
    ? new PublicKey(tipAccount)
    : SENDER_TIP_ACCOUNTS[randomInt(SENDER_TIP_ACCOUNTS.length)];
  if (!SENDER_TIP_ACCOUNTS.some((account) => account.equals(selectedTip))) {
    throw new UserError('tipAccount must be a Helius Sender tip account');
  }
  return Object.freeze({
    network,
    url: endpoint.toString(),
    tipLamports,
    priorityFeeMicroLamports,
    computeUnitLimit,
    tipAccount: selectedTip,
    fetchImpl,
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
export async function sendViaSender(
  rpc,
  payer,
  instructions,
  { sender, signers = [], approve } = {},
) {
  if (!sender) throw new UserError('Sender configuration is required');
  const built = await signedTransaction(
    rpc,
    payer,
    [
      ComputeBudgetProgram.setComputeUnitLimit({
        units: sender.computeUnitLimit,
      }),
      ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: sender.priorityFeeMicroLamports,
      }),
      ...instructions,
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: sender.tipAccount,
        lamports: sender.tipLamports,
      }),
    ],
    signers,
  );
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
        params: [
          bytes.toString('base64'),
          { encoding: 'base64', skipPreflight: true, maxRetries: 0 },
        ],
      }),
    });
    const payload = await response.json();
    if (!response.ok || payload.error || payload.result !== built.signature) {
      throw new UserError('Sender rejected the transaction');
    }
  } catch {
    await rpc.sendRawTransaction(bytes, { skipPreflight: true });
    via = 'rpc-fallback';
  }
  const result = await rpc.confirmTransaction(
    { signature: built.signature, ...built.block },
    'confirmed',
  );
  return {
    signature: built.signature,
    slot: result.context.slot,
    err: result.value.err,
    via,
  };
}
