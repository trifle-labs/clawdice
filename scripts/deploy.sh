#!/bin/bash
# Full deployment script - deploys contracts and updates deployments.json
# Usage: ./scripts/deploy.sh [network]

set -e

NETWORK=${1:-baseSepolia}
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

# Set RPC URL based on network
if [ "$NETWORK" = "base" ]; then
  RPC_URL="https://mainnet.base.org"
else
  RPC_URL="https://sepolia.base.org"
fi

echo "Deploying to $NETWORK..."
echo "RPC: $RPC_URL"

# Run forge deploy and capture output
OUTPUT=$(forge script script/RedeployClawdice.s.sol:RedeployClawdice \
  --rpc-url "$RPC_URL" \
  --broadcast \
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
echo "Updating deployments.json..."
./scripts/update-deployments.sh "$NETWORK" "$VAULT_ADDRESS" "$CLAWDICE_ADDRESS" "$DEPLOYER"

echo ""
echo "=== DEPLOYMENT COMPLETE ==="
echo "Network: $NETWORK"
echo "Vault: $VAULT_ADDRESS"
echo "Clawdice: $CLAWDICE_ADDRESS"
echo ""
echo "Next steps:"
echo "1. Copy deployments.json to frontend repo"
echo "2. Verify contracts: forge verify-contract ..."
echo "3. Stake CLAW to vault for bankroll"
