// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {VerdictOracle} from "../src/VerdictOracle.sol";

/// @notice Deploys VerdictOracle, authorises the attester, then hands ownership to OWNER.
///
/// Env:
///   ATTESTER  address the verdictagent server signs with (hot key, can only write verdicts)
///   OWNER     final owner, ideally a multisig; it must call acceptOwnership() afterwards
///
/// Mainnet (never pass a raw private key; use an encrypted keystore):
///   cast wallet import deployer --interactive
///   forge script script/Deploy.s.sol --rpc-url robinhood --account deployer --broadcast --verify
contract Deploy is Script {
    function run() external returns (VerdictOracle oracle) {
        address attester = vm.envAddress("ATTESTER");
        address finalOwner = vm.envAddress("OWNER");
        require(attester != address(0) && finalOwner != address(0), "ATTESTER and OWNER required");
        require(attester != finalOwner, "attester must not be the owner");

        vm.startBroadcast();
        address deployer = msg.sender;
        oracle = new VerdictOracle(deployer);
        oracle.setAttester(attester, true);
        if (finalOwner != deployer) oracle.transferOwnership(finalOwner);
        vm.stopBroadcast();

        console2.log("chain id      ", block.chainid);
        console2.log("VerdictOracle ", address(oracle));
        console2.log("attester      ", attester);
        console2.log("pending owner ", finalOwner == deployer ? address(0) : finalOwner);
        if (finalOwner != deployer) console2.log("next: OWNER must call acceptOwnership()");
    }
}
