# Clawsino

Provably fair on-chain dice game with ERC-4626 staking vault, powered by Clanker tokens.

## Overview

Clawsino is a Satoshi Dice-style betting protocol where:
- Players bet with any ERC20 token (designed for Clanker tokens on Base)
- Randomness derived from future block hash (commit-reveal pattern)
- House bank powered by LP stakers via ERC-4626 vault
- Kelly Criterion ensures safe maximum bet sizes
- 1% house edge (configurable)
- **Single transaction betting** with ETH via Uniswap integration
- **Gasless approvals** via ERC20 permit

## How It Works

### Betting

**Option 1: Bet with Tokens**
1. Approve tokens: `token.approve(clawsino, amount)`
2. Place bet: `placeBet(amount, odds)`
3. Claim: `claim(betId)` after next block

**Option 2: Bet with ETH (Single Transaction)**
1. Call `placeBetWithETH{value: ethAmount}(odds, minTokensOut)`
2. Contract swaps ETH → tokens via Uniswap
3. Bet placed in one transaction
4. Claim: `claim(betId)` after next block

**Option 3: Bet with Permit (Gasless Approval)**
1. Sign ERC20 permit off-chain
2. Call `placeBetWithPermit(amount, odds, deadline, v, r, s)`
3. Approve + bet in one transaction

### Result Determination

1. **Place Bet**: Bet recorded at block N, funds held in contract
2. **Result**: Determined by block N+1 hash (unknown at bet time)
   - `random = keccak256(betId, blockhash(N+1))`
   - betId acts as nonce ensuring unique results per bet
   - If `random < adjustedOdds` → WIN
3. **Claim**: Winner calls `claim(betId)` within 256 blocks
4. **Expiry**: Unclaimed bets after ~1 hour are swept to house pool

### Odds & Payouts

| Target Odds | Win Chance* | Payout | Max Bet (10,000 token pool) |
|-------------|-------------|--------|----------------------------|
| 50% | 49.5% | 2x | 100 tokens |
| 25% | 24.75% | 4x | 33 tokens |
| 10% | 9.9% | 10x | 11 tokens |

*Adjusted for 1% house edge

### Kelly Criterion

Max bet is calculated to prevent house ruin:
```
maxBet = (houseBalance × houseEdge) / (multiplier - 1)
```

## Staking (ERC-4626)

### What is ERC-4626?

ERC-4626 is the "Tokenized Vault Standard" - an extension of ERC-20 that represents shares in an underlying asset pool. Unlike plain ERC-20 tokens where 1 token always equals 1 token, ERC-4626 shares represent a proportional claim on a changing pool of assets.

### How Vault Shares Work

```
Alice stakes 1000 tokens when pool = 10000 tokens
→ Gets 1000 shares (10% of pool)

House wins 1000 tokens from bets
→ Pool now 11000 tokens, still 10000 shares
→ Each share worth 1.1 tokens

Alice unstakes her 1000 shares
→ Receives 1100 tokens (10% of 11000 tokens)
```

### Staking Options

**Option 1: Stake with Tokens**
```solidity
token.approve(vault, amount);
vault.stake(amount);
```

**Option 2: Stake with ETH (Single Transaction)**
```solidity
vault.stakeWithETH{value: ethAmount}(minTokensOut);
// Swaps ETH → tokens via Uniswap, then stakes
```

**Option 3: Stake with Permit**
```solidity
vault.stakeWithPermit(amount, deadline, v, r, s);
```

### Unstaking

```solidity
vault.unstake(shares);
// Returns underlying tokens
```

## Clanker Token Integration

This contract is designed to work with Clanker tokens on Base:
- Clanker tokens are deployed via [@clanker](https://clanker.world)
- Each Clanker token has a Uniswap V3 pool (1% fee tier)
- The vault token represents staked Clanker tokens

### Deployment for a Clanker Token

1. Deploy ClawsinoVault with your Clanker token address
2. Deploy Clawsino pointing to the vault
3. Call `vault.setClawsino(clawsinoAddress)`
4. Seed initial liquidity via `vault.seedLiquidity(amount)`

## Contracts

| Contract | Description |
|----------|-------------|
| `Clawsino.sol` | Main game logic, betting, claims, Uniswap integration |
| `ClawsinoVault.sol` | ERC-4626 staking vault for collateral tokens |
| `BetMath.sol` | Payout calculations, randomness |
| `KellyCriterion.sol` | Max bet calculations |
| `ISwapRouter.sol` | Uniswap V3 SwapRouter interface |

## Installation

```bash
# Clone
git clone https://github.com/trifle-labs/clawsino
cd clawsino

# Install dependencies
forge install

# Build
forge build

# Test
forge test
```

## SDK

```bash
npm install @trifle-labs/clawsino
```

```typescript
import { Clawsino } from '@trifle-labs/clawsino';
import { base } from 'viem/chains';

const clawsino = new Clawsino({
  chain: base,
  clawsinoAddress: '0x...',
  vaultAddress: '0x...',
  tokenAddress: '0x...',  // Clanker token
  account: privateKeyToAccount(key),
});

// Option 1: Bet with tokens (requires approval)
await clawsino.approveTokens(parseEther('100'));
const { betId } = await clawsino.placeBet({
  amount: parseEther('100'),
  odds: 0.5
});

// Option 2: Bet with ETH (single transaction)
const { betId } = await clawsino.placeBetWithETH({
  ethAmount: parseEther('0.1'),
  odds: 0.5,
  minTokensOut: parseEther('90')  // slippage protection
});

// Check result after next block
const result = await clawsino.computeResult(betId);
if (result.won) {
  await clawsino.claim(betId);
}

// Stake with tokens
await clawsino.vault.approveTokens(parseEther('1000'));
await clawsino.vault.stake(parseEther('1000'));

// Or stake with ETH (single transaction)
await clawsino.vault.stakeWithETH('1', 0n); // 1 ETH
```

## CLI

```bash
# Install
npm install -g @trifle-labs/clawsino-cli

# Place bet with tokens
clawsino bet 100 0.5  # 100 tokens at 50% odds

# Place bet with ETH
clawsino bet-eth 0.1 0.5  # 0.1 ETH at 50% odds

# Check status
clawsino status 123

# Claim winnings
clawsino claim 123

# Stake tokens
clawsino stake 1000

# Stake with ETH
clawsino stake-eth 1.0

# Check balance
clawsino balance

# Contract info
clawsino info
```

## Network Addresses

### Base

| Contract | Address |
|----------|---------|
| WETH | `0x4200000000000000000000000000000000000006` |
| SwapRouter02 | `0x2626664c2603336E57B271c5C0b26F421741e481` |
| Clawsino | TBD |
| ClawsinoVault | TBD |

### Mainnet

| Contract | Address |
|----------|---------|
| WETH | `0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2` |
| SwapRouter02 | `0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45` |
| Clawsino | TBD |
| ClawsinoVault | TBD |

## Security

- **Reentrancy**: Protected via OpenZeppelin ReentrancyGuard
- **Randomness**: Future blockhash (can't be predicted or manipulated cheaply)
- **Bet limits**: Kelly Criterion prevents house ruin
- **Expiry**: Unclaimed bets swept after 1 hour
- **Safe transfers**: All token transfers use OpenZeppelin SafeERC20
- **Slippage protection**: minTokensOut parameter for ETH swaps

### Known Limitations

- Block proposers could theoretically manipulate results, but the economic cost exceeds reasonable bet sizes
- Blockhash only available for 256 blocks - must claim within ~1 hour
- Uniswap swap may fail if insufficient liquidity

## License

MIT

## Links

- [Specification](./SPEC.md)
- [Agent Skill](./skills/clawsino/SKILL.md)
- [ERC-4626 Standard](https://eips.ethereum.org/EIPS/eip-4626)
- [Clanker](https://clanker.world)
- [Uniswap V3 Base Deployments](https://docs.uniswap.org/contracts/v3/reference/deployments/base-deployments)
