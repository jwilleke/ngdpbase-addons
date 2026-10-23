import { describe, expect, test } from 'vitest';
import { occupancyForm } from '../forms/occupancyForm.js';

const FIELD_TYPES = ['text', 'email', 'tel', 'textarea', 'date', 'time', 'dropdown', 'checkbox', 'hidden', 'section', 'amount', 'checklist', 'lines'];

describe('Occupancy information form', () => {
  test('field names are unique and every type is one the forms add-on knows', () => {
    const names = occupancyForm.fields.map(f => f.name);
    expect(new Set(names).size).toBe(names.length);
    for (const f of occupancyForm.fields) expect(FIELD_TYPES).toContain(f.type);
    expect(occupancyForm.id).toMatch(/^[a-z0-9-]+$/);
  });

  test('asks everything ORC 5311.09(A)(2) names', () => {
    const names = occupancyForm.fields.map(f => f.name);
    for (const required of ['homeAddress', 'homeMailingAddress', 'homePhone', 'businessMailingAddress', 'businessPhone',
      'agentName', 'agentBusinessAddress', 'agentBusinessPhone']) {
      expect(names).toContain(required);
    }
  });

  test('the unit choice comes from AccommodationManager, not a hand-kept list', () => {
    const unit = occupancyForm.fields.find(f => f.name === 'unit');
    expect(unit).toMatchObject({ type: 'dropdown', optionsSource: 'fetch:AccommodationManager.toFormOptions()' });
  });
});
