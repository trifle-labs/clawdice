---
name: clawsino
description: Interact with Clawsino provably fair dice game
version: 0.1.0
author: Trifle Labs
commands:
  - name: bet
    description: Place a bet with specified amount and odds
    args:
      - name: amount
        type: string
        required: true
        description: Bet amount in ETH (e.g., "0.1")
      - name: odds
        type: number
        required: true
        description: Win probability 0-1 (e.g., 0.5 for 50%)
  - name: status
    description: Check status of a bet
    args:
      - name: betId
        type: number
        required: true
  - name: claim
    description: Claim winnings from a winning bet
    args:
      - name: betId
        type: number
        required: true
  - name: max-bet
    description: Get maximum allowed bet for given odds
    args:
      - name: odds
        type: number
        required: true
  - name: stake
    description: Stake ETH in the house vault
    args:
      - name: amount
        type: string
        required: true
  - name: unstake
    description: Unstake shares from the vault
    args:
      - name: shares
        type: string
        required: true
  - name: balance
    description: Check vault stake balance
  - name: info
    description: Get contract info and stats
dependencies:
  - evm
env:
  - CLAWSINO_NETWORK
  - CLAWSINO_RPC_URL
---

# Clawsino Skill

Interact with the Clawsino provably fair on-chain dice game.

## Overview

Clawsino is a commit-reveal dice game where:
- Players bet ETH with customizable odds (e.g., 50% chance to 2x)
- Randomness derived from future block hash
- House bank accepts stakes from LPs via ERC-4626 vault
- Kelly Criterion ensures safe maximum bet sizes

## Commands

### Place a Bet

```bash
clawsino bet <amount> <odds>
```

Example: Bet 0.1 ETH at 50% odds (2x multiplier)
```bash
clawsino bet 0.1 0.5
```

The bet is placed immediately. Wait for the next block to see results.

### Check Bet Status

```bash
clawsino status <betId>
```

Shows bet details and whether you won or lost (after next block).

### Claim Winnings

```bash
clawsino claim <betId>
```

Claim your payout if you won. Must be done within 256 blocks.

### Get Max Bet

```bash
clawsino max-bet <odds>
```

Check the maximum bet allowed for given odds. Based on Kelly Criterion.

### Stake in Vault

```bash
clawsino stake <amount>
```

Stake ETH to become a house LP. Receive clawETH shares.

### Unstake from Vault

```bash
clawsino unstake <shares>
```

Burn clawETH shares to receive ETH. Value fluctuates with house P&L.

### Check Balance

```bash
clawsino balance
```

View your clawETH shares and their ETH value.

### Contract Info

```bash
clawsino info
```

Shows house edge, pending bets, vault stats, and max bets.

## Betting Strategy

### Odds & Payouts

| Target Odds | Win Chance | Payout | Example |
|-------------|------------|--------|---------|
| 0.50 | ~49.5%* | 2x | Bet 1 ETH, win 2 ETH |
| 0.25 | ~24.75%* | 4x | Bet 1 ETH, win 4 ETH |
| 0.10 | ~9.9%* | 10x | Bet 1 ETH, win 10 ETH |

*Adjusted for 1% house edge

### Max Bet Calculation

Max bet is calculated using Kelly Criterion:
```
maxBet = (houseBalance * houseEdge) / (multiplier - 1)
```

For 10 ETH house with 1% edge:
- 50% odds (2x): max 0.1 ETH
- 25% odds (4x): max 0.033 ETH
- 10% odds (10x): max 0.011 ETH

## For Bankr Bot

When receiving a bet request:

1. Query max bet: `clawsino max-bet <odds>`
2. Validate amount doesn't exceed max
3. Place bet: `clawsino bet <amount> <odds>`
4. Store bet ID
5. After next block, check result: `clawsino status <betId>`
6. If won, claim: `clawsino claim <betId>`

Example interaction:
```
User: Roll the dice! 0.05 ETH at 50% odds
Agent:
  1. Check max bet for 50% odds: 0.1 ETH ✓
  2. Place bet: clawsino bet 0.05 0.5
  3. Bet #123 placed, waiting for block...
  4. Result: WON! Payout: 0.1 ETH
  5. Claiming winnings...
  6. Claimed! You won 0.05 ETH profit!
```

## Staking

LPs stake ETH to provide house liquidity:
- Receive clawETH (ERC-4626 vault shares)
- Share price rises when house wins
- Share price falls when house loses
- 1% house edge = positive expected value for stakers

Risk: High variance short-term, but profitable long-term due to edge.

## Network Configuration

Set environment variables:
```bash
export CLAWSINO_NETWORK=mainnet  # or sepolia, base
export CLAWSINO_RPC_URL=https://eth.drpc.org
export PRIVATE_KEY=0x...
```

## Contract Addresses

See `@trifle-labs/clawsino` package for deployment addresses.
