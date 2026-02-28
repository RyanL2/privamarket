// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IERC8004 - Identity Registry Interface (Stub)
/// @notice Minimal interface for the ERC-8004 Identity Registry on Monad
/// @dev Registry deployed at 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432
interface IIdentityRegistry {
    /// @notice Register the caller as a resolver agent
    function register() external;

    /// @notice Check if an address is a registered agent
    function isRegistered(address agent) external view returns (bool);
}
