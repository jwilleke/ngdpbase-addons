/**
 * Charge lines (operator, 2026-10-26, https://github.com/jwilleke/ngdpbase-addons/issues/44): the
 * parts an assessment is shown in on the invoice, from `ngdpbase.addons.accommodation.charge-lines`.
 * The Fairways':
 *
 *   [ { "description": "Reserve Contribution", "percent": 61.49 },
 *     { "description": "Operating Contribution" } ]
 *
 * Each line with a `percent` is that share of the assessment, rounded to the nearest cent; exactly one
 * line has none and takes the rest, so the lines always add up to the assessment. With no lines set,
 * an assessment is one line, named after its category. Accounting shows them as given (its D-040).
 */

/** One configured line: its description, and its percent, or none for the line that takes the rest. */
export interface ChargeLineRule { description: string; percent: number | null }

/** One line of an assessment: what it is, and its amount in whole cents. */
export interface ChargeLine { description: string; amount: number }

/**
 * The configured lines. A malformed list throws, naming it: lines that do not add up bill people
 * wrongly, so they stop the add-on rather than being guessed.
 */
export function chargeLinesFrom(config: unknown): ChargeLineRule[] {
  if (config === undefined || config === null) return [];
  const where = 'ngdpbase.addons.accommodation.charge-lines';
  if (!Array.isArray(config)) throw new Error(`${where} must be a list of charge lines`);
  if (config.length === 0) return [];
  const rules = config.map((raw, i) => {
    const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const description = typeof r.description === 'string' ? r.description.trim() : '';
    if (!description) throw new Error(`${where}[${i}] needs a description`);
    if (r.percent === undefined) return { description, percent: null };
    if (typeof r.percent !== 'number' || !Number.isFinite(r.percent) || r.percent <= 0 || r.percent >= 100) {
      throw new Error(`${where}[${i}].percent must be a percent above 0 and below 100`);
    }
    if (Math.abs(r.percent * 100 - Math.round(r.percent * 100)) > 1e-6) {
      throw new Error(`${where}[${i}].percent may have at most two decimals`);
    }
    return { description, percent: r.percent };
  });
  if (rules.filter(r => r.percent === null).length !== 1) throw new Error(`${where} needs exactly one line with no percent, which takes the rest`);
  const total = rules.reduce((t, r) => t + (r.percent ?? 0), 0);
  if (total >= 100) throw new Error(`${where}: the percents add up to ${total}, leaving nothing for the rest`);
  if (new Set(rules.map(r => r.description)).size !== rules.length) throw new Error(`${where}: each line needs its own description`);
  return rules;
}

/** An assessment in its lines, adding up to it exactly; one line named `name` when no lines are set. */
export function splitIntoLines(amount: number, rules: ChargeLineRule[], name: string): ChargeLine[] {
  if (rules.length === 0) return [{ description: name, amount }];
  // Percent in hundredths, so the cents are worked out in whole numbers: 61.49% is 6149 / 10000.
  const parts = rules.map(r => (r.percent === null ? null : Math.round((amount * Math.round(r.percent * 100)) / 10000)));
  const rest = amount - parts.reduce<number>((t, p) => t + (p ?? 0), 0);
  return rules.map((r, i) => ({ description: r.description, amount: parts[i] ?? rest }));
}
