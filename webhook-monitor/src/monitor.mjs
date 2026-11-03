import bs58 from 'bs58';
import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { actionIx, readVault, send, sendViaSender } from './client.mjs';

export function signaturesFromRaw(payload) {
  if (!Array.isArray(payload) || payload.length === 0) throw new Error('Expected raw webhook transaction array');
  return [...new Set(payload.map(item => {
    const signature = item?.transaction?.signatures?.[0];
    if (typeof signature !== 'string' || bs58.decode(signature).length !== 64) throw new Error('Invalid transaction signature');
    return signature;
  }))];
}

export function adminChange(tx, program, vault, admin) {
  if (!tx?.meta || tx.meta.err !== null) return false;
  const message = tx.transaction.message;
  if (!message.accountKeys.some(k => k.pubkey.equals(admin) && k.signer)) return false;
  return message.instructions.some(ix => {
    if (!ix.programId.equals(program) || !Array.isArray(ix.accounts) || ix.accounts.length !== 2 || typeof ix.data !== 'string') return false;
    const data = bs58.decode(ix.data);
    return data.length === 33 && data[0] === 1 && ix.accounts[0].equals(vault) && ix.accounts[1].equals(admin);
  });
}

export class Monitor {
  constructor({ rpc, program, vault, guardian, store, sender = null, log = console.log }) {
    Object.assign(this, { rpc, program, vault, guardian, store, sender, log });
    this.running = false;
  }
  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      for (const job of this.store.pending()) {
        try {
          const tx = await this.rpc.getParsedTransaction(job.signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
          if (!tx) continue; // RPC lag is unresolved, and survives restart.
          const state = await readVault(this.rpc, this.program, this.vault);
          if (!state.guardian.equals(this.guardian.publicKey)) throw new Error('Wrong guardian');
          if (!adminChange(tx, this.program, this.vault, state.admin)) {
            this.store.complete(job.signature, 'irrelevant-or-failed'); continue;
          }
          if (this.store.approved(job.signature)) {
            this.store.complete(job.signature, 'approved'); continue;
          }
          if (!state.paused) {
            const instructions = [actionIx(this.program, this.vault, this.guardian.publicKey, 3)];
            const pause = this.sender
              ? await sendViaSender(this.rpc, this.guardian, instructions, { sender: this.sender })
              : await send(this.rpc, this.guardian, instructions);
            this.log(JSON.stringify({ event: 'pause-confirmed', trigger: job.signature, ...pause, at: new Date().toISOString() }));
            if (pause.err) throw new Error('Pause transaction failed');
          }
          const after = await readVault(this.rpc, this.program, this.vault);
          if (!after.paused) throw new Error('Pause not observed');
          this.store.complete(job.signature, 'paused');
        } catch {
          // Never log RPC exception messages: they can contain URLs with API keys.
          this.log(JSON.stringify({ event: 'job-pending', signature: job.signature, at: new Date().toISOString() }));
        }
      }
    } finally { this.running = false; }
  }
}

export function receiver({ secret, store, wake = () => {}, log = console.log }) {
  if (!secret) throw new Error('WEBHOOK_AUTH is required');
  const expected = Buffer.from(secret);
  return createServer(async (req, res) => {
    if (req.method !== 'POST' || req.url !== '/webhook') { res.writeHead(404).end(); return; }
    const supplied = Buffer.from(req.headers.authorization ?? '');
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      res.writeHead(403).end(); req.resume(); return;
    }
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const signatures = signaturesFromRaw(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      store.enqueue(signatures); // Durable before ACK; duplicate signatures are harmless.
      log(JSON.stringify({ event: 'received', signatures, at: new Date().toISOString() }));
      res.writeHead(200).end();
      setImmediate(wake);
    } catch {
      res.writeHead(400).end();
    }
  });
}
