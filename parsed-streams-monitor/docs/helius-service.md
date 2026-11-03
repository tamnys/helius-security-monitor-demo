# Helius service integration

The devnet walkthrough uses `STREAM_MODE=fixture`: real devnet transactions
arrive through a local WebSocket fixture, and missed transactions are recovered
through standard RPC. The real Parsed Streams and Parsed Events integration is
separate from that walkthrough.

## Read-only smoke check

Load `HELIUS_API_KEY` from your external environment file, then run:

```sh
pnpm smoke
```

The command discovers Jupiter's `route` instruction, subscribes to it, prints a
public signature and slot, and exits. It submits no transactions and needs no
signing keys. The expected final event is `parsed-streams-smoke-passed`.

Helius currently serves `describeProgram` at `wss://fs-beta.helius-rpc.com/` and
subscriptions at `wss://beta.helius-rpc.com/`. The command uses separate
connections as required by the
[protocol reference](https://www.helius.dev/docs/parsed-streams/quickstart#discovery).
Both authenticate using the externally supplied API key, which is not logged.
`SMOKE_TIMEOUT_MS` controls how long the subscription waits for a notification.

## Mainnet adapter

The bot's `STREAM_MODE=parsed` mode requires a mainnet RPC, `HELIUS_API_KEY`,
`PARSED_EVENTS_URL`, and the configured collateral program/account. It
subscribes to the real stream and uses Parsed Events history after reconnects.
If `STREAM_URL` is omitted, it uses the documented Gatekeeper subscription
endpoint. Do not retain the fixture's localhost URL when selecting parsed mode.

This adapter demonstrates the integration path; the intentionally vulnerable
collateral program and its CLI walkthrough remain devnet-only examples.

## Delivery and recovery

Parsed Streams delivery is at most once. The client subscribes before recovering
history, buffers live notifications during recovery, persists and deduplicates
events, then advances its saved slot and processes the buffered events.

Devnet recovery uses `getSignaturesForAddress` and `getParsedTransaction`.
Mainnet recovery uses the paginated Parsed Events transaction-history endpoint.
See [the design](design.md) for decoding, authorization, and failure boundaries.
