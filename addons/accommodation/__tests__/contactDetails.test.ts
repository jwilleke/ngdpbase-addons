/**
 * The one mapping of the Occupancy information form's answers to identity-record fields
 * (settled with ngdpbase core, 2026-10-24), used by association's approve and an owner's edit.
 */
import { describe, expect, test } from 'vitest';
import { contactDetailsFrom, occupantAnswersFrom } from '../managers/contactDetails.js';

describe('contactDetailsFrom', () => {
  test('the home address as address; every other address and phone as a typed contactPoint; blanks left out', () => {
    expect(contactDetailsFrom({
      homeAddress: '9 Elsewhere Ln', homeMailingAddress: 'PO Box 1', homePhone: '555-0100', otherPhone: '',
      businessMailingAddress: '1 Work St', businessPhone: '555-0200',
      agentName: 'Acme Management', agentBusinessAddress: '2 Agent Rd', agentBusinessPhone: '555-0300',
      emergencyName: 'Kim', emergencyPhone: '555-0199', emergencyEmail: 'kim@example.org'
    })).toEqual({
      address: { '@type': 'PostalAddress', streetAddress: '9 Elsewhere Ln' },
      contactPoint: [
        { '@type': 'PostalAddress', contactType: 'mailing', streetAddress: 'PO Box 1' },
        { '@type': 'ContactPoint', contactType: 'home', telephone: '555-0100' },
        { '@type': 'PostalAddress', contactType: 'business', streetAddress: '1 Work St' },
        { '@type': 'ContactPoint', contactType: 'business', telephone: '555-0200' },
        { '@type': 'PostalAddress', contactType: 'agent', name: 'Acme Management', streetAddress: '2 Agent Rd', telephone: '555-0300' },
        { '@type': 'ContactPoint', contactType: 'emergency', name: 'Kim', telephone: '555-0199', email: 'kim@example.org' }
      ]
    });
    expect(contactDetailsFrom({})).toEqual({ contactPoint: [] });
  });

  test('occupantAnswersFrom reads back what contactDetailsFrom wrote, for the kinds an owner may change', () => {
    const answers = { homePhone: '555-0100', otherPhone: '555-0101', businessMailingAddress: '1 Work St', businessPhone: '555-0200',
      emergencyName: 'Kim', emergencyPhone: '555-0199', emergencyEmail: 'kim@example.org' };
    expect(occupantAnswersFrom(contactDetailsFrom(answers).contactPoint)).toEqual(answers);
    expect(occupantAnswersFrom(undefined)).toEqual({ homePhone: '', otherPhone: '', businessMailingAddress: '', businessPhone: '', emergencyName: '', emergencyPhone: '', emergencyEmail: '' });
  });
});
