/**
 * Classic Betting Strategies
 *
 * These strategies were studied by 14th-18th century French mathematicians
 * including Blaise Pascal, Pierre de Fermat, and the Chevalier de Méré.
 *
 * WARNING: All betting strategies have negative expected value against a house edge.
 * These are provided for educational and entertainment purposes only.
 */

export interface BetDecision {
  shouldBet: boolean;
  amount: bigint;
  odds: number;
  reason: string;
}

export interface StrategyState {
  initialBet: bigint;
  currentBet: bigint;
  totalWagered: bigint;
  totalWon: bigint;
  wins: number;
  losses: number;
  streak: number; // positive = wins, negative = losses
  history: boolean[]; // true = win, false = loss
}

export function createInitialState(initialBet: bigint): StrategyState {
  return {
    initialBet,
    currentBet: initialBet,
    totalWagered: 0n,
    totalWon: 0n,
    wins: 0,
    losses: 0,
    streak: 0,
    history: [],
  };
}

export function updateState(state: StrategyState, won: boolean, betAmount: bigint, payout: bigint): StrategyState {
  const newHistory = [...state.history, won];
  const newStreak = won
    ? (state.streak >= 0 ? state.streak + 1 : 1)
    : (state.streak <= 0 ? state.streak - 1 : -1);

  return {
    ...state,
    totalWagered: state.totalWagered + betAmount,
    totalWon: state.totalWon + (won ? payout : 0n),
    wins: state.wins + (won ? 1 : 0),
    losses: state.losses + (won ? 0 : 1),
    streak: newStreak,
    history: newHistory,
  };
}

/**
 * MARTINGALE STRATEGY
 *
 * Origin: 18th century France, named after John Henry Martindale
 *
 * Method: Double your bet after each loss, reset to initial bet after a win.
 * The idea is that one win recovers all previous losses plus profit equal to initial bet.
 *
 * Risk: Exponential growth in bet size during losing streaks can hit table limits
 * or bankroll limits quickly. A run of 10 losses on a 1 token bet requires 1024 tokens.
 */
export function martingale(state: StrategyState, maxBet: bigint): BetDecision {
  let nextBet: bigint;
  let reason: string;

  if (state.history.length === 0 || state.history[state.history.length - 1]) {
    // First bet or last bet was a win - reset to initial
    nextBet = state.initialBet;
    reason = state.history.length === 0
      ? 'Starting with initial bet'
      : 'Won last bet, resetting to initial';
  } else {
    // Lost last bet - double it
    nextBet = state.currentBet * 2n;
    reason = `Lost last bet, doubling to recover losses (streak: ${state.streak})`;
  }

  if (nextBet > maxBet) {
    return {
      shouldBet: false,
      amount: 0n,
      odds: 0.5,
      reason: `Next bet ${nextBet} exceeds max bet ${maxBet}. Strategy cannot continue.`,
    };
  }

  return {
    shouldBet: true,
    amount: nextBet,
    odds: 0.5, // Martingale works best at 50% odds
    reason,
  };
}

/**
 * ANTI-MARTINGALE (PAROLI) STRATEGY
 *
 * Origin: 16th century Italy, popularized in France
 *
 * Method: Double your bet after each win, reset after a loss or reaching target wins.
 * Capitalizes on winning streaks while limiting losses.
 *
 * Risk: Profits can be wiped out by a single loss at the peak.
 */
export function antiMartingale(
  state: StrategyState,
  maxBet: bigint,
  targetWinStreak: number = 3
): BetDecision {
  let nextBet: bigint;
  let reason: string;

  if (state.history.length === 0) {
    nextBet = state.initialBet;
    reason = 'Starting with initial bet';
  } else if (!state.history[state.history.length - 1]) {
    // Lost - reset
    nextBet = state.initialBet;
    reason = 'Lost last bet, resetting to protect profits';
  } else if (state.streak >= targetWinStreak) {
    // Hit target streak - collect profits
    nextBet = state.initialBet;
    reason = `Hit ${targetWinStreak} win streak! Collecting profits and resetting`;
  } else {
    // Won but haven't hit target - double
    nextBet = state.currentBet * 2n;
    reason = `Win streak: ${state.streak}. Doubling to ride the wave (target: ${targetWinStreak})`;
  }

  if (nextBet > maxBet) {
    nextBet = maxBet;
    reason += ` (capped at max bet)`;
  }

  return {
    shouldBet: true,
    amount: nextBet,
    odds: 0.5,
    reason,
  };
}

/**
 * D'ALEMBERT STRATEGY
 *
 * Origin: Named after 18th century French mathematician Jean-Baptiste le Rond d'Alembert
 *
 * Method: Increase bet by one unit after a loss, decrease by one unit after a win.
 * Based on the (flawed) "law of equilibrium" - that wins and losses should balance.
 *
 * Risk: Slower growth than Martingale but still accumulates losses over time.
 */
export function dAlembert(state: StrategyState, maxBet: bigint): BetDecision {
  const unit = state.initialBet;
  let nextBet: bigint;
  let reason: string;

  if (state.history.length === 0) {
    nextBet = unit;
    reason = 'Starting with one unit';
  } else if (state.history[state.history.length - 1]) {
    // Won - decrease by one unit (minimum: 1 unit)
    nextBet = state.currentBet > unit ? state.currentBet - unit : unit;
    reason = 'Won last bet, decreasing by one unit';
  } else {
    // Lost - increase by one unit
    nextBet = state.currentBet + unit;
    reason = 'Lost last bet, increasing by one unit';
  }

  if (nextBet > maxBet) {
    return {
      shouldBet: false,
      amount: 0n,
      odds: 0.5,
      reason: `Next bet ${nextBet} exceeds max bet ${maxBet}. Strategy cannot continue.`,
    };
  }

  return {
    shouldBet: true,
    amount: nextBet,
    odds: 0.5,
    reason,
  };
}

/**
 * FIBONACCI STRATEGY
 *
 * Origin: Based on the 13th century sequence by Leonardo of Pisa (Fibonacci),
 * applied to gambling in later centuries.
 *
 * Method: Bet according to Fibonacci sequence (1,1,2,3,5,8,13...) after losses.
 * Move back two steps in sequence after a win.
 *
 * Risk: Slower than Martingale but still grows exponentially.
 */
export function fibonacci(state: StrategyState, maxBet: bigint): BetDecision {
  const unit = state.initialBet;

  // Generate Fibonacci sequence up to reasonable length
  const fib = [1n, 1n];
  while (fib[fib.length - 1] * unit <= maxBet * 2n) {
    fib.push(fib[fib.length - 1] + fib[fib.length - 2]);
  }

  // Count consecutive losses to determine position in sequence
  let lossCount = 0;
  for (let i = state.history.length - 1; i >= 0; i--) {
    if (!state.history[i]) lossCount++;
    else break;
  }

  // After a win, move back 2 positions
  const lastWon = state.history.length > 0 && state.history[state.history.length - 1];
  if (lastWon && lossCount > 0) {
    lossCount = Math.max(0, lossCount - 2);
  }

  const fibIndex = Math.min(lossCount, fib.length - 1);
  const nextBet = fib[fibIndex] * unit;

  if (nextBet > maxBet) {
    return {
      shouldBet: false,
      amount: 0n,
      odds: 0.5,
      reason: `Fibonacci position ${fibIndex} (${fib[fibIndex]} units) exceeds max bet`,
    };
  }

  return {
    shouldBet: true,
    amount: nextBet,
    odds: 0.5,
    reason: `Fibonacci position ${fibIndex}: ${fib[fibIndex]} unit(s)`,
  };
}

/**
 * LABOUCHÈRE STRATEGY (Cancellation System)
 *
 * Origin: Attributed to Henry Labouchère, 19th century British politician
 *
 * Method: Write a sequence of numbers (e.g., 1,2,3,4). Bet sum of first and last.
 * On win: remove both numbers. On loss: add the lost amount to the end.
 * Goal: Cancel all numbers to profit by sum of original sequence.
 *
 * Risk: Sequence can grow very long during losing streaks.
 */
export interface LabouchereState extends StrategyState {
  sequence: number[];
}

export function createLabouchereState(initialBet: bigint, sequence: number[] = [1, 2, 3, 4]): LabouchereState {
  return {
    ...createInitialState(initialBet),
    sequence: [...sequence],
  };
}

export function labouchere(state: LabouchereState, maxBet: bigint): BetDecision {
  if (state.sequence.length === 0) {
    return {
      shouldBet: false,
      amount: 0n,
      odds: 0.5,
      reason: 'Sequence complete! Goal reached. Reset to start again.',
    };
  }

  const unit = state.initialBet;
  let betUnits: number;

  if (state.sequence.length === 1) {
    betUnits = state.sequence[0];
  } else {
    betUnits = state.sequence[0] + state.sequence[state.sequence.length - 1];
  }

  const nextBet = BigInt(betUnits) * unit;

  if (nextBet > maxBet) {
    return {
      shouldBet: false,
      amount: 0n,
      odds: 0.5,
      reason: `Bet of ${betUnits} units exceeds max bet. Sequence: [${state.sequence.join(',')}]`,
    };
  }

  return {
    shouldBet: true,
    amount: nextBet,
    odds: 0.5,
    reason: `Sequence: [${state.sequence.join(',')}] → bet ${betUnits} units`,
  };
}

export function updateLabouchereSequence(state: LabouchereState, won: boolean, betUnits: number): number[] {
  if (won) {
    // Remove first and last
    const newSeq = [...state.sequence];
    newSeq.shift();
    if (newSeq.length > 0) newSeq.pop();
    return newSeq;
  } else {
    // Add bet amount to end
    return [...state.sequence, betUnits];
  }
}

/**
 * OSCAR'S GRIND
 *
 * Origin: Described by Allan Wilson in "The Casino Gambler's Guide" (1965),
 * named after a gambler called Oscar.
 *
 * Method: Increase bet by one unit after a win (if you're behind).
 * Keep bet same after a loss. Goal is to profit one unit per cycle.
 *
 * Risk: Very slow progression but can get stuck in long cycles.
 */
export interface OscarsGrindState extends StrategyState {
  cycleProfit: bigint;
}

export function createOscarsGrindState(initialBet: bigint): OscarsGrindState {
  return {
    ...createInitialState(initialBet),
    cycleProfit: 0n,
  };
}

export function oscarsGrind(state: OscarsGrindState, maxBet: bigint): BetDecision {
  const unit = state.initialBet;

  // If we've profited one unit, cycle complete
  if (state.cycleProfit >= unit) {
    return {
      shouldBet: true,
      amount: unit,
      odds: 0.5,
      reason: `Cycle complete! Profited ${state.cycleProfit}. Starting new cycle.`,
    };
  }

  let nextBet: bigint;
  let reason: string;

  if (state.history.length === 0) {
    nextBet = unit;
    reason = 'Starting cycle with one unit';
  } else if (!state.history[state.history.length - 1]) {
    // Lost - keep same bet
    nextBet = state.currentBet;
    reason = 'Lost last bet, keeping same bet size';
  } else {
    // Won - increase by one unit if still behind
    const potentialBet = state.currentBet + unit;
    // Don't bet more than needed to reach +1 unit profit
    const neededToComplete = unit - state.cycleProfit;
    nextBet = potentialBet > neededToComplete ? neededToComplete : potentialBet;
    reason = `Won! Increasing bet. Cycle profit: ${state.cycleProfit}`;
  }

  if (nextBet > maxBet) {
    nextBet = maxBet;
    reason += ' (capped at max bet)';
  }

  return {
    shouldBet: true,
    amount: nextBet,
    odds: 0.5,
    reason,
  };
}

/**
 * Get strategy by name
 */
export type StrategyName = 'martingale' | 'anti-martingale' | 'dalembert' | 'fibonacci' | 'labouchere' | 'oscars-grind';

export const STRATEGIES: Record<StrategyName, {
  name: string;
  description: string;
  origin: string;
  risk: 'low' | 'medium' | 'high' | 'extreme';
}> = {
  'martingale': {
    name: 'Martingale',
    description: 'Double after loss, reset after win',
    origin: '18th century France',
    risk: 'extreme',
  },
  'anti-martingale': {
    name: 'Anti-Martingale (Paroli)',
    description: 'Double after win, reset after loss',
    origin: '16th century Italy',
    risk: 'medium',
  },
  'dalembert': {
    name: "D'Alembert",
    description: 'Increase by 1 unit after loss, decrease after win',
    origin: '18th century France (mathematician Jean-Baptiste d\'Alembert)',
    risk: 'medium',
  },
  'fibonacci': {
    name: 'Fibonacci',
    description: 'Follow Fibonacci sequence (1,1,2,3,5,8...) on losses',
    origin: '13th century sequence, gambling application later',
    risk: 'high',
  },
  'labouchere': {
    name: 'Labouchère (Cancellation)',
    description: 'Bet sum of first and last in a sequence, cross off on wins',
    origin: '19th century Britain',
    risk: 'high',
  },
  'oscars-grind': {
    name: "Oscar's Grind",
    description: 'Increase by 1 unit after win (if behind), same after loss',
    origin: 'Described in 1965, named after a gambler',
    risk: 'low',
  },
};
