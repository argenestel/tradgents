// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Local Anvil-only deterministic Pyth stand-in for indexer tests.
contract TestPyth {
    error TestnetOnly(uint256 actualChainId);
    bytes32 private constant MON_FEED = 0x31491744e2dbf6df7fcf4ac0820d18a609b49076d45066d3568424e62f686cd1;

    struct Price { int64 price; uint64 conf; int32 expo; uint256 publishTime; }
    constructor() { if (block.chainid != 10143) revert TestnetOnly(block.chainid); }

    function getPriceUnsafe(bytes32 id) external view returns (Price memory value) {
        value.price = id == MON_FEED ? int64(20_000_000) : int64(100_000_000);
        value.conf = 0;
        value.expo = -8;
        value.publishTime = block.timestamp;
    }
}
