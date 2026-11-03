import { randomBytes } from 'node:crypto';
import { PublicKey, SystemProgram } from '@solana/web3.js';
import { Store } from './store.mjs';
import {
  actionIx,
  amountBytes,
  connection,
  customError,
  ERRORS,
  ids,
  initializeIx,
  keypair,
  LEN,
  publicState,
  readVault,
  required,
  send,
  vaultAddress,
  waitForPaused,
} from './client.mjs';

import { UserError, publicKey } from './config.mjs';
async function success(result) {
  if (result.err) {
    const error = new UserError(
      'Transaction failed. Inspect the public transaction result.',
    );
    error.result = result;
    throw error;
  }
  return result;
}
export async function executeCommand({ command, argument }) {
  if (command === 'jobs') {
    const store = new Store(required('DB_PATH'));
    try {
      return store.jobs();
    } finally {
      store.close();
    }
  }
  const rpc = await connection();
  if (command === 'init') {
    const program = publicKey('PROGRAM_ID');
    const admin = keypair('ADMIN_KEYPAIR'),
      guardian = keypair('BOT_KEYPAIR'),
      withdrawer = keypair('WITHDRAWER_KEYPAIR');
    const seed = randomBytes(32);
    const vault = vaultAddress(program, admin.publicKey, seed);
    const result = await success(
      await send(
        rpc,
        admin,
        [
          initializeIx(
            program,
            admin.publicKey,
            withdrawer.publicKey,
            guardian.publicKey,
            seed,
          ),
          SystemProgram.transfer({
            fromPubkey: admin.publicKey,
            toPubkey: vault,
            lamports: Number(argument),
          }),
        ],
        [guardian],
      ),
    );
    return { ...result, vault: vault.toBase58() };
  }
  const { program, vault } = ids();
  if (command === 'state') {
    return publicState(await readVault(rpc, program, vault));
  }
  if (command === 'wait-paused') {
    await waitForPaused(rpc, program, vault);
    return {
      event: 'paused-observed',
      vault: vault.toBase58(),
      at: new Date().toISOString(),
    };
  }
  if (command === 'approved-change' || command === 'attack-change') {
    const admin = keypair('ADMIN_KEYPAIR');
    const target =
      command === 'attack-change'
        ? keypair('ATTACKER_KEYPAIR').publicKey
        : new PublicKey(argument);
    const store =
      command === 'approved-change'
        ? new Store(required('DB_PATH'))
        : undefined;
    try {
      return await success(
        await send(
          rpc,
          admin,
          [actionIx(program, vault, admin.publicKey, 1, target.toBuffer())],
          [],
          store ? (signature) => store.approve(signature) : undefined,
        ),
      );
    } finally {
      store?.close();
    }
  }
  if (command === 'withdraw' || command === 'donate') {
    const actor = keypair(
      command === 'donate' ? 'ADMIN_KEYPAIR' : 'WITHDRAWER_KEYPAIR',
    );
    const ix =
      command === 'donate'
        ? SystemProgram.transfer({
            fromPubkey: actor.publicKey,
            toPubkey: vault,
            lamports: Number(argument),
          })
        : actionIx(
            program,
            vault,
            actor.publicKey,
            2,
            amountBytes(Number(argument)),
          );
    return success(await send(rpc, actor, [ix]));
  }
  if (['drain', 'attack-atomic', 'expect-paused'].includes(command)) {
    const attacker = keypair('ATTACKER_KEYPAIR');
    const before = await readVault(rpc, program, vault);
    const rent = await rpc.getMinimumBalanceForRentExemption(LEN);
    const spendable = before.lamports - rent;
    if (spendable <= 0)
      throw new UserError(
        'Vault has no spendable funds. Initialize a fresh funded vault.',
      );
    const instructions = [
      actionIx(program, vault, attacker.publicKey, 2, amountBytes(spendable)),
    ];
    let payer = attacker,
      signers = [];
    if (command === 'attack-atomic') {
      payer = keypair('ADMIN_KEYPAIR');
      signers = [attacker];
      instructions.unshift(
        actionIx(
          program,
          vault,
          payer.publicKey,
          1,
          attacker.publicKey.toBuffer(),
        ),
      );
    }
    const result = await send(rpc, payer, instructions, signers);
    const after = await readVault(rpc, program, vault);
    const outcome = {
      ...result,
      vaultBefore: before.lamports,
      vaultAfter: after.lamports,
    };
    if (command === 'expect-paused') {
      if (
        !before.paused ||
        !customError(result, ERRORS.Paused) ||
        after.lamports !== before.lamports
      ) {
        throw new UserError(
          'Expected an on-chain Paused error and unchanged vault balance',
        );
      }
    } else if (result.err || after.lamports !== rent)
      throw new UserError('Expected spendable balance to be drained');
    return outcome;
  }
  throw new UserError('Unknown command. Run pnpm demo --help.');
}
