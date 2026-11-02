import { connection, ids, keypair, required, readVault, senderConfig, warmSender } from './client.mjs';
import { Store } from './store.mjs';
import { Monitor, receiver } from './monitor.mjs';

async function main() {
const senderEnabled = process.env.SENDER_ENABLED === '1';
if (process.env.SENDER_ENABLED !== undefined && !['0', '1'].includes(process.env.SENDER_ENABLED)) {
  throw new Error('SENDER_ENABLED must be 0 or 1');
}
const allowMainnet = senderEnabled && process.env.ALLOW_MAINNET === '1';
const rpc = await connection({ allowMainnet });
const { program, vault } = ids();
const guardian = keypair('BOT_KEYPAIR');
const state = await readVault(rpc, program, vault);
if (!state.guardian.equals(guardian.publicKey)) throw new Error('BOT_KEYPAIR is not this vault guardian');
const sender = senderEnabled ? senderConfig({
  network: rpc.network,
  url: required('SENDER_URL'),
  tipLamports: Number(process.env.SENDER_TIP_LAMPORTS ?? 1_000_000),
  priorityFeeMicroLamports: Number(process.env.SENDER_PRIORITY_MICROLAMPORTS ?? 200_000),
}) : null;
const port = Number(required('PORT'));
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be a TCP port');
const store = new Store(required('DB_PATH'));
const monitor = new Monitor({ rpc, program, vault, guardian, store, sender });
const server = receiver({ secret: required('WEBHOOK_AUTH'), store, wake: () => void monitor.tick() });
const slots = rpc.onSlotChange(() => void monitor.tick());
const warmup = sender ? setInterval(() => void warmSender(sender), 5_000) : null;
warmup?.unref();
if (sender) void warmSender(sender);
server.listen(port, '0.0.0.0', () => {
  console.log(JSON.stringify({ event: 'listening', port, network: rpc.network, submission: sender ? 'sender-max' : 'rpc', vault: vault.toBase58() }));
  void monitor.tick();
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  if (warmup) clearInterval(warmup);
  void rpc.removeSlotChangeListener(slots);
  server.close(() => process.exit(0));
});

}
main().catch(() => {
  console.error("Bot startup failed. Check the network, external configuration, and guardian account.");
  process.exitCode = 1;
});
