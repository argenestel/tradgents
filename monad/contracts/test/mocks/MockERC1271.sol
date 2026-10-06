// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Minimal ERC-1271 wallet that treats signatures from `owner` as valid.
contract MockERC1271 {
    bytes4 internal constant MAGIC = 0x1626ba7e;
    address public immutable owner;

    constructor(address owner_) {
        owner = owner_;
    }

    function isValidSignature(bytes32 hash, bytes memory signature) external view returns (bytes4) {
        if (signature.length != 65) return 0xffffffff;
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := mload(add(signature, 0x20))
            s := mload(add(signature, 0x40))
            v := byte(0, mload(add(signature, 0x60)))
        }
        if (v < 27) v += 27;
        address recovered = ecrecover(hash, v, r, s);
        if (recovered != address(0) && recovered == owner) return MAGIC;
        return 0xffffffff;
    }
}

/// @notice ERC-1271 wallet that always rejects.
contract RejectingERC1271 {
    function isValidSignature(bytes32, bytes memory) external pure returns (bytes4) {
        return 0xffffffff;
    }
}
