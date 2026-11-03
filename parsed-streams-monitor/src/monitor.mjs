import { freezeIx, readCollateral, send } from './client.mjs';

export class GuardianMonitor {
  constructor({
    rpc,
    program,
    collateral,
    guardian,
    store,
    log = console.log,
  }) {
    Object.assign(this, { rpc, program, collateral, guardian, store, log });
    this.tail = Promise.resolve();
  }

  async accept(event) {
    this.store.enqueue([event]);
    await this.tick();
  }

  async tick() {
    const run = this.tail.then(() => this.process());
    this.tail = run.catch(() => {});
    return run;
  }

  async process() {
    for (const job of this.store.pending(this.collateral.toBase58())) {
      try {
        if (this.store.approved(job.signature)) {
          this.store.complete(job.signature, 'approved');
          continue;
        }
        const state = await readCollateral(
          this.rpc,
          this.program,
          this.collateral,
        );
        if (!state.guardian.equals(this.guardian.publicKey))
          throw new Error('Wrong guardian');
        if (state.frozen) {
          this.store.alert(
            job.signature,
            job.collateral,
            job.new_admin,
            'frozen',
          );
          this.store.complete(job.signature, 'already-frozen');
          continue;
        }
        const alert = {
          event: 'unauthorized-admin-alert',
          signature: job.signature,
          slot: job.slot,
          collateral: job.collateral,
          newAdmin: job.new_admin,
          at: new Date().toISOString(),
        };
        this.store.alert(
          job.signature,
          job.collateral,
          job.new_admin,
          'pending',
        );
        this.log(JSON.stringify(alert));
        const freeze = await send(this.rpc, this.guardian, [
          freezeIx(this.program, this.collateral, this.guardian.publicKey),
        ]);
        this.log(
          JSON.stringify({
            event: 'freeze-confirmed',
            trigger: job.signature,
            ...freeze,
            at: new Date().toISOString(),
          }),
        );
        if (freeze.err) throw new Error('Freeze transaction failed');
        const after = await readCollateral(
          this.rpc,
          this.program,
          this.collateral,
        );
        if (!after.frozen) throw new Error('Freeze not observed');
        this.store.alert(
          job.signature,
          job.collateral,
          job.new_admin,
          'frozen',
        );
        this.store.complete(job.signature, 'frozen');
      } catch {
        this.log(
          JSON.stringify({
            event: 'job-pending',
            signature: job.signature,
            at: new Date().toISOString(),
          }),
        );
      }
    }
  }
}
