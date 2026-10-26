/**
 * Test data. The categories and late charges are The Fairways' (operator, 2026-10-21, used as
 * examples); the accommodations are made up, shaped like The Fairways' units.json.
 */
import type { Accommodation } from '../providers/AccommodationProvider.js';
import type { UserRecord } from '../managers/ResidencyManager.js';

export const FAIRWAYS_CATEGORIES = {
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

export const SAMPLE_ACCOMMODATIONS: Accommodation[] = [
  {
    id: '66-00001.000', streetNo: '101', streetName: 'Sample', streetType: 'Dr', city: 'Mount Vernon',
    accommodationCategory: 'C', sqft: 1500, marketValue: 200000, notes: '',
    billing: [
      { address: 'PAT EXAMPLE\n101 Sample Dr\nMount Vernon OH 43050', share: 60 },
      { address: 'SAM EXAMPLE\n9 Elsewhere Ln\nColumbus OH 43215', share: 40 }
    ]
  },
  { id: '66-00002.000', streetNo: '103', streetName: 'Sample', streetType: 'Dr', accommodationCategory: 'D', sqft: 1900, notes: 'corner unit' },
  { id: '66-00003.000', streetNo: '105', streetName: 'Sample', streetType: 'Dr', accommodationCategory: 'Z' }
];

/** "Today" in the tests, so which links are current never depends on the day the tests run. */
export const TEST_TODAY = '2026-10-22';

/** Users as UserManager.searchUsers() gives them, with their dated links (#21). */
export const SAMPLE_USERS: UserRecord[] = [
  { username: 'pat.example', displayName: 'Pat Example', email: 'pat@example.org',
    ownership: [{ typeOfGood: '66-00001.000', ownedFrom: '2015-06-01', ownedThrough: 'current', share: 50, period: 'p1-now' }] },
  { username: 'sam.example', displayName: 'Sam Example', ownership: [
    { typeOfGood: '66-00001.000', ownedFrom: '2015-06-01', ownedThrough: 'current', share: 50, period: 'p1-now' },
    { typeOfGood: '66-00002.000', ownedFrom: '2020-03-01', ownedThrough: 'current', share: 50, period: 'p2-now' }] },
  { username: 'lee.renter', displayName: 'Lee Renter',
    occupies: [{ roleName: 'occupant', accommodation: '66-00001.000', startDate: '2023-02-01', endDate: 'current' }] },
  { username: 'kim.both',
    ownership: [{ typeOfGood: '66-00002.000', ownedFrom: '2020-03-01', ownedThrough: 'current', share: 50, period: 'p2-now' }],
    occupies: [{ roleName: 'occupant', accommodation: '66-00002.000', startDate: '2020-03-15', endDate: 'current' }] },
  { username: 'old.owner', displayName: 'Old Owner',
    ownership: [{ typeOfGood: '66-00001.000', ownedFrom: '2008-01-10', ownedThrough: '2015-05-31', share: 100, period: 'p1-old' }] },
  { username: 'moving.in', displayName: 'Moving In',
    occupies: [{ roleName: 'occupant', accommodation: '66-00001.000', startDate: '2026-11-01', endDate: 'current' }] },
  { username: 'broken.links', ownership: [{ typeOfGood: '66-00001.000', ownedFrom: '2020-01-01', ownedThrough: null, share: 100 }] },
  { username: 'admin', displayName: 'Administrator' }
];
