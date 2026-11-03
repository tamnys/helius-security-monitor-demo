import bs58 from 'bs58';
import { PublicKey } from '@solana/web3.js';

export const ADD_COLLATERAL_ADMIN = 1;

function address(value) {
  try {
    return new PublicKey(value);
  } catch {
    return null;
  }
}

function validSignature(value) {
  if (typeof value !== 'string') return false;
  try {
    return bs58.decode(value).length === 64;
  } catch {
    return false;
  }
}

function rawInstruction(rawData, rawAccounts, program, collateral) {
  if (typeof rawData !== 'string' || !Array.isArray(rawAccounts)) return null;
  let data;
  try {
    data = bs58.decode(rawData);
  } catch {
    return null;
  }
  if (data.length !== 33 || data[0] !== ADD_COLLATERAL_ADMIN) return null;
  const accounts = rawAccounts.map(address);
  if (accounts.some((value) => value === null)) return null;
  const newAdmin = new PublicKey(data.subarray(1));
  if (!accounts[0].equals(collateral) || !accounts[1].equals(newAdmin))
    return null;
  return { newAdmin };
}

export function decodeAddAdminInstruction(instruction, program, collateral) {
  if (!address(instruction?.programId)?.equals(program)) return null;
  const raw = rawInstruction(
    instruction.rawData ?? instruction.data,
    instruction.rawAccounts,
    program,
    collateral,
  );
  if (raw) return raw;

  if (typeof instruction.instructionName !== 'string') return null;
  const normalized = instruction.instructionName
    .replaceAll('_', '')
    .toLowerCase();
  if (normalized !== 'addcollateraladmin') return null;
  const decodedAccounts = instruction.decoded?.accounts;
  if (!Array.isArray(decodedAccounts)) return null;
  const collateralAccount = decodedAccounts.find(
    (account) => account?.name === 'collateral',
  );
  const newAdmin = decodedAccounts.find(
    (account) => account?.name === 'new_admin',
  );
  if (
    !address(collateralAccount?.pubkey)?.equals(collateral) ||
    !address(newAdmin?.pubkey)
  )
    return null;
  return { newAdmin: new PublicKey(newAdmin.pubkey) };
}

export function eventFromStreamNotification(message, program, collateral) {
  if (message?.method !== 'parsedTransactionNotification') return null;
  const value = message.params?.result?.value;
  const transaction = value?.transaction;
  if (
    !validSignature(transaction?.signature) ||
    transaction.status !== 'ok' ||
    transaction.error !== null
  )
    return null;
  if (
    !Number.isSafeInteger(transaction.slot) ||
    !Array.isArray(value.instructions)
  )
    return null;
  const indexes = Array.isArray(value.matchedIndexes)
    ? value.matchedIndexes
    : value.instructions.map((_, index) => index);
  for (const index of indexes) {
    const instruction = value.instructions[index];
    const decoded = decodeAddAdminInstruction(instruction, program, collateral);
    if (!decoded) continue;
    return {
      signature: transaction.signature,
      slot: transaction.slot,
      collateral: collateral.toBase58(),
      newAdmin: decoded.newAdmin.toBase58(),
      instructionIndex: instruction.instructionIndex ?? null,
      innerInstructionIndex: instruction.innerInstructionIndex ?? null,
    };
  }
  return null;
}

function rpcInstruction(instruction, keys) {
  if (
    instruction.programId &&
    Array.isArray(instruction.accounts) &&
    typeof instruction.data === 'string'
  ) {
    return {
      instructionIndex: null,
      innerInstructionIndex: null,
      programId: new PublicKey(instruction.programId),
      rawAccounts: instruction.accounts.map((value) => new PublicKey(value)),
      rawData: instruction.data,
    };
  }
  if (!Number.isInteger(instruction.programIdIndex)) return null;
  const programId = keys[instruction.programIdIndex];
  const accounts = instruction.accounts
    .map((index) => keys[index])
    .filter(Boolean);
  if (!programId || accounts.length !== instruction.accounts.length)
    return null;
  return {
    instructionIndex: null,
    innerInstructionIndex: null,
    programId,
    rawAccounts: accounts,
    rawData: instruction.data,
  };
}

export function eventFromRpcTransaction(
  transaction,
  signature,
  program,
  collateral,
) {
  if (
    !transaction ||
    transaction.meta?.err !== null ||
    !validSignature(signature)
  )
    return null;
  const message = transaction.transaction?.message;
  if (!Array.isArray(message?.instructions)) return null;
  const keys = message.accountKeys.map((account) => account.pubkey ?? account);
  const candidates = message.instructions.map((instruction, index) => {
    const normalized = rpcInstruction(instruction, keys);
    if (normalized) normalized.instructionIndex = index;
    return normalized;
  });
  for (const inner of transaction.meta?.innerInstructions ?? []) {
    for (const instruction of inner.instructions ?? []) {
      const normalized = rpcInstruction(instruction, keys);
      if (normalized) {
        normalized.instructionIndex = inner.index;
        normalized.innerInstructionIndex =
          inner.instructions.indexOf(instruction);
      }
      candidates.push(normalized);
    }
  }
  for (const instruction of candidates.filter(Boolean)) {
    const decoded = decodeAddAdminInstruction(instruction, program, collateral);
    if (!decoded) continue;
    return {
      signature,
      slot: transaction.slot,
      collateral: collateral.toBase58(),
      newAdmin: decoded.newAdmin.toBase58(),
      instructionIndex: instruction.instructionIndex,
      innerInstructionIndex: instruction.innerInstructionIndex,
      programId: program.toBase58(),
      rawData: instruction.rawData,
      rawAccounts: instruction.rawAccounts.map((account) => account.toBase58()),
    };
  }
  return null;
}

export function eventFromParsedEvent(item, program, collateral) {
  if (item?.parserStatus !== 'OK' || item.parsed?.transactionStatus !== 'OK')
    return null;
  if (
    !validSignature(item.signature) ||
    !Number.isSafeInteger(item.parsed.slot)
  )
    return null;
  for (const instruction of item.parsed.instructions ?? []) {
    const decoded = decodeAddAdminInstruction(instruction, program, collateral);
    if (!decoded) continue;
    return {
      signature: item.signature,
      slot: item.parsed.slot,
      collateral: collateral.toBase58(),
      newAdmin: decoded.newAdmin.toBase58(),
      instructionIndex: instruction.instructionIndex ?? null,
      innerInstructionIndex: instruction.innerInstructionIndex ?? null,
    };
  }
  return null;
}
