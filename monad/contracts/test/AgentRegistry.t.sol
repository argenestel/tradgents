// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {AgentRegistry} from "../src/AgentRegistry.sol";
import {MockERC1271, RejectingERC1271} from "./mocks/MockERC1271.sol";
import {ReentrantOwner} from "./mocks/ReentrantOwner.sol";

contract AgentRegistryTest is Test {
    AgentRegistry internal registry;
    address internal admin;
    address internal guardian;
    address internal treasury;
    address internal ownerWallet;
    address internal agentWallet;

    uint256 internal constant MIN_BOND = 1 ether;
    uint64 internal constant COOLDOWN = 7 days;
    bytes32 internal constant META = keccak256("tradgents-meta");
    bytes32 internal constant REASON = keccak256("verified dispute reference 42");

    function setUp() public {
        admin = makeAddr("admin"); guardian = makeAddr("guardian"); treasury = makeAddr("treasury");
        ownerWallet = makeAddr("owner"); agentWallet = address(new MockERC1271());
        vm.deal(ownerWallet, 100 ether); vm.deal(agentWallet, 100 ether);
        vm.prank(admin); registry = new AgentRegistry(guardian, treasury, MIN_BOND, COOLDOWN);
    }

    function _signature() internal pure returns (bytes memory) {
        return abi.encodePacked(bytes32(uint256(1)), bytes32(uint256(2)), uint8(27));
    }

    function _sign(address agent, address owner, bytes32 metadataHash, uint256 nonce, uint256 deadline) internal returns (bytes memory) {
        bytes memory signature = _signature();
        if (agent.code.length > 0) {
            MockERC1271(agent).setExpected(registry.hashRegister(agent, owner, metadataHash, nonce, deadline), keccak256(signature));
        }
        return signature;
    }

    function _registerHappy() internal {
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _sign(agentWallet, ownerWallet, META, 0, deadline);
        vm.prank(ownerWallet); registry.register{value: MIN_BOND}(agentWallet, ownerWallet, META, 0, deadline, sig);
    }

    function _requestUnbond() internal { vm.prank(ownerWallet); registry.requestUnbond(agentWallet); }

    function test_register_happyPathAndCooldownDoesNotStartAtRegistration() public {
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _sign(agentWallet, ownerWallet, META, 0, deadline);
        vm.prank(ownerWallet);
        vm.expectEmit(true, true, false, true);
        emit AgentRegistry.AgentRegistered(agentWallet, ownerWallet, META, MIN_BOND, 0);
        registry.register{value: MIN_BOND}(agentWallet, ownerWallet, META, 0, deadline, sig);
        (address storedOwner, bytes32 storedMeta, uint256 bond, AgentRegistry.Status status, uint64 registeredAt, uint64 requestedAt, uint64 withdrawableAt) = registry.agents(agentWallet);
        assertEq(storedOwner, ownerWallet); assertEq(storedMeta, META); assertEq(bond, MIN_BOND);
        assertEq(uint256(status), uint256(AgentRegistry.Status.Active)); assertEq(registeredAt, uint64(block.timestamp));
        assertEq(requestedAt, 0); assertEq(withdrawableAt, 0); assertEq(registry.nonces(agentWallet), 1);
        vm.warp(block.timestamp + 30 days); vm.prank(ownerWallet);
        vm.expectRevert(AgentRegistry.UnbondNotRequested.selector); registry.withdraw(agentWallet);
    }

    function test_register_badSignature() public {
        uint256 deadline = block.timestamp + 1 hours; bytes memory sig = _signature();
        vm.prank(ownerWallet); vm.expectRevert(AgentRegistry.InvalidSignature.selector);
        registry.register{value: MIN_BOND}(agentWallet, ownerWallet, META, 0, deadline, sig);
    }

    function test_register_expiredDeadline() public {
        uint256 deadline = block.timestamp + 10; bytes memory sig = _sign(agentWallet, ownerWallet, META, 0, deadline);
        vm.warp(deadline + 1); vm.prank(ownerWallet); vm.expectRevert(AgentRegistry.DeadlineExpired.selector);
        registry.register{value: MIN_BOND}(agentWallet, ownerWallet, META, 0, deadline, sig);
    }

    function test_register_replayAndWrongNonce() public {
        uint256 deadline = block.timestamp + 1 hours; bytes memory sig = _sign(agentWallet, ownerWallet, META, 0, deadline);
        vm.prank(ownerWallet); registry.register{value: MIN_BOND}(agentWallet, ownerWallet, META, 0, deadline, sig);
        vm.prank(ownerWallet); vm.expectRevert(AgentRegistry.AlreadyRegistered.selector);
        registry.register{value: MIN_BOND}(agentWallet, ownerWallet, META, 0, deadline, sig);
        address second = makeAddr("second"); vm.deal(second, 2 ether);
        vm.prank(ownerWallet); vm.expectRevert(AgentRegistry.InvalidNonce.selector);
        registry.register{value: MIN_BOND}(second, ownerWallet, META, 1, deadline, _signature());
    }

    function test_register_erc1271Signer() public {
        MockERC1271 wallet = new MockERC1271(); uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _sign(address(wallet), ownerWallet, META, 0, deadline);
        vm.prank(ownerWallet); registry.register{value: MIN_BOND}(address(wallet), ownerWallet, META, 0, deadline, sig);
        (address storedOwner,, uint256 bond, AgentRegistry.Status status,,,) = registry.agents(address(wallet));
        assertEq(storedOwner, ownerWallet); assertEq(bond, MIN_BOND);
        assertEq(uint256(status), uint256(AgentRegistry.Status.Active)); assertEq(registry.nonces(address(wallet)), 1);
    }

    function test_register_erc1271Rejects() public {
        RejectingERC1271 wallet = new RejectingERC1271(); uint256 deadline = block.timestamp + 1 hours;
        vm.prank(ownerWallet); vm.expectRevert(AgentRegistry.InvalidSignature.selector);
        registry.register{value: MIN_BOND}(address(wallet), ownerWallet, META, 0, deadline, _signature());
    }

    function test_register_bondAndAddressChecks() public {
        uint256 deadline = block.timestamp + 1 hours; bytes memory sig = _sign(agentWallet, ownerWallet, META, 0, deadline);
        vm.prank(ownerWallet); vm.expectRevert(AgentRegistry.BondTooLow.selector);
        registry.register{value: MIN_BOND - 1}(agentWallet, ownerWallet, META, 0, deadline, sig);
        vm.prank(ownerWallet); vm.expectRevert(AgentRegistry.ZeroAddress.selector);
        registry.register{value: MIN_BOND}(address(0), ownerWallet, META, 0, deadline, sig);
    }

    function test_requestUnbondOwnerOnlyAndSingleRequest() public {
        _registerHappy(); vm.prank(makeAddr("stranger")); vm.expectRevert(AgentRegistry.NotAgentOwner.selector);
        registry.requestUnbond(agentWallet);
        _requestUnbond(); vm.prank(ownerWallet); vm.expectRevert(AgentRegistry.UnbondAlreadyRequested.selector);
        registry.requestUnbond(agentWallet);
    }

    function test_requestUnbondStartsCooldownAndWithdrawalAfterCooldown() public {
        _registerHappy(); uint64 requestTime = uint64(block.timestamp); uint64 availableAt = requestTime + COOLDOWN;
        vm.prank(ownerWallet); vm.expectEmit(true, false, false, true);
        emit AgentRegistry.UnbondRequested(agentWallet, availableAt); registry.requestUnbond(agentWallet);
        (,,,,, uint64 requestedAt, uint64 withdrawableAt) = registry.agents(agentWallet);
        assertEq(requestedAt, requestTime); assertEq(withdrawableAt, availableAt);
        vm.warp(availableAt - 1); vm.prank(ownerWallet); vm.expectRevert(AgentRegistry.CooldownActive.selector); registry.withdraw(agentWallet);
        vm.warp(availableAt); uint256 beforeBalance = ownerWallet.balance; vm.prank(ownerWallet);
        vm.expectEmit(true, true, false, true); emit AgentRegistry.BondWithdrawn(agentWallet, ownerWallet, MIN_BOND);
        registry.withdraw(agentWallet);
        (,, uint256 bond, AgentRegistry.Status status,,,) = registry.agents(agentWallet);
        assertEq(bond, 0); assertEq(uint256(status), uint256(AgentRegistry.Status.Exited));
        assertEq(ownerWallet.balance, beforeBalance + MIN_BOND);
    }

    function test_withdraw_pausedCannotWithdraw() public {
        _registerHappy(); _requestUnbond(); vm.warp(block.timestamp + COOLDOWN);
        vm.prank(guardian); registry.pauseAgent(agentWallet, bytes32("pause"));
        vm.prank(ownerWallet); vm.expectRevert(AgentRegistry.NotWithdrawable.selector); registry.withdraw(agentWallet);
    }

    function test_slashRequiresCooldownAndNonzeroReasonAndEmitsReasonCode() public {
        _registerHappy(); vm.prank(admin); vm.expectRevert(AgentRegistry.NotSlashingWindow.selector); registry.slashAgent(agentWallet, REASON);
        _requestUnbond(); vm.prank(admin); vm.expectRevert(AgentRegistry.InvalidReasonCode.selector); registry.slashAgent(agentWallet, bytes32(0));
        vm.prank(admin); vm.expectEmit(true, true, false, true);
        emit AgentRegistry.AgentSlashed(agentWallet, treasury, MIN_BOND, REASON); registry.slashAgent(agentWallet, REASON);
        (,, uint256 bond, AgentRegistry.Status status,,,) = registry.agents(agentWallet);
        assertEq(bond, 0); assertEq(uint256(status), uint256(AgentRegistry.Status.Slashed)); assertEq(treasury.balance, MIN_BOND);
        vm.prank(ownerWallet); vm.expectRevert(AgentRegistry.NotWithdrawable.selector); registry.withdraw(agentWallet);
    }

    function test_slashWindowClosesAtCooldownEnd() public {
        _registerHappy(); _requestUnbond(); vm.warp(block.timestamp + COOLDOWN); vm.prank(admin);
        vm.expectRevert(AgentRegistry.NotSlashingWindow.selector); registry.slashAgent(agentWallet, REASON);
    }

    function test_unpauseEmitsCorrectEvent() public {
        _registerHappy(); vm.prank(guardian); registry.pauseAgent(agentWallet, bytes32("pause")); vm.prank(guardian);
        vm.expectEmit(true, true, false, true); emit AgentRegistry.AgentUnpaused(agentWallet, guardian); registry.unpauseAgent(agentWallet);
    }

    function test_reentrancyAttempt() public {
        ReentrantOwner attacker = new ReentrantOwner(); vm.deal(address(attacker), 10 ether);
        attacker.setRegistry(address(registry)); attacker.setAgent(agentWallet);
        uint256 deadline = block.timestamp + 1 hours; bytes memory sig = _sign(agentWallet, address(attacker), META, 0, deadline);
        vm.prank(address(attacker)); registry.register{value: MIN_BOND}(agentWallet, address(attacker), META, 0, deadline, sig);
        vm.prank(address(attacker)); registry.requestUnbond(agentWallet); vm.warp(block.timestamp + COOLDOWN); attacker.withdraw();
        assertEq(attacker.hits(), 1); assertEq(attacker.nestedFailures(), 1); assertEq(address(attacker).balance, 10 ether);
        assertEq(address(registry).balance, 0);
        (,, uint256 bond, AgentRegistry.Status status,,,) = registry.agents(agentWallet);
        assertEq(bond, 0); assertEq(uint256(status), uint256(AgentRegistry.Status.Exited));
    }

    function test_ownerTransferIsTwoStep() public {
        address next = makeAddr("next-owner"); vm.prank(admin); registry.transferOwnership(next);
        assertEq(registry.owner(), admin); assertEq(registry.pendingOwner(), next);
        vm.prank(next); registry.acceptOwnership(); assertEq(registry.owner(), next); assertEq(registry.pendingOwner(), address(0));
        vm.prank(admin); vm.expectRevert(); registry.setMinBondWei(2 ether);
        vm.prank(next); registry.setMinBondWei(2 ether); assertEq(registry.minBondWei(), 2 ether);
    }

    function test_accessControlAndSettings() public {
        address stranger = makeAddr("stranger"); vm.prank(stranger); vm.expectRevert(); registry.setMinBondWei(2 ether);
        vm.prank(stranger); vm.expectRevert(); registry.setUnbondDelay(1 days);
        vm.prank(stranger); vm.expectRevert(); registry.setGuardian(stranger);
        vm.prank(stranger); vm.expectRevert(); registry.setTreasury(stranger);
        vm.prank(stranger); vm.expectRevert(AgentRegistry.NotGuardian.selector); registry.pauseAgent(agentWallet, bytes32(0));
        vm.prank(guardian); vm.expectRevert(); registry.slashAgent(agentWallet, REASON);
        _registerHappy(); _requestUnbond(); vm.prank(admin); registry.setMinBondWei(2 ether); assertEq(registry.minBondWei(), 2 ether);
        vm.prank(admin); registry.setGuardian(stranger); assertEq(registry.guardian(), stranger);
        vm.prank(stranger); registry.pauseAgent(agentWallet, bytes32("ok"));
        (,,, AgentRegistry.Status status,,,) = registry.agents(agentWallet); assertEq(uint256(status), uint256(AgentRegistry.Status.Paused));
        vm.prank(stranger); vm.expectRevert(); registry.slashAgent(agentWallet, REASON);
        vm.prank(admin); registry.slashAgent(agentWallet, REASON);
        (,,, status,,,) = registry.agents(agentWallet); assertEq(uint256(status), uint256(AgentRegistry.Status.Slashed));
    }

    function test_withdraw_notOwner() public {
        _registerHappy(); _requestUnbond(); vm.warp(block.timestamp + COOLDOWN);
        vm.prank(makeAddr("thief")); vm.expectRevert(AgentRegistry.NotAgentOwner.selector); registry.withdraw(agentWallet);
    }

    function test_eip712Domain() public view {
        (, string memory name, string memory version, uint256 chainId, address verifyingContract,,) = registry.eip712Domain();
        assertEq(name, "Tradgents"); assertEq(version, "1"); assertEq(chainId, block.chainid); assertEq(verifyingContract, address(registry));
    }
}
