import { publicKey } from './config.mjs';
export {
  ROOT,
  DEVNET_GENESIS,
  MAINNET_GENESIS,
  required,
  keypair,
  connection,
} from './config.mjs';
import bs58 from 'bs58';
import {
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';

export const LEN = 196;
export const MAX_ADMINS = 4;
export const ERRORS = {
  Frozen: 0,
  Unauthorized: 1,
  InvalidCollateral: 2,
  InvalidAuthorities: 3,
  InsufficientFunds: 4,
  AdminLimit: 5,
  AlreadyAdmin: 6,
};

export function ids() {
  return {
    program: publicKey('COLLATERAL_PROGRAM_ID'),
    collateral: publicKey('COLLATERAL'),
  };
}

export function collateralAddress(program, customer, seed) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('collateral'), customer.toBuffer(), seed],
    program,
  )[0];
}

export function initializeIx(program, customer, guardian, seed) {
  return new TransactionInstruction({
    programId: program,
    keys: [
      { pubkey: customer, isSigner: true, isWritable: true },
      {
        pubkey: collateralAddress(program, customer, seed),
        isSigner: false,
        isWritable: true,
      },
      { pubkey: guardian, isSigner: true, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([Buffer.from([0]), seed]),
  });
}

export function addAdminIx(program, collateral, newAdmin) {
  return new TransactionInstruction({
    programId: program,
    keys: [
      { pubkey: collateral, isSigner: false, isWritable: true },
      { pubkey: newAdmin, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([Buffer.from([1]), newAdmin.toBuffer()]),
  });
}

export function withdrawIx(program, collateral, admin, amount) {
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64LE(BigInt(amount));
  return new TransactionInstruction({
    programId: program,
    keys: [
      { pubkey: collateral, isSigner: false, isWritable: true },
      { pubkey: admin, isSigner: true, isWritable: true },
    ],
    data: Buffer.concat([Buffer.from([2]), bytes]),
  });
}

export function freezeIx(program, collateral, guardian) {
  return new TransactionInstruction({
    programId: program,
    keys: [
      { pubkey: collateral, isSigner: false, isWritable: true },
      { pubkey: guardian, isSigner: true, isWritable: false },
    ],
    data: Buffer.from([3]),
  });
}

export async function readCollateral(rpc, program, collateral) {
  const account = await rpc.getAccountInfo(collateral, 'confirmed');
  if (
    !account ||
    !account.owner.equals(program) ||
    account.data.length !== LEN ||
    account.data[0] !== 1 ||
    account.data[1] > 1
  ) {
    throw new Error('Invalid collateral account');
  }
  const data = account.data;
  const count = data[3];
  if (count < 1 || count > MAX_ADMINS)
    throw new Error('Invalid collateral admin count');
  const admins = Array.from(
    { length: count },
    (_, index) =>
      new PublicKey(data.subarray(68 + index * 32, 100 + index * 32)),
  );
  const state = {
    frozen: data[1] === 1,
    bump: data[2],
    seed: data.subarray(4, 36),
    guardian: new PublicKey(data.subarray(36, 68)),
    admins,
    lamports: account.lamports,
  };
  const [expected, bump] = PublicKey.findProgramAddressSync(
    [Buffer.from('collateral'), admins[0].toBuffer(), state.seed],
    program,
  );
  if (!expected.equals(collateral) || bump !== state.bump)
    throw new Error('Invalid collateral PDA');
  return state;
}

export async function signedTransaction(rpc, payer, instructions, signers) {
  const block = await rpc.getLatestBlockhash('confirmed');
  const tx = new Transaction({ feePayer: payer.publicKey, ...block }).add(
    ...instructions,
  );
  tx.sign(
    ...new Map(
      [payer, ...signers].map((signer) => [
        signer.publicKey.toBase58(),
        signer,
      ]),
    ).values(),
  );
  return { tx, block, signature: bs58.encode(tx.signature) };
}

export async function send(rpc, payer, instructions, signers = [], approve) {
  const built = await signedTransaction(rpc, payer, instructions, signers);
  approve?.(built.signature);
  await rpc.sendRawTransaction(built.tx.serialize(), { skipPreflight: true });
  try {
    const result = await rpc.confirmTransaction(
      { signature: built.signature, ...built.block },
      'confirmed',
    );
    return {
      signature: built.signature,
      slot: result.context.slot,
      err: result.value.err,
    };
  } catch (error) {
    if (error && typeof error === 'object' && 'InstructionError' in error) {
      return { signature: built.signature, slot: null, err: error };
    }
    throw error;
  }
}

export function customError(result, expected) {
  const value = result.err?.InstructionError?.[1];
  return value?.Custom === expected || value === expected;
}

export function publicState(state) {
  return {
    frozen: state.frozen,
    guardian: state.guardian.toBase58(),
    admins: state.admins.map((admin) => admin.toBase58()),
    lamports: state.lamports,
  };
}

export async function waitFrozen(rpc, program, collateral) {
  let resolve,
    reject,
    checking = false,
    done = false;
  const waiting = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  async function check() {
    if (checking || done) return;
    checking = true;
    try {
      if ((await readCollateral(rpc, program, collateral)).frozen) {
        done = true;
        resolve();
      }
    } catch (error) {
      done = true;
      reject(error);
    } finally {
      checking = false;
    }
  }
  const subscription = rpc.onSlotChange(() => void check());
  try {
    await check();
    await waiting;
  } finally {
    await rpc.removeSlotChangeListener(subscription);
  }
}
