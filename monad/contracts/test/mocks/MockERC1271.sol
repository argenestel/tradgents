// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Keyless test wallet that accepts one configured digest/signature pair.
contract MockERC1271 {
    bytes4 internal constant MAGIC = 0x1626ba7e;
    bytes32 private expectedDigest;
    bytes32 private expectedSignatureHash;

    function setExpected(bytes32 digest, bytes32 signatureHash) external {
        expectedDigest = digest;
        expectedSignatureHash = signatureHash;
    }

    function isValidSignature(bytes32 hash, bytes memory signature) external view returns (bytes4) {
        return hash == expectedDigest && keccak256(signature) == expectedSignatureHash ? MAGIC : bytes4(0xffffffff);
    }
}

/// @notice ERC-1271 wallet that always rejects.
contract RejectingERC1271 {
    function isValidSignature(bytes32, bytes memory) external pure returns (bytes4) {
        return 0xffffffff;
    }
}
