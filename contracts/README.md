# VerdictOracle

Onchain record of verdictagent verdicts on **Robinhood Chain** (chain id 4663). Any agent or contract can read the latest verdict for a token and check it against the inputs it commits to.

- **Holds no funds.** No payable function, no `receive`, no `fallback`.
- **Not upgradeable.** The reviewed bytecode is the running bytecode.
- **Two roles.** The *owner* (use a multisig) adds or removes attesters and can pause writes. The *attester* (the verdictagent server key) can only call `attest`.
- **Forward only.** A token's verdict can only be replaced by one with a later `evaluatedAt`, so an old verdict cannot be replayed over a newer one.
- **Verifiable.** `inputsHash = keccak256(canonical JSON of the scored inputs)`. Take the snapshot from the API, re-run the open-source engine, compare.

```solidity
function verdictOf(address token) external view returns (Verdict memory);   // evaluatedAt == 0 → none
function isHealthy(address token, uint8 minScore, uint64 maxAge) external view returns (bool);
```

`isHealthy` lets another contract refuse to touch a token that has no fresh verdict, scores below `minScore`, or is labelled COLLAPSING or DEAD:

```solidity
require(IVerdictOracle(ORACLE).isHealthy(token, 55, 1 hours), "verdict: not healthy");
```

## Develop

```bash
forge install foundry-rs/forge-std --no-git
forge test                 # 22 tests incl. fuzzing (1024 runs each)
forge coverage             # 100% lines / functions
forge test --gas-report    # attest ≈ 68k gas
```

## Deploy to Robinhood Chain mainnet

Checklist before mainnet:

- [ ] An independent review or audit of `src/VerdictOracle.sol`. It holds no funds, but other contracts may rely on `isHealthy`.
- [ ] A multisig (e.g. Safe on Robinhood Chain) to be the owner.
- [ ] A fresh attester key used for nothing else, funded with a little ETH for gas.
- [ ] A deployer key with a little ETH, kept in an encrypted keystore (never a raw private key on the command line).

```bash
export ROBINHOOD_RPC_URL=https://rpc-robinhood.globalstake.io
cast wallet import deployer --interactive            # encrypted keystore, asks for the key once

export ATTESTER=0x...   # address of the server attester key
export OWNER=0x...      # the multisig

# dry run first (no --broadcast), check the printed addresses
forge script script/Deploy.s.sol --rpc-url robinhood --account deployer
# then for real, with verification on Blockscout
forge script script/Deploy.s.sol --rpc-url robinhood --account deployer --broadcast --verify
```

Then from the multisig, call `acceptOwnership()` on the printed address. Until that happens the deployer is still the owner.

Point the API at it (`.env`):

```
ORACLE_ADDRESS=0x...            # printed by the script
ORACLE_CHAIN_ID=4663
ATTESTER_PRIVATE_KEY=0x...      # the attester key, server side only
API_KEYS=<key>:attest|watch     # who may trigger onchain writes (each costs gas)
```

`/v1/health` shows `oracle.canAttest: true` when the server key is authorised.

## Verified locally

Deployed with this script on a local chain (anvil, chain id 4663). The server then scanned a live Robinhood Chain token, wrote the verdict with `verdict_attest_token`, and read it back with `cast call verdictOf`. A second attest with identical inputs sent no transaction. Ownership was handed over, and after that the old deployer and the attester were refused admin calls. Sending ETH to the contract reverted.
