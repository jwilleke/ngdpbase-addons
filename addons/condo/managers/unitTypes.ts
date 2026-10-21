/**
 * Unit types, from `ngdpbase.addons.condo.unit-types` (operator, 2026-10-21,
 * https://github.com/jwilleke/ngdpbase-addons/issues/4). Each unit has a type,
 * and each type carries the unit assessment:
 *
 *   "C": { "name": "C Model", "assessment": 41000, "period": "monthly", "datedue": 1 }
 *
 * - assessment: whole cents
 * - period: "monthly" or "annual"
 * - datedue: monthly, the day of the month (1–28); annual, "MM-DD"
 */

export type AssessmentPeriod = 'monthly' | 'annual';

export interface UnitType {
  id: string;
  name: string;
  assessment: number;
  period: AssessmentPeriod;
  datedue: number | string;
}

const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function validDatedue(period: AssessmentPeriod, datedue: unknown): boolean {
  if (period === 'monthly') return Number.isInteger(datedue) && (datedue as number) >= 1 && (datedue as number) <= 28;
  if (typeof datedue !== 'string') return false;
  const m = /^(\d{2})-(\d{2})$/.exec(datedue);
  if (!m) return false;
  const month = Number(m[1]);
  const day = Number(m[2]);
  return month >= 1 && month <= 12 && day >= 1 && day <= DAYS_IN_MONTH[month - 1]!;
}

/**
 * The configured unit types. A malformed entry throws, naming it: a wrong
 * assessment is billing data, so it stops the add-on rather than being guessed.
 */
export function unitTypesFrom(config: unknown): Map<string, UnitType> {
  const types = new Map<string, UnitType>();
  if (config === undefined || config === null) return types;
  if (typeof config !== 'object' || Array.isArray(config)) throw new Error('ngdpbase.addons.condo.unit-types must be a map of unit types');
  for (const [id, raw] of Object.entries(config as Record<string, unknown>)) {
    const t = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const where = `ngdpbase.addons.condo.unit-types.${id}`;
    if (!Number.isInteger(t.assessment) || (t.assessment as number) < 0) throw new Error(`${where}.assessment must be whole cents, 0 or more`);
    if (t.period !== 'monthly' && t.period !== 'annual') throw new Error(`${where}.period must be "monthly" or "annual"`);
    if (!validDatedue(t.period, t.datedue)) {
      throw new Error(`${where}.datedue must be ${t.period === 'monthly' ? 'a day of the month, 1–28' : 'a date "MM-DD"'}`);
    }
    types.set(id, {
      id,
      name: typeof t.name === 'string' && t.name !== '' ? t.name : id,
      assessment: t.assessment as number,
      period: t.period,
      datedue: t.datedue as number | string
    });
  }
  return types;
}
