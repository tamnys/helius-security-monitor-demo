import { eventFromStreamNotification } from './decoder.mjs';
import { connection, ids, keypair, readCollateral, required } from './client.mjs';
import { GuardianMonitor } from './monitor.mjs';
import { ParsedEventsRecovery, RpcRecovery } from './recovery.mjs';
import { Store } from './store.mjs';
import { collateralStreamFilter, ParsedStreamsClient } from './stream.mjs';
import { credentialedUrl } from './url.mjs';

async function main() {
  const mode = required('STREAM_MODE');
  if (!['fixture', 'parsed'].includes(mode)) throw new Error('STREAM_MODE must be fixture or parsed');
  const rpc = await connection({ allowMainnet: mode === 'parsed' });
  if (mode === 'fixture' && rpc.network !== 'devnet' && rpc.network !== 'localnet') {
    throw new Error('Fixture mode requires devnet or localnet');
  }
  if (mode === 'parsed' && rpc.network !== 'mainnet') {
    throw new Error('Parsed Streams mode requires mainnet');
  }
  const { program, collateral } = ids();
  const guardian = keypair('BOT_KEYPAIR');
  const state = await readCollateral(rpc, program, collateral);
  if (!state.guardian.equals(guardian.publicKey)) throw new Error('BOT_KEYPAIR is not this collateral guardian');

  let streamUrl;
  let recovery;
  if (mode === 'parsed') {
    const apiKey = required('HELIUS_API_KEY');
    streamUrl = credentialedUrl(process.env.STREAM_URL ?? 'wss://beta.helius-rpc.com/', apiKey);
    recovery = new ParsedEventsRecovery({
      rpc, program, collateral,
      endpoint: required('PARSED_EVENTS_URL'), apiKey,
    });
  } else {
    streamUrl = required('STREAM_URL');
    recovery = new RpcRecovery({ rpc, program, collateral });
  }

  const store = new Store(required('DB_PATH'));
  const monitor = new GuardianMonitor({ rpc, program, collateral, guardian, store });

  async function reconcile() {
    const latest = await recovery.latestSlot();
    const last = store.lastReconciledSlot();
    const from = last === null ? 0 : last + 1;
    const events = from > latest ? [] : await recovery.eventsBetween(from, latest);
    store.enqueue(events);
    store.setLastReconciledSlot(Math.max(latest, last ?? 0));
    if (events.length) console.log(JSON.stringify({ event: 'recovery-events', count: events.length, throughSlot: latest }));
    await monitor.tick();
  }

  const client = new ParsedStreamsClient({
    url: streamUrl,
    filter: collateralStreamFilter(program, collateral),
    reconcile,
    mapNotification: message => eventFromStreamNotification(message, program, collateral),
    onEvent: event => monitor.accept(event),
  });

  console.log(JSON.stringify({
    event: 'listening', mode, network: rpc.network, collateral: collateral.toBase58(),
    program: program.toBase58(),
  }));
  client.start();
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
    client.stop();
    store.close();
    process.exit(0);
  });
}

main().catch(() => {
  console.error('Bot startup failed. Check the network, external configuration, and guardian account.');
  process.exitCode = 1;
});
