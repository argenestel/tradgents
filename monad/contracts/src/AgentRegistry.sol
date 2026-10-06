// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";

/// @title AgentRegistry
/// @notice Non-custodial directory bond escrow for Tradgents agents.
///         Holds a returnable native MON bond. Does not hold trading keys or
///         route funds. A bond can be slashed by the owner only during a
///         requested unbond cooldown and only with a nonzero reason code.
contract AgentRegistry is Ownable2Step, ReentrancyGuard, EIP712 {
    uint64 public constant MIN_UNBOND_DELAY = 1 days;

    bytes32 public constant REGISTER_TYPEHASH = keccak256(
        "Register(address agentWallet,address ownerWallet,bytes32 metadataHash,uint256 nonce,uint256 deadline)"
    );

    enum Status {
        None,
        Active,
        Paused,
        Slashed,
        Exited
    }

    struct Agent {
        address owner;
        bytes32 metadataHash;
        uint256 bondWei;
        Status status;
        uint64 registeredAt;
        uint64 unbondRequestedAt;
        uint64 withdrawableAt;
    }

    mapping(address => Agent) public agents;
    mapping(address => uint256) public nonces;

    uint256 public minBondWei;
    uint64 public unbondDelay;
    address public guardian;
    address public treasury;

    event AgentRegistered(
        address indexed agentWallet,
        address indexed ownerWallet,
        bytes32 metadataHash,
        uint256 bondWei,
        uint256 nonce
    );
    event UnbondRequested(address indexed agentWallet, uint64 availableAt);
    event BondWithdrawn(address indexed agentWallet, address indexed ownerWallet, uint256 amount);
    event AgentPaused(address indexed agentWallet, address indexed guardian, bytes32 reason);
    event AgentUnpaused(address indexed agentWallet, address indexed guardian);
    event AgentSlashed(address indexed agentWallet, address indexed treasury, uint256 amount, bytes32 reasonCode);
    event MinBondUpdated(uint256 minBondWei);
    event UnbondDelayUpdated(uint64 unbondDelay);
    event GuardianUpdated(address indexed guardian);
    event TreasuryUpdated(address indexed treasury);

    error ZeroAddress();
    error InvalidSignature();
    error DeadlineExpired();
    error InvalidNonce();
    error BondTooLow();
    error AlreadyRegistered();
    error NotRegistered();
    error NotAgentOwner();
    error NotGuardian();
    error CooldownActive();
    error UnbondNotRequested();
    error UnbondAlreadyRequested();
    error NotSlashingWindow();
    error InvalidReasonCode();
    error NotWithdrawable();
    error InvalidStatus();
    error UnbondDelayTooShort();
    error RenounceDisabled();

    modifier onlyGuardian() {
        if (msg.sender != guardian) revert NotGuardian();
        _;
    }

    constructor(address guardian_, address treasury_, uint256 minBondWei_, uint64 unbondDelay_)
        Ownable(msg.sender)
        EIP712("Tradgents", "1")
    {
        if (guardian_ == address(0) || treasury_ == address(0)) revert ZeroAddress();
        if (unbondDelay_ < MIN_UNBOND_DELAY) revert UnbondDelayTooShort();
        guardian = guardian_;
        treasury = treasury_;
        minBondWei = minBondWei_;
        unbondDelay = unbondDelay_;
        emit GuardianUpdated(guardian_);
        emit TreasuryUpdated(treasury_);
        emit MinBondUpdated(minBondWei_);
        emit UnbondDelayUpdated(unbondDelay_);
    }

    /// @notice EIP-712 digest for a Register payload (domain includes chainId + this contract).
    function hashRegister(
        address agentWallet,
        address ownerWallet,
        bytes32 metadataHash,
        uint256 nonce,
        uint256 deadline
    ) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(abi.encode(REGISTER_TYPEHASH, agentWallet, ownerWallet, metadataHash, nonce, deadline))
        );
    }

    /// @notice Register an agent. `signature` must be a valid EIP-712 / ERC-1271
    ///         signature from `agentWallet` over the Register typed data.
    ///         `msg.value` is the native MON bond and must be >= minBondWei.
    function register(
        address agentWallet,
        address ownerWallet,
        bytes32 metadataHash,
        uint256 nonce,
        uint256 deadline,
        bytes calldata signature
    ) external payable nonReentrant {
        if (agentWallet == address(0) || ownerWallet == address(0)) revert ZeroAddress();
        if (agents[agentWallet].status != Status.None) revert AlreadyRegistered();
        if (block.timestamp > deadline) revert DeadlineExpired();
        if (nonce != nonces[agentWallet]) revert InvalidNonce();
        if (msg.value < minBondWei) revert BondTooLow();

        bytes32 digest = hashRegister(agentWallet, ownerWallet, metadataHash, nonce, deadline);
        if (!SignatureChecker.isValidSignatureNow(agentWallet, digest, signature)) {
            revert InvalidSignature();
        }

        // Checks-effects: consume nonce and store agent before any further interaction.
        nonces[agentWallet] = nonce + 1;
        uint64 ts = uint64(block.timestamp);
        agents[agentWallet] = Agent({
            owner: ownerWallet,
            metadataHash: metadataHash,
            bondWei: msg.value,
            status: Status.Active,
            registeredAt: ts,
            unbondRequestedAt: 0,
            withdrawableAt: 0
        });

        emit AgentRegistered(agentWallet, ownerWallet, metadataHash, msg.value, nonce);
    }

    /// @notice Start the unbond cooldown. Registration time never starts withdrawal eligibility.
    function requestUnbond(address agentWallet) external {
        Agent storage a = agents[agentWallet];
        if (a.status == Status.None) revert NotRegistered();
        if (msg.sender != a.owner) revert NotAgentOwner();
        if (a.status != Status.Active) revert InvalidStatus();
        if (a.unbondRequestedAt != 0) revert UnbondAlreadyRequested();
        uint64 availableAt = uint64(block.timestamp) + unbondDelay;
        a.unbondRequestedAt = uint64(block.timestamp);
        a.withdrawableAt = availableAt;
        emit UnbondRequested(agentWallet, availableAt);
    }

    /// @notice Owner withdraws only after explicitly requesting unbond and waiting the full cooldown.
    function withdraw(address agentWallet) external nonReentrant {
        Agent storage a = agents[agentWallet];
        if (a.status == Status.None) revert NotRegistered();
        if (msg.sender != a.owner) revert NotAgentOwner();
        if (a.status != Status.Active) revert NotWithdrawable();
        if (a.unbondRequestedAt == 0) revert UnbondNotRequested();
        if (block.timestamp < a.withdrawableAt) revert CooldownActive();

        uint256 amount = a.bondWei;
        a.bondWei = 0;
        a.status = Status.Exited;

        (bool ok,) = msg.sender.call{value: amount}("");
        if (!ok) revert NotWithdrawable();

        emit BondWithdrawn(agentWallet, msg.sender, amount);
    }

    /// @notice Guardian pauses an active agent. Paused agents cannot withdraw.
    function pauseAgent(address agentWallet, bytes32 reason) external onlyGuardian {
        Agent storage a = agents[agentWallet];
        if (a.status != Status.Active) revert InvalidStatus();
        a.status = Status.Paused;
        emit AgentPaused(agentWallet, msg.sender, reason);
    }

    /// @notice Guardian may unpause a paused (not slashed) agent.
    function unpauseAgent(address agentWallet) external onlyGuardian {
        Agent storage a = agents[agentWallet];
        if (a.status != Status.Paused) revert InvalidStatus();
        a.status = Status.Active;
        emit AgentUnpaused(agentWallet, msg.sender);
    }

    /// @notice Owner may slash only during the owner's requested unbond cooldown, with an auditable reason code.
    function slashAgent(address agentWallet, bytes32 reasonCode) external onlyOwner nonReentrant {
        Agent storage a = agents[agentWallet];
        if (a.status != Status.Active && a.status != Status.Paused) revert InvalidStatus();
        if (a.unbondRequestedAt == 0 || block.timestamp >= a.withdrawableAt) revert NotSlashingWindow();
        if (reasonCode == bytes32(0)) revert InvalidReasonCode();

        uint256 amount = a.bondWei;
        a.bondWei = 0;
        a.status = Status.Slashed;

        address to = treasury;
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert NotWithdrawable();

        emit AgentSlashed(agentWallet, to, amount, reasonCode);
    }

    function setMinBondWei(uint256 minBondWei_) external onlyOwner {
        minBondWei = minBondWei_;
        emit MinBondUpdated(minBondWei_);
    }

    function setUnbondDelay(uint64 unbondDelay_) external onlyOwner {
        if (unbondDelay_ < MIN_UNBOND_DELAY) revert UnbondDelayTooShort();
        unbondDelay = unbondDelay_;
        emit UnbondDelayUpdated(unbondDelay_);
    }

    function renounceOwnership() public pure override {
        revert RenounceDisabled();
    }

    function setGuardian(address guardian_) external onlyOwner {
        if (guardian_ == address(0)) revert ZeroAddress();
        guardian = guardian_;
        emit GuardianUpdated(guardian_);
    }

    function setTreasury(address treasury_) external onlyOwner {
        if (treasury_ == address(0)) revert ZeroAddress();
        treasury = treasury_;
        emit TreasuryUpdated(treasury_);
    }
}
