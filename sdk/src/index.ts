import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  type Hash,
  type PublicClient,
  type WalletClient,
  type Chain,
  parseEther,
  formatEther,
  getContract,
  type Account,
  type Transport,
} from 'viem';
import { mainnet, sepolia, base } from 'viem/chains';
import { ClawsinoABI, ClawsinoVaultABI, BetStatus } from './abi';

export { ClawsinoABI, ClawsinoVaultABI, BetStatus } from './abi';

export interface ClawsinoConfig {
  rpcUrl?: string;
  chain?: Chain;
  clawsinoAddress: Address;
  vaultAddress: Address;
  account?: Account;
}

export interface Bet {
  player: Address;
  amount: bigint;
  targetOddsE18: bigint;
  blockNumber: bigint;
  status: number;
}

export interface BetResult {
  won: boolean;
  payout: bigint;
}

export interface PlaceBetParams {
  amount: bigint | string;
  odds: number; // 0-1, e.g., 0.5 for 50%
}

const E18 = BigInt(10 ** 18);

export class Clawsino {
  private publicClient: PublicClient;
  private walletClient?: WalletClient;
  private clawsinoAddress: Address;
  private vaultAddress: Address;
  private chain: Chain;

  constructor(config: ClawsinoConfig) {
    this.chain = config.chain ?? mainnet;
    this.clawsinoAddress = config.clawsinoAddress;
    this.vaultAddress = config.vaultAddress;

    this.publicClient = createPublicClient({
      chain: this.chain,
      transport: http(config.rpcUrl),
    });

    if (config.account) {
      this.walletClient = createWalletClient({
        chain: this.chain,
        transport: http(config.rpcUrl),
        account: config.account,
      });
    }
  }

  // ============ Read Functions ============

  async getMaxBet(odds: number): Promise<bigint> {
    const oddsE18 = BigInt(Math.floor(odds * 1e18));
    return this.publicClient.readContract({
      address: this.clawsinoAddress,
      abi: ClawsinoABI,
      functionName: 'getMaxBet',
      args: [oddsE18],
    });
  }

  async getBet(betId: bigint): Promise<Bet> {
    const result = await this.publicClient.readContract({
      address: this.clawsinoAddress,
      abi: ClawsinoABI,
      functionName: 'getBet',
      args: [betId],
    });
    return {
      player: result.player,
      amount: result.amount,
      targetOddsE18: result.targetOddsE18,
      blockNumber: result.blockNumber,
      status: result.status,
    };
  }

  async computeResult(betId: bigint): Promise<BetResult> {
    const [won, payout] = await this.publicClient.readContract({
      address: this.clawsinoAddress,
      abi: ClawsinoABI,
      functionName: 'computeResult',
      args: [betId],
    });
    return { won, payout };
  }

  async getHouseEdge(): Promise<number> {
    const edgeE18 = await this.publicClient.readContract({
      address: this.clawsinoAddress,
      abi: ClawsinoABI,
      functionName: 'houseEdgeE18',
    });
    return Number(edgeE18) / 1e18;
  }

  async getPendingBetCount(): Promise<bigint> {
    return this.publicClient.readContract({
      address: this.clawsinoAddress,
      abi: ClawsinoABI,
      functionName: 'getPendingBetCount',
    });
  }

  async getNextBetId(): Promise<bigint> {
    return this.publicClient.readContract({
      address: this.clawsinoAddress,
      abi: ClawsinoABI,
      functionName: 'nextBetId',
    });
  }

  // ============ Write Functions ============

  async placeBet(params: PlaceBetParams): Promise<{ hash: Hash; betId: bigint }> {
    if (!this.walletClient) throw new Error('Wallet client required for write operations');

    const amount = typeof params.amount === 'string' ? parseEther(params.amount) : params.amount;
    const oddsE18 = BigInt(Math.floor(params.odds * 1e18));

    // Check max bet
    const maxBet = await this.getMaxBet(params.odds);
    if (amount > maxBet) {
      throw new Error(`Bet amount ${formatEther(amount)} exceeds max bet ${formatEther(maxBet)}`);
    }

    const hash = await this.walletClient.writeContract({
      address: this.clawsinoAddress,
      abi: ClawsinoABI,
      functionName: 'placeBet',
      args: [oddsE18],
      value: amount,
    });

    // Get bet ID from event
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
    const betId = await this.getNextBetId() - 1n;

    return { hash, betId };
  }

  async claim(betId: bigint): Promise<Hash> {
    if (!this.walletClient) throw new Error('Wallet client required for write operations');

    return this.walletClient.writeContract({
      address: this.clawsinoAddress,
      abi: ClawsinoABI,
      functionName: 'claim',
      args: [betId],
    });
  }

  async sweepExpired(maxCount: bigint = 5n): Promise<Hash> {
    if (!this.walletClient) throw new Error('Wallet client required for write operations');

    return this.walletClient.writeContract({
      address: this.clawsinoAddress,
      abi: ClawsinoABI,
      functionName: 'sweepExpired',
      args: [maxCount],
    });
  }

  // ============ Vault Functions ============

  get vault() {
    return new ClawsinoVaultClient(
      this.publicClient,
      this.walletClient,
      this.vaultAddress
    );
  }

  // ============ Utility Functions ============

  calculatePayout(amount: bigint, odds: number): bigint {
    const oddsE18 = BigInt(Math.floor(odds * 1e18));
    return (amount * E18) / oddsE18;
  }

  calculateMultiplier(odds: number): number {
    return 1 / odds;
  }

  formatOdds(odds: number): string {
    return `${(odds * 100).toFixed(2)}%`;
  }
}

export class ClawsinoVaultClient {
  constructor(
    private publicClient: PublicClient,
    private walletClient: WalletClient | undefined,
    private vaultAddress: Address
  ) {}

  async totalAssets(): Promise<bigint> {
    return this.publicClient.readContract({
      address: this.vaultAddress,
      abi: ClawsinoVaultABI,
      functionName: 'totalAssets',
    });
  }

  async totalSupply(): Promise<bigint> {
    return this.publicClient.readContract({
      address: this.vaultAddress,
      abi: ClawsinoVaultABI,
      functionName: 'totalSupply',
    });
  }

  async balanceOf(account: Address): Promise<bigint> {
    return this.publicClient.readContract({
      address: this.vaultAddress,
      abi: ClawsinoVaultABI,
      functionName: 'balanceOf',
      args: [account],
    });
  }

  async previewDeposit(assets: bigint): Promise<bigint> {
    return this.publicClient.readContract({
      address: this.vaultAddress,
      abi: ClawsinoVaultABI,
      functionName: 'previewDeposit',
      args: [assets],
    });
  }

  async previewRedeem(shares: bigint): Promise<bigint> {
    return this.publicClient.readContract({
      address: this.vaultAddress,
      abi: ClawsinoVaultABI,
      functionName: 'previewRedeem',
      args: [shares],
    });
  }

  async getSharePrice(): Promise<number> {
    const assets = await this.totalAssets();
    const supply = await this.totalSupply();
    if (supply === 0n) return 1;
    return Number(assets) / Number(supply);
  }

  async stake(amount: bigint | string): Promise<Hash> {
    if (!this.walletClient) throw new Error('Wallet client required');

    const value = typeof amount === 'string' ? parseEther(amount) : amount;

    return this.walletClient.writeContract({
      address: this.vaultAddress,
      abi: ClawsinoVaultABI,
      functionName: 'stake',
      value,
    });
  }

  async unstake(shares: bigint): Promise<Hash> {
    if (!this.walletClient) throw new Error('Wallet client required');

    return this.walletClient.writeContract({
      address: this.vaultAddress,
      abi: ClawsinoVaultABI,
      functionName: 'unstake',
      args: [shares],
    });
  }
}

// Deployment info helper
export const deployments = {
  mainnet: {
    clawsino: '0x0000000000000000000000000000000000000000' as Address,
    vault: '0x0000000000000000000000000000000000000000' as Address,
  },
  sepolia: {
    clawsino: '0x0000000000000000000000000000000000000000' as Address,
    vault: '0x0000000000000000000000000000000000000000' as Address,
  },
  base: {
    clawsino: '0x0000000000000000000000000000000000000000' as Address,
    vault: '0x0000000000000000000000000000000000000000' as Address,
  },
};

export function getDeployment(network: keyof typeof deployments) {
  return deployments[network];
}
