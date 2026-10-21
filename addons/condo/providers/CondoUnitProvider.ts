/**
 * Where condo units are stored. CondoUnitManager loads one of these, chosen by
 * `ngdpbase.addons.condo.provider`; routes and plugins never reach a provider.
 *
 * Add-ons cannot import core's BaseProvider (core values come only through
 * `host`), so this follows its shape without extending it.
 */

/**
 * A unit as stored. `id` is the county parcel. Every other field a site gives
 * is kept and passed through unchanged (operator, 2026-10-21).
 */
export type CondoUnit = { id: string } & Record<string, unknown>;

export interface CondoUnitProvider {
  /** The provider's config name, logged at boot. */
  readonly name: string;
  initialize(): Promise<void>;
  loadUnits(): Promise<CondoUnit[]>;
  /** Replaces every stored unit. */
  saveUnits(units: CondoUnit[]): Promise<void>;
}
