# Live devnet Parsed Streams proof

This page records the public devnet transactions from the completed
Rain-inspired containment run. All amounts are devnet SOL or lamports and have
no real value.

## Deployment

| Item | Value |
| --- | --- |
| Network | Solana devnet |
| Program | `CKEZ6GAHPwsqjqh78GASC6mHkHFhefr7jnWnyPHeujPx` |
| Program data | `93bbaFvTA3oLiHoNEdHaax3VXD2u38SC7dxoeLhu8iDY` |
| Upgrade authority | `FjHRfaFFiVMtcNEQ24JXUyydKueGKxtBvB73vnY1oxof` |
| Deployment signature | `5u43ccqrDGf7Wx1rSE7VJhQkA8ApHUsFkKjkhUbadefpzKbjG3CdvnbxjQQmcpmQx4exfVYKVyyb36ERMoodzFRx` |
| Deployment slot / UTC block time | `518026834` / `2026-11-02T23:54:41Z` |
| Artifact size | `76,824` bytes |
| Artifact SHA-256 | `cda1b828b5fcc75aab6b054834273ce321b2744a1333f08cc164a0870521b546` |

The deployment authority is separate from the customer and fixed guardian.

## Clean containment run

| Step | Public signature | Slot / UTC block time |
| --- | --- | --- |
| Initialize clean victim `AjZBAr1NWNXoEWcLMXr8tSjRG6TLpAidK61WBqAF8Aeb` | `3j1g5GLpyATTLs63jBDBGTaucsPqMs44KYoU9Keq2be3RfmjVZD1AVP9apfxqK3MGLYohE8gLaWvCh8C7uux5cGn` | `518029687` / `2026-11-03T00:06:03Z` |
| Approved admin insertion | `2Vnj7pX4VQMcWkXyHf6eoGrKMZm5DERnPuyNXFqdAVjDAA1gVL1EDiEbUErgdkKH24VZAqQs3RzUPikrtwtE2Dsp` | `518029728` / `2026-11-03T00:06:13Z` |
| Unauthorized attacker insertion while fixture offline | `4H4quLuNXTJeH1Naz3U9tRVXfQowjuESxiYYxpJ4b34GGap4qScXpDW61D5zAorNjvZLtN41Bfe7ZzArAUyYpkR2` | `518029921` / `2026-11-03T00:06:59Z` |
| Guardian freeze after reconnect recovery | `4hLF7rVaWrQJjyoxHM8Njdniu66SBcsfsJBnnMAwkJ4DPnSwB7KupY8YuLUUtqg1r2BMTMXiVhwJwccb5pzMgWnG` | `518030003` / `2026-11-03T00:07:18Z` |
| Attacker post-freeze withdrawal | `2TPfbP5Ri4w1NpF4NWBxaNeS6RmvUpPb5iXyU1SH4UAgzuV9ReEdGZKKZFoc9Z76EcJP8tMAZ2yqk8Vi3yJc6qtX` | `518030067` / `2026-11-03T00:07:34Z` |

The approved insertion completed with outcome `approved` and did not freeze
the account. Its exact transaction signature was registered before broadcast.

The attacker insertion occurred after the fixture process was stopped. The
guardian continued reconnecting with delays of 1, 2, 4, 8, and 16 seconds.
After the fixture restarted, the bot resubscribed, recovered the event from the
saved slot window, and emitted `unauthorized-admin-alert` at
`2026-11-03T00:07:18.506Z`. The freeze transaction confirmed at
`2026-11-03T00:07:19.419Z`. These local timestamps describe this run and are not
a delivery guarantee.

The post-freeze withdrawal returned `InstructionError: [0, {"Custom": 0}]`,
which is the program's `Frozen` error. The victim collateral balance was
`21,645,920` lamports before the attempted withdrawal and remained
`21,645,920` lamports afterward.

## Account isolation

A separate control account, `Eh5czpyW1fuvSxzVdUcDqKH7hKQ2nfsxTe6k5GXUJEcW`,
belongs to a different customer and has its own fixed guardian. Withdrawing
`1,000,000` lamports succeeded after the victim account was frozen:

`3DmSYFzuzna1femumYDg1opTYAoWUevTYpxWYJ8weFYvC8Cd1AskW5Z6hcryrrBjNaoviBMDpkFcEiSUGpCRMezr`

The control account remained unfrozen at `10,645,920` lamports after that
withdrawal. Its pre-withdrawal balance was `11,645,920` lamports.

## Atomicity limit

Fresh account `DaD69JZGkdVEepyXHY1wAV54D2BRZVpzAJbuFaGUtLk1` received the
unauthorized admin insertion and withdrawal in one transaction:

`4XyEU9Yg1dw4R6SEStY5X8KpbuS8s39ySmwgrS9KBbp1XsrRmyuxmvpK29wBG8Dj62eXwBbcW1Gne7HpSJUks5QT`

It drained `10,000,000` spendable lamports, leaving `1,645,920` lamports of
rent. The transaction confirmed at slot `518029446` before Parsed Streams could
observe the insertion. A monitor cannot interpose an instruction between two
instructions in the same confirmed transaction.

## Real service smoke test

The devnet run used the local protocol fixture because the documented Parsed
Streams and Parsed Events endpoints are mainnet services. The separate
read-only smoke command was not executed for this proof because
`HELIUS_API_KEY` was not present in the external environment. The command
tests `describeProgram` and a live Jupiter Parsed Streams subscription when the
key is supplied.
