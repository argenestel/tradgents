use super::*;
use anchor_lang::{AccountSerialize, InstructionData, ToAccountMetas};

fn account<T: AccountSerialize>(key: Pubkey, value: &T) -> AccountInfo<'static> {
    let mut bytes = Vec::new();
    value.try_serialize(&mut bytes).unwrap();
    AccountInfo::new(
        Box::leak(Box::new(key)),
        false,
        true,
        Box::leak(Box::new(10_000_000)),
        Box::leak(bytes.into_boxed_slice()),
        &crate::ID,
        false,
        0,
    )
}
fn signer(key: Pubkey, signed: bool) -> AccountInfo<'static> {
    AccountInfo::new(
        Box::leak(Box::new(key)),
        signed,
        false,
        Box::leak(Box::new(10_000_000)),
        Box::leak(Vec::new().into_boxed_slice()),
        &anchor_lang::system_program::ID,
        false,
        0,
    )
}
fn agent(wallet: Pubkey, beneficiary: Pubkey, bump: u8) -> Agent {
    Agent {
        agent_wallet: wallet,
        beneficiary,
        metadata_hash: [3; 32],
        bond: 1_000_000,
        unlock_at: 100,
        paused: false,
        slashed: false,
        withdrawn: false,
        bump,
    }
}
fn moderation(authority: Pubkey, signed: bool, slashed: bool) -> &'static [AccountInfo<'static>] {
    let admin = Pubkey::new_from_array([1; 32]);
    let guardian = Pubkey::new_from_array([2; 32]);
    let wallet = Pubkey::new_from_array([3; 32]);
    let (config_key, config_bump) = Pubkey::find_program_address(&[b"config"], &ID);
    let (agent_key, agent_bump) = Pubkey::find_program_address(&[b"agent", wallet.as_ref()], &ID);
    let mut a = agent(wallet, admin, agent_bump);
    a.slashed = slashed;
    Box::leak(
        vec![
            signer(authority, signed),
            account(
                config_key,
                &Config {
                    admin,
                    guardian,
                    treasury: Pubkey::new_from_array([4; 32]),
                    minimum_bond: 1_000_000,
                    cooldown: 100,
                    bump: config_bump,
                },
            ),
            account(agent_key, &a),
        ]
        .into_boxed_slice(),
    )
}
#[test]
fn configuration_validation() {
    let key = Pubkey::new_from_array([1; 32]);
    assert!(validate_config(key, key, 1, 0).is_ok());
    for (guardian, treasury, bond, cooldown) in [
        (Pubkey::default(), key, 1, 0),
        (key, Pubkey::default(), 1, 0),
        (key, key, 0, 0),
        (key, key, 1, -1),
    ] {
        assert!(validate_config(guardian, treasury, bond, cooldown).is_err());
    }
}
#[test]
fn admin_and_guardian_pause_and_unpause_via_anchor_entrypoint() {
    for authority in [
        Pubkey::new_from_array([1; 32]),
        Pubkey::new_from_array([2; 32]),
    ] {
        let accounts = moderation(authority, true, false);
        crate::entry(&ID, accounts, &crate::instruction::PauseAgent {}.data()).unwrap();
        assert!(
            Agent::try_deserialize(&mut &accounts[2].data.borrow()[..])
                .unwrap()
                .paused
        );
        crate::entry(&ID, accounts, &crate::instruction::UnpauseAgent {}.data()).unwrap();
        assert!(
            !Agent::try_deserialize(&mut &accounts[2].data.borrow()[..])
                .unwrap()
                .paused
        );
    }
}
#[test]
fn non_admin_cannot_pause_or_unpause_via_anchor_entrypoint() {
    let accounts = moderation(Pubkey::new_from_array([9; 32]), true, false);
    assert!(crate::entry(&ID, accounts, &crate::instruction::PauseAgent {}.data()).is_err());
    assert!(crate::entry(&ID, accounts, &crate::instruction::UnpauseAgent {}.data()).is_err());
}
#[test]
fn unsigned_moderator_rejected_via_anchor_entrypoint() {
    let accounts = moderation(Pubkey::new_from_array([1; 32]), false, false);
    assert!(crate::entry(&ID, accounts, &crate::instruction::PauseAgent {}.data()).is_err());
}
#[test]
fn slashed_agent_cannot_unpause_via_anchor_entrypoint() {
    let accounts = moderation(Pubkey::new_from_array([1; 32]), true, true);
    assert!(crate::entry(&ID, accounts, &crate::instruction::UnpauseAgent {}.data()).is_err());
}
#[test]
fn registration_requires_both_signatures_in_instruction_contract() {
    let metas = crate::accounts::RegisterAgent {
        payer: Pubkey::new_unique(),
        agent_wallet: Pubkey::new_unique(),
        config: Pubkey::new_unique(),
        agent: Pubkey::new_unique(),
        vault: Pubkey::new_unique(),
        system_program: anchor_lang::system_program::ID,
    }
    .to_account_metas(None);
    assert!(metas[0].is_signer);
    assert!(metas[1].is_signer);
}

fn config() -> Config {
    Config {
        admin: Pubkey::new_from_array([1; 32]),
        guardian: Pubkey::new_from_array([2; 32]),
        treasury: Pubkey::new_from_array([4; 32]),
        minimum_bond: 1_000_000,
        cooldown: 100,
        bump: 0,
    }
}
fn vault_and_recipient(bond: u64) -> (AccountInfo<'static>, AccountInfo<'static>, u64) {
    let reserve = Rent::default().minimum_balance(8 + Vault::INIT_SPACE);
    let vault = account(
        Pubkey::new_unique(),
        &Vault {
            agent: Pubkey::new_unique(),
            bump: 1,
        },
    );
    **vault.lamports.borrow_mut() = reserve + bond;
    let destination = signer(Pubkey::new_unique(), false);
    (vault, destination, reserve)
}
#[test]
fn registration_holds_bond_and_withdrawal_succeeds_at_cooldown() {
    let c = config();
    let mut a = registered_agent(
        Pubkey::new_unique(),
        Pubkey::new_unique(),
        [7; 32],
        c.minimum_bond,
        &c,
        50,
        1,
    )
    .unwrap();
    let (vault, destination, reserve) = vault_and_recipient(a.bond);
    let before = destination.lamports();
    assert_eq!(a.unlock_at, 150);
    assert_eq!(a.bond, c.minimum_bond);
    assert!(withdraw_at(&mut a, &vault, &destination, 149, reserve).is_err());
    assert_eq!(vault.lamports(), reserve + c.minimum_bond);
    assert_eq!(destination.lamports(), before);
    assert_eq!(
        withdraw_at(&mut a, &vault, &destination, 150, reserve).unwrap(),
        c.minimum_bond
    );
    assert_eq!(vault.lamports(), reserve);
    assert_eq!(destination.lamports(), before + c.minimum_bond);
    assert_eq!(a.bond, 0);
    assert!(a.withdrawn);
    assert!(withdraw_at(&mut a, &vault, &destination, 151, reserve).is_err());
}
#[test]
fn minimum_bond_and_unlock_overflow_rejected() {
    let c = config();
    assert!(registered_agent(
        Pubkey::new_unique(),
        Pubkey::new_unique(),
        [0; 32],
        c.minimum_bond - 1,
        &c,
        0,
        1
    )
    .is_err());
    assert!(registered_agent(
        Pubkey::new_unique(),
        Pubkey::new_unique(),
        [0; 32],
        c.minimum_bond,
        &c,
        i64::MAX,
        1
    )
    .is_err());
}
#[test]
fn paused_slashed_and_withdrawn_cannot_withdraw() {
    for state in 0..3 {
        let mut a = agent(Pubkey::new_unique(), Pubkey::new_unique(), 0);
        a.paused = state == 0;
        a.slashed = state == 1;
        a.withdrawn = state == 2;
        let (vault, destination, reserve) = vault_and_recipient(a.bond);
        let balance = vault.lamports();
        assert!(withdraw_at(&mut a, &vault, &destination, 1000, reserve).is_err());
        assert_eq!(vault.lamports(), balance);
        assert_eq!(a.bond, 1_000_000);
    }
}
#[test]
fn slash_transfer_preserves_vault_rent_reserve() {
    let (vault, destination, reserve) = vault_and_recipient(1_000_000);
    move_bond_reserving(&vault, &destination, 1_000_000, reserve).unwrap();
    assert_eq!(vault.lamports(), reserve);
    assert!(move_bond_reserving(&vault, &destination, 1, reserve).is_err());
}
#[test]
fn rent_underfunding_overflow_and_self_transfer_are_rejected() {
    let (vault, destination, reserve) = vault_and_recipient(1_000_000);
    let initial = vault.lamports();
    assert!(move_bond_reserving(&vault, &destination, initial + 1, reserve).is_err());
    assert!(move_bond_reserving(&vault, &destination, 1_000_001, reserve).is_err());
    assert!(move_bond_reserving(&vault, &vault, 1, reserve).is_err());
    **destination.lamports.borrow_mut() = u64::MAX;
    assert!(move_bond_reserving(&vault, &destination, 1, reserve).is_err());
    assert_eq!(vault.lamports(), initial);
}
#[test]
fn non_admin_cannot_slash_via_anchor_entrypoint() {
    let accounts = moderation(Pubkey::new_from_array([9; 32]), true, false);
    let (vault_key, bump) =
        Pubkey::find_program_address(&[b"vault", accounts[2].key.as_ref()], &ID);
    let vault = account(
        vault_key,
        &Vault {
            agent: *accounts[2].key,
            bump,
        },
    );
    let mut treasury = signer(Pubkey::new_from_array([4; 32]), false);
    treasury.is_writable = true;
    let full = Box::leak(
        vec![
            accounts[0].clone(),
            accounts[1].clone(),
            accounts[2].clone(),
            vault,
            treasury,
        ]
        .into_boxed_slice(),
    );
    let error = crate::entry(&ID, full, &crate::instruction::SlashAgent {}.data()).unwrap_err();
    assert_eq!(
        error,
        anchor_lang::solana_program::program_error::ProgramError::Custom(6000)
    );
}
#[test]
fn missing_agent_cosignature_rejected_via_anchor_entrypoint() {
    let wallet = Pubkey::new_from_array([3; 32]);
    let (config_key, config_bump) = Pubkey::find_program_address(&[b"config"], &ID);
    let (agent_key, agent_bump) = Pubkey::find_program_address(&[b"agent", wallet.as_ref()], &ID);
    let (vault_key, vault_bump) =
        Pubkey::find_program_address(&[b"vault", agent_key.as_ref()], &ID);
    let mut payer = signer(Pubkey::new_from_array([1; 32]), true);
    payer.is_writable = true;
    let mut c = config();
    c.bump = config_bump;
    let mut system = signer(anchor_lang::system_program::ID, false);
    system.executable = true;
    let accounts = Box::leak(
        vec![
            payer,
            signer(wallet, false),
            account(config_key, &c),
            account(agent_key, &agent(wallet, c.admin, agent_bump)),
            account(
                vault_key,
                &Vault {
                    agent: agent_key,
                    bump: vault_bump,
                },
            ),
            system,
        ]
        .into_boxed_slice(),
    );
    let error = crate::entry(
        &ID,
        accounts,
        &crate::instruction::RegisterAgent {
            metadata_hash: [0; 32],
            bond: 1_000_000,
        }
        .data(),
    )
    .unwrap_err();
    assert_eq!(
        error,
        anchor_lang::solana_program::program_error::ProgramError::Custom(3010)
    );
}
