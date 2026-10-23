/**
 * Accommodations in one JSON file, `<dataPath>/accommodations.json`: an array of accommodations.
 * The default provider (`ngdpbase.addons.accommodation.provider: "json"`).
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Accommodation, AccommodationProvider } from './AccommodationProvider.js';

export default class JsonFileAccommodationProvider implements AccommodationProvider {
  readonly name = 'json';
  readonly file: string;

  constructor(private readonly dataPath: string) {
    this.file = path.join(dataPath, 'accommodations.json');
  }

  async initialize(): Promise<void> {
    await mkdir(this.dataPath, { recursive: true });
  }

  async loadAccommodations(): Promise<Accommodation[]> {
    let raw: string;
    try {
      raw = await readFile(this.file, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error(`${this.file}: expected an array of accommodations`);
    return parsed.filter((a): a is Accommodation =>
      !!a && typeof a === 'object' && typeof (a as { id?: unknown }).id === 'string' && (a as { id: string }).id !== '');
  }

  /** Written to a temporary file, then renamed over the old one, so a crash never leaves half a file. */
  async saveAccommodations(accommodations: Accommodation[]): Promise<void> {
    const tmp = `${this.file}.tmp`;
    await writeFile(tmp, JSON.stringify(accommodations, null, 2) + '\n', 'utf8');
    await rename(tmp, this.file);
  }
}
