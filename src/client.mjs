import { readFileSync, realpathSync } from 'node:fs';
import { dirname, relative, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import bs58 from 'bs58';
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from '@solana/web3.js';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const LEN = 131;
export const ERRORS = { Paused: 0, Unauthorized: 1, InvalidVault: 2, InvalidAuthorities: 3, InsufficientFunds: 4, AdminCpiForbidden: 5 };
export const DEVNET_GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';

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

export async function connection() {
  const url = required('RPC_URL');
  const rpc = new Connection(url, 'confirmed');
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname);
  const genesis = await rpc.getGenesisHash();
  if (genesis !== DEVNET_GENESIS && !(local && process.env.ALLOW_LOCALNET === '1')) {
    throw new Error('Only Solana devnet or explicitly enabled loopback localnet is allowed');
  }
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
  return { signature: built.signature, slot: result.context.slot, err: result.value.err };
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
