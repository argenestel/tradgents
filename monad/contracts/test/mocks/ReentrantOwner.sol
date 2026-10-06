// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IAgentRegistry {
    function withdraw(address agentWallet) external;
    function register(
        address agentWallet,
        address ownerWallet,
        bytes32 metadataHash,
        uint256 nonce,
        uint256 deadline,
        bytes calldata signature
    ) external payable;
}

/// @notice Owner that tries to reenter withdraw when receiving the bond.
contract ReentrantOwner {
    IAgentRegistry public registry;
    address public agent;
    uint256 public hits;
    uint256 public nestedFailures;

    function setRegistry(address registry_) external {
        registry = IAgentRegistry(registry_);
    }

    function setAgent(address agent_) external {
        agent = agent_;
    }

    function withdraw() external {
        registry.withdraw(agent);
    }

    receive() external payable {
        hits++;
        if (address(registry) != address(0) && agent != address(0) && hits < 4) {
            try registry.withdraw(agent) {
                // should not succeed
            } catch {
                nestedFailures++;
            }
        }
    }
}
