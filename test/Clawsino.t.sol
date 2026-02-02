// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/Clawsino.sol";
import "../src/ClawsinoVault.sol";
import "../src/interfaces/ISwapRouter.sol";
import "../src/libraries/BetMath.sol";
import "../src/libraries/KellyCriterion.sol";

// Mock ERC20 token (simulates Clanker token)
contract MockToken {
    string public name = "Mock Clanker Token";
    string public symbol = "MCLAW";
    uint8 public decimals = 18;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    function mint(address to, uint256 amount) public {
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function approve(address spender, uint256 amount) public returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) public returns (bool) {
        return transferFrom(msg.sender, to, amount);
    }

    function transferFrom(address from, address to, uint256 amount) public returns (bool) {
        require(balanceOf[from] >= amount, "Insufficient balance");

        if (from != msg.sender && allowance[from][msg.sender] != type(uint256).max) {
            require(allowance[from][msg.sender] >= amount, "Insufficient allowance");
            allowance[from][msg.sender] -= amount;
        }

        balanceOf[from] -= amount;
        balanceOf[to] += amount;

        emit Transfer(from, to, amount);
        return true;
    }
}

// Mock WETH for testing
contract MockWETH {
    string public name = "Wrapped Ether";
    string public symbol = "WETH";
    uint8 public decimals = 18;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event Deposit(address indexed dst, uint256 wad);
    event Withdrawal(address indexed src, uint256 wad);

    function deposit() public payable {
        balanceOf[msg.sender] += msg.value;
        emit Deposit(msg.sender, msg.value);
    }

    function withdraw(uint256 wad) public {
        require(balanceOf[msg.sender] >= wad, "Insufficient balance");
        balanceOf[msg.sender] -= wad;
        payable(msg.sender).transfer(wad);
        emit Withdrawal(msg.sender, wad);
    }

    function totalSupply() public view returns (uint256) {
        return address(this).balance;
    }

    function approve(address guy, uint256 wad) public returns (bool) {
        allowance[msg.sender][guy] = wad;
        emit Approval(msg.sender, guy, wad);
        return true;
    }

    function transfer(address dst, uint256 wad) public returns (bool) {
        return transferFrom(msg.sender, dst, wad);
    }

    function transferFrom(address src, address dst, uint256 wad) public returns (bool) {
        require(balanceOf[src] >= wad, "Insufficient balance");

        if (src != msg.sender && allowance[src][msg.sender] != type(uint256).max) {
            require(allowance[src][msg.sender] >= wad, "Insufficient allowance");
            allowance[src][msg.sender] -= wad;
        }

        balanceOf[src] -= wad;
        balanceOf[dst] += wad;

        emit Transfer(src, dst, wad);
        return true;
    }

    receive() external payable {
        deposit();
    }
}

// Mock Uniswap router for testing
contract MockSwapRouter is ISwapRouter {
    MockWETH public weth;
    MockToken public token;
    uint256 public rate = 1000; // 1 ETH = 1000 tokens

    constructor(address _weth, address _token) {
        weth = MockWETH(payable(_weth));
        token = MockToken(_token);
    }

    function setRate(uint256 _rate) external {
        rate = _rate;
    }

    function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256 amountOut) {
        // Transfer WETH from sender
        weth.transferFrom(msg.sender, address(this), params.amountIn);

        // Calculate output (simple fixed rate for testing)
        amountOut = params.amountIn * rate;
        require(amountOut >= params.amountOutMinimum, "Insufficient output");

        // Mint tokens to recipient
        token.mint(params.recipient, amountOut);
    }

    function exactOutputSingle(ExactOutputSingleParams calldata params) external payable returns (uint256 amountIn) {
        // Calculate input needed
        amountIn = (params.amountOut + rate - 1) / rate; // Round up
        require(amountIn <= params.amountInMaximum, "Excessive input");

        // Transfer WETH from sender
        weth.transferFrom(msg.sender, address(this), amountIn);

        // Mint tokens to recipient
        token.mint(params.recipient, params.amountOut);
    }
}

contract ClawsinoTest is Test {
    Clawsino public clawsino;
    ClawsinoVault public vault;
    MockWETH public weth;
    MockToken public token;
    MockSwapRouter public router;

    address public owner = address(this);
    address public player1 = address(0x1);
    address public player2 = address(0x2);

    uint64 constant FIFTY_PERCENT = 0.5e18;
    uint64 constant TWENTY_FIVE_PERCENT = 0.25e18;

    function setUp() public {
        // Deploy mocks
        weth = new MockWETH();
        token = new MockToken();
        router = new MockSwapRouter(address(weth), address(token));

        // Deploy vault
        vault = new ClawsinoVault(address(token), address(weth), address(router), "Clawsino Staked Token", "clawTOKEN");

        // Deploy Clawsino
        clawsino = new Clawsino(address(vault), address(weth), address(router));

        // Set Clawsino in vault
        vault.setClawsino(address(clawsino));

        // Mint tokens to owner and seed liquidity
        token.mint(address(this), 10000 ether);
        token.approve(address(vault), type(uint256).max);
        vault.seedLiquidity(10000 ether);

        // Fund players with tokens
        token.mint(player1, 10000 ether);
        token.mint(player2, 10000 ether);

        // Fund players with ETH
        vm.deal(player1, 100 ether);
        vm.deal(player2, 100 ether);

        // Approve clawsino for players
        vm.prank(player1);
        token.approve(address(clawsino), type(uint256).max);
        vm.prank(player2);
        token.approve(address(clawsino), type(uint256).max);
    }

    function test_InitialSetup() public view {
        assertEq(clawsino.vault(), address(vault));
        assertEq(clawsino.houseEdgeE18(), 0.01e18);
        assertEq(vault.clawsino(), address(clawsino));
        assertEq(token.balanceOf(address(vault)), 10000 ether);
    }

    function test_PlaceBet() public {
        vm.prank(player1);
        uint256 betId = clawsino.placeBet(100 ether, FIFTY_PERCENT);

        assertEq(betId, 1);

        IClawsino.Bet memory bet = clawsino.getBet(betId);
        assertEq(bet.player, player1);
        assertEq(bet.amount, 100 ether);
        assertEq(bet.targetOddsE18, FIFTY_PERCENT);
        assertEq(uint8(bet.status), uint8(IClawsino.BetStatus.Pending));
    }

    function test_PlaceBetWithETH() public {
        vm.prank(player1);
        uint256 betId = clawsino.placeBetWithETH{ value: 0.1 ether }(FIFTY_PERCENT, 0);

        assertEq(betId, 1);

        IClawsino.Bet memory bet = clawsino.getBet(betId);
        assertEq(bet.player, player1);
        // 0.1 ETH * 1000 rate = 100 tokens
        assertEq(bet.amount, 100 ether);
        assertEq(bet.targetOddsE18, FIFTY_PERCENT);
        assertEq(uint8(bet.status), uint8(IClawsino.BetStatus.Pending));
    }

    function test_PlaceBetWithETH_SlippageProtection() public {
        vm.prank(player1);
        // Require at least 200 tokens but will only get 100
        vm.expectRevert("Insufficient output");
        clawsino.placeBetWithETH{ value: 0.1 ether }(FIFTY_PERCENT, 200 ether);
    }

    function test_PlaceBet_TooSmall() public {
        vm.prank(player1);
        vm.expectRevert("Bet too small");
        clawsino.placeBet(0.0001 ether, FIFTY_PERCENT);
    }

    function test_PlaceBet_OddsTooLow() public {
        vm.prank(player1);
        vm.expectRevert("Odds too low");
        clawsino.placeBet(100 ether, 0.001e18);
    }

    function test_PlaceBet_OddsTooHigh() public {
        vm.prank(player1);
        vm.expectRevert("Odds too high");
        clawsino.placeBet(100 ether, 0.999e18);
    }

    function test_MaxBet_FiftyPercent() public view {
        // maxBet = (bankroll * edge) / (multiplier - 1)
        // = (10000 tokens * 0.01) / (2 - 1) = 100 tokens
        uint256 maxBet = clawsino.getMaxBet(FIFTY_PERCENT);
        assertEq(maxBet, 100 ether);
    }

    function test_MaxBet_TwentyFivePercent() public view {
        // maxBet = (10000 tokens * 0.01) / (4 - 1) = 33.33... tokens
        uint256 maxBet = clawsino.getMaxBet(TWENTY_FIVE_PERCENT);
        assertApproxEqRel(maxBet, 33.33 ether, 0.01e18);
    }

    function test_PlaceBet_ExceedsMax() public {
        vm.prank(player1);
        vm.expectRevert("Bet exceeds max");
        clawsino.placeBet(200 ether, FIFTY_PERCENT);
    }

    function test_Claim_Win() public {
        // Place bet
        vm.prank(player1);
        uint256 betId = clawsino.placeBet(100 ether, FIFTY_PERCENT);

        // Mine blocks to get blockhash (need block > betBlock + 1)
        vm.roll(block.number + 2);

        // Check result
        (bool won, uint256 payout) = clawsino.computeResult(betId);

        if (won) {
            uint256 balanceBefore = token.balanceOf(player1);
            vm.prank(player1);
            clawsino.claim(betId);

            assertEq(token.balanceOf(player1), balanceBefore + payout);

            IClawsino.Bet memory bet = clawsino.getBet(betId);
            assertEq(uint8(bet.status), uint8(IClawsino.BetStatus.Claimed));
        }
    }

    function test_Claim_Loss() public {
        // Place bet
        vm.prank(player1);
        uint256 betId = clawsino.placeBet(100 ether, FIFTY_PERCENT);

        // Mine blocks (need block > betBlock + 1)
        vm.roll(block.number + 2);

        // Check result
        (bool won,) = clawsino.computeResult(betId);

        if (!won) {
            uint256 vaultBalanceBefore = token.balanceOf(address(vault));

            vm.prank(player1);
            clawsino.claim(betId);

            // Lost bet goes to vault
            assertEq(token.balanceOf(address(vault)), vaultBalanceBefore + 100 ether);

            IClawsino.Bet memory bet = clawsino.getBet(betId);
            assertEq(uint8(bet.status), uint8(IClawsino.BetStatus.Lost));
        }
    }

    function test_Claim_NotYourBet() public {
        vm.prank(player1);
        uint256 betId = clawsino.placeBet(100 ether, FIFTY_PERCENT);

        vm.roll(block.number + 1);

        vm.prank(player2);
        vm.expectRevert("Not your bet");
        clawsino.claim(betId);
    }

    function test_Claim_TooEarly() public {
        vm.prank(player1);
        uint256 betId = clawsino.placeBet(100 ether, FIFTY_PERCENT);

        // Don't mine any blocks
        vm.prank(player1);
        vm.expectRevert("Wait for next block");
        clawsino.claim(betId);
    }

    function test_SweepExpired() public {
        // Place bet
        vm.prank(player1);
        uint256 betId = clawsino.placeBet(100 ether, FIFTY_PERCENT);

        // Fast forward past expiry (300 blocks)
        vm.roll(block.number + 301);

        uint256 vaultBalanceBefore = token.balanceOf(address(vault));

        // Sweep
        uint256 swept = clawsino.sweepExpired(10);
        assertEq(swept, 1);

        // Bet amount should be in vault
        assertEq(token.balanceOf(address(vault)), vaultBalanceBefore + 100 ether);

        // Check bet status
        IClawsino.Bet memory bet = clawsino.getBet(betId);
        assertEq(uint8(bet.status), uint8(IClawsino.BetStatus.Expired));
    }

    function test_SetHouseEdge() public {
        clawsino.setHouseEdge(0.02e18);
        assertEq(clawsino.houseEdgeE18(), 0.02e18);
    }

    function test_SetHouseEdge_TooHigh() public {
        vm.expectRevert("Edge too high");
        clawsino.setHouseEdge(0.15e18);
    }

    function test_SetHouseEdge_NotOwner() public {
        vm.prank(player1);
        vm.expectRevert();
        clawsino.setHouseEdge(0.02e18);
    }

    function test_SetPoolFee() public {
        clawsino.setPoolFee(3000);
        assertEq(clawsino.poolFee(), 3000);
    }
}

contract BetMathTest is Test {
    function test_CalculatePayout_FiftyPercent() public pure {
        uint256 payout = BetMath.calculatePayout(1 ether, 0.5e18);
        assertEq(payout, 2 ether);
    }

    function test_CalculatePayout_TwentyFivePercent() public pure {
        uint256 payout = BetMath.calculatePayout(1 ether, 0.25e18);
        assertEq(payout, 4 ether);
    }

    function test_CalculatePayout_TenPercent() public pure {
        uint256 payout = BetMath.calculatePayout(1 ether, 0.1e18);
        assertEq(payout, 10 ether);
    }

    function test_IsWinner_ZeroResult() public pure {
        // Zero should always win (below any threshold > 0)
        bool won = BetMath.isWinner(0, 0.5e18, 0.01e18);
        assertTrue(won);
    }

    function test_IsWinner_MaxResult() public pure {
        // Max result should never win
        bool won = BetMath.isWinner(type(uint256).max, 0.99e18, 0.01e18);
        assertFalse(won);
    }
}

contract KellyCriterionTest is Test {
    function test_CalculateMaxBet_FiftyPercent() public pure {
        // maxBet = (10 ETH * 0.01) / (2 - 1) = 0.1 ETH
        uint256 maxBet = KellyCriterion.calculateMaxBet(10 ether, 0.5e18, 0.01e18);
        assertEq(maxBet, 0.1 ether);
    }

    function test_CalculateMaxBet_TwentyFivePercent() public pure {
        // maxBet = (10 ETH * 0.01) / (4 - 1) = 0.0333... ETH
        uint256 maxBet = KellyCriterion.calculateMaxBet(10 ether, 0.25e18, 0.01e18);
        assertApproxEqRel(maxBet, 0.0333 ether, 0.01e18);
    }

    function test_CalculateMaxBet_TenPercent() public pure {
        // maxBet = (10 ETH * 0.01) / (10 - 1) = 0.0111... ETH
        uint256 maxBet = KellyCriterion.calculateMaxBet(10 ether, 0.1e18, 0.01e18);
        assertApproxEqRel(maxBet, 0.0111 ether, 0.01e18);
    }

    function test_CalculateMaxBet_ZeroBankroll() public pure {
        uint256 maxBet = KellyCriterion.calculateMaxBet(0, 0.5e18, 0.01e18);
        assertEq(maxBet, 0);
    }

    function test_IsBetSafe() public pure {
        assertTrue(KellyCriterion.isBetSafe(0.05 ether, 10 ether, 0.5e18, 0.01e18));
        assertTrue(KellyCriterion.isBetSafe(0.1 ether, 10 ether, 0.5e18, 0.01e18));
        assertFalse(KellyCriterion.isBetSafe(0.2 ether, 10 ether, 0.5e18, 0.01e18));
    }
}

contract ClawsinoVaultTest is Test {
    ClawsinoVault public vault;
    Clawsino public clawsino;
    MockWETH public weth;
    MockToken public token;
    MockSwapRouter public router;

    address public staker1 = address(0x1);
    address public staker2 = address(0x2);

    function setUp() public {
        weth = new MockWETH();
        token = new MockToken();
        router = new MockSwapRouter(address(weth), address(token));

        vault = new ClawsinoVault(address(token), address(weth), address(router), "Clawsino Staked Token", "clawTOKEN");
        clawsino = new Clawsino(address(vault), address(weth), address(router));
        vault.setClawsino(address(clawsino));

        // Fund stakers
        token.mint(staker1, 10000 ether);
        token.mint(staker2, 10000 ether);
        vm.deal(staker1, 100 ether);
        vm.deal(staker2, 100 ether);

        // Approve vault
        vm.prank(staker1);
        token.approve(address(vault), type(uint256).max);
        vm.prank(staker2);
        token.approve(address(vault), type(uint256).max);
    }

    function test_Stake() public {
        vm.prank(staker1);
        uint256 shares = vault.stake(1000 ether);

        assertEq(shares, 1000 ether); // First stake is 1:1
        assertEq(vault.balanceOf(staker1), 1000 ether);
        assertEq(token.balanceOf(address(vault)), 1000 ether);
    }

    function test_StakeWithETH() public {
        vm.prank(staker1);
        uint256 shares = vault.stakeWithETH{ value: 1 ether }(0);

        // 1 ETH * 1000 rate = 1000 tokens
        assertEq(shares, 1000 ether);
        assertEq(vault.balanceOf(staker1), 1000 ether);
        assertEq(token.balanceOf(address(vault)), 1000 ether);
    }

    function test_StakeWithETH_SlippageProtection() public {
        vm.prank(staker1);
        vm.expectRevert("Insufficient output");
        vault.stakeWithETH{ value: 1 ether }(2000 ether); // Require 2000 but only get 1000
    }

    function test_Stake_Multiple() public {
        vm.prank(staker1);
        vault.stake(1000 ether);

        vm.prank(staker2);
        uint256 shares = vault.stake(1000 ether);

        assertEq(shares, 1000 ether); // Same share price
        assertEq(vault.balanceOf(staker2), 1000 ether);
        assertEq(token.balanceOf(address(vault)), 2000 ether);
    }

    function test_Unstake() public {
        vm.prank(staker1);
        vault.stake(1000 ether);

        uint256 balanceBefore = token.balanceOf(staker1);

        vm.prank(staker1);
        uint256 assets = vault.unstake(1000 ether);

        assertEq(assets, 1000 ether);
        assertEq(token.balanceOf(staker1), balanceBefore + 1000 ether);
        assertEq(vault.balanceOf(staker1), 0);
    }

    function test_SharePriceIncrease() public {
        // Staker1 stakes 1000 tokens
        vm.prank(staker1);
        vault.stake(1000 ether);

        // Simulate house win (send 100 tokens to vault from clawsino)
        token.mint(address(clawsino), 100 ether);
        vm.prank(address(clawsino));
        token.transfer(address(vault), 100 ether);

        // Vault now has 1100 tokens, staker1 has 1000 shares
        // Each share worth 1.1 tokens
        uint256 assets = vault.previewRedeem(1000 ether);
        assertApproxEqAbs(assets, 1100 ether, 1); // Allow 1 wei difference
    }

    function test_SetClawsino_OnlyOnce() public {
        // Already set in setUp
        vm.expectRevert("Already set");
        vault.setClawsino(address(0x123));
    }

    function test_SetPoolFee() public {
        vault.setPoolFee(3000);
        assertEq(vault.poolFee(), 3000);
    }
}
