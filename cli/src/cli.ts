#!/usr/bin/env node

import { Command } from 'commander';
import { Clawsino, BetStatus, getDeployment } from '@trifle-labs/clawsino';
import { privateKeyToAccount } from 'viem/accounts';
import { parseEther, formatEther, type Address } from 'viem';
import { mainnet, sepolia, base } from 'viem/chains';

const program = new Command();

const chains = {
  mainnet,
  sepolia,
  base,
};

function getClawsino(options: { network: string; rpc?: string }) {
  const network = options.network as keyof typeof chains;
  const chain = chains[network];
  if (!chain) throw new Error(`Unknown network: ${options.network}`);

  const deployment = getDeployment(network as any);
  const privateKey = process.env.PRIVATE_KEY;

  return new Clawsino({
    chain,
    rpcUrl: options.rpc,
    clawsinoAddress: deployment.clawsino,
    vaultAddress: deployment.vault,
    account: privateKey ? privateKeyToAccount(privateKey as `0x${string}`) : undefined,
  });
}

program
  .name('clawsino')
  .description('CLI for Clawsino provably fair dice game')
  .version('0.1.0')
  .option('-n, --network <network>', 'Network to use (mainnet, sepolia, base)', 'mainnet')
  .option('-r, --rpc <url>', 'Custom RPC URL');

program
  .command('max-bet')
  .description('Get maximum bet for given odds')
  .argument('<odds>', 'Win probability (0-1, e.g., 0.5 for 50%)')
  .action(async (oddsStr: string, _, cmd) => {
    const odds = parseFloat(oddsStr);
    if (odds <= 0 || odds >= 1) {
      console.error('Odds must be between 0 and 1');
      process.exit(1);
    }

    const clawsino = getClawsino(cmd.optsWithGlobals());
    const maxBet = await clawsino.getMaxBet(odds);
    const multiplier = clawsino.calculateMultiplier(odds);

    console.log(`Odds: ${clawsino.formatOdds(odds)}`);
    console.log(`Multiplier: ${multiplier.toFixed(2)}x`);
    console.log(`Max Bet: ${formatEther(maxBet)} ETH`);
  });

program
  .command('bet')
  .description('Place a bet')
  .argument('<amount>', 'Bet amount in ETH')
  .argument('<odds>', 'Win probability (0-1)')
  .action(async (amountStr: string, oddsStr: string, _, cmd) => {
    const amount = parseEther(amountStr);
    const odds = parseFloat(oddsStr);

    if (odds <= 0 || odds >= 1) {
      console.error('Odds must be between 0 and 1');
      process.exit(1);
    }

    if (!process.env.PRIVATE_KEY) {
      console.error('PRIVATE_KEY environment variable required');
      process.exit(1);
    }

    const clawsino = getClawsino(cmd.optsWithGlobals());
    const payout = clawsino.calculatePayout(amount, odds);

    console.log(`Placing bet...`);
    console.log(`  Amount: ${formatEther(amount)} ETH`);
    console.log(`  Odds: ${clawsino.formatOdds(odds)}`);
    console.log(`  Potential Payout: ${formatEther(payout)} ETH`);

    try {
      const { hash, betId } = await clawsino.placeBet({ amount, odds });
      console.log(`\nBet placed!`);
      console.log(`  Bet ID: ${betId}`);
      console.log(`  Tx: ${hash}`);
      console.log(`\nWait for next block, then check result with: clawsino status ${betId}`);
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

program
  .command('status')
  .description('Check bet status')
  .argument('<betId>', 'Bet ID')
  .action(async (betIdStr: string, _, cmd) => {
    const betId = BigInt(betIdStr);
    const clawsino = getClawsino(cmd.optsWithGlobals());

    const bet = await clawsino.getBet(betId);
    const statusNames = ['Pending', 'Won', 'Lost', 'Claimed', 'Expired'];
    const odds = Number(bet.targetOddsE18) / 1e18;

    console.log(`Bet #${betId}`);
    console.log(`  Player: ${bet.player}`);
    console.log(`  Amount: ${formatEther(bet.amount)} ETH`);
    console.log(`  Odds: ${clawsino.formatOdds(odds)}`);
    console.log(`  Block: ${bet.blockNumber}`);
    console.log(`  Status: ${statusNames[bet.status]}`);

    if (bet.status === BetStatus.Pending) {
      try {
        const result = await clawsino.computeResult(betId);
        console.log(`\nResult Available:`);
        console.log(`  Won: ${result.won ? 'YES!' : 'No'}`);
        if (result.won) {
          console.log(`  Payout: ${formatEther(result.payout)} ETH`);
          console.log(`\nClaim with: clawsino claim ${betId}`);
        }
      } catch {
        console.log(`\nResult not available yet (wait for next block)`);
      }
    }
  });

program
  .command('claim')
  .description('Claim bet winnings')
  .argument('<betId>', 'Bet ID')
  .action(async (betIdStr: string, _, cmd) => {
    const betId = BigInt(betIdStr);

    if (!process.env.PRIVATE_KEY) {
      console.error('PRIVATE_KEY environment variable required');
      process.exit(1);
    }

    const clawsino = getClawsino(cmd.optsWithGlobals());

    console.log(`Claiming bet #${betId}...`);

    try {
      const hash = await clawsino.claim(betId);
      console.log(`Claimed!`);
      console.log(`Tx: ${hash}`);
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

program
  .command('stake')
  .description('Stake ETH in the vault')
  .argument('<amount>', 'Amount in ETH')
  .action(async (amountStr: string, _, cmd) => {
    if (!process.env.PRIVATE_KEY) {
      console.error('PRIVATE_KEY environment variable required');
      process.exit(1);
    }

    const clawsino = getClawsino(cmd.optsWithGlobals());

    console.log(`Staking ${amountStr} ETH...`);

    try {
      const hash = await clawsino.vault.stake(amountStr);
      console.log(`Staked!`);
      console.log(`Tx: ${hash}`);
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

program
  .command('unstake')
  .description('Unstake shares from the vault')
  .argument('<shares>', 'Number of shares')
  .action(async (sharesStr: string, _, cmd) => {
    if (!process.env.PRIVATE_KEY) {
      console.error('PRIVATE_KEY environment variable required');
      process.exit(1);
    }

    const clawsino = getClawsino(cmd.optsWithGlobals());
    const shares = parseEther(sharesStr);

    console.log(`Unstaking ${sharesStr} shares...`);

    try {
      const hash = await clawsino.vault.unstake(shares);
      console.log(`Unstaked!`);
      console.log(`Tx: ${hash}`);
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

program
  .command('balance')
  .description('Check vault balance')
  .argument('[address]', 'Address to check (defaults to signer)')
  .action(async (address: string | undefined, _, cmd) => {
    const clawsino = getClawsino(cmd.optsWithGlobals());

    let addr: Address;
    if (address) {
      addr = address as Address;
    } else if (process.env.PRIVATE_KEY) {
      addr = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`).address;
    } else {
      console.error('Address required or set PRIVATE_KEY');
      process.exit(1);
    }

    const shares = await clawsino.vault.balanceOf(addr);
    const sharePrice = await clawsino.vault.getSharePrice();
    const value = Number(formatEther(shares)) * sharePrice;
    const totalAssets = await clawsino.vault.totalAssets();

    console.log(`Vault Stats:`);
    console.log(`  Total Assets: ${formatEther(totalAssets)} ETH`);
    console.log(`  Share Price: ${sharePrice.toFixed(6)} ETH`);
    console.log(`\nYour Position:`);
    console.log(`  Shares: ${formatEther(shares)} clawETH`);
    console.log(`  Value: ${value.toFixed(6)} ETH`);
  });

program
  .command('info')
  .description('Show contract info')
  .action(async (_, cmd) => {
    const clawsino = getClawsino(cmd.optsWithGlobals());

    const houseEdge = await clawsino.getHouseEdge();
    const pendingBets = await clawsino.getPendingBetCount();
    const totalAssets = await clawsino.vault.totalAssets();
    const sharePrice = await clawsino.vault.getSharePrice();

    console.log(`Clawsino Info:`);
    console.log(`  House Edge: ${(houseEdge * 100).toFixed(2)}%`);
    console.log(`  Pending Bets: ${pendingBets}`);
    console.log(`\nVault:`);
    console.log(`  Total Assets: ${formatEther(totalAssets)} ETH`);
    console.log(`  Share Price: ${sharePrice.toFixed(6)} ETH`);
    console.log(`\nMax Bets:`);

    for (const odds of [0.5, 0.25, 0.1]) {
      const maxBet = await clawsino.getMaxBet(odds);
      console.log(`  ${(odds * 100).toFixed(0)}% odds: ${formatEther(maxBet)} ETH`);
    }
  });

program.parse();
