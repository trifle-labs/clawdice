# Clawdice: Provably Fair On-Chain Dice

A commit-reveal dice game inspired by Satoshi Dice / Just Dice with staking pool mechanics.

## Overview

Clawdice is a provably fair gambling protocol where:
- Players bet ETH with customizable odds (e.g., 50% chance to 2x)
- Randomness derived from future block hash (commit-reveal pattern)
- House bank accepts stakes from LPs who share in profits/losses
- Kelly Criterion used to calculate safe maximum bet sizes
- ERC-4626 vault tokens represent LP positions

## Core Mechanics

### Betting Flow

```
1. COMMIT: Player submits bet(amount, targetOdds)
   - Bet recorded with current block number (N)
   - Funds locked in contract

2. REVEAL: After block N+1 is mined
   - Random number = uint256(blockhash(N+1)) / MAX_UINT256  → [0, 1)
   - If random < adjustedOdds → WIN
   - adjustedOdds = targetOdds * (1 - houseEdge)

3. CLAIM: Winner calls claim(betId)
   - Payout = betAmount / targetOdds
   - Must claim within 256 blocks (blockhash availability)

4. EXPIRE: Unclaimed bets after 1 hour
   - Swept by cleanup hook (max 5 per tx)
   - Expired bet funds go to house pool
```

### Odds & Payouts

| Target Odds | Win Probability | Payout Multiplier | House Edge (1%) |
|-------------|-----------------|-------------------|-----------------|
| 0.50        | 50%             | 2.00x             | 49.5% actual    |
| 0.25        | 25%             | 4.00x             | 24.75% actual   |
| 0.75        | 75%             | 1.33x             | 74.25% actual   |
| 0.10        | 10%             | 10.00x            | 9.9% actual     |

Formula: `payout = betAmount / targetOdds`
Actual win chance: `targetOdds * (1 - houseEdge)`

### Maximum Bet Calculation (Kelly Criterion)

To protect the house from ruin, max bet is calculated using Kelly:

```
maxBet = (houseBalance * edge) / (multiplier - 1)

Where:
- edge = houseEdge (default 1%)
- multiplier = 1 / targetOdds
```

For a $10,000 house with 1% edge:
- At 50% odds (2x): maxBet = (10000 * 0.01) / (2 - 1) = $100
- At 10% odds (10x): maxBet = (10000 * 0.01) / (10 - 1) = $11.11

This ensures expected house profit even in worst-case variance.

### Provable Fairness

The commit-reveal pattern ensures:
1. Player cannot know the outcome before betting (future block hash unknown)
2. House cannot manipulate outcome (block hash determined by miners/validators)
3. Result verifiable by anyone with blockhash

```solidity
function computeResult(uint256 betBlock, bytes32 blockHash) pure returns (uint256) {
    return uint256(keccak256(abi.encodePacked(betBlock, blockHash)));
}

function isWinner(uint256 result, uint256 targetOddsE18, uint256 houseEdgeE18) pure returns (bool) {
    uint256 adjustedOdds = targetOddsE18 * (1e18 - houseEdgeE18) / 1e18;
    uint256 threshold = adjustedOdds * type(uint256).max / 1e18;
    return result < threshold;
}
```

## Staking Pool (ERC-4626)

### Vault Mechanics

The house bank is an ERC-4626 tokenized vault:
- Depositors receive `clawETH` shares proportional to their stake
- Share value fluctuates with house wins/losses
- Withdraw anytime at current share price

```solidity
// Deposit ETH, receive shares
function deposit(uint256 assets, address receiver) returns (uint256 shares);

// Redeem shares for ETH
function redeem(uint256 shares, address receiver, address owner) returns (uint256 assets);

// Current share price
function convertToAssets(uint256 shares) returns (uint256 assets);
```

### Share Price Changes

- House wins bet → assets increase → share price rises
- House loses bet → assets decrease → share price falls
- House edge ensures positive expected value for stakers

Example:
1. Alice deposits 10 ETH when pool has 100 ETH, gets 10 shares (100 total shares)
2. Pool wins 5 ETH in bets → pool now 105 ETH
3. Alice's 10 shares now worth 10.5 ETH

## Contract Architecture

```
contracts/
├── Clawdice.sol           # Main game logic
├── ClawdiceVault.sol      # ERC-4626 staking vault
├── interfaces/
│   ├── IClawdice.sol
│   └── IClawdiceVault.sol
└── libraries/
    ├── BetMath.sol        # Odds & payout calculations
    └── KellyCriterion.sol # Max bet calculations
```

### Clawdice.sol

```solidity
struct Bet {
    address player;
    uint128 amount;
    uint64 targetOddsE18;  // 18 decimals, e.g., 0.5e18 = 50%
    uint64 blockNumber;
    BetStatus status;
}

enum BetStatus { Pending, Won, Lost, Claimed, Expired }

// Core functions
function placeBet(uint64 targetOddsE18) external payable returns (uint256 betId);
function claim(uint256 betId) external;
function sweepExpired(uint256 maxCount) external returns (uint256 swept);

// View functions
function getBet(uint256 betId) external view returns (Bet memory);
function getMaxBet(uint64 targetOddsE18) external view returns (uint256);
function computeResult(uint256 betId) external view returns (bool won, uint256 payout);

// Admin
function setHouseEdge(uint256 newEdgeE18) external onlyOwner;
```

### ClawdiceVault.sol

Extends OpenZeppelin's ERC-4626 with:
- Native ETH deposits (wrapped to WETH internally, or native handling)
- Integration with Clawdice for balance changes
- Events for staking analytics

## Security Considerations

### Bet Limits
- Minimum bet: 0.001 ETH (prevent dust attacks)
- Maximum bet: Kelly-calculated limit
- Odds range: 0.01 (1%) to 0.99 (99%)

### Timing
- Bets must be claimed within 256 blocks (blockhash limit)
- Expired bets swept after 1 hour (~300 blocks on mainnet)
- Sweep hook runs before other transactions (max 5 sweeps per tx)

### Reentrancy
- Follow checks-effects-interactions
- Use ReentrancyGuard on all external calls

### Front-running
- Cannot front-run: outcome unknown until next block mined
- Block proposers could theoretically manipulate, but:
  - Economic cost of skipping block exceeds most bet values
  - Applicable to all blockhash-based randomness

## TypeScript SDK

```typescript
import { Clawdice } from '@trifle-labs/clawdice';

const clawdice = new Clawdice({
  rpcUrl: 'https://eth.drpc.org',
  contractAddress: '0x...',
  privateKey: process.env.PRIVATE_KEY  // optional for read-only
});

// Place bet
const betId = await clawdice.placeBet({
  amount: parseEther('0.1'),
  odds: 0.5  // 50% chance to 2x
});

// Check result (after next block)
const result = await clawdice.getResult(betId);
if (result.won) {
  await clawdice.claim(betId);
}

// Stake in vault
await clawdice.vault.deposit(parseEther('1'));
const myShares = await clawdice.vault.balanceOf(address);
```

## CLI

```bash
# Place a bet
clawdice bet --amount 0.1 --odds 0.5

# Check bet status
clawdice status <betId>

# Claim winnings
clawdice claim <betId>

# Stake ETH
clawdice stake 1.0

# Check stake value
clawdice balance

# Withdraw stake
clawdice withdraw --shares 100
```

## Agent Skill

The `clawdice` skill allows agents to:
- Query current max bet for given odds
- Place bets with safety checks
- Monitor pending bets
- Claim winnings automatically
- Stake/unstake from vault

See `skills/clawdice/SKILL.md` for full documentation.

## Development

```bash
# Install dependencies
npm install

# Compile contracts
forge build

# Run tests
forge test

# Deploy to local anvil
anvil &
forge script script/Deploy.s.sol --rpc-url http://localhost:8545 --broadcast

# Run TypeScript tests
npm test
```

## Deployments

| Network | Clawdice | ClawdiceVault |
|---------|----------|---------------|
| Mainnet | TBD      | TBD           |
| Sepolia | TBD      | TBD           |
| Base    | TBD      | TBD           |

## License

MIT
