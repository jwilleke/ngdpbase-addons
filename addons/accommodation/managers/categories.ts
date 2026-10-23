/**
 * Accommodation categories (schema.org `accommodationCategory`), from
 * `ngdpbase.addons.accommodation.categories` (operator, 2026-10-21,
 * https://github.com/jwilleke/ngdpbase-addons/issues/4). Each accommodation has a
 * category, and each category carries the assessment:
 *
 *   "C": { "name": "C Model", "assessment": 41000, "period": "monthly", "datedue": 1 }
 *
 * - assessment: whole cents
 * - period: "monthly" or "annual"
 * - datedue: monthly, the day of the month (1–28); annual, "MM-DD"
 */

export type AssessmentPeriod = 'monthly' | 'annual';

export interface AccommodationCategory {
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
 * The configured categories. A malformed entry throws, naming it: a wrong
 * assessment is billing data, so it stops the add-on rather than being guessed.
 */
export function categoriesFrom(config: unknown): Map<string, AccommodationCategory> {
  const categories = new Map<string, AccommodationCategory>();
  if (config === undefined || config === null) return categories;
  if (typeof config !== 'object' || Array.isArray(config)) throw new Error('ngdpbase.addons.accommodation.categories must be a map of categories');
  for (const [id, raw] of Object.entries(config as Record<string, unknown>)) {
    const c = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const where = `ngdpbase.addons.accommodation.categories.${id}`;
    if (!Number.isInteger(c.assessment) || (c.assessment as number) < 0) throw new Error(`${where}.assessment must be whole cents, 0 or more`);
    if (c.period !== 'monthly' && c.period !== 'annual') throw new Error(`${where}.period must be "monthly" or "annual"`);
    if (!validDatedue(c.period, c.datedue)) {
      throw new Error(`${where}.datedue must be ${c.period === 'monthly' ? 'a day of the month, 1–28' : 'a date "MM-DD"'}`);
    }
    categories.set(id, {
      id,
      name: typeof c.name === 'string' && c.name !== '' ? c.name : id,
      assessment: c.assessment as number,
      period: c.period,
      datedue: c.datedue as number | string
    });
  }
  return categories;
}
