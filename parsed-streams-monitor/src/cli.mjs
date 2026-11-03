import { randomBytes } from 'node:crypto';
import { PublicKey, SystemProgram } from '@solana/web3.js';
import {
  addAdminIx, collateralAddress, connection, customError, ERRORS, ids, initializeIx,
  keypair, LEN, publicState, readCollateral, required, send, waitFrozen, withdrawIx,
} from './client.mjs';
import { Store } from './store.mjs';

const [command, argument] = process.argv.slice(2);

function amount() {
  if (!argument || !/^[1-9][0-9]*$/.test(argument)) throw new Error('Provide a positive integer lamport amount');
  const value = BigInt(argument);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Amount exceeds the exact RPC integer range');
  return Number(value);
}

async function success(result) {
  console.log(JSON.stringify(result));
  if (result.err) throw new Error('Transaction failed');
}

async function main() {
  if (command === 'jobs' || command === 'alerts') {
    const store = new Store(required('DB_PATH'));
    console.log(JSON.stringify(command === 'jobs' ? store.jobs() : store.alerts(), null, 2));
    store.close();
    return;
  }

  const rpc = await connection();
  if (command === 'init') {
    const program = new PublicKey(required('COLLATERAL_PROGRAM_ID'));
    const customer = keypair('CUSTOMER_KEYPAIR');
    const guardian = keypair('BOT_KEYPAIR');
    const seed = randomBytes(32);
    const collateral = collateralAddress(program, customer.publicKey, seed);
    await success(await send(rpc, customer, [
      initializeIx(program, customer.publicKey, guardian.publicKey, seed),
      SystemProgram.transfer({ fromPubkey: customer.publicKey, toPubkey: collateral, lamports: amount() }),
    ], [guardian]));
    console.log('COLLATERAL=' + collateral.toBase58());
    return;
  }

  const { program, collateral } = ids();
  if (command === 'state') {
    console.log(JSON.stringify(publicState(await readCollateral(rpc, program, collateral)), null, 2));
    return;
  }
  if (command === 'wait-frozen') {
    await waitFrozen(rpc, program, collateral);
    console.log(JSON.stringify({ event: 'frozen-observed', collateral: collateral.toBase58(), at: new Date().toISOString() }));
    return;
  }
  if (command === 'approved-add' || command === 'attack-add') {
    const actor = keypair(command === 'attack-add' ? 'ATTACKER_KEYPAIR' : 'CUSTOMER_KEYPAIR');
    const newAdmin = command === 'attack-add' ? keypair('ATTACKER_KEYPAIR').publicKey : new PublicKey(argument);
    const store = command === 'approved-add' ? new Store(required('DB_PATH')) : undefined;
    try {
      await success(await send(rpc, actor, [addAdminIx(program, collateral, newAdmin)], [],
        store ? signature => store.approve(signature) : undefined));
    } finally { store?.close(); }
    return;
  }
  if (command === 'withdraw') {
    const customer = keypair('CUSTOMER_KEYPAIR');
    await success(await send(rpc, customer, [withdrawIx(program, collateral, customer.publicKey, amount())]));
    return;
  }
  if (command === 'expect-frozen-withdraw') {
    const attacker = keypair('ATTACKER_KEYPAIR');
    const before = await readCollateral(rpc, program, collateral);
    const rent = await rpc.getMinimumBalanceForRentExemption(LEN);
    const spendable = before.lamports - rent;
    if (spendable <= 0) throw new Error('Collateral has no spendable funds');
    const result = await send(rpc, attacker, [withdrawIx(program, collateral, attacker.publicKey, spendable)]);
    const after = await readCollateral(rpc, program, collateral);
    console.log(JSON.stringify({ ...result, collateralBefore: before.lamports, collateralAfter: after.lamports }));
    if (!before.frozen || !customError(result, ERRORS.Frozen) || after.lamports !== before.lamports) {
      throw new Error('Expected an on-chain Frozen error and unchanged collateral balance');
    }
    return;
  }
  if (command === 'attack-atomic') {
    const attacker = keypair('ATTACKER_KEYPAIR');
    const before = await readCollateral(rpc, program, collateral);
    const rent = await rpc.getMinimumBalanceForRentExemption(LEN);
    const spendable = before.lamports - rent;
    if (spendable <= 0) throw new Error('Collateral has no spendable funds');
    const result = await send(rpc, attacker, [
      addAdminIx(program, collateral, attacker.publicKey),
      withdrawIx(program, collateral, attacker.publicKey, spendable),
    ]);
    const after = await readCollateral(rpc, program, collateral);
    console.log(JSON.stringify({ ...result, collateralBefore: before.lamports, collateralAfter: after.lamports }));
    if (result.err || after.lamports !== rent) throw new Error('Expected the atomic attack to drain spendable funds');
    return;
  }

  throw new Error('Commands: init LAMPORTS | state | approved-add PUBKEY | attack-add | withdraw LAMPORTS | expect-frozen-withdraw | attack-atomic | wait-frozen | jobs | alerts');
}

function finish(code) {
  process.stdout.write('', () => process.stderr.write('', () => process.exit(code)));
}

main().then(() => finish(0)).catch(error => {
  console.error('Command failed (' + error.name + '). Check configuration, balances, and public transaction results.');
  finish(1);
});
