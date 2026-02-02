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
  type Account,
} from 'viem';
import { mainnet, base } from 'viem/chains';
import { ClawsinoABI, ClawsinoVaultABI, ERC20ABI, BetStatus } from './abi';

export { ClawsinoABI, ClawsinoVaultABI, ERC20ABI, BetStatus } from './abi';

export interface ClawsinoConfig {
  rpcUrl?: string;
  chain?: Chain;
  clawsinoAddress: Address;
  vaultAddress: Address;
  tokenAddress: Address;
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

export interface PlaceBetWithETHParams {
  ethAmount: bigint | string;
  odds: number;
  minTokensOut?: bigint;
}

const E18 = BigInt(10 ** 18);

export class Clawsino {
  private publicClient: PublicClient;
  private walletClient?: WalletClient;
  private clawsinoAddress: Address;
  private vaultAddress: Address;
  private tokenAddress: Address;
  private chain: Chain;

  constructor(config: ClawsinoConfig) {
    this.chain = config.chain ?? mainnet;
    this.clawsinoAddress = config.clawsinoAddress;
    this.vaultAddress = config.vaultAddress;
    this.tokenAddress = config.tokenAddress;

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

  async getCollateralToken(): Promise<Address> {
    return this.publicClient.readContract({
      address: this.clawsinoAddress,
      abi: ClawsinoABI,
      functionName: 'collateralToken',
    });
  }

  async getTokenBalance(account: Address): Promise<bigint> {
    return this.publicClient.readContract({
      address: this.tokenAddress,
      abi: ERC20ABI,
      functionName: 'balanceOf',
      args: [account],
    });
  }

  async getTokenAllowance(owner: Address, spender: Address): Promise<bigint> {
    return this.publicClient.readContract({
      address: this.tokenAddress,
      abi: ERC20ABI,
      functionName: 'allowance',
      args: [owner, spender],
    });
  }

  // ============ Write Functions ============

  /**
   * Approve tokens for betting
   */
  async approveTokens(amount: bigint): Promise<Hash> {
    if (!this.walletClient) throw new Error('Wallet client required for write operations');

    return this.walletClient.writeContract({
      address: this.tokenAddress,
      abi: ERC20ABI,
      functionName: 'approve',
      args: [this.clawsinoAddress, amount],
    });
  }

  /**
   * Place a bet with tokens (requires prior approval)
   */
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
      args: [amount, oddsE18],
    });

    // Get bet ID from event
    await this.publicClient.waitForTransactionReceipt({ hash });
    const betId = await this.getNextBetId() - 1n;

    return { hash, betId };
  }

  /**
   * Place a bet with ETH (swaps to token via Uniswap)
   */
  async placeBetWithETH(params: PlaceBetWithETHParams): Promise<{ hash: Hash; betId: bigint }> {
    if (!this.walletClient) throw new Error('Wallet client required for write operations');

    const ethAmount = typeof params.ethAmount === 'string' ? parseEther(params.ethAmount) : params.ethAmount;
    const oddsE18 = BigInt(Math.floor(params.odds * 1e18));
    const minTokensOut = params.minTokensOut ?? 0n;

    const hash = await this.walletClient.writeContract({
      address: this.clawsinoAddress,
      abi: ClawsinoABI,
      functionName: 'placeBetWithETH',
      args: [oddsE18, minTokensOut],
      value: ethAmount,
    });

    // Get bet ID from event
    await this.publicClient.waitForTransactionReceipt({ hash });
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
      this.vaultAddress,
      this.tokenAddress
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
    private vaultAddress: Address,
    private tokenAddress: Address
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

  /**
   * Approve tokens for staking
   */
  async approveTokens(amount: bigint): Promise<Hash> {
    if (!this.walletClient) throw new Error('Wallet client required');

    return this.walletClient.writeContract({
      address: this.tokenAddress,
      abi: ERC20ABI,
      functionName: 'approve',
      args: [this.vaultAddress, amount],
    });
  }

  /**
   * Stake tokens directly (requires prior approval)
   */
  async stake(amount: bigint | string): Promise<Hash> {
    if (!this.walletClient) throw new Error('Wallet client required');

    const assets = typeof amount === 'string' ? parseEther(amount) : amount;

    return this.walletClient.writeContract({
      address: this.vaultAddress,
      abi: ClawsinoVaultABI,
      functionName: 'stake',
      args: [assets],
    });
  }

  /**
   * Stake with ETH (swaps to tokens via Uniswap)
   */
  async stakeWithETH(ethAmount: bigint | string, minTokensOut: bigint = 0n): Promise<Hash> {
    if (!this.walletClient) throw new Error('Wallet client required');

    const value = typeof ethAmount === 'string' ? parseEther(ethAmount) : ethAmount;

    return this.walletClient.writeContract({
      address: this.vaultAddress,
      abi: ClawsinoVaultABI,
      functionName: 'stakeWithETH',
      args: [minTokensOut],
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
    token: '0x0000000000000000000000000000000000000000' as Address,
    weth: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as Address,
    swapRouter: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45' as Address,
  },
  base: {
    clawsino: '0x0000000000000000000000000000000000000000' as Address,
    vault: '0x0000000000000000000000000000000000000000' as Address,
    token: '0x0000000000000000000000000000000000000000' as Address,
    weth: '0x4200000000000000000000000000000000000006' as Address,
    swapRouter: '0x2626664c2603336E57B271c5C0b26F421741e481' as Address,
  },
};

export function getDeployment(network: keyof typeof deployments) {
  return deployments[network];
}
