use rain_collateral_guard::{
    process_instruction, ADMIN_LIMIT, ALREADY_ADMIN, FROZEN, INVALID_AUTHORITIES,
    INVALID_COLLATERAL, LEN, UNAUTHORIZED,
};
use solana_program_test::{processor, ProgramTest, ProgramTestContext};
use solana_sdk::{
    compute_budget::ComputeBudgetInstruction,
    instruction::{AccountMeta, Instruction, InstructionError},
    pubkey::Pubkey,
    signature::{Keypair, Signer},
    system_instruction, system_program,
    transaction::{Transaction, TransactionError},
};

fn collateral_address(program: &Pubkey, customer: &Pubkey, seed: &[u8; 32]) -> Pubkey {
    Pubkey::find_program_address(&[b"collateral", customer.as_ref(), seed], program).0
}

struct Demo {
    ctx: ProgramTestContext,
    program: Pubkey,
    customer: Keypair,
    guardian: Keypair,
    attacker: Keypair,
    control_customer: Keypair,
    seed: [u8; 32],
    collateral: Pubkey,
    control: Pubkey,
    sequence: u64,
}

impl Demo {
    async fn new() -> Self {
        let program = Pubkey::new_unique();
        let test = ProgramTest::new(
            "rain_collateral_guard",
            program,
            processor!(process_instruction),
        );
        let ctx = test.start_with_context().await;
        let customer = Keypair::new();
        let guardian = Keypair::new();
        let attacker = Keypair::new();
        let control_customer = Keypair::new();
        let seed = Pubkey::new_unique().to_bytes();
        let collateral = collateral_address(&program, &customer.pubkey(), &seed);
        let control = collateral_address(&program, &control_customer.pubkey(), &seed);
        let mut demo = Self {
            ctx,
            program,
            customer,
            guardian,
            attacker,
            control_customer,
            seed,
            collateral,
            control,
            sequence: 0,
        };
        for key in [
            demo.customer.pubkey(),
            demo.guardian.pubkey(),
            demo.attacker.pubkey(),
            demo.control_customer.pubkey(),
        ] {
            demo.fund(key, 100_000_000).await;
        }
        let customer = demo.customer.insecure_clone();
        let guardian = demo.guardian.insecure_clone();
        let init = demo.init(&demo.collateral, &customer.pubkey(), &demo.seed);
        demo.submit(vec![init], &[&customer, &guardian])
            .await
            .unwrap();
        let control_customer = demo.control_customer.insecure_clone();
        let init = demo.init(&demo.control, &control_customer.pubkey(), &demo.seed);
        demo.submit(vec![init], &[&control_customer, &guardian])
            .await
            .unwrap();
        demo.fund(demo.collateral, 20_000_000).await;
        demo.fund(demo.control, 20_000_000).await;
        demo
    }

    async fn fund(&mut self, to: Pubkey, lamports: u64) {
        let ix = system_instruction::transfer(&self.ctx.payer.pubkey(), &to, lamports);
        self.submit(vec![ix], &[]).await.unwrap();
    }

    fn init(&self, collateral: &Pubkey, customer: &Pubkey, seed: &[u8; 32]) -> Instruction {
        Instruction {
            program_id: self.program,
            accounts: vec![
                AccountMeta::new(*customer, true),
                AccountMeta::new(*collateral, false),
                AccountMeta::new_readonly(self.guardian.pubkey(), true),
                AccountMeta::new_readonly(system_program::id(), false),
            ],
            data: [vec![0], seed.to_vec()].concat(),
        }
    }

    fn add_admin(&self, collateral: Pubkey, admin: Pubkey) -> Instruction {
        Instruction {
            program_id: self.program,
            accounts: vec![
                AccountMeta::new(collateral, false),
                AccountMeta::new_readonly(admin, false),
            ],
            data: [vec![1], admin.to_bytes().to_vec()].concat(),
        }
    }

    fn withdraw(&self, collateral: Pubkey, admin: Pubkey, amount: u64) -> Instruction {
        Instruction {
            program_id: self.program,
            accounts: vec![
                AccountMeta::new(collateral, false),
                AccountMeta::new(admin, true),
            ],
            data: [vec![2], amount.to_le_bytes().to_vec()].concat(),
        }
    }

    fn freeze(&self, collateral: Pubkey) -> Instruction {
        self.freeze_as(collateral, self.guardian.pubkey())
    }

    fn freeze_as(&self, collateral: Pubkey, signer: Pubkey) -> Instruction {
        Instruction {
            program_id: self.program,
            accounts: vec![
                AccountMeta::new(collateral, false),
                AccountMeta::new_readonly(signer, true),
            ],
            data: vec![3],
        }
    }

    async fn submit(
        &mut self,
        mut instructions: Vec<Instruction>,
        signers: &[&Keypair],
    ) -> Result<(), TransactionError> {
        self.sequence += 1;
        instructions.insert(
            0,
            ComputeBudgetInstruction::set_compute_unit_price(self.sequence),
        );
        let blockhash = self.ctx.banks_client.get_latest_blockhash().await.unwrap();
        let mut all = vec![&self.ctx.payer];
        all.extend_from_slice(signers);
        let tx = Transaction::new_signed_with_payer(
            &instructions,
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

    async fn account(&mut self, address: Pubkey) -> solana_sdk::account::Account {
        self.ctx
            .banks_client
            .get_account(address)
            .await
            .unwrap()
            .unwrap()
    }
}

fn custom(result: Result<(), TransactionError>, instruction: u8, code: u32) {
    assert_eq!(
        result,
        Err(TransactionError::InstructionError(
            instruction,
            InstructionError::Custom(code)
        ))
    );
}

#[tokio::test]
async fn vulnerable_admin_insertion_is_contained_per_account() {
    let mut demo = Demo::new().await;
    let customer = demo.customer.insecure_clone();
    let guardian = demo.guardian.insecure_clone();
    let attacker = demo.attacker.insecure_clone();
    let control_customer = demo.control_customer.insecure_clone();

    let ix = demo.withdraw(demo.collateral, customer.pubkey(), 1_000);
    demo.submit(vec![ix], &[&customer]).await.unwrap();

    let ix = demo.add_admin(demo.collateral, attacker.pubkey());
    demo.submit(vec![ix], &[]).await.unwrap();
    let injected = demo.account(demo.collateral).await;
    assert_eq!(injected.data[3], 2);
    assert_eq!(
        &injected.data[100..132],
        attacker.pubkey().as_ref(),
        "the deliberately unauthenticated instruction appended the attacker"
    );

    let ix = demo.freeze_as(demo.collateral, attacker.pubkey());
    custom(demo.submit(vec![ix], &[&attacker]).await, 1, UNAUTHORIZED);
    let ix = demo.freeze_as(demo.collateral, customer.pubkey());
    custom(demo.submit(vec![ix], &[&customer]).await, 1, UNAUTHORIZED);

    let ix = demo.freeze(demo.collateral);
    demo.submit(vec![ix.clone()], &[&guardian]).await.unwrap();
    demo.submit(vec![ix], &[&guardian]).await.unwrap();
    let before_withdraw = demo.account(demo.collateral).await;
    assert_eq!(before_withdraw.data[1], 1);
    let ix = demo.withdraw(demo.collateral, attacker.pubkey(), 1_000);
    custom(demo.submit(vec![ix], &[&attacker]).await, 1, FROZEN);
    assert_eq!(
        before_withdraw.lamports,
        demo.account(demo.collateral).await.lamports
    );

    let ix = demo.add_admin(demo.collateral, Pubkey::new_unique());
    custom(demo.submit(vec![ix], &[]).await, 1, FROZEN);

    let control_before = demo.account(demo.control).await.lamports;
    let ix = demo.withdraw(demo.control, control_customer.pubkey(), 2_000);
    demo.submit(vec![ix], &[&control_customer]).await.unwrap();
    assert_eq!(
        demo.account(demo.control).await.lamports,
        control_before - 2_000
    );

    let init = demo.init(&demo.collateral, &customer.pubkey(), &demo.seed);
    custom(
        demo.submit(vec![init], &[&customer, &guardian]).await,
        1,
        INVALID_COLLATERAL,
    );
}

#[tokio::test]
async fn authority_and_admin_limits_are_enforced() {
    let mut demo = Demo::new().await;
    let customer = demo.customer.insecure_clone();
    let guardian = demo.guardian.insecure_clone();
    let attacker = demo.attacker.insecure_clone();

    let ix = demo.add_admin(demo.collateral, guardian.pubkey());
    custom(demo.submit(vec![ix], &[]).await, 1, INVALID_AUTHORITIES);
    let ix = demo.withdraw(demo.collateral, attacker.pubkey(), 1_000);
    custom(demo.submit(vec![ix], &[&attacker]).await, 1, UNAUTHORIZED);

    for _ in 0..3 {
        let ix = demo.add_admin(demo.collateral, Pubkey::new_unique());
        demo.submit(vec![ix], &[]).await.unwrap();
    }
    assert_eq!(demo.account(demo.collateral).await.data[3], 4);
    let ix = demo.add_admin(demo.collateral, Pubkey::new_unique());
    custom(demo.submit(vec![ix], &[]).await, 1, ADMIN_LIMIT);
    let duplicate = demo.add_admin(demo.collateral, customer.pubkey());
    custom(demo.submit(vec![duplicate], &[]).await, 1, ALREADY_ADMIN);

    let wrong = demo.add_admin(demo.control, attacker.pubkey());
    let mut data = wrong.data;
    data[1..].copy_from_slice(Pubkey::new_unique().as_ref());
    let wrong = Instruction { data, ..wrong };
    custom(demo.submit(vec![wrong], &[]).await, 1, UNAUTHORIZED);
}

#[tokio::test]
async fn atomic_add_and_withdraw_bypasses_the_recovery_window() {
    let mut demo = Demo::new().await;
    let attacker = demo.attacker.insecure_clone();
    let before = demo.account(demo.collateral).await;
    let rent = demo
        .ctx
        .banks_client
        .get_rent()
        .await
        .unwrap()
        .minimum_balance(LEN);
    assert_eq!(before.data.len(), LEN);
    let spendable = before.lamports - rent;
    let add = demo.add_admin(demo.collateral, attacker.pubkey());
    let withdraw = demo.withdraw(demo.collateral, attacker.pubkey(), spendable);
    demo.submit(vec![add, withdraw], &[&attacker])
        .await
        .unwrap();
    assert_eq!(demo.account(demo.collateral).await.lamports, rent);
}
