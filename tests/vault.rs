use failsafe_vault::{
    process_instruction, ADMIN_CPI_FORBIDDEN, INVALID_AUTHORITIES, INVALID_VAULT, LEN, PAUSED,
    UNAUTHORIZED,
};
use solana_program::{account_info::AccountInfo, entrypoint::ProgramResult, program::invoke};
use solana_program_test::{processor, ProgramTest, ProgramTestContext};
use solana_sdk::{
    compute_budget::ComputeBudgetInstruction,
    instruction::{AccountMeta, Instruction, InstructionError},
    pubkey::Pubkey,
    signature::{Keypair, Signer},
    system_instruction, system_program,
    transaction::{Transaction, TransactionError},
};

const FORWARDER: Pubkey = Pubkey::new_from_array([42; 32]);

fn forward(_: &Pubkey, accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    let instruction = Instruction {
        program_id: *accounts.last().unwrap().key,
        accounts: accounts[..accounts.len() - 1]
            .iter()
            .map(|account| AccountMeta {
                pubkey: *account.key,
                is_signer: account.is_signer,
                is_writable: account.is_writable,
            })
            .collect(),
        data: data.to_vec(),
    };
    invoke(&instruction, accounts)
}

struct Demo {
    ctx: ProgramTestContext,
    program: Pubkey,
    admin: Keypair,
    guardian: Keypair,
    withdrawer: Keypair,
    attacker: Keypair,
    seed: [u8; 32],
    vault: Pubkey,
    sequence: u64,
}

impl Demo {
    async fn new() -> Self {
        let program = Pubkey::new_unique();
        let mut test = ProgramTest::new("failsafe_vault", program, processor!(process_instruction));
        test.prefer_bpf(false);
        test.add_program("forwarder", FORWARDER, processor!(forward));
        let ctx = test.start_with_context().await;
        let admin = Keypair::new();
        let seed = Pubkey::new_unique().to_bytes();
        let vault =
            Pubkey::find_program_address(&[b"vault", admin.pubkey().as_ref(), &seed], &program).0;
        let mut demo = Self {
            ctx,
            program,
            admin,
            guardian: Keypair::new(),
            withdrawer: Keypair::new(),
            attacker: Keypair::new(),
            seed,
            vault,
            sequence: 0,
        };
        let fund = system_instruction::transfer(
            &demo.ctx.payer.pubkey(),
            &demo.admin.pubkey(),
            100_000_000,
        );
        demo.submit(vec![fund], &[]).await.unwrap();
        for actor in [
            demo.withdrawer.pubkey(),
            demo.guardian.pubkey(),
            demo.attacker.pubkey(),
        ] {
            let fund = system_instruction::transfer(&demo.ctx.payer.pubkey(), &actor, 10_000_000);
            demo.submit(vec![fund], &[]).await.unwrap();
        }
        let init = demo.init();
        let admin = demo.admin.insecure_clone();
        let guardian = demo.guardian.insecure_clone();
        demo.submit(vec![init], &[&admin, &guardian]).await.unwrap();
        let fund = system_instruction::transfer(&demo.ctx.payer.pubkey(), &demo.vault, 10_000_000);
        demo.submit(vec![fund], &[]).await.unwrap();
        demo
    }

    fn init(&self) -> Instruction {
        Instruction {
            program_id: self.program,
            accounts: vec![
                AccountMeta::new(self.admin.pubkey(), true),
                AccountMeta::new(self.vault, false),
                AccountMeta::new_readonly(self.withdrawer.pubkey(), false),
                AccountMeta::new_readonly(self.guardian.pubkey(), true),
                AccountMeta::new_readonly(system_program::id(), false),
            ],
            data: [vec![0], self.seed.to_vec()].concat(),
        }
    }

    fn action(&self, actor: Pubkey, tag: u8, args: &[u8]) -> Instruction {
        Instruction {
            program_id: self.program,
            accounts: vec![
                AccountMeta::new(self.vault, false),
                AccountMeta {
                    pubkey: actor,
                    is_signer: true,
                    is_writable: tag == 2,
                },
            ],
            data: [vec![tag], args.to_vec()].concat(),
        }
    }

    async fn submit(
        &mut self,
        mut ixs: Vec<Instruction>,
        signers: &[&Keypair],
    ) -> Result<(), TransactionError> {
        // Unique transaction message for repeat/idempotency tests using the same blockhash.
        self.sequence += 1;
        ixs.insert(
            0,
            ComputeBudgetInstruction::set_compute_unit_price(self.sequence),
        );
        let blockhash = self.ctx.banks_client.get_latest_blockhash().await.unwrap();
        let mut all = vec![&self.ctx.payer];
        all.extend_from_slice(signers);
        let tx = Transaction::new_signed_with_payer(
            &ixs,
            Some(&self.ctx.payer.pubkey()),
            &all,
            blockhash,
        );
        self.ctx
            .banks_client
            .process_transaction(tx)
            .await
            .map_err(|error| error.unwrap())
    }

    async fn state(&mut self) -> solana_sdk::account::Account {
        self.ctx
            .banks_client
            .get_account(self.vault)
            .await
            .unwrap()
            .unwrap()
    }
}

fn custom(result: Result<(), TransactionError>, code: u32) {
    assert_eq!(
        result,
        Err(TransactionError::InstructionError(
            1,
            InstructionError::Custom(code)
        ))
    );
}

#[tokio::test]
async fn authorities_and_one_way_containment() {
    let mut d = Demo::new().await;
    let admin = d.admin.insecure_clone();
    let guardian = d.guardian.insecure_clone();
    let withdrawer = d.withdrawer.insecure_clone();
    let attacker = d.attacker.insecure_clone();

    let ix = d.action(withdrawer.pubkey(), 2, &1000_u64.to_le_bytes());
    d.submit(vec![ix], &[&withdrawer]).await.unwrap();

    let ix = d.action(guardian.pubkey(), 2, &1000_u64.to_le_bytes());
    custom(d.submit(vec![ix], &[&guardian]).await, UNAUTHORIZED);
    let ix = d.action(guardian.pubkey(), 1, attacker.pubkey().as_ref());
    custom(d.submit(vec![ix], &[&guardian]).await, UNAUTHORIZED);
    for actor in [&admin, &attacker] {
        let ix = d.action(actor.pubkey(), 3, &[]);
        custom(d.submit(vec![ix], &[actor]).await, UNAUTHORIZED);
    }
    let mut unsigned = d.action(guardian.pubkey(), 3, &[]);
    unsigned.accounts[1].is_signer = false;
    custom(d.submit(vec![unsigned], &[]).await, UNAUTHORIZED);

    let mut via_cpi = d.action(admin.pubkey(), 1, attacker.pubkey().as_ref());
    via_cpi.program_id = FORWARDER;
    via_cpi
        .accounts
        .push(AccountMeta::new_readonly(d.program, false));
    custom(
        d.submit(vec![via_cpi], &[&admin]).await,
        ADMIN_CPI_FORBIDDEN,
    );

    let mut substitute = d.action(attacker.pubkey(), 2, &1000_u64.to_le_bytes());
    substitute.accounts[0].pubkey = admin.pubkey();
    custom(
        d.submit(vec![substitute], &[&attacker]).await,
        INVALID_VAULT,
    );

    let ix = d.action(admin.pubkey(), 1, guardian.pubkey().as_ref());
    custom(d.submit(vec![ix], &[&admin]).await, INVALID_AUTHORITIES);
    let ix = d.action(admin.pubkey(), 1, attacker.pubkey().as_ref());
    d.submit(vec![ix], &[&admin]).await.unwrap();
    let state = d.state().await;
    assert_eq!(&state.data[99..131], guardian.pubkey().as_ref());

    let ix = d.action(guardian.pubkey(), 3, &[]);
    d.submit(vec![ix.clone()], &[&guardian]).await.unwrap();
    d.submit(vec![ix], &[&guardian]).await.unwrap();
    let before = d.state().await;
    assert_eq!(before.data[1], 1);
    let ix = d.action(attacker.pubkey(), 2, &1000_u64.to_le_bytes());
    custom(d.submit(vec![ix], &[&attacker]).await, PAUSED);
    let ix = d.action(admin.pubkey(), 1, withdrawer.pubkey().as_ref());
    custom(d.submit(vec![ix], &[&admin]).await, PAUSED);
    let ix = d.init();
    custom(
        d.submit(vec![ix], &[&admin, &guardian]).await,
        INVALID_VAULT,
    );
    let after = d.state().await;
    assert_eq!(before.lamports, after.lamports);
    assert_eq!(before.data, after.data);
}

#[tokio::test]
async fn uncontained_and_atomic_attacks_drain_only_spendable_funds() {
    for atomic in [false, true] {
        let mut d = Demo::new().await;
        let admin = d.admin.insecure_clone();
        let attacker = d.attacker.insecure_clone();
        let change = d.action(admin.pubkey(), 1, attacker.pubkey().as_ref());
        let rent = d
            .ctx
            .banks_client
            .get_rent()
            .await
            .unwrap()
            .minimum_balance(LEN);
        let spendable = d.state().await.lamports - rent;
        let drain = d.action(attacker.pubkey(), 2, &spendable.to_le_bytes());
        if atomic {
            d.submit(vec![change, drain], &[&admin, &attacker])
                .await
                .unwrap();
        } else {
            d.submit(vec![change], &[&admin]).await.unwrap();
            d.submit(vec![drain], &[&attacker]).await.unwrap();
        }
        assert_eq!(d.state().await.lamports, rent);
    }
}
