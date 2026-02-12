#!/bin/bash
# Update deployments.json after a deployment
# Usage: ./scripts/update-deployments.sh <network> <vault-address> <clawdice-address>

set -e

NETWORK=${1:-baseSepolia}
VAULT_ADDRESS=$2
CLAWDICE_ADDRESS=$3
DEPLOYER=${4:-0x312e253d1C18b92112aD2276Ade650FE7E620D1a}
CLAW_TOKEN=0xD2C1CB4556ca49Ac6C7A5bc71657bD615500057c

if [ -z "$VAULT_ADDRESS" ] || [ -z "$CLAWDICE_ADDRESS" ]; then
  echo "Usage: $0 <network> <vault-address> <clawdice-address> [deployer]"
  exit 1
fi

CHAIN_ID=84532
if [ "$NETWORK" = "base" ]; then
  CHAIN_ID=8453
fi

TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# Update deployments.json using jq
jq --arg network "$NETWORK" \
   --arg chainId "$CHAIN_ID" \
   --arg clawToken "$CLAW_TOKEN" \
   --arg clawdice "$CLAWDICE_ADDRESS" \
   --arg vault "$VAULT_ADDRESS" \
   --arg deployedAt "$TIMESTAMP" \
   --arg deployer "$DEPLOYER" \
   '.[$network] = {
     chainId: ($chainId | tonumber),
     clawToken: $clawToken,
     clawdice: $clawdice,
     clawdiceVault: $vault,
     deployedAt: $deployedAt,
     deployer: $deployer
   }' deployments.json > deployments.json.tmp && mv deployments.json.tmp deployments.json

echo "Updated deployments.json for $NETWORK:"
jq ".${NETWORK}" deployments.json
