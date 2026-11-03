import { eventFromParsedEvent, eventFromRpcTransaction } from './decoder.mjs';
import { credentialedUrl } from './url.mjs';

export class RpcRecovery {
  constructor({ rpc, program, collateral }) {
    Object.assign(this, { rpc, program, collateral });
  }

  latestSlot() {
    return this.rpc.getSlot('confirmed');
  }

  async eventsBetween(fromSlot, toSlot) {
    if (fromSlot > toSlot) return [];
    const selected = new Map();
    let before;
    while (true) {
      const page = await this.rpc.getSignaturesForAddress(this.collateral, {
        limit: 1_000,
        commitment: 'confirmed',
        ...(before ? { before } : {}),
      });
      if (!page.length) break;
      for (const entry of page) {
        if (entry.slot >= fromSlot && entry.slot <= toSlot)
          selected.set(entry.signature, entry.slot);
      }
      const oldest = page.at(-1);
      if (oldest.slot < fromSlot || page.length < 1_000) break;
      before = oldest.signature;
    }
    const events = [];
    for (const [signature, expectedSlot] of [...selected].sort(
      (a, b) => a[1] - b[1],
    )) {
      const transaction = await this.rpc.getParsedTransaction(signature, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0,
      });
      if (!transaction)
        throw new Error('Recovery transaction is not available yet');
      const event = eventFromRpcTransaction(
        transaction,
        signature,
        this.program,
        this.collateral,
      );
      if (event) events.push(event);
    }
    return events;
  }
}

export class ParsedEventsRecovery {
  constructor({
    rpc,
    program,
    collateral,
    endpoint,
    apiKey,
    fetchImpl = globalThis.fetch,
  }) {
    Object.assign(this, {
      rpc,
      program,
      collateral,
      endpoint,
      apiKey,
      fetchImpl,
    });
  }

  latestSlot() {
    return this.rpc.getSlot('confirmed');
  }

  async eventsBetween(fromSlot, toSlot) {
    if (fromSlot > toSlot) return [];
    const events = [];
    let paginationToken;
    while (true) {
      const response = await this.fetchImpl(
        credentialedUrl(this.endpoint, this.apiKey),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            address: this.collateral.toBase58(),
            limit: 100,
            sortOrder: 'asc',
            commitment: 'confirmed',
            status: 'succeeded',
            rawTransaction: 'none',
            slot: { gte: fromSlot, lte: toSlot },
            ...(paginationToken ? { paginationToken } : {}),
          }),
        },
      );
      if (!response.ok)
        throw new Error('Parsed Events recovery request failed');
      const page = await response.json();
      if (!Array.isArray(page.data))
        throw new Error('Parsed Events recovery returned an invalid page');
      for (const item of page.data) {
        const event = eventFromParsedEvent(item, this.program, this.collateral);
        if (event) events.push(event);
      }
      if (!page.paginationToken) break;
      if (page.paginationToken === paginationToken)
        throw new Error('Parsed Events pagination did not advance');
      paginationToken = page.paginationToken;
    }
    return events;
  }
}
