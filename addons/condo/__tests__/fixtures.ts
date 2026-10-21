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
    unitType: 'C', sqft: 1500, marketValue: 200000, shares: { 'pat.example': 60 }, notes: ''
  },
  { id: '66-00002.000', streetNo: '103', streetName: 'Sample', streetType: 'Dr', unitType: 'D', sqft: 1900, notes: 'corner unit' },
  { id: '66-00003.000', streetNo: '105', streetName: 'Sample', streetType: 'Dr', unitType: 'Z' }
];

/** Users as UserManager.getUsers() gives them, with condo's extended fields. */
export const SAMPLE_USERS: CondoUserRecord[] = [
  { username: 'pat.example', displayName: 'Pat Example', email: 'pat@example.org', parcel: ['66-00001.000'], condoUserType: ['owner'] },
  { username: 'sam.example', displayName: 'Sam Example', parcel: ['66-00001.000', '66-00002.000'], condoUserType: ['owner'] },
  { username: 'lee.renter', displayName: 'Lee Renter', parcel: ['66-00001.000'], condoUserType: ['occupant'] },
  { username: 'kim.both', parcel: '66-00002.000', condoUserType: ['owner', 'occupant'] },
  { username: 'admin', displayName: 'Administrator' }
];
