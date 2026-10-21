/**
 * CondoUnitManager — the condo units, registered on the engine as
 * 'CondoUnitManager' so routes, plugins and other add-ons reach it with
 * engine.getManager('CondoUnitManager').
 *
 * Skeleton only: storage, owners and backup arrive with
 * https://github.com/jwilleke/ngdpbase-addons/issues/4.
 */

export default class CondoUnitManager {
  private units: Record<string, unknown>[] = [];

  constructor(protected readonly dataPath: string) {}

  /** Called once during register(). */
  async load(): Promise<void> {
    this.units = [];
  }

  count(): number {
    return this.units.length;
  }
}
