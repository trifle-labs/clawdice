#!/bin/bash
# Full deployment script - deploys contracts, verifies, stakes liquidity, updates deployments.json
# Usage: ./scripts/deploy.sh [network] [stake_amount]
#
# Prerequisites:
#   - PRIVATE_KEY env var set
#   - ETHERSCAN_API_KEY env var set
#
# Examples:
#   ./scripts/deploy.sh baseSepolia 10000   # Deploy to Base Sepolia, stake 10K CLAW
#   ./scripts/deploy.sh base 50000          # Deploy to Base mainnet, stake 50K CLAW

set -e

NETWORK=${1:-baseSepolia}
STAKE_AMOUNT=${2:-10000}
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

# Network configuration
declare -A RPC_URLS=(
  ["baseSepolia"]="https://sepolia.base.org"
  ["base"]="https://mainnet.base.org"
)

declare -A CHAIN_IDS=(
  ["baseSepolia"]="84532"
  ["base"]="8453"
)

declare -A EXPLORERS=(
  ["baseSepolia"]="https://sepolia.basescan.org"
  ["base"]="https://basescan.org"
)

RPC_URL=${RPC_URLS[$NETWORK]}
CHAIN_ID=${CHAIN_IDS[$NETWORK]}
EXPLORER=${EXPLORERS[$NETWORK]}

if [ -z "$RPC_URL" ]; then
  echo "ERROR: Unknown network '$NETWORK'. Supported: baseSepolia, base"
  exit 1
fi

if [ -z "$PRIVATE_KEY" ]; then
  echo "ERROR: PRIVATE_KEY env var not set"
  exit 1
fi

if [ -z "$ETHERSCAN_API_KEY" ]; then
  echo "WARNING: ETHERSCAN_API_KEY not set - skipping verification"
fi

echo "=========================================="
echo "CLAWDICE DEPLOYMENT"
echo "=========================================="
echo "Network:      $NETWORK"
echo "Chain ID:     $CHAIN_ID"
echo "RPC:          $RPC_URL"
echo "Stake Amount: $STAKE_AMOUNT CLAW"
echo "=========================================="
echo ""

# Step 1: Deploy contracts
echo "[1/5] Deploying contracts..."
OUTPUT=$(forge script script/RedeployClawdice.s.sol:RedeployClawdice \
  --rpc-url "$RPC_URL" \
  --broadcast \
  --private-key "$PRIVATE_KEY" \
  2>&1)

echo "$OUTPUT"

# Parse addresses from output
VAULT_ADDRESS=$(echo "$OUTPUT" | grep "New Vault deployed at:" | awk '{print $NF}')
CLAWDICE_ADDRESS=$(echo "$OUTPUT" | grep "New Clawdice deployed at:" | awk '{print $NF}')
DEPLOYER=$(echo "$OUTPUT" | grep "Deployer:" | awk '{print $NF}')

if [ -z "$VAULT_ADDRESS" ] || [ -z "$CLAWDICE_ADDRESS" ]; then
  echo "ERROR: Could not parse deployment addresses from output"
  exit 1
fi

echo ""
echo "✅ Contracts deployed"
echo "   Vault:    $VAULT_ADDRESS"
echo "   Clawdice: $CLAWDICE_ADDRESS"
echo ""

# Step 2: Update deployments.json
echo "[2/5] Updating deployments.json..."
./scripts/update-deployments.sh "$NETWORK" "$VAULT_ADDRESS" "$CLAWDICE_ADDRESS" "$DEPLOYER"
echo "✅ deployments.json updated"
echo ""

# Step 3: Verify contracts
if [ -n "$ETHERSCAN_API_KEY" ]; then
  echo "[3/5] Verifying contracts on Basescan..."
  
  # Get CLAW token address from deployment script
  CLAW_TOKEN="0xD2C1CB4556ca49Ac6C7A5bc71657bD615500057c"
  WETH="0x4200000000000000000000000000000000000006"
  UNIVERSAL_ROUTER="0x492E6456D9528771018DeB9E87ef7750EF184104"
  PERMIT2="0x000000000022D473030F116dDEE9F6B43aC78BA3"
  
  # Encode constructor args for Vault
  VAULT_ARGS=$(cast abi-encode "constructor(address,address,address,address,(address,address,uint24,int24,address),string,string)" \
    "$CLAW_TOKEN" "$WETH" "$UNIVERSAL_ROUTER" "$PERMIT2" \
    "($WETH,$CLAW_TOKEN,10000,200,0x0000000000000000000000000000000000000000)" \
    "Clawdice Vault" "vCLAW")
  
  # Encode constructor args for Clawdice
  CLAWDICE_ARGS=$(cast abi-encode "constructor(address,address,address,address,(address,address,uint24,int24,address))" \
    "$VAULT_ADDRESS" "$WETH" "$UNIVERSAL_ROUTER" "$PERMIT2" \
    "($WETH,$CLAW_TOKEN,10000,200,0x0000000000000000000000000000000000000000)")
  
  # Verify Vault
  echo "   Verifying Vault..."
  forge verify-contract \
    --chain-id "$CHAIN_ID" \
    --verifier-url "https://api.etherscan.io/v2/api?chainid=$CHAIN_ID" \
    --compiler-version "0.8.24" \
    "$VAULT_ADDRESS" \
    src/ClawdiceVault.sol:ClawdiceVault \
    --constructor-args "$VAULT_ARGS" || true
  
  # Verify Clawdice
  echo "   Verifying Clawdice..."
  forge verify-contract \
    --chain-id "$CHAIN_ID" \
    --verifier-url "https://api.etherscan.io/v2/api?chainid=$CHAIN_ID" \
    --compiler-version "0.8.24" \
    "$CLAWDICE_ADDRESS" \
    src/Clawdice.sol:Clawdice \
    --constructor-args "$CLAWDICE_ARGS" || true
  
  echo "✅ Verification submitted"
  echo ""
else
  echo "[3/5] Skipping verification (no ETHERSCAN_API_KEY)"
  echo ""
fi

# Step 4: Stake liquidity to vault
if [ "$STAKE_AMOUNT" -gt 0 ]; then
  echo "[4/5] Staking $STAKE_AMOUNT CLAW to vault..."
  
  STAKE_WEI=$(cast --to-wei "$STAKE_AMOUNT")
  
  # Approve vault
  echo "   Approving vault..."
  cast send "$CLAW_TOKEN" "approve(address,uint256)" \
    "$VAULT_ADDRESS" "$STAKE_WEI" \
    --private-key "$PRIVATE_KEY" \
    --rpc-url "$RPC_URL" > /dev/null
  
  # Stake
  echo "   Staking..."
  cast send "$VAULT_ADDRESS" "stake(uint256)" \
    "$STAKE_WEI" \
    --private-key "$PRIVATE_KEY" \
    --rpc-url "$RPC_URL" > /dev/null
  
  # Verify
  VAULT_TVL=$(cast call "$VAULT_ADDRESS" "totalAssets()(uint256)" --rpc-url "$RPC_URL")
  echo "✅ Staked! Vault TVL: $(cast from-wei $(echo $VAULT_TVL | tr -d '[],' | awk '{print $1}')) CLAW"
  echo ""
else
  echo "[4/5] Skipping staking (amount = 0)"
  echo ""
fi

# Step 5: Summary
echo "[5/5] Deployment complete!"
echo ""
echo "=========================================="
echo "DEPLOYMENT SUMMARY"
echo "=========================================="
echo "Network:    $NETWORK ($CHAIN_ID)"
echo "Vault:      $VAULT_ADDRESS"
echo "Clawdice:   $CLAWDICE_ADDRESS"
echo "Deployer:   $DEPLOYER"
echo ""
echo "Explorer:"
echo "  Vault:    $EXPLORER/address/$VAULT_ADDRESS"
echo "  Clawdice: $EXPLORER/address/$CLAWDICE_ADDRESS"
echo ""
echo "Next steps:"
echo "  1. Copy deployments.json to frontend:"
echo "     cp deployments.json ../clawdice-frontend/src/lib/"
echo "  2. Commit and push both repos"
echo "=========================================="
