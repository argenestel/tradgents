#![forbid(unsafe_code)]
use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};

declare_id!("73Gga8nZPh8ohGCzVZ7PKnxKJR1Zp8FVDskdPjabr3WA");

#[program]
pub mod agent_registry {
    use super::*;
    pub fn initialize_config(
        ctx: Context<InitializeConfig>,
        guardian: Pubkey,
        treasury: Pubkey,
        minimum_bond: u64,
        cooldown: i64,
    ) -> Result<()> {
        validate_config(guardian, treasury, minimum_bond, cooldown)?;
        let c = &mut ctx.accounts.config;
        c.admin = ctx.accounts.admin.key();
        c.guardian = guardian;
        c.treasury = treasury;
        c.minimum_bond = minimum_bond;
        c.cooldown = cooldown;
        c.bump = ctx.bumps.config;
        emit!(ConfigUpdated {
            admin: c.admin,
            guardian,
            treasury,
            minimum_bond,
            cooldown
        });
        Ok(())
    }
    pub fn update_config(
        ctx: Context<UpdateConfig>,
        guardian: Pubkey,
        treasury: Pubkey,
        minimum_bond: u64,
        cooldown: i64,
    ) -> Result<()> {
        validate_config(guardian, treasury, minimum_bond, cooldown)?;
        let c = &mut ctx.accounts.config;
        c.guardian = guardian;
        c.treasury = treasury;
        c.minimum_bond = minimum_bond;
        c.cooldown = cooldown;
        emit!(ConfigUpdated {
            admin: c.admin,
            guardian,
            treasury,
            minimum_bond,
            cooldown
        });
        Ok(())
    }
    pub fn register_agent(
        ctx: Context<RegisterAgent>,
        metadata_hash: [u8; 32],
        bond: u64,
    ) -> Result<()> {
        require!(
            bond >= ctx.accounts.config.minimum_bond,
            RegistryError::BondTooSmall
        );
        let now = Clock::get()?.unix_timestamp;
        let registered = registered_agent(
            ctx.accounts.agent_wallet.key(),
            ctx.accounts.payer.key(),
            metadata_hash,
            bond,
            &ctx.accounts.config,
            now,
            ctx.bumps.agent,
        )?;
        transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.payer.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                },
            ),
            bond,
        )?;
        let a = &mut ctx.accounts.agent;
        a.set_inner(registered);
        ctx.accounts.vault.agent = a.key();
        ctx.accounts.vault.bump = ctx.bumps.vault;
        emit!(AgentRegistered {
            agent_wallet: a.agent_wallet,
            beneficiary: a.beneficiary,
            metadata_hash,
            bond,
            unlock_at: a.unlock_at
        });
        Ok(())
    }
    pub fn withdraw_bond(ctx: Context<WithdrawBond>) -> Result<()> {
        let a = &mut ctx.accounts.agent;
        require!(!a.paused, RegistryError::Paused);
        require!(!a.slashed, RegistryError::Slashed);
        require!(!a.withdrawn, RegistryError::Withdrawn);
        let bond = withdraw_at(
            a,
            &ctx.accounts.vault.to_account_info(),
            &ctx.accounts.beneficiary.to_account_info(),
            Clock::get()?.unix_timestamp,
            Rent::get()?.minimum_balance(ctx.accounts.vault.to_account_info().data_len()),
        )?;
        emit!(BondWithdrawn {
            agent_wallet: a.agent_wallet,
            bond
        });
        Ok(())
    }
    pub fn pause_agent(ctx: Context<Moderate>) -> Result<()> {
        set_pause(ctx, true)
    }
    pub fn unpause_agent(ctx: Context<Moderate>) -> Result<()> {
        set_pause(ctx, false)
    }
    pub fn slash_agent(ctx: Context<Slash>) -> Result<()> {
        let a = &mut ctx.accounts.agent;
        require!(!a.slashed, RegistryError::Slashed);
        require!(!a.withdrawn, RegistryError::Withdrawn);
        move_bond(
            &ctx.accounts.vault.to_account_info(),
            &ctx.accounts.treasury.to_account_info(),
            a.bond,
        )?;
        let bond = a.bond;
        a.bond = 0;
        a.slashed = true;
        emit!(AgentSlashed {
            agent_wallet: a.agent_wallet,
            bond,
            treasury: ctx.accounts.treasury.key()
        });
        Ok(())
    }
}
fn validate_config(guardian: Pubkey, treasury: Pubkey, bond: u64, cooldown: i64) -> Result<()> {
    require!(
        guardian != Pubkey::default() && treasury != Pubkey::default() && bond > 0 && cooldown >= 0,
        RegistryError::InvalidConfig
    );
    Ok(())
}
fn set_pause(ctx: Context<Moderate>, paused: bool) -> Result<()> {
    require!(!ctx.accounts.agent.slashed, RegistryError::Slashed);
    ctx.accounts.agent.paused = paused;
    emit!(AgentPaused {
        agent_wallet: ctx.accounts.agent.agent_wallet,
        paused
    });
    Ok(())
}
fn move_bond(vault: &AccountInfo, destination: &AccountInfo, amount: u64) -> Result<()> {
    let reserve = Rent::get()?.minimum_balance(vault.data_len());
    move_bond_reserving(vault, destination, amount, reserve)
}
fn move_bond_reserving(
    vault: &AccountInfo,
    destination: &AccountInfo,
    amount: u64,
    reserve: u64,
) -> Result<()> {
    require!(
        vault.key != destination.key,
        RegistryError::InvalidDestination
    );
    let remaining = vault
        .lamports()
        .checked_sub(amount)
        .ok_or(RegistryError::Overflow)?;
    require!(remaining >= reserve, RegistryError::RentReserve);
    let received = destination
        .lamports()
        .checked_add(amount)
        .ok_or(RegistryError::Overflow)?;
    **vault.try_borrow_mut_lamports()? = remaining;
    **destination.try_borrow_mut_lamports()? = received;
    Ok(())
}
fn registered_agent(
    wallet: Pubkey,
    beneficiary: Pubkey,
    metadata_hash: [u8; 32],
    bond: u64,
    config: &Config,
    now: i64,
    bump: u8,
) -> Result<Agent> {
    require!(bond >= config.minimum_bond, RegistryError::BondTooSmall);
    let unlock_at = now
        .checked_add(config.cooldown)
        .ok_or(RegistryError::Overflow)?;
    Ok(Agent {
        agent_wallet: wallet,
        beneficiary,
        metadata_hash,
        bond,
        unlock_at,
        paused: false,
        slashed: false,
        withdrawn: false,
        bump,
    })
}
fn withdraw_at(
    agent: &mut Agent,
    vault: &AccountInfo,
    destination: &AccountInfo,
    now: i64,
    reserve: u64,
) -> Result<u64> {
    require!(!agent.paused, RegistryError::Paused);
    require!(!agent.slashed, RegistryError::Slashed);
    require!(!agent.withdrawn, RegistryError::Withdrawn);
    require!(now >= agent.unlock_at, RegistryError::Cooldown);
    let bond = agent.bond;
    move_bond_reserving(vault, destination, bond, reserve)?;
    agent.bond = 0;
    agent.withdrawn = true;
    Ok(bond)
}
#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(init, payer=admin, space=8+Config::INIT_SPACE, seeds=[b"config"], bump)]
    pub config: Account<'info, Config>,
    #[account(constraint=registry_program.programdata_address()? == Some(program_data.key()) @ RegistryError::Unauthorized)]
    pub registry_program: Program<'info, crate::program::AgentRegistry>,
    #[account(constraint=program_data.upgrade_authority_address == Some(admin.key()) @ RegistryError::Unauthorized)]
    pub program_data: Account<'info, ProgramData>,
    pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
pub struct UpdateConfig<'info> {
    pub admin: Signer<'info>,
    #[account(mut, seeds=[b"config"], bump=config.bump, has_one=admin @ RegistryError::Unauthorized)]
    pub config: Account<'info, Config>,
}
#[derive(Accounts)]
pub struct RegisterAgent<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub agent_wallet: Signer<'info>,
    #[account(seeds=[b"config"], bump=config.bump)]
    pub config: Account<'info, Config>,
    #[account(init, payer=payer, space=8+Agent::INIT_SPACE, seeds=[b"agent",agent_wallet.key().as_ref()], bump)]
    pub agent: Account<'info, Agent>,
    #[account(init, payer=payer, space=8+Vault::INIT_SPACE, seeds=[b"vault",agent.key().as_ref()], bump)]
    pub vault: Account<'info, Vault>,
    pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
pub struct WithdrawBond<'info> {
    pub agent_wallet: Signer<'info>,
    /// CHECK: constrained to the immutable recorded beneficiary; receives SOL only.
    #[account(mut, address=agent.beneficiary, constraint=beneficiary.owner == &anchor_lang::system_program::ID @ RegistryError::InvalidDestination)]
    pub beneficiary: UncheckedAccount<'info>,
    #[account(mut, seeds=[b"agent",agent_wallet.key().as_ref()], bump=agent.bump, has_one=agent_wallet)]
    pub agent: Account<'info, Agent>,
    #[account(mut, seeds=[b"vault",agent.key().as_ref()], bump=vault.bump, has_one=agent)]
    pub vault: Account<'info, Vault>,
}
#[derive(Accounts)]
pub struct Moderate<'info> {
    pub authority: Signer<'info>,
    #[account(seeds=[b"config"], bump=config.bump, constraint=authority.key()==config.admin || authority.key()==config.guardian @ RegistryError::Unauthorized)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds=[b"agent",agent.agent_wallet.as_ref()], bump=agent.bump)]
    pub agent: Account<'info, Agent>,
}
#[derive(Accounts)]
pub struct Slash<'info> {
    pub authority: Signer<'info>,
    #[account(seeds=[b"config"], bump=config.bump, constraint=authority.key()==config.admin || authority.key()==config.guardian @ RegistryError::Unauthorized)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds=[b"agent",agent.agent_wallet.as_ref()], bump=agent.bump)]
    pub agent: Account<'info, Agent>,
    #[account(mut, seeds=[b"vault",agent.key().as_ref()], bump=vault.bump, has_one=agent)]
    pub vault: Account<'info, Vault>,
    /// CHECK: config-selected system account, SOL recipient only.
    #[account(mut, address=config.treasury, constraint=treasury.owner == &anchor_lang::system_program::ID @ RegistryError::InvalidDestination)]
    pub treasury: UncheckedAccount<'info>,
}
#[account]
#[derive(InitSpace)]
pub struct Config {
    pub admin: Pubkey,
    pub guardian: Pubkey,
    pub treasury: Pubkey,
    pub minimum_bond: u64,
    pub cooldown: i64,
    pub bump: u8,
}
#[account]
#[derive(InitSpace)]
pub struct Agent {
    pub agent_wallet: Pubkey,
    pub beneficiary: Pubkey,
    pub metadata_hash: [u8; 32],
    pub bond: u64,
    pub unlock_at: i64,
    pub paused: bool,
    pub slashed: bool,
    pub withdrawn: bool,
    pub bump: u8,
}
#[account]
#[derive(InitSpace)]
pub struct Vault {
    pub agent: Pubkey,
    pub bump: u8,
}
#[event]
pub struct ConfigUpdated {
    pub admin: Pubkey,
    pub guardian: Pubkey,
    pub treasury: Pubkey,
    pub minimum_bond: u64,
    pub cooldown: i64,
}
#[event]
pub struct AgentRegistered {
    pub agent_wallet: Pubkey,
    pub beneficiary: Pubkey,
    pub metadata_hash: [u8; 32],
    pub bond: u64,
    pub unlock_at: i64,
}
#[event]
pub struct BondWithdrawn {
    pub agent_wallet: Pubkey,
    pub bond: u64,
}
#[event]
pub struct AgentPaused {
    pub agent_wallet: Pubkey,
    pub paused: bool,
}
#[event]
pub struct AgentSlashed {
    pub agent_wallet: Pubkey,
    pub bond: u64,
    pub treasury: Pubkey,
}
#[error_code]
pub enum RegistryError {
    #[msg("Not an authorized admin or guardian")]
    Unauthorized,
    #[msg("Bond below configured minimum")]
    BondTooSmall,
    #[msg("Bond cooldown has not elapsed")]
    Cooldown,
    #[msg("Agent is paused")]
    Paused,
    #[msg("Agent has been slashed")]
    Slashed,
    #[msg("Bond already withdrawn")]
    Withdrawn,
    #[msg("Checked arithmetic failed")]
    Overflow,
    #[msg("Invalid configuration")]
    InvalidConfig,
    #[msg("Vault must remain rent exempt")]
    RentReserve,
    #[msg("Invalid SOL destination")]
    InvalidDestination,
}

#[cfg(test)]
mod tests;
