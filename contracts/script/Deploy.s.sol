// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {PrivateMarket} from "../src/PrivateMarket.sol";
import {IIdentityRegistry} from "../src/interfaces/IERC8004.sol";

contract DeployScript is Script {
    address constant IDENTITY_REGISTRY = 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432;
    error MissingWMONAddress();

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(deployerKey);

        // 1. Resolve WMON collateral token
        address wmon = vm.envAddress("WMON_ADDRESS");
        if (wmon == address(0)) revert MissingWMONAddress();
        console.log("WMON:", wmon);

        // 2. Deploy PrivateMarket with WMON collateral
        PrivateMarket market = new PrivateMarket(wmon);
        console.log("PrivateMarket deployed:", address(market));

        // 3. Register as ERC-8004 agent (best-effort, skip if registry not deployed)
        if (IDENTITY_REGISTRY.code.length > 0) {
            try IIdentityRegistry(IDENTITY_REGISTRY).register() {
                console.log("Registered as ERC-8004 agent");
            } catch {
                console.log("ERC-8004 registration failed (call reverted)");
            }
        } else {
            console.log("ERC-8004 registry not deployed, skipping registration");
        }

        // 4. Create demo markets
        market.createMarket(
            "Will Monad mainnet launch by Q3 2026?",
            block.timestamp + 90 days,
            5 // 5 second batch interval
        );
        console.log("Demo market 0 created");

        market.createMarket("Will ETH be above $5000 by end of 2026?", block.timestamp + 180 days, 5);
        console.log("Demo market 1 created");

        vm.stopBroadcast();
    }
}
