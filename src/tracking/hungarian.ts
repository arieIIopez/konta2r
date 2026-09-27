export interface Assignment {
  row: number;
  column: number;
  cost: number;
}

const LARGE_COST = 1e9;

function finiteCost(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) ? value : LARGE_COST;
}

/**
 * Minimum-cost bipartite assignment using the Hungarian algorithm.
 * Rectangular matrices are supported. Non-finite entries are treated as
 * forbidden associations and filtered from the returned solution.
 */
export function solveMinimumCostAssignment(
  costMatrix: readonly (readonly number[])[],
  maxAcceptedCost = Number.POSITIVE_INFINITY,
): Assignment[] {
  const rows = costMatrix.length;
  const columns = rows === 0 ? 0 : Math.max(...costMatrix.map((row) => row.length));
  if (rows === 0 || columns === 0) {
    return [];
  }

  const transposed = rows > columns;
  const n = transposed ? columns : rows;
  const m = transposed ? rows : columns;

  const costAt = (i: number, j: number): number => {
    const row = transposed ? j : i;
    const column = transposed ? i : j;
    return finiteCost(costMatrix[row]?.[column]);
  };

  const u = Array<number>(n + 1).fill(0);
  const v = Array<number>(m + 1).fill(0);
  const p = Array<number>(m + 1).fill(0);
  const way = Array<number>(m + 1).fill(0);

  for (let i = 1; i <= n; i += 1) {
    p[0] = i;
    let j0 = 0;
    const minv = Array<number>(m + 1).fill(Number.POSITIVE_INFINITY);
    const used = Array<boolean>(m + 1).fill(false);

    do {
      used[j0] = true;
      const i0 = p[j0] ?? 0;
      let delta = Number.POSITIVE_INFINITY;
      let j1 = 0;

      for (let j = 1; j <= m; j += 1) {
        if (used[j]) continue;
        const cur = costAt(i0 - 1, j - 1) - (u[i0] ?? 0) - (v[j] ?? 0);
        if (cur < (minv[j] ?? Number.POSITIVE_INFINITY)) {
          minv[j] = cur;
          way[j] = j0;
        }
        if ((minv[j] ?? Number.POSITIVE_INFINITY) < delta) {
          delta = minv[j] ?? Number.POSITIVE_INFINITY;
          j1 = j;
        }
      }

      if (!Number.isFinite(delta)) {
        break;
      }

      for (let j = 0; j <= m; j += 1) {
        if (used[j]) {
          const pj = p[j] ?? 0;
          u[pj] = (u[pj] ?? 0) + delta;
          v[j] = (v[j] ?? 0) - delta;
        } else {
          minv[j] = (minv[j] ?? Number.POSITIVE_INFINITY) - delta;
        }
      }
      j0 = j1;
    } while ((p[j0] ?? 0) !== 0);

    do {
      const j1 = way[j0] ?? 0;
      p[j0] = p[j1] ?? 0;
      j0 = j1;
    } while (j0 !== 0);
  }

  const assignments: Assignment[] = [];
  for (let j = 1; j <= m; j += 1) {
    const assignedRow = (p[j] ?? 0) - 1;
    if (assignedRow < 0 || assignedRow >= n) continue;

    const originalRow = transposed ? j - 1 : assignedRow;
    const originalColumn = transposed ? assignedRow : j - 1;
    const originalCost = finiteCost(costMatrix[originalRow]?.[originalColumn]);

    if (originalCost >= LARGE_COST || originalCost > maxAcceptedCost) continue;
    assignments.push({ row: originalRow, column: originalColumn, cost: originalCost });
  }

  return assignments.sort((a, b) => a.row - b.row || a.column - b.column);
}
