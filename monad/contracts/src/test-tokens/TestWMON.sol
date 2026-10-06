// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Minimal WETH9-compatible wrapped native token for local testnet DEX fixtures.
/// @dev Deployment reverts on every chain except 10143; never use on mainnet.
contract TestWMON {
    error TestnetOnly(uint256 actualChainId);
    error InsufficientBalance();
    error InsufficientAllowance();

    string public constant name = "Wrapped MON";
    string public constant symbol = "WMON";
    uint8 public constant decimals = 18;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Approval(address indexed owner, address indexed spender, uint256 value);
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Deposit(address indexed dst, uint256 wad);
    event Withdrawal(address indexed src, uint256 wad);

    constructor() {
        if (block.chainid != 10143) revert TestnetOnly(block.chainid);
    }

    receive() external payable { deposit(); }

    function deposit() public payable {
        balanceOf[msg.sender] += msg.value;
        emit Deposit(msg.sender, msg.value);
        emit Transfer(address(0), msg.sender, msg.value);
    }

    function withdraw(uint256 amount) external {
        if (balanceOf[msg.sender] < amount) revert InsufficientBalance();
        unchecked { balanceOf[msg.sender] -= amount; }
        emit Withdrawal(msg.sender, amount);
        emit Transfer(msg.sender, address(0), amount);
        (bool ok,) = msg.sender.call{value: amount}("");
        require(ok, "native transfer failed");
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed < amount) revert InsufficientAllowance();
        if (allowed != type(uint256).max) allowance[from][msg.sender] = allowed - amount;
        _transfer(from, to, amount);
        return true;
    }

    function _transfer(address from, address to, uint256 amount) private {
        if (balanceOf[from] < amount) revert InsufficientBalance();
        require(to != address(0), "zero recipient");
        unchecked { balanceOf[from] -= amount; balanceOf[to] += amount; }
        emit Transfer(from, to, amount);
    }
}
