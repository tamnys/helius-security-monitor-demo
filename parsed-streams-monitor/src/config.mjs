import { readFileSync, realpathSync } from 'node:fs';
import { dirname, relative, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DEVNET_GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
export const MAINNET_GENESIS = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';

// Only messages constructed locally are safe to print. RPC errors can contain API keys.
export class UserError extends Error {}
export function safeMessage(error) {
  return error instanceof UserError
    ? error.message
    : 'Request failed. Check RPC connectivity, account balances, and the transaction in Solana Explorer.';
}
export function required(name) {
  const value = process.env[name];
  if (!value)
    throw new UserError(
      `Set ${name} in your external environment file and load it into this terminal.`,
    );
  return value;
}
export function publicKey(name) {
  const value = required(name);
  try {
    return new PublicKey(value);
  } catch {
    throw new UserError(`${name} must be a valid Solana public key.`);
  }
}
export function choice(name, values, fallback) {
  const value = process.env[name] ?? fallback ?? required(name);
  if (!values.includes(value))
    throw new UserError(`${name} must be ${values.join(' or ')}.`);
  return value;
}
export function port(name) {
  const value = Number(required(name));
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new UserError(`${name} must be a TCP port between 1 and 65535.`);
  }
  return value;
}
export function keypair(name) {
  const value = required(name);
  let path;
  try {
    path = realpathSync(value);
  } catch {
    throw new UserError(
      `${name} must point to a readable external Solana keypair file.`,
    );
  }
  const rel = relative(ROOT, path);
  if (!isAbsolute(rel) && rel !== '..' && !rel.startsWith('../')) {
    throw new UserError(`${name} must point outside the demo directory.`);
  }
  try {
    return Keypair.fromSecretKey(
      Uint8Array.from(JSON.parse(readFileSync(path, 'utf8'))),
    );
  } catch {
    throw new UserError(
      `${name} must point to a readable, valid Solana keypair JSON file.`,
    );
  }
}
export async function connection({ allowMainnet = false } = {}) {
  const value = required('RPC_URL');
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new UserError('RPC_URL must be an HTTP or HTTPS URL.');
  }
  if (!['http:', 'https:'].includes(url.protocol))
    throw new UserError('RPC_URL must be an HTTP or HTTPS URL.');
  const rpc = new Connection(value, 'confirmed');
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  const genesis = await rpc.getGenesisHash();
  const network =
    genesis === DEVNET_GENESIS
      ? 'devnet'
      : genesis === MAINNET_GENESIS
        ? 'mainnet'
        : local && process.env.ALLOW_LOCALNET === '1'
          ? 'localnet'
          : null;
  if (!network || (network === 'mainnet' && !allowMainnet)) {
    throw new UserError(
      'Only Solana devnet or explicitly enabled loopback localnet is allowed, unless mainnet is explicitly enabled. Check RPC_URL.',
    );
  }
  Object.defineProperties(rpc, {
    genesisHash: { value: genesis, enumerable: false },
    network: { value: network, enumerable: false },
  });
  return rpc;
}
