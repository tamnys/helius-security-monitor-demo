import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, formatResult } from '../src/cli-ui.mjs';
import { keypair, publicKey, safeMessage, UserError } from '../src/config.mjs';

const cli = fileURLToPath(new URL('../src/cli.mjs', import.meta.url));
function run(args, env = {}) {
  return spawnSync(process.execPath, [cli, ...args], { env, encoding: 'utf8' });
}
test('help and invalid arguments do not require configuration or RPC', () => {
  for (const args of [[], ['--help'], ['state', '--help']]) {
    const result = run(args);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Usage: pnpm demo/);
  }
  for (const args of [
    ['unknown'],
    ['init'],
    ['init', '0'],
    ['init', '1.5'],
    ['init', '9007199254740992'],
    ['state', 'extra'],
    ['approved-change', 'invalid'],
  ]) {
    const result = run(args);
    assert.equal(result.status, 1);
    assert.doesNotMatch(result.stderr, /RPC_URL|fetch failed/);
  }
});
test('known configuration errors are actionable and unknown errors are redacted', () => {
  const result = run(['state']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Set RPC_URL/);
  const secret = 'do-not-log-this-credential';
  assert.doesNotMatch(
    safeMessage(
      new Error(`RPC failed: https://rpc.example/?api-key=${secret}`),
    ),
    new RegExp(secret),
  );
  assert.match(safeMessage(new UserError('Set RPC_URL')), /Set RPC_URL/);
  process.env.TEST_PUBLIC_KEY = secret;
  process.env.TEST_KEYPAIR = '/missing/' + secret;
  try {
    assert.throws(
      () => publicKey('TEST_PUBLIC_KEY'),
      (error) => error instanceof UserError && !error.message.includes(secret),
    );
    assert.throws(
      () => keypair('TEST_KEYPAIR'),
      (error) => error instanceof UserError && !error.message.includes(secret),
    );
  } finally {
    delete process.env.TEST_PUBLIC_KEY;
    delete process.env.TEST_KEYPAIR;
  }
});
test('malformed key files do not leak file contents', () => {
  const dir = mkdtempSync(join(tmpdir(), 'helius-config-'));
  process.env.TEST_KEYPAIR = join(dir, 'invalid.json');
  writeFileSync(process.env.TEST_KEYPAIR, 'do-not-log-file-contents');
  try {
    assert.throws(
      () => keypair('TEST_KEYPAIR'),
      (error) =>
        error instanceof UserError &&
        /TEST_KEYPAIR/.test(error.message) &&
        !error.message.includes('do-not-log'),
    );
  } finally {
    delete process.env.TEST_KEYPAIR;
    rmSync(dir, { recursive: true });
  }
});
test('JSON results retain public fields and readable results include the transaction link', () => {
  const result = {
    signature: 'public-signature',
    slot: 123,
    err: null,
    vault: 'public-account',
  };
  assert.deepEqual(JSON.parse(formatResult('init', result, true)), result);
  assert.match(
    formatResult('init', result),
    /https:\/\/explorer.solana.com\/tx\/public-signature\?cluster=devnet/,
  );
  assert.match(formatResult('init', result), /export VAULT=public-account/);
  assert.equal(parseArgs(['init', '1', '--json']).json, true);
});
test('jobs can be read without RPC and --json emits a single JSON value', () => {
  const dir = mkdtempSync(join(tmpdir(), 'helius-cli-'));
  try {
    const result = run(['jobs', '--json'], {
      DB_PATH: join(dir, 'monitor.sqlite'),
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), []);
    assert.match(
      run(['jobs'], { DB_PATH: join(dir, 'monitor.sqlite') }).stdout,
      /No jobs recorded/,
    );
  } finally {
    rmSync(dir, { recursive: true });
  }
});
