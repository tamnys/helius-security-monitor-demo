import { randomBytes } from 'node:crypto';
import { PublicKey, SystemProgram } from '@solana/web3.js';
import { Store } from './store.mjs';
import { actionIx, amountBytes, connection, customError, ERRORS, ids, initializeIx, keypair, LEN, publicState, readVault, required, send, vaultAddress, waitForPaused } from './client.mjs';

const [command, argument] = process.argv.slice(2);
function amount() {
  if (!argument || !/^[1-9][0-9]*$/.test(argument)) throw new Error('Provide a positive integer lamport amount');
  const value = BigInt(argument);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Amount exceeds the exact integer range of the RPC client');
  return Number(value);
}
async function success(result) {
  console.log(JSON.stringify(result));
  if (result.err) throw new Error('Transaction failed');
}
async function main() {
  if (command === 'jobs') {
    const store = new Store(required('DB_PATH'));
    console.log(JSON.stringify(store.jobs(), null, 2)); store.close(); return;
  }
  const rpc = await connection();
  if (command === 'init') {
    const program = new PublicKey(required('PROGRAM_ID'));
    const admin = keypair('ADMIN_KEYPAIR'), guardian = keypair('BOT_KEYPAIR'), withdrawer = keypair('WITHDRAWER_KEYPAIR');
    const seed = randomBytes(32);
    const vault = vaultAddress(program, admin.publicKey, seed);
    await success(await send(rpc, admin, [
      initializeIx(program, admin.publicKey, withdrawer.publicKey, guardian.publicKey, seed),
      SystemProgram.transfer({ fromPubkey: admin.publicKey, toPubkey: vault, lamports: amount() }),
    ], [guardian]));
    console.log('VAULT=' + vault.toBase58()); return;
  }
  const { program, vault } = ids();
  if (command === 'state') {
    console.log(JSON.stringify(publicState(await readVault(rpc, program, vault)), null, 2)); return;
  }
  if (command === 'wait-paused') {
    await waitForPaused(rpc, program, vault);
    console.log(JSON.stringify({ event: 'paused-observed', vault: vault.toBase58(), at: new Date().toISOString() })); return;
  }
  if (command === 'approved-change' || command === 'attack-change') {
    const admin = keypair('ADMIN_KEYPAIR');
    const target = command === 'attack-change' ? keypair('ATTACKER_KEYPAIR').publicKey : new PublicKey(argument);
    const store = command === 'approved-change' ? new Store(required('DB_PATH')) : undefined;
    try {
      await success(await send(rpc, admin, [actionIx(program, vault, admin.publicKey, 1, target.toBuffer())], [],
        store ? signature => store.approve(signature) : undefined));
    } finally { store?.close(); }
    return;
  }
  if (command === 'withdraw' || command === 'donate') {
    const actor = keypair(command === 'donate' ? 'ADMIN_KEYPAIR' : 'WITHDRAWER_KEYPAIR');
    const ix = command === 'donate'
      ? SystemProgram.transfer({ fromPubkey: actor.publicKey, toPubkey: vault, lamports: amount() })
      : actionIx(program, vault, actor.publicKey, 2, amountBytes(amount()));
    await success(await send(rpc, actor, [ix])); return;
  }
  if (['drain', 'attack-atomic', 'expect-paused'].includes(command)) {
    const attacker = keypair('ATTACKER_KEYPAIR');
    const before = await readVault(rpc, program, vault);
    const rent = await rpc.getMinimumBalanceForRentExemption(LEN);
    const spendable = before.lamports - rent;
    if (spendable <= 0) throw new Error('Vault has no spendable funds');
    const instructions = [actionIx(program, vault, attacker.publicKey, 2, amountBytes(spendable))];
    let payer = attacker, signers = [];
    if (command === 'attack-atomic') {
      payer = keypair('ADMIN_KEYPAIR'); signers = [attacker];
      instructions.unshift(actionIx(program, vault, payer.publicKey, 1, attacker.publicKey.toBuffer()));
    }
    const result = await send(rpc, payer, instructions, signers);
    const after = await readVault(rpc, program, vault);
    console.log(JSON.stringify({ ...result, vaultBefore: before.lamports, vaultAfter: after.lamports }));
    if (command === 'expect-paused') {
      if (!before.paused || !customError(result, ERRORS.Paused) || after.lamports !== before.lamports) {
        throw new Error('Expected an on-chain Paused error and unchanged vault balance');
      }
    } else if (result.err || after.lamports !== rent) throw new Error('Expected spendable balance to be drained');
    return;
  }
  throw new Error('Commands: init LAMPORTS | state | approved-change PUBKEY | attack-change | withdraw LAMPORTS | donate LAMPORTS | drain | attack-atomic | wait-paused | expect-paused | jobs');
}
main().catch(error => {
  // RPC errors may embed an API key in their URL. Do not print their messages.
  console.error('Command failed (' + error.name + '). Check configuration, balances, and public transaction results.');
  process.exitCode = 1;
});
