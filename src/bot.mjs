import { connection, ids, keypair, required, pollMs, readVault } from './client.mjs';
import { Store } from './store.mjs';
import { Monitor, receiver } from './monitor.mjs';

async function main() {
const rpc = await connection();
const { program, vault } = ids();
const guardian = keypair('BOT_KEYPAIR');
const state = await readVault(rpc, program, vault);
if (!state.guardian.equals(guardian.publicKey)) throw new Error('BOT_KEYPAIR is not this vault guardian');
const interval = pollMs();
const port = Number(required('PORT'));
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be a TCP port');
const store = new Store(required('DB_PATH'));
const monitor = new Monitor({ rpc, program, vault, guardian, store });
const server = receiver({ secret: required('WEBHOOK_AUTH'), store, wake: () => void monitor.tick() });
const timer = setInterval(() => void monitor.tick(), interval);
server.listen(port, '0.0.0.0', () => {
  console.log(JSON.stringify({ event: 'listening', port, vault: vault.toBase58() }));
  void monitor.tick();
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  clearInterval(timer);
  server.close(() => process.exit(0));
});

}
main().catch(() => {
  console.error("Bot startup failed. Check the network, external configuration, and guardian account.");
  process.exitCode = 1;
});
