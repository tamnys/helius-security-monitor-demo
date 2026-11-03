const TITLE = 'webhook-monitor devnet demo';
const COMMANDS = {
  init: [
    'LAMPORTS',
    'Create and fund a fresh vault',
    'Vault initialized. Save the address in every terminal.',
  ],
  state: ['', 'Read vault state', 'Vault state'],
  'approved-change': [
    'PUBKEY',
    'Register and submit an approved withdrawer change',
    'Approved withdrawer change confirmed.',
  ],
  'attack-change': [
    '',
    'Change withdrawer using the compromised admin',
    'Unapproved withdrawer change confirmed.',
  ],
  withdraw: [
    'LAMPORTS',
    'Withdraw as the initial withdrawer',
    'Withdrawal confirmed.',
  ],
  donate: [
    'LAMPORTS',
    'Deposit SOL without changing permissions',
    'Donation confirmed.',
  ],
  drain: [
    '',
    'Drain the spendable balance as the attacker',
    'Spendable balance drained.',
  ],
  'attack-atomic': [
    '',
    'Change withdrawer and drain in one transaction',
    'Atomic attack drained the spendable balance.',
  ],
  'wait-paused': [
    '',
    'Wait for a confirmed pause (Ctrl-C to stop)',
    'Vault pause observed.',
  ],
  'expect-paused': [
    '',
    'Require a rejected withdrawal and unchanged funds',
    '',
  ],
  jobs: ['', 'Inspect durable monitor jobs', ''],
};

import { PublicKey } from '@solana/web3.js';
import { UserError } from './config.mjs';

export function parseArgs(argv) {
  const json = argv.includes('--json');
  const args = argv.filter((value) => value !== '--json');
  if (args.length === 0 || args.includes('--help') || args.includes('-h'))
    return { help: true, json };
  const [command, argument, ...extra] = args;
  if (!Object.hasOwn(COMMANDS, command))
    throw new UserError('Unknown command. Run pnpm demo --help.');
  const [parameter] = COMMANDS[command];
  if (
    extra.length ||
    (parameter ? argument === undefined : argument !== undefined)
  ) {
    throw new UserError(
      `Usage: pnpm demo ${command}${parameter ? ' ' + parameter : ''} [--json]`,
    );
  }
  if (parameter === 'LAMPORTS') {
    if (
      !/^[1-9][0-9]*$/.test(argument) ||
      BigInt(argument) > BigInt(Number.MAX_SAFE_INTEGER)
    ) {
      throw new UserError(
        'LAMPORTS must be a positive integer within the exact RPC integer range.',
      );
    }
  }
  if (parameter === 'PUBKEY') {
    try {
      new PublicKey(argument);
    } catch {
      throw new UserError('PUBKEY must be a valid Solana public key.');
    }
  }
  return { command, argument, json };
}

export function help() {
  return [
    TITLE,
    '',
    'Usage: pnpm demo <command> [argument] [--json]',
    '',
    ...Object.entries(COMMANDS).map(
      ([name, [parameter, description]]) =>
        `  ${(name + (parameter ? ' ' + parameter : '')).padEnd(32)} ${description}`,
    ),
    '',
    'Options: --help, -h   Show help without connecting to RPC',
    '         --json       Print machine-readable results',
    '',
    'Load your external environment file before running commands. See README.md.',
  ].join('\n');
}

function valueText(value) {
  if (value === null) return 'none';
  if (Array.isArray(value)) return value.map(valueText).join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
export function formatResult(command, result, json = false) {
  if (json) return JSON.stringify(result, null, 2);
  if (Array.isArray(result)) {
    if (!result.length) return `No ${command} recorded.`;
    return result
      .map((row) =>
        Object.entries(row)
          .map(([key, value]) => `${key}: ${valueText(value)}`)
          .join('\n'),
      )
      .join('\n\n');
  }
  const expectedRejection = command.startsWith('expect-');
  const lines = [
    expectedRejection
      ? 'Withdrawal rejected as expected. Account balance is unchanged.'
      : COMMANDS[command][2],
  ];
  if (result.signature)
    lines.push(
      `Transaction: https://explorer.solana.com/tx/${result.signature}?cluster=devnet`,
    );
  for (const [key, value] of Object.entries(result)) {
    if (key === 'signature' || (key === 'err' && value === null)) continue;
    if (command === 'init' && (key === 'vault' || key === 'collateral')) {
      lines.push(`export ${key.toUpperCase()}=${value}`);
    } else lines.push(`${key}: ${valueText(value)}`);
  }
  return lines.join('\n');
}
