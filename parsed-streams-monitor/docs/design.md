# Parsed Streams guardian design

This project models a bug class from the Rain incident: a program accepts an
attacker-controlled key as a customer collateral admin without proving that an
existing admin authorized the change. The attacker can then use the ordinary
withdrawal path. The demo catches the insertion before a separate withdrawal and
freezes only that customer's account.

It deliberately differs from the webhook project. Webhooks handle infrequent,
consequential account activity through authenticated HTTP callbacks. Parsed
Streams handles instruction-level activity through a long-lived WebSocket whose
delivery is at most once, so the client owns reconnect and historical recovery.

## On-chain state

The collateral account contains:

- A version and one-way frozen flag
- The PDA bump and seed
- The fixed guardian address
- One to four authorized admin addresses

The PDA seed includes the initial customer/admin address, preventing account
substitution. The guardian cannot be replaced by an admin. There is no unfreeze
or guardian-rotation instruction.

## Intentionally vulnerable instruction

`add_collateral_admin` appends a proposed admin without checking that an
existing admin signed. The proposed key must not already be present, cannot be
the guardian, and must fit the four-admin limit. This is the exploit being
monitored, not a production authorization design.

`withdraw_collateral` accepts any stored admin while active and preserves the
account's rent reserve. `freeze_customer` accepts only the fixed guardian and is
idempotent.

## Parsed Streams subscription

The filter combines the collateral program and the customer account. Helius
filters on the server before sending the full matching transaction. Failed
transactions are excluded, and CPI instructions remain eligible.

The custom demo program is not in Helius's IDL catalog, so the instruction is
delivered as raw bytes and accounts. The local decoder verifies:

- The notification is a confirmed successful transaction.
- The instruction program matches the deployed collateral program.
- Raw tag `1` is `AddCollateralAdmin`.
- Account zero is the watched collateral PDA.
- Account one and the 32-byte argument identify the same proposed admin.

Catalog-supported programs receive named instruction and account fields from
Parsed Streams. The local decoder also accepts that shape when available.

## Authorization registry

The registry stores exact transaction signatures. A legitimate operator creates,
signs, and registers the complete transaction before broadcast. The signature
commits to every account, instruction, argument, and blockhash. The monitor never
treats an admin signature alone as authorization.

Each event is persisted before work begins. Duplicate stream deliveries and
recovered transactions share the same signature key, so they cannot create a
second freeze job.

## Automatic response

For an unapproved insertion, the monitor:

1. Creates and logs a durable `unauthorized-admin-alert`.
2. Signs `freeze_customer` with the guardian key.
3. Submits and confirms the transaction through RPC.
4. Reads authoritative account state.
5. Records `frozen` only after the account is frozen.

If a previous attempt landed but confirmation was uncertain, the next run sees
the frozen account and records `already-frozen` without submitting another
freeze. Alert creation is idempotent by trigger signature.

## Reconnect and recovery

The monitor keeps a durable `last_reconciled_slot`. On every connection it sends
`parsedTransactionSubscribe` before reconciling. Live notifications that arrive
during recovery are buffered, preventing a gap between the subscription and the
historical scan.

The reconciliation steps are:

1. Read the current confirmed slot.
2. Query transactions in `last_reconciled_slot + 1 .. current`.
3. Localize and persist matching admin insertions.
4. Atomically deduplicate with existing jobs.
5. Persist the reconciled slot.
6. Process pending jobs and buffered notifications.

Devnet uses `getSignaturesForAddress` with pagination and `getParsedTransaction`.
The mainnet adapter uses the paginated Parsed Events transaction-history endpoint
with explicit slot bounds. If either recovery source is incomplete, the client
closes the subscription and retries with exponential backoff rather than
pretending the gap is closed.

Connections use a 1-second to 30-second exponential backoff and a 60-second idle
watchdog based on Helius's documented close behavior.

## Failure boundaries

- Detection happens after confirmation. A separate second transaction provides
  a response window, but any second transaction can also outrun the response.
- An insertion and withdrawal in the same transaction succeed atomically before
  Parsed Streams sees the event.
- Stream or recovery downtime creates a gap. Recovery helps after reconnect but
  cannot reverse withdrawals completed during the gap.
- The guardian can cause denial of service. A mistaken approval record or
  decoder error causes a false freeze.
- The deployment authority can replace the program and bypass the fix.
- A production system needs guardian rotation, recovery governance, monitoring
  of the monitor, and external alert delivery.

## References

- [Helius Parsed Streams](https://www.helius.dev/docs/parsed-streams)
- [Parsed Streams reconnect guide](https://www.helius.dev/docs/parsed-streams/guides/handling-reconnects)
- [Helius Parsed Events](https://www.helius.dev/docs/parsed-events)
- [Solana transaction atomicity](https://solana.com/docs/core/transactions)
