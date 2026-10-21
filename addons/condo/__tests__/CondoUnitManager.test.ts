/**
 * CondoUnitManager over the JSON provider, in a temporary folder that each
 * test creates and removes, and nothing else.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import CondoUnitManager, { createProvider } from '../managers/CondoUnitManager.js';
import { unitTypesFrom } from '../managers/unitTypes.js';
import { lateChargesFrom } from '../managers/lateCharges.js';
import { FAIRWAYS_LATE_CHARGES, FAIRWAYS_UNIT_TYPES, SAMPLE_UNITS } from './fixtures.js';

describe('CondoUnitManager', () => {
  let dataPath: string;
  let bumps: number;

  async function open(units = SAMPLE_UNITS): Promise<CondoUnitManager> {
    writeFileSync(path.join(dataPath, 'units.json'), JSON.stringify(units));
    const manager = new CondoUnitManager({
      provider: await createProvider('json', dataPath),
      unitTypes: unitTypesFrom(FAIRWAYS_UNIT_TYPES),
      lateCharges: lateChargesFrom(FAIRWAYS_LATE_CHARGES),
      bump: async () => { bumps++; }
    });
    await manager.initialize();
    return manager;
  }

  beforeEach(() => {
    dataPath = mkdtempSync(path.join(tmpdir(), 'condo-units-'));
    bumps = 0;
  });
  afterEach(() => { rmSync(dataPath, { recursive: true, force: true }); });

  test('loads units and passes every field through', async () => {
    const m = await open();
    expect(m.providerName).toBe('json');
    expect(m.count()).toBe(3);
    expect(m.get('66-00001.000')).toMatchObject({ sqft: 1500, marketValue: 200000, city: 'Mount Vernon' });
  });

  test('no file yet is no units, and the folder is made', async () => {
    const sub = path.join(dataPath, 'new');
    const m = new CondoUnitManager({ provider: await createProvider('json', sub), unitTypes: new Map() });
    await m.initialize();
    expect(m.count()).toBe(0);
  });

  test('an unknown provider is refused, naming the known ones', async () => {
    await expect(createProvider('sql', dataPath)).rejects.toThrow('unknown provider "sql" (known: json)');
  });

  test('search matches any field and owners, ignoring case', async () => {
    const m = await open();
    expect(m.search('CORNER').map(u => u.id)).toEqual(['66-00002.000']);
    expect(m.search('sam example').map(u => u.id)).toEqual(['66-00001.000']);
    expect(m.search('105').map(u => u.id)).toEqual(['66-00003.000']);
    expect(m.search('').length).toBe(3);
  });

  test('owners: given shares kept, the rest split evenly; plain names still read', async () => {
    const m = await open();
    expect(m.owners('66-00001.000')).toEqual([
      { name: 'Pat Example', person: 'person:0001', share: 60 },
      { name: 'Sam Example', person: null, share: 40 }
    ]);
    expect(m.owners('66-00002.000')).toEqual([{ name: 'Lee Owner', person: null, share: 100 }]);
    expect(m.owners('66-00003.000')).toEqual([]);
  });

  test('owners refuses shares over 100%', async () => {
    const m = await open([{ id: 'p', owners: [{ name: 'A', share: 70 }, { name: 'B', share: 40 }] }]);
    expect(() => m.owners('p')).toThrow('110%');
  });

  test('unit type and assessment come from the configured type', async () => {
    const m = await open();
    expect(m.unitType('66-00001.000')?.name).toBe('C Model');
    expect(m.assessment('66-00002.000')).toEqual({ unitType: 'D', amount: 58400, period: 'monthly', datedue: 1 });
    expect(m.assessment('66-00003.000')).toBeNull(); // type Z is not configured
    expect(m.assessment('no-such-unit')).toBeNull();
  });

  test('lateCharges gives the rules, and a caller cannot change them', async () => {
    const m = await open();
    const rules = m.lateCharges();
    expect(rules.map(r => r.id)).toEqual(['late-10', 'late-60']);
    rules[0]!.amount = 1;
    expect(m.lateCharges()[0]!.amount).toBe(1000);
  });

  test('upsert and delete save through the provider and bump the cache once each', async () => {
    const m = await open();
    await m.upsert({ id: '66-00004.000', unitType: 'A', owners: [] });
    expect(await m.delete('66-00001.000')).toBe(true);
    expect(await m.delete('nope')).toBe(false);
    expect(bumps).toBe(2);
    const saved = JSON.parse(readFileSync(path.join(dataPath, 'units.json'), 'utf8')) as { id: string }[];
    expect(saved.map(u => u.id).sort()).toEqual(['66-00002.000', '66-00003.000', '66-00004.000']);
  });

  test('backup holds every unit; restore puts them back through the provider', async () => {
    const m = await open();
    const backup = await m.backup();
    expect(backup).toMatchObject({ managerName: 'CondoUnitManager', providerClass: 'json' });
    await m.upsert({ id: 'added-later' });
    await m.delete('66-00002.000');
    await m.restore(JSON.parse(JSON.stringify(backup)));
    expect(m.list().map(u => u.id)).toEqual(SAMPLE_UNITS.map(u => u.id).sort());
    expect(m.get('66-00001.000')).toMatchObject({ marketValue: 200000 });
    const saved = JSON.parse(readFileSync(path.join(dataPath, 'units.json'), 'utf8')) as unknown[];
    expect(saved).toHaveLength(3);
    expect(bumps).toBe(3);
  });

  test('restore refuses what is not a condo units backup, and changes nothing', async () => {
    const m = await open();
    await expect(m.restore({ managerName: 'UserManager', timestamp: '', data: { units: [] } })).rejects.toThrow('not a condo units backup');
    await expect(m.restore({ managerName: 'CondoUnitManager', timestamp: '', data: null })).rejects.toThrow('not a condo units backup');
    await expect(m.restore({ managerName: 'CondoUnitManager', timestamp: '', data: { units: [{ id: 'ok' }, { name: 'no id' }] } })).rejects.toThrow('backup unit 1 has no parcel id');
    expect(m.count()).toBe(3);
    expect(bumps).toBe(0);
  });

  test('upsert refuses a unit without a parcel id', async () => {
    const m = await open();
    await expect(m.upsert({ id: '' })).rejects.toThrow('unit.id');
    expect(bumps).toBe(0);
  });
});
