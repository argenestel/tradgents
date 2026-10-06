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
    uint256 internal agentPk;
    address internal agentWallet;

    uint256 internal constant MIN_BOND = 1 ether;
    uint64 internal constant COOLDOWN = 7 days;
    bytes32 internal constant META = keccak256("tradgents-meta");

    function setUp() public {
        admin = makeAddr("admin");
        guardian = makeAddr("guardian");
        treasury = makeAddr("treasury");
        ownerWallet = makeAddr("owner");
        (agentWallet, agentPk) = makeAddrAndKey("agent");

        vm.deal(ownerWallet, 100 ether);
        vm.deal(agentWallet, 100 ether);

        vm.prank(admin);
        registry = new AgentRegistry(guardian, treasury, MIN_BOND, COOLDOWN);
    }

    function _sign(address agent, address owner, bytes32 metadataHash, uint256 nonce, uint256 deadline, uint256 pk)
        internal
        view
        returns (bytes memory)
    {
        bytes32 digest = registry.hashRegister(agent, owner, metadataHash, nonce, deadline);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _registerHappy() internal {
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _sign(agentWallet, ownerWallet, META, 0, deadline, agentPk);
        vm.prank(ownerWallet);
        registry.register{value: MIN_BOND}(agentWallet, ownerWallet, META, 0, deadline, sig);
    }

    function test_register_happyPath() public {
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _sign(agentWallet, ownerWallet, META, 0, deadline, agentPk);

        vm.prank(ownerWallet);
        vm.expectEmit(true, true, false, true);
        emit AgentRegistry.AgentRegistered(agentWallet, ownerWallet, META, MIN_BOND, 0);
        registry.register{value: MIN_BOND}(agentWallet, ownerWallet, META, 0, deadline, sig);

        (
            address storedOwner,
            bytes32 storedMeta,
            uint256 bond,
            AgentRegistry.Status status,
            uint64 registeredAt,
            uint64 withdrawableAt
        ) = registry.agents(agentWallet);

        assertEq(storedOwner, ownerWallet);
        assertEq(storedMeta, META);
        assertEq(bond, MIN_BOND);
        assertEq(uint256(status), uint256(AgentRegistry.Status.Active));
        assertEq(registeredAt, uint64(block.timestamp));
        assertEq(withdrawableAt, uint64(block.timestamp + COOLDOWN));
        assertEq(registry.nonces(agentWallet), 1);
        assertEq(address(registry).balance, MIN_BOND);
    }

    function test_register_badSignature() public {
        uint256 deadline = block.timestamp + 1 hours;
        (, uint256 strangerPk) = makeAddrAndKey("stranger");
        bytes memory sig = _sign(agentWallet, ownerWallet, META, 0, deadline, strangerPk);

        vm.prank(ownerWallet);
        vm.expectRevert(AgentRegistry.InvalidSignature.selector);
        registry.register{value: MIN_BOND}(agentWallet, ownerWallet, META, 0, deadline, sig);
    }

    function test_register_expiredDeadline() public {
        uint256 deadline = block.timestamp + 10;
        bytes memory sig = _sign(agentWallet, ownerWallet, META, 0, deadline, agentPk);
        vm.warp(deadline + 1);

        vm.prank(ownerWallet);
        vm.expectRevert(AgentRegistry.DeadlineExpired.selector);
        registry.register{value: MIN_BOND}(agentWallet, ownerWallet, META, 0, deadline, sig);
    }

    function test_register_replay() public {
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _sign(agentWallet, ownerWallet, META, 0, deadline, agentPk);

        vm.prank(ownerWallet);
        registry.register{value: MIN_BOND}(agentWallet, ownerWallet, META, 0, deadline, sig);

        vm.prank(ownerWallet);
        vm.expectRevert(AgentRegistry.AlreadyRegistered.selector);
        registry.register{value: MIN_BOND}(agentWallet, ownerWallet, META, 0, deadline, sig);
    }

    function test_register_replayWrongNonce() public {
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _sign(agentWallet, ownerWallet, META, 1, deadline, agentPk);
        vm.prank(ownerWallet);
        vm.expectRevert(AgentRegistry.InvalidNonce.selector);
        registry.register{value: MIN_BOND}(agentWallet, ownerWallet, META, 1, deadline, sig);
    }

    function test_register_erc1271Signer() public {
        uint256 innerPk;
        address inner;
        (inner, innerPk) = makeAddrAndKey("smart-owner");
        MockERC1271 wallet = new MockERC1271(inner);

        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _sign(address(wallet), ownerWallet, META, 0, deadline, innerPk);

        vm.prank(ownerWallet);
        registry.register{value: MIN_BOND}(address(wallet), ownerWallet, META, 0, deadline, sig);

        (address storedOwner,, uint256 bond, AgentRegistry.Status status,,) = registry.agents(address(wallet));
        assertEq(storedOwner, ownerWallet);
        assertEq(bond, MIN_BOND);
        assertEq(uint256(status), uint256(AgentRegistry.Status.Active));
        assertEq(registry.nonces(address(wallet)), 1);
    }

    function test_register_erc1271Rejects() public {
        RejectingERC1271 wallet = new RejectingERC1271();
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _sign(agentWallet, ownerWallet, META, 0, deadline, agentPk);

        vm.prank(ownerWallet);
        vm.expectRevert(AgentRegistry.InvalidSignature.selector);
        registry.register{value: MIN_BOND}(address(wallet), ownerWallet, META, 0, deadline, sig);
    }

    function test_register_bondBelowMinimum() public {
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _sign(agentWallet, ownerWallet, META, 0, deadline, agentPk);
        vm.prank(ownerWallet);
        vm.expectRevert(AgentRegistry.BondTooLow.selector);
        registry.register{value: MIN_BOND - 1}(agentWallet, ownerWallet, META, 0, deadline, sig);
    }

    function test_register_zeroAddresses() public {
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _sign(agentWallet, ownerWallet, META, 0, deadline, agentPk);
        vm.prank(ownerWallet);
        vm.expectRevert(AgentRegistry.ZeroAddress.selector);
        registry.register{value: MIN_BOND}(address(0), ownerWallet, META, 0, deadline, sig);
    }

    function test_withdraw_beforeCooldown() public {
        _registerHappy();
        vm.prank(ownerWallet);
        vm.expectRevert(AgentRegistry.CooldownActive.selector);
        registry.withdrawBond(agentWallet);
    }

    function test_withdraw_afterCooldown() public {
        _registerHappy();
        vm.warp(block.timestamp + COOLDOWN);

        uint256 beforeOwner = ownerWallet.balance;
        uint256 beforeReg = address(registry).balance;

        vm.prank(ownerWallet);
        vm.expectEmit(true, true, false, true);
        emit AgentRegistry.BondWithdrawn(agentWallet, ownerWallet, MIN_BOND);
        registry.withdrawBond(agentWallet);

        (,, uint256 bond, AgentRegistry.Status status,,) = registry.agents(agentWallet);
        assertEq(bond, 0);
        assertEq(uint256(status), uint256(AgentRegistry.Status.Exited));
        assertEq(ownerWallet.balance, beforeOwner + MIN_BOND);
        assertEq(address(registry).balance, beforeReg - MIN_BOND);
    }

    function test_withdraw_pausedCannotWithdraw() public {
        _registerHappy();
        vm.warp(block.timestamp + COOLDOWN);
        vm.prank(guardian);
        registry.pauseAgent(agentWallet, bytes32("pause"));

        vm.prank(ownerWallet);
        vm.expectRevert(AgentRegistry.NotWithdrawable.selector);
        registry.withdrawBond(agentWallet);
    }

    function test_withdraw_slashedCannotWithdraw() public {
        _registerHappy();
        vm.warp(block.timestamp + COOLDOWN);
        vm.prank(admin);
        registry.slashAgent(agentWallet, bytes32("dispute"));

        vm.prank(ownerWallet);
        vm.expectRevert(AgentRegistry.NotWithdrawable.selector);
        registry.withdrawBond(agentWallet);
        assertEq(treasury.balance, MIN_BOND);
        assertEq(address(registry).balance, 0);
    }

    function test_reentrancyAttempt() public {
        ReentrantOwner attacker = new ReentrantOwner();
        vm.deal(address(attacker), 10 ether);
        attacker.setRegistry(address(registry));
        attacker.setAgent(agentWallet);

        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _sign(agentWallet, address(attacker), META, 0, deadline, agentPk);
        vm.prank(address(attacker));
        registry.register{value: MIN_BOND}(agentWallet, address(attacker), META, 0, deadline, sig);

        vm.warp(block.timestamp + COOLDOWN);
        attacker.withdraw();

        // Bond paid out once; nested reenter failed.
        assertEq(attacker.hits(), 1);
        assertEq(attacker.nestedFailures(), 1);
        assertEq(address(attacker).balance, 10 ether);
        assertEq(address(registry).balance, 0);
        (,, uint256 bond, AgentRegistry.Status status,,) = registry.agents(agentWallet);
        assertEq(bond, 0);
        assertEq(uint256(status), uint256(AgentRegistry.Status.Exited));
    }

    function test_accessControl() public {
        address stranger = makeAddr("stranger");

        vm.prank(stranger);
        vm.expectRevert();
        registry.setMinBondWei(2 ether);

        vm.prank(stranger);
        vm.expectRevert();
        registry.setUnbondDelay(1 days);

        vm.prank(stranger);
        vm.expectRevert();
        registry.setGuardian(stranger);

        vm.prank(stranger);
        vm.expectRevert();
        registry.setTreasury(stranger);

        vm.prank(stranger);
        vm.expectRevert(AgentRegistry.NotGuardian.selector);
        registry.pauseAgent(agentWallet, bytes32(0));

        vm.prank(guardian);
        vm.expectRevert();
        registry.slashAgent(agentWallet, bytes32(0));

        vm.prank(admin);
        vm.expectRevert(AgentRegistry.NotGuardian.selector);
        registry.pauseAgent(agentWallet, bytes32(0));

        _registerHappy();

        vm.prank(admin);
        registry.setMinBondWei(2 ether);
        assertEq(registry.minBondWei(), 2 ether);

        vm.prank(admin);
        registry.setGuardian(stranger);
        assertEq(registry.guardian(), stranger);

        vm.prank(stranger);
        registry.pauseAgent(agentWallet, bytes32("ok"));
        (, , , AgentRegistry.Status status, ,) = registry.agents(agentWallet);
        assertEq(uint256(status), uint256(AgentRegistry.Status.Paused));

        vm.prank(stranger);
        vm.expectRevert();
        registry.slashAgent(agentWallet, bytes32("no"));

        vm.prank(admin);
        registry.slashAgent(agentWallet, bytes32("dispute"));
        (, , , status, ,) = registry.agents(agentWallet);
        assertEq(uint256(status), uint256(AgentRegistry.Status.Slashed));
        assertEq(treasury.balance, MIN_BOND);
    }

    function test_withdraw_notOwner() public {
        _registerHappy();
        vm.warp(block.timestamp + COOLDOWN);
        vm.prank(makeAddr("thief"));
        vm.expectRevert(AgentRegistry.NotAgentOwner.selector);
        registry.withdrawBond(agentWallet);
    }

    function test_eip712Domain() public view {
        (
            ,
            string memory name,
            string memory version,
            uint256 chainId,
            address verifyingContract,
            ,
        ) = registry.eip712Domain();
        assertEq(name, "Tradgents");
        assertEq(version, "1");
        assertEq(chainId, block.chainid);
        assertEq(verifyingContract, address(registry));
    }
}
