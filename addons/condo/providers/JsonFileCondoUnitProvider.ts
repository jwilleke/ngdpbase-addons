/**
 * Condo units in one JSON file, `<dataPath>/units.json`: an array of units.
 * The default provider (`ngdpbase.addons.condo.provider: "json"`).
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { CondoUnit, CondoUnitProvider } from './CondoUnitProvider.js';

export default class JsonFileCondoUnitProvider implements CondoUnitProvider {
  readonly name = 'json';
  readonly file: string;

  constructor(private readonly dataPath: string) {
    this.file = path.join(dataPath, 'units.json');
  }

  async initialize(): Promise<void> {
    await mkdir(this.dataPath, { recursive: true });
  }

  async loadUnits(): Promise<CondoUnit[]> {
    let raw: string;
    try {
      raw = await readFile(this.file, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error(`${this.file}: expected an array of units`);
    return parsed.filter((u): u is CondoUnit =>
      !!u && typeof u === 'object' && typeof (u as { id?: unknown }).id === 'string' && (u as { id: string }).id !== '');
  }

  /** Written to a temporary file, then renamed over the old one, so a crash never leaves half a file. */
  async saveUnits(units: CondoUnit[]): Promise<void> {
    const tmp = `${this.file}.tmp`;
    await writeFile(tmp, JSON.stringify(units, null, 2) + '\n', 'utf8');
    await rename(tmp, this.file);
  }
}
