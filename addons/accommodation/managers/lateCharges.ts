/**
 * Late-charge rules, from `ngdpbase.addons.accommodation.late-charges` (operator,
 * 2026-10-21, https://github.com/jwilleke/ngdpbase-addons/issues/10). This add-on
 * holds and checks them; the accounting add-on applies them to what each unit
 * owes, and the treasurer confirms each charge.
 *
 *   "late-60": { "days-late": 60, "amount": 5000, "annual-percent": 8, "repeat": "monthly" }
 *
 * - days-late: whole days past the due date after which the rule applies
 * - amount: whole cents (optional)
 * - annual-percent: simple interest on the overdue balance, charged monthly at
 *   rate ÷ 12, never compounded (optional)
 * - repeat: "once" per late assessment, or "monthly"
 */

export type LateChargeRepeat = 'once' | 'monthly';

export interface LateChargeRule {
  id: string;
  daysLate: number;
  amount: number | null;
  annualPercent: number | null;
  repeat: LateChargeRepeat;
}

/**
 * The configured rules, ordered by days late. A malformed entry throws,
 * naming it: a wrong rule bills people wrongly, so it is never guessed.
 */
export function lateChargesFrom(config: unknown): LateChargeRule[] {
  if (config === undefined || config === null) return [];
  if (typeof config !== 'object' || Array.isArray(config)) throw new Error('ngdpbase.addons.accommodation.late-charges must be a map of rules');
  const rules: LateChargeRule[] = [];
  for (const [id, raw] of Object.entries(config as Record<string, unknown>)) {
    const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const where = `ngdpbase.addons.accommodation.late-charges.${id}`;
    if (!Number.isInteger(r['days-late']) || (r['days-late'] as number) < 1) throw new Error(`${where}.days-late must be whole days, 1 or more`);
    if (r.amount !== undefined && (!Number.isInteger(r.amount) || (r.amount as number) < 1)) throw new Error(`${where}.amount must be whole cents, 1 or more`);
    const pct = r['annual-percent'];
    if (pct !== undefined && (typeof pct !== 'number' || !Number.isFinite(pct) || pct <= 0 || pct > 100)) {
      throw new Error(`${where}.annual-percent must be a number above 0, at most 100`);
    }
    if (r.amount === undefined && pct === undefined) throw new Error(`${where} needs an amount, an annual-percent, or both`);
    if (r.repeat !== 'once' && r.repeat !== 'monthly') throw new Error(`${where}.repeat must be "once" or "monthly"`);
    rules.push({
      id,
      daysLate: r['days-late'] as number,
      amount: (r.amount as number | undefined) ?? null,
      annualPercent: (pct as number | undefined) ?? null,
      repeat: r.repeat
    });
  }
  return rules.sort((a, b) => a.daysLate - b.daysLate || a.id.localeCompare(b.id));
}
