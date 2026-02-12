// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/Clawdice.sol";
import "../src/ClawdiceVault.sol";
import "../src/interfaces/IUniswapV4.sol";

contract RedeployClawdice is Script {
    // Base Sepolia addresses
    address constant WETH = 0x4200000000000000000000000000000000000006;
    address constant UNIVERSAL_ROUTER = 0x492E6456D9528771018DeB9E87ef7750EF184104;
    address constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    address constant CLAW_TOKEN = 0xD2C1CB4556ca49Ac6C7A5bc71657bD615500057c;
    address payable constant EXISTING_VAULT = payable(0xA186fa18f9889097F7F7746378932b50f5A91E61);

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        console.log("Deployer:", deployer);
        console.log("Redeploying Clawdice with fixed action codes...");

        // Create pool key (WETH < CLAW by address)
        PoolKey memory poolKey = PoolKey({
            currency0: Currency.wrap(WETH),
            currency1: Currency.wrap(CLAW_TOKEN),
            fee: 10000,
            tickSpacing: 200,
            hooks: address(0)
        });

        vm.startBroadcast(deployerPrivateKey);

        // Deploy new Clawdice
        Clawdice clawdice = new Clawdice(EXISTING_VAULT, WETH, UNIVERSAL_ROUTER, PERMIT2, poolKey);
        console.log("New Clawdice deployed at:", address(clawdice));

        // Update vault to point to new Clawdice
        ClawdiceVault(EXISTING_VAULT).setClawdice(address(clawdice));
        console.log("Vault updated to use new Clawdice");

        vm.stopBroadcast();
    }
}
