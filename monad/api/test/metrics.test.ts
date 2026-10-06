import { expect,it } from 'vitest';
import { computeMetrics,DAY } from '../src/metrics.ts';
import type { Interaction } from '../src/types.ts';
it('computes daily flow-adjusted TWR and applies the same flows to the MON benchmark',()=>{
  const now=3*DAY,equity=[
    {t:0,usd:100,sol:10,flow:100},
    {t:DAY/2,usd:150,sol:10,flow:50},
    {t:DAY,usd:165,sol:11,flow:0},
    {t:2*DAY,usd:181.5,sol:11,flow:0},
  ];
  const m=computeMetrics(equity,[],'all',now);
  expect(m.returnPct).toBeCloseTo(21,8);expect(m.solReturnPct).toBeCloseTo(10,8);
  expect(m.sharpe).toBeGreaterThan(0);expect(m.days).toBe(2);
});
