# Clawdice

Provably fair on-chain dice game with ERC-4626 staking vault, powered by Clanker tokens.

## Overview

Clawdice is a Satoshi Dice-style betting protocol where:
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
1. Approve tokens: `token.approve(clawdice, amount)`
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
- Clanker tokens are deployed via [@clanker](https://clanker.world) or [Bankr](https://bankr.xyz)
- Clanker v4 tokens use Uniswap V4 pools with Hooks
- The vault token represents staked Clanker tokens

### Deployment for a Clanker Token

1. Deploy ClawdiceVault with your Clanker token address
2. Deploy Clawdice pointing to the vault
3. Call `vault.setClawdice(clawdiceAddress)`
4. Seed initial liquidity via `vault.seedLiquidity(amount)`

## Contracts

| Contract | Description |
|----------|-------------|
| `Clawdice.sol` | Main game logic, betting, claims, Uniswap V4 integration |
| `ClawdiceVault.sol` | ERC-4626 staking vault for collateral tokens |
| `BetMath.sol` | Payout calculations, randomness |
| `KellyCriterion.sol` | Max bet calculations |
| `IUniswapV4.sol` | Uniswap V4 Universal Router interface |

## Installation

```bash
# Clone
git clone https://github.com/trifle-labs/clawdice
cd clawdice

# Install dependencies
forge install

# Build
forge build

# Test
forge test
```

## SDK

```bash
npm install @trifle-labs/clawdice
```

```typescript
import { Clawdice } from '@trifle-labs/clawdice';
import { base } from 'viem/chains';

const clawdice = new Clawdice({
  chain: base,
  clawdiceAddress: '0x...',
  vaultAddress: '0x...',
  tokenAddress: '0x...',  // Clanker token
  account: privateKeyToAccount(key),
});

// Option 1: Bet with tokens (requires approval)
await clawdice.approveTokens(parseEther('100'));
const { betId } = await clawdice.placeBet({
  amount: parseEther('100'),
  odds: 0.5
});

// Option 2: Bet with ETH (single transaction)
const { betId } = await clawdice.placeBetWithETH({
  ethAmount: parseEther('0.1'),
  odds: 0.5,
  minTokensOut: parseEther('90')  // slippage protection
});

// Check result after next block
const result = await clawdice.computeResult(betId);
if (result.won) {
  await clawdice.claim(betId);
}

// Stake with tokens
await clawdice.vault.approveTokens(parseEther('1000'));
await clawdice.vault.stake(parseEther('1000'));

// Or stake with ETH (single transaction)
await clawdice.vault.stakeWithETH('1', 0n); // 1 ETH
```

## CLI

```bash
# Install
npm install -g @trifle-labs/clawdice-cli

# Place bet with tokens
clawdice bet 100 0.5  # 100 tokens at 50% odds

# Place bet with ETH
clawdice bet-eth 0.1 0.5  # 0.1 ETH at 50% odds

# Check status
clawdice status 123

# Claim winnings
clawdice claim 123

# Stake tokens
clawdice stake 1000

# Stake with ETH
clawdice stake-eth 1.0

# Check balance
clawdice balance

# Contract info
clawdice info
```

## Network Addresses

### Base

| Contract | Address |
|----------|---------|
| WETH | `0x4200000000000000000000000000000000000006` |
| Universal Router (V4) | `0x6ff5693b99212da76ad316178a184ab56d299b43` |
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` |
| Clawdice | TBD |
| ClawdiceVault | TBD |

### Mainnet

| Contract | Address |
|----------|---------|
| WETH | `0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2` |
| Universal Router (V4) | `0x66a9893cC07D91D95644AEDD05D03f95e1dBA8Af` |
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` |
| Clawdice | TBD |
| ClawdiceVault | TBD |

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
- [Agent Skill](./skills/clawdice/SKILL.md)
- [ERC-4626 Standard](https://eips.ethereum.org/EIPS/eip-4626)
- [Clanker](https://clanker.world)
- [Uniswap V4 Deployments](https://docs.uniswap.org/contracts/v4/deployments)
