# Optional Sender Max integration

The devnet walkthrough submits pauses through RPC. The bot also includes a
mainnet-only
[Helius Sender Max](https://www.helius.dev/docs/sending-transactions/sender-max)
transport; this does not make the educational vault a production-ready program.

For an independently configured mainnet deployment, the bot requires a mainnet
`RPC_URL` and these explicit settings:

```sh
ALLOW_MAINNET=1
SENDER_ENABLED=1
SENDER_URL=https://sender.helius-rpc.com/fast
```

The demo CLI always rejects mainnet. The bot checks the RPC genesis hash and
rejects Sender on devnet.

The pause transaction contains a compute budget, priority fee, guardian pause,
and Sender tip. `.env.example` provides the existing fee settings:

| Variable                        | Setting                                             |
| ------------------------------- | --------------------------------------------------- |
| `SENDER_TIP_LAMPORTS`           | `1000000` lamports, the enforced Sender Max minimum |
| `SENDER_PRIORITY_MICROLAMPORTS` | `200000` micro-lamports per compute unit            |

Fund the guardian for the tip, priority fee, and transaction fee. The global
HTTPS endpoint avoids sending credentials over plaintext. If selecting a
regional HTTP endpoint, keep its URL keyless.

The bot warms the connection during idle periods. If Sender rejects a submission
or the HTTP request fails, it submits the **same signed bytes** through RPC. An
uncertain outcome remains pending and is reconciled against vault state. Sender
improves routing options but does not guarantee inclusion or that a pause beats
the attacker's next transaction.
