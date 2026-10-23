/**
 * Test data. The unit types and late charges are The Fairways' (operator, 2026-10-21, used as
 * examples); the units are made up, shaped like The Fairways' units.json.
 */
import type { CondoUnit } from '../providers/CondoUnitProvider.js';
import type { CondoUserRecord } from '../managers/CondoUnitManager.js';

export const FAIRWAYS_UNIT_TYPES = {
  A: { name: 'A Model', assessment: 33800, period: 'monthly', datedue: 1 },
  B: { name: 'B Model', assessment: 33800, period: 'monthly', datedue: 1 },
  C: { name: 'C Model', assessment: 41000, period: 'monthly', datedue: 1 },
  D: { name: 'D Model', assessment: 58400, period: 'monthly', datedue: 1 },
  E: { name: 'E Model', assessment: 33800, period: 'monthly', datedue: 1 },
  F: { name: 'F Model', assessment: 33800, period: 'monthly', datedue: 1 },
  G: { name: 'G Model', assessment: 33800, period: 'monthly', datedue: 1 },
  other: { name: 'Other', assessment: 33800, period: 'monthly', datedue: 1 }
};

/** The Fairways' late-charge policy (adopted 2019-07-16), as an example. */
export const FAIRWAYS_LATE_CHARGES = {
  'late-60': { 'days-late': 60, amount: 5000, 'annual-percent': 8, repeat: 'monthly' },
  'late-10': { 'days-late': 10, amount: 1000, repeat: 'once' }
};

export const SAMPLE_UNITS: CondoUnit[] = [
  {
    id: '66-00001.000', streetNo: '101', streetName: 'Sample', streetType: 'Dr', city: 'Mount Vernon',
    unitType: 'C', sqft: 1500, marketValue: 200000, notes: '',
    billing: [
      { to: ['pat.example'], address: { streetAddress: '101 Sample Dr', addressLocality: 'Mount Vernon', addressRegion: 'OH', postalCode: '43050' }, share: 60 },
      { to: ['sam.example'], address: { streetAddress: '9 Elsewhere Ln', addressLocality: 'Columbus', addressRegion: 'OH', postalCode: '43215' }, share: 40 }
    ]
  },
  { id: '66-00002.000', streetNo: '103', streetName: 'Sample', streetType: 'Dr', unitType: 'D', sqft: 1900, notes: 'corner unit' },
  { id: '66-00003.000', streetNo: '105', streetName: 'Sample', streetType: 'Dr', unitType: 'Z' }
];

/** "Today" in the tests, so which links are current never depends on the day the tests run. */
export const TEST_TODAY = '2026-10-22';

/** Users as UserManager.searchUsers() gives them, with condo's dated links (#15). */
export const SAMPLE_USERS: CondoUserRecord[] = [
  { username: 'pat.example', displayName: 'Pat Example', email: 'pat@example.org',
    condoUnits: [{ parcel: '66-00001.000', type: 'owner', from: '2015-06-01', to: 'current' }] },
  { username: 'sam.example', displayName: 'Sam Example', condoUnits: [
    { parcel: '66-00001.000', type: 'owner', from: '2015-06-01', to: 'current' },
    { parcel: '66-00002.000', type: 'owner', from: '2020-03-01', to: 'current' }] },
  { username: 'lee.renter', displayName: 'Lee Renter',
    condoUnits: [{ parcel: '66-00001.000', type: 'occupant', from: '2023-02-01', to: 'current' }] },
  { username: 'kim.both', condoUnits: [
    { parcel: '66-00002.000', type: 'owner', from: '2020-03-01', to: 'current' },
    { parcel: '66-00002.000', type: 'occupant', from: '2020-03-15', to: 'current' }] },
  { username: 'old.owner', displayName: 'Old Owner',
    condoUnits: [{ parcel: '66-00001.000', type: 'owner', from: '2008-01-10', to: '2015-05-31' }] },
  { username: 'moving.in', displayName: 'Moving In',
    condoUnits: [{ parcel: '66-00001.000', type: 'occupant', from: '2026-11-01', to: 'current' }] },
  { username: 'broken.links', condoUnits: [{ parcel: '66-00001.000', type: 'owner', from: '2020-01-01', to: null }] },
  { username: 'admin', displayName: 'Administrator' }
];
