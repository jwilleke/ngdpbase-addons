/**
 * Where accommodations are stored. AccommodationManager loads one of these, chosen by
 * `ngdpbase.addons.accommodation.provider`; routes and plugins never reach a provider.
 *
 * Add-ons cannot import core's BaseProvider (core values come only through
 * `host`), so this follows its shape without extending it.
 */

/**
 * An accommodation (schema.org `Accommodation`) as stored. `id` is the county
 * parcel. Every other field a site gives is kept and passed through unchanged
 * (operator, 2026-10-21).
 */
export type Accommodation = { id: string } & Record<string, unknown>;

export interface AccommodationProvider {
  /** The provider's config name, logged at boot. */
  readonly name: string;
  initialize(): Promise<void>;
  loadAccommodations(): Promise<Accommodation[]>;
  /** Replaces every stored accommodation. */
  saveAccommodations(accommodations: Accommodation[]): Promise<void>;
}
