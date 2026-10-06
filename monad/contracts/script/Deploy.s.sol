// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {AgentRegistry} from "../src/AgentRegistry.sol";

/// @notice Deploy AgentRegistry. Key is read from DEPLOYER_PRIVATE_KEY only.
///         Do not broadcast to a public network from automation — the human
///         deploys with a funded key. See README.md for Monad testnet commands.
contract Deploy is Script {
    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address guardian = vm.envAddress("GUARDIAN");
        address treasury = vm.envAddress("TREASURY");
        uint256 minBond = vm.envOr("MIN_BOND_WEI", uint256(0.1 ether));
        uint64 delay = uint64(vm.envOr("UNBOND_DELAY", uint256(7 days)));

        vm.startBroadcast(pk);
        AgentRegistry registry = new AgentRegistry(guardian, treasury, minBond, delay);
        vm.stopBroadcast();

        console.log("AgentRegistry", address(registry));
        console.log("owner", registry.owner());
        console.log("guardian", registry.guardian());
        console.log("treasury", registry.treasury());
        console.log("minBondWei", registry.minBondWei());
        console.log("unbondDelay", uint256(registry.unbondDelay()));
        console.log("chainId", block.chainid);
    }
}
