// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "lib/openzeppelin-contracts/contracts/token/ERC20/ERC20.sol";

/// @title PrivaUSD
/// @notice Collateral ERC-20 token for PrivaMarket prediction markets
/// @dev Has a public faucet for demo/testnet usage, capped at 10,000 per call
contract PrivaUSD is ERC20 {
    uint256 public constant MAX_FAUCET_AMOUNT = 10_000 ether;

    error FaucetAmountTooLarge();

    constructor() ERC20("PrivaUSD", "PUSD") {}

    /// @notice Mint tokens for free (testnet faucet)
    /// @param amount Amount to mint (max 10,000 tokens)
    function faucet(uint256 amount) external {
        if (amount > MAX_FAUCET_AMOUNT) revert FaucetAmountTooLarge();
        _mint(msg.sender, amount);
    }
}
