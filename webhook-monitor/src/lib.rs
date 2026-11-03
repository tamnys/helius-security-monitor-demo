#![allow(unexpected_cfgs)]
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint::ProgramResult,
    instruction::{get_stack_height, TRANSACTION_LEVEL_STACK_HEIGHT},
    program::invoke_signed,
    program_error::ProgramError,
    pubkey::Pubkey,
    rent::Rent,
    system_instruction, system_program,
    sysvar::Sysvar,
};

#[cfg(not(feature = "no-entrypoint"))]
solana_program::entrypoint!(process_instruction);

pub const LEN: usize = 131;
pub const PAUSED: u32 = 0;
pub const UNAUTHORIZED: u32 = 1;
pub const INVALID_VAULT: u32 = 2;
pub const INVALID_AUTHORITIES: u32 = 3;
pub const INSUFFICIENT_FUNDS: u32 = 4;
pub const ADMIN_CPI_FORBIDDEN: u32 = 5;

#[derive(Clone, Debug)]
pub struct Vault {
    pub paused: bool,
    pub bump: u8,
    pub seed: [u8; 32],
    pub admin: Pubkey,
    pub withdrawer: Pubkey,
    pub guardian: Pubkey,
}

impl Vault {
    pub fn read(program: &Pubkey, account: &AccountInfo) -> Result<Self, ProgramError> {
        if account.owner != program || !account.is_writable {
            return Err(ProgramError::Custom(INVALID_VAULT));
        }
        let bytes = account.try_borrow_data()?;
        if bytes.len() != LEN || bytes[0] != 1 || bytes[1] > 1 {
            return Err(ProgramError::Custom(INVALID_VAULT));
        }
        let state = Self {
            paused: bytes[1] == 1,
            bump: bytes[2],
            seed: bytes[3..35].try_into().unwrap(),
            admin: Pubkey::new_from_array(bytes[35..67].try_into().unwrap()),
            withdrawer: Pubkey::new_from_array(bytes[67..99].try_into().unwrap()),
            guardian: Pubkey::new_from_array(bytes[99..131].try_into().unwrap()),
        };
        let (expected, bump) =
            Pubkey::find_program_address(&[b"vault", state.admin.as_ref(), &state.seed], program);
        if expected != *account.key || bump != state.bump {
            return Err(ProgramError::Custom(INVALID_VAULT));
        }
        Ok(state)
    }

    fn write(&self, account: &AccountInfo) -> ProgramResult {
        let mut bytes = account.try_borrow_mut_data()?;
        bytes[0] = 1;
        bytes[1] = u8::from(self.paused);
        bytes[2] = self.bump;
        bytes[3..35].copy_from_slice(&self.seed);
        bytes[35..67].copy_from_slice(self.admin.as_ref());
        bytes[67..99].copy_from_slice(self.withdrawer.as_ref());
        bytes[99..131].copy_from_slice(self.guardian.as_ref());
        Ok(())
    }

    fn active(&self) -> ProgramResult {
        if self.paused {
            Err(ProgramError::Custom(PAUSED))
        } else {
            Ok(())
        }
    }
}

fn signer(account: &AccountInfo, expected: &Pubkey) -> ProgramResult {
    if account.key != expected || !account.is_signer {
        return Err(ProgramError::Custom(UNAUTHORIZED));
    }
    Ok(())
}

pub fn process_instruction(
    program: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let (&tag, args) = data
        .split_first()
        .ok_or(ProgramError::InvalidInstructionData)?;
    if tag == 0 {
        if args.len() != 32 || accounts.len() != 5 {
            return Err(ProgramError::InvalidInstructionData);
        }
        let mut iter = accounts.iter();
        let admin = next_account_info(&mut iter)?;
        let vault = next_account_info(&mut iter)?;
        let withdrawer = next_account_info(&mut iter)?;
        let guardian = next_account_info(&mut iter)?;
        let system = next_account_info(&mut iter)?;
        signer(admin, admin.key)?;
        signer(guardian, guardian.key)?;
        if guardian.key == admin.key || guardian.key == withdrawer.key {
            return Err(ProgramError::Custom(INVALID_AUTHORITIES));
        }
        if *system.key != system_program::id() || !admin.is_writable || !vault.is_writable {
            return Err(ProgramError::InvalidAccountData);
        }
        let (expected, bump) =
            Pubkey::find_program_address(&[b"vault", admin.key.as_ref(), args], program);
        if *vault.key != expected || vault.owner != &system_program::id() || vault.data_len() != 0 {
            return Err(ProgramError::Custom(INVALID_VAULT));
        }
        invoke_signed(
            &system_instruction::create_account(
                admin.key,
                vault.key,
                Rent::get()?.minimum_balance(LEN),
                LEN as u64,
                program,
            ),
            &[admin.clone(), vault.clone(), system.clone()],
            &[&[b"vault", admin.key.as_ref(), args, &[bump]]],
        )?;
        return Vault {
            paused: false,
            bump,
            seed: args.try_into().unwrap(),
            admin: *admin.key,
            withdrawer: *withdrawer.key,
            guardian: *guardian.key,
        }
        .write(vault);
    }

    if accounts.len() != 2 {
        return Err(ProgramError::InvalidInstructionData);
    }
    let vault = &accounts[0];
    let actor = &accounts[1];
    let mut state = Vault::read(program, vault)?;
    match tag {
        1 if args.len() == 32 => {
            if get_stack_height() != TRANSACTION_LEVEL_STACK_HEIGHT {
                return Err(ProgramError::Custom(ADMIN_CPI_FORBIDDEN));
            }
            signer(actor, &state.admin)?;
            state.active()?;
            let next = Pubkey::new_from_array(args.try_into().unwrap());
            if next == state.guardian {
                return Err(ProgramError::Custom(INVALID_AUTHORITIES));
            }
            state.withdrawer = next;
            state.write(vault)
        }
        2 if args.len() == 8 => {
            state.active()?;
            signer(actor, &state.withdrawer)?;
            if !actor.is_writable {
                return Err(ProgramError::InvalidAccountData);
            }
            let amount = u64::from_le_bytes(args.try_into().unwrap());
            let reserve = Rent::get()?.minimum_balance(LEN);
            let remaining = vault
                .lamports()
                .checked_sub(amount)
                .filter(|balance| *balance >= reserve)
                .ok_or(ProgramError::Custom(INSUFFICIENT_FUNDS))?;
            let received = actor
                .lamports()
                .checked_add(amount)
                .ok_or(ProgramError::ArithmeticOverflow)?;
            **vault.try_borrow_mut_lamports()? = remaining;
            **actor.try_borrow_mut_lamports()? = received;
            Ok(())
        }
        3 if args.is_empty() => {
            signer(actor, &state.guardian)?;
            state.paused = true;
            state.write(vault)
        }
        _ => Err(ProgramError::InvalidInstructionData),
    }
}
