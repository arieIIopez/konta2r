import { describe, expect, it } from 'vitest';
import { solveMinimumCostAssignment } from '../../src/tracking/hungarian';

describe('Hungarian assignment', () => {
  it('finds the global optimum instead of greedy row order', () => {
    const result = solveMinimumCostAssignment([
      [1, 2],
      [1.1, 100],
    ]);

    expect(result).toEqual([
      { row: 0, column: 1, cost: 2 },
      { row: 1, column: 0, cost: 1.1 },
    ]);
  });

  it('supports rectangular matrices with more rows than columns', () => {
    const result = solveMinimumCostAssignment([
      [1, 9],
      [2, 1],
      [0.5, 5],
    ]);

    expect(result).toHaveLength(2);
    expect(result.some((item) => item.row === 2 && item.column === 0)).toBe(true);
    expect(result.some((item) => item.row === 1 && item.column === 1)).toBe(true);
  });

  it('does not emit forbidden infinite associations', () => {
    const result = solveMinimumCostAssignment([
      [Number.POSITIVE_INFINITY, 0.2],
      [0.3, Number.POSITIVE_INFINITY],
    ]);

    expect(result).toEqual([
      { row: 0, column: 1, cost: 0.2 },
      { row: 1, column: 0, cost: 0.3 },
    ]);
  });

  it('honors a caller-defined maximum accepted cost', () => {
    const result = solveMinimumCostAssignment([
      [0.2, 5],
      [4, 3],
    ], 1);

    expect(result).toEqual([{ row: 0, column: 0, cost: 0.2 }]);
  });
});
