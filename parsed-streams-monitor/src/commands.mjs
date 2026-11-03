import { randomBytes } from 'node:crypto';
import { PublicKey, SystemProgram } from '@solana/web3.js';
import {
  addAdminIx,
  collateralAddress,
  connection,
  customError,
  ERRORS,
  ids,
  initializeIx,
  keypair,
  LEN,
  publicState,
  readCollateral,
  required,
  send,
  waitFrozen,
  withdrawIx,
} from './client.mjs';
import { Store } from './store.mjs';

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
  if (command === 'jobs' || command === 'alerts') {
    const store = new Store(required('DB_PATH'));
    try {
      return command === 'jobs' ? store.jobs() : store.alerts();
    } finally {
      store.close();
    }
  }

  const rpc = await connection();
  if (command === 'init') {
    const program = publicKey('COLLATERAL_PROGRAM_ID');
    const customer = keypair('CUSTOMER_KEYPAIR');
    const guardian = keypair('BOT_KEYPAIR');
    const seed = randomBytes(32);
    const collateral = collateralAddress(program, customer.publicKey, seed);
    const result = await success(
      await send(
        rpc,
        customer,
        [
          initializeIx(program, customer.publicKey, guardian.publicKey, seed),
          SystemProgram.transfer({
            fromPubkey: customer.publicKey,
            toPubkey: collateral,
            lamports: Number(argument),
          }),
        ],
        [guardian],
      ),
    );
    return { ...result, collateral: collateral.toBase58() };
  }

  const { program, collateral } = ids();
  if (command === 'state') {
    return publicState(await readCollateral(rpc, program, collateral));
  }
  if (command === 'wait-frozen') {
    await waitFrozen(rpc, program, collateral);
    return {
      event: 'frozen-observed',
      collateral: collateral.toBase58(),
      at: new Date().toISOString(),
    };
  }
  if (command === 'approved-add' || command === 'attack-add') {
    const actor = keypair(
      command === 'attack-add' ? 'ATTACKER_KEYPAIR' : 'CUSTOMER_KEYPAIR',
    );
    const newAdmin =
      command === 'attack-add'
        ? keypair('ATTACKER_KEYPAIR').publicKey
        : new PublicKey(argument);
    const store =
      command === 'approved-add' ? new Store(required('DB_PATH')) : undefined;
    try {
      return await success(
        await send(
          rpc,
          actor,
          [addAdminIx(program, collateral, newAdmin)],
          [],
          store ? (signature) => store.approve(signature) : undefined,
        ),
      );
    } finally {
      store?.close();
    }
  }
  if (command === 'withdraw') {
    const customer = keypair('CUSTOMER_KEYPAIR');
    return success(
      await send(rpc, customer, [
        withdrawIx(program, collateral, customer.publicKey, Number(argument)),
      ]),
    );
  }
  if (command === 'expect-frozen-withdraw') {
    const attacker = keypair('ATTACKER_KEYPAIR');
    const before = await readCollateral(rpc, program, collateral);
    const rent = await rpc.getMinimumBalanceForRentExemption(LEN);
    const spendable = before.lamports - rent;
    if (spendable <= 0)
      throw new UserError(
        'Collateral has no spendable funds. Initialize a fresh funded account.',
      );
    const result = await send(rpc, attacker, [
      withdrawIx(program, collateral, attacker.publicKey, spendable),
    ]);
    const after = await readCollateral(rpc, program, collateral);
    const outcome = {
      ...result,
      collateralBefore: before.lamports,
      collateralAfter: after.lamports,
    };
    if (
      !before.frozen ||
      !customError(result, ERRORS.Frozen) ||
      after.lamports !== before.lamports
    ) {
      throw new UserError(
        'Expected an on-chain Frozen error and unchanged collateral balance',
      );
    }
    return outcome;
  }
  if (command === 'attack-atomic') {
    const attacker = keypair('ATTACKER_KEYPAIR');
    const before = await readCollateral(rpc, program, collateral);
    const rent = await rpc.getMinimumBalanceForRentExemption(LEN);
    const spendable = before.lamports - rent;
    if (spendable <= 0)
      throw new UserError(
        'Collateral has no spendable funds. Initialize a fresh funded account.',
      );
    const result = await send(rpc, attacker, [
      addAdminIx(program, collateral, attacker.publicKey),
      withdrawIx(program, collateral, attacker.publicKey, spendable),
    ]);
    const after = await readCollateral(rpc, program, collateral);
    const outcome = {
      ...result,
      collateralBefore: before.lamports,
      collateralAfter: after.lamports,
    };
    if (result.err || after.lamports !== rent)
      throw new UserError(
        'Expected the atomic attack to drain spendable funds',
      );
    return outcome;
  }

  throw new UserError('Unknown command. Run pnpm demo --help.');
}
