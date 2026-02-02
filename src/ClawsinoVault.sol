// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interfaces/ISwapRouter.sol";

/// @title ClawsinoVault
/// @notice ERC-4626 vault for Clawsino staking using any ERC20 token as collateral
/// @dev Supports Uniswap swaps for ETH deposits and ERC20 permit for gasless approvals
contract ClawsinoVault is ERC4626, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    address public clawsino;
    IERC20 public immutable collateralToken;
    IWETH public immutable weth;
    ISwapRouter public immutable swapRouter;
    uint24 public poolFee = 10000; // 1% fee tier (Clanker default)

    event ClawsinoSet(address indexed clawsino);
    event Staked(address indexed staker, uint256 assets, uint256 shares);
    event Unstaked(address indexed staker, uint256 shares, uint256 assets);
    event PoolFeeUpdated(uint24 oldFee, uint24 newFee);

    constructor(
        address _collateralToken,
        address _weth,
        address _swapRouter,
        string memory _name,
        string memory _symbol
    ) ERC4626(IERC20(_collateralToken)) ERC20(_name, _symbol) Ownable(msg.sender) {
        collateralToken = IERC20(_collateralToken);
        weth = IWETH(_weth);
        swapRouter = ISwapRouter(_swapRouter);

        // Approve router for WETH swaps
        IERC20(_weth).approve(_swapRouter, type(uint256).max);
    }

    /// @notice Set the Clawsino contract address (one-time)
    function setClawsino(address _clawsino) external onlyOwner {
        require(clawsino == address(0), "Already set");
        require(_clawsino != address(0), "Invalid address");
        clawsino = _clawsino;
        emit ClawsinoSet(_clawsino);
    }

    /// @notice Update pool fee tier for swaps
    function setPoolFee(uint24 _poolFee) external onlyOwner {
        uint24 oldFee = poolFee;
        poolFee = _poolFee;
        emit PoolFeeUpdated(oldFee, _poolFee);
    }

    /// @notice Stake tokens directly and receive vault shares
    /// @param assets Amount of collateral tokens to stake
    function stake(uint256 assets) external nonReentrant returns (uint256 shares) {
        require(assets > 0, "Zero assets");

        // Calculate shares BEFORE transfer
        shares = _convertToShares(assets);
        require(shares > 0, "Zero shares");

        // Transfer tokens from sender
        collateralToken.safeTransferFrom(msg.sender, address(this), assets);

        // Mint shares to sender
        _mint(msg.sender, shares);

        emit Staked(msg.sender, assets, shares);
    }

    /// @notice Stake tokens using ERC20 permit (gasless approval)
    /// @param assets Amount of collateral tokens to stake
    /// @param deadline Permit deadline
    /// @param v Permit signature v
    /// @param r Permit signature r
    /// @param s Permit signature s
    function stakeWithPermit(uint256 assets, uint256 deadline, uint8 v, bytes32 r, bytes32 s)
        external
        nonReentrant
        returns (uint256 shares)
    {
        require(assets > 0, "Zero assets");

        // Execute permit
        IERC20Permit(address(collateralToken)).permit(msg.sender, address(this), assets, deadline, v, r, s);

        // Calculate shares BEFORE transfer
        shares = _convertToShares(assets);
        require(shares > 0, "Zero shares");

        // Transfer tokens from sender
        collateralToken.safeTransferFrom(msg.sender, address(this), assets);

        // Mint shares to sender
        _mint(msg.sender, shares);

        emit Staked(msg.sender, assets, shares);
    }

    /// @notice Stake with ETH - swaps to collateral token via Uniswap
    /// @param minTokensOut Minimum tokens to receive from swap (slippage protection)
    function stakeWithETH(uint256 minTokensOut) external payable nonReentrant returns (uint256 shares) {
        require(msg.value > 0, "No ETH sent");

        // Wrap ETH to WETH
        weth.deposit{ value: msg.value }();

        // Swap WETH -> collateral token
        uint256 tokensReceived = swapRouter.exactInputSingle(
            ISwapRouter.ExactInputSingleParams({
                tokenIn: address(weth),
                tokenOut: address(collateralToken),
                fee: poolFee,
                recipient: address(this),
                amountIn: msg.value,
                amountOutMinimum: minTokensOut,
                sqrtPriceLimitX96: 0
            })
        );

        // Calculate shares
        shares = _convertToShares(tokensReceived);
        require(shares > 0, "Zero shares");

        // Mint shares to sender
        _mint(msg.sender, shares);

        emit Staked(msg.sender, tokensReceived, shares);
    }

    /// @notice Convert assets to shares, handling zero supply case
    function _convertToShares(uint256 assets) internal view returns (uint256) {
        uint256 supply = totalSupply();
        if (supply == 0) {
            return assets; // 1:1 for first deposit
        }
        return (assets * supply) / totalAssets();
    }

    /// @notice Convert shares to assets
    function _convertToAssets(uint256 shares) internal view returns (uint256) {
        uint256 supply = totalSupply();
        if (supply == 0) {
            return shares; // 1:1 when no supply
        }
        return (shares * totalAssets()) / supply;
    }

    /// @notice Unstake by burning shares and receiving collateral tokens
    function unstake(uint256 shares) external nonReentrant returns (uint256 assets) {
        require(shares > 0, "Zero shares");
        require(balanceOf(msg.sender) >= shares, "Insufficient shares");

        // Calculate assets
        assets = _convertToAssets(shares);
        require(assets > 0, "Zero assets");

        // Check we have enough tokens
        require(collateralToken.balanceOf(address(this)) >= assets, "Insufficient liquidity");

        // Burn shares
        _burn(msg.sender, shares);

        // Transfer tokens
        collateralToken.safeTransfer(msg.sender, assets);

        emit Unstaked(msg.sender, shares, assets);
    }

    /// @notice Get total assets (collateral token balance)
    function totalAssets() public view override returns (uint256) {
        return collateralToken.balanceOf(address(this));
    }

    /// @notice Receive tokens from Clawsino (bet losses)
    function receiveFromClawsino(uint256 amount) external {
        require(msg.sender == clawsino, "Only Clawsino");
        // Tokens are already transferred via safeTransfer before this call
        // This function is just for event tracking if needed
    }

    /// @notice Withdraw tokens to pay Clawsino winners
    /// @param amount Amount of tokens to withdraw
    function withdrawForPayout(uint256 amount) external nonReentrant {
        require(msg.sender == clawsino, "Only Clawsino");
        require(collateralToken.balanceOf(address(this)) >= amount, "Insufficient funds");

        collateralToken.safeTransfer(clawsino, amount);
    }

    /// @notice Seed initial liquidity (owner only, for initial setup)
    function seedLiquidity(uint256 amount) external onlyOwner {
        require(amount > 0, "Zero amount");

        collateralToken.safeTransferFrom(msg.sender, address(this), amount);

        // Mint shares to owner (1:1 for initial deposit)
        uint256 shares = amount;
        _mint(msg.sender, shares);

        emit Staked(msg.sender, amount, shares);
    }

    /// @notice Emergency withdraw all tokens (owner only)
    function emergencyWithdraw() external onlyOwner {
        uint256 balance = collateralToken.balanceOf(address(this));
        if (balance > 0) {
            collateralToken.safeTransfer(owner(), balance);
        }
    }

    /// @notice Refund any ETH sent directly (shouldn't happen but safety net)
    receive() external payable {
        // Only accept ETH from WETH unwrap
        require(msg.sender == address(weth), "Use stakeWithETH");
    }
}
