#![allow(unexpected_cfgs)]
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint::ProgramResult,
    program::invoke_signed,
    program_error::ProgramError,
    pubkey::Pubkey,
    rent::Rent,
    system_program,
    sysvar::Sysvar,
};

#[cfg(not(feature = "no-entrypoint"))]
solana_program::entrypoint!(process_instruction);

pub const LEN: usize = 196;
pub const MAX_ADMINS: usize = 4;
pub const FROZEN: u32 = 0;
pub const UNAUTHORIZED: u32 = 1;
pub const INVALID_COLLATERAL: u32 = 2;
pub const INVALID_AUTHORITIES: u32 = 3;
pub const INSUFFICIENT_FUNDS: u32 = 4;
pub const ADMIN_LIMIT: u32 = 5;
pub const ALREADY_ADMIN: u32 = 6;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Collateral {
    pub frozen: bool,
    pub bump: u8,
    pub admin_count: u8,
    pub seed: [u8; 32],
    pub guardian: Pubkey,
    pub admins: [Pubkey; MAX_ADMINS],
}

impl Collateral {
    pub fn read(program: &Pubkey, account: &AccountInfo) -> Result<Self, ProgramError> {
        if account.owner != program || !account.is_writable {
            return Err(ProgramError::Custom(INVALID_COLLATERAL));
        }
        let bytes = account.try_borrow_data()?;
        if bytes.len() != LEN || bytes[0] != 1 || bytes[1] > 1 {
            return Err(ProgramError::Custom(INVALID_COLLATERAL));
        }
        let admin_count = bytes[3] as usize;
        if !(1..=MAX_ADMINS).contains(&admin_count) {
            return Err(ProgramError::Custom(INVALID_COLLATERAL));
        }
        let mut admins = [Pubkey::default(); MAX_ADMINS];
        for (index, admin) in admins.iter_mut().take(admin_count).enumerate() {
            let offset = 68 + index * 32;
            *admin = Pubkey::new_from_array(bytes[offset..offset + 32].try_into().unwrap());
        }
        let state = Self {
            frozen: bytes[1] == 1,
            bump: bytes[2],
            admin_count: bytes[3],
            seed: bytes[4..36].try_into().unwrap(),
            guardian: Pubkey::new_from_array(bytes[36..68].try_into().unwrap()),
            admins,
        };
        let (expected, bump) = Pubkey::find_program_address(
            &[b"collateral", state.admins[0].as_ref(), &state.seed],
            program,
        );
        if expected != *account.key || bump != state.bump {
            return Err(ProgramError::Custom(INVALID_COLLATERAL));
        }
        Ok(state)
    }

    fn write(&self, account: &AccountInfo) -> ProgramResult {
        let mut bytes = account.try_borrow_mut_data()?;
        bytes.fill(0);
        bytes[0] = 1;
        bytes[1] = u8::from(self.frozen);
        bytes[2] = self.bump;
        bytes[3] = self.admin_count;
        bytes[4..36].copy_from_slice(&self.seed);
        bytes[36..68].copy_from_slice(self.guardian.as_ref());
        for (index, admin) in self
            .admins
            .iter()
            .take(self.admin_count as usize)
            .enumerate()
        {
            let offset = 68 + index * 32;
            bytes[offset..offset + 32].copy_from_slice(admin.as_ref());
        }
        Ok(())
    }

    fn active(&self) -> ProgramResult {
        if self.frozen {
            Err(ProgramError::Custom(FROZEN))
        } else {
            Ok(())
        }
    }

    fn has_admin(&self, key: &Pubkey) -> bool {
        self.admins[..self.admin_count as usize].contains(key)
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
        if args.len() != 32 || accounts.len() != 4 {
            return Err(ProgramError::InvalidInstructionData);
        }
        let mut iter = accounts.iter();
        let customer = next_account_info(&mut iter)?;
        let collateral = next_account_info(&mut iter)?;
        let guardian = next_account_info(&mut iter)?;
        let system = next_account_info(&mut iter)?;
        signer(customer, customer.key)?;
        signer(guardian, guardian.key)?;
        if guardian.key == customer.key {
            return Err(ProgramError::Custom(INVALID_AUTHORITIES));
        }
        if *system.key != system_program::id() || !customer.is_writable || !collateral.is_writable {
            return Err(ProgramError::InvalidAccountData);
        }
        let (expected, bump) =
            Pubkey::find_program_address(&[b"collateral", customer.key.as_ref(), args], program);
        if *collateral.key != expected
            || collateral.owner != &system_program::id()
            || collateral.data_len() != 0
        {
            return Err(ProgramError::Custom(INVALID_COLLATERAL));
        }
        invoke_signed(
            &solana_program::system_instruction::create_account(
                customer.key,
                collateral.key,
                Rent::get()?.minimum_balance(LEN),
                LEN as u64,
                program,
            ),
            &[customer.clone(), collateral.clone(), system.clone()],
            &[&[b"collateral", customer.key.as_ref(), args, &[bump]]],
        )?;
        let mut admins = [Pubkey::default(); MAX_ADMINS];
        admins[0] = *customer.key;
        return Collateral {
            frozen: false,
            bump,
            admin_count: 1,
            seed: args.try_into().unwrap(),
            guardian: *guardian.key,
            admins,
        }
        .write(collateral);
    }

    if tag == 1 {
        if args.len() != 32 || accounts.len() != 2 {
            return Err(ProgramError::InvalidInstructionData);
        }
        let collateral = &accounts[0];
        let new_admin = Pubkey::new_from_array(args.try_into().unwrap());
        let mut state = Collateral::read(program, collateral)?;
        state.active()?;
        if new_admin == Pubkey::default() || new_admin == state.guardian {
            return Err(ProgramError::Custom(INVALID_AUTHORITIES));
        }
        if state.has_admin(&new_admin) {
            return Err(ProgramError::Custom(ALREADY_ADMIN));
        }
        if state.admin_count as usize >= MAX_ADMINS {
            return Err(ProgramError::Custom(ADMIN_LIMIT));
        }
        // Deliberately missing authorization: this is the Rain-style demo bug.
        // Parsed Streams reports this instruction and the guardian freezes the
        // affected account before a separate withdrawal can succeed.
        if *accounts[1].key != new_admin {
            return Err(ProgramError::Custom(UNAUTHORIZED));
        }
        state.admins[state.admin_count as usize] = new_admin;
        state.admin_count += 1;
        return state.write(collateral);
    }

    if tag == 2 {
        if args.len() != 8 || accounts.len() != 2 {
            return Err(ProgramError::InvalidInstructionData);
        }
        let collateral = &accounts[0];
        let admin = &accounts[1];
        let state = Collateral::read(program, collateral)?;
        state.active()?;
        if !admin.is_signer || !state.has_admin(admin.key) || !admin.is_writable {
            return Err(ProgramError::Custom(UNAUTHORIZED));
        }
        let amount = u64::from_le_bytes(args.try_into().unwrap());
        let reserve = Rent::get()?.minimum_balance(LEN);
        let remaining = collateral
            .lamports()
            .checked_sub(amount)
            .filter(|balance| *balance >= reserve)
            .ok_or(ProgramError::Custom(INSUFFICIENT_FUNDS))?;
        let received = admin
            .lamports()
            .checked_add(amount)
            .ok_or(ProgramError::ArithmeticOverflow)?;
        **collateral.try_borrow_mut_lamports()? = remaining;
        **admin.try_borrow_mut_lamports()? = received;
        return Ok(());
    }

    if tag == 3 {
        if !args.is_empty() || accounts.len() != 2 {
            return Err(ProgramError::InvalidInstructionData);
        }
        let collateral = &accounts[0];
        let guardian = &accounts[1];
        let mut state = Collateral::read(program, collateral)?;
        signer(guardian, &state.guardian)?;
        state.frozen = true;
        return state.write(collateral);
    }

    Err(ProgramError::InvalidInstructionData)
}
