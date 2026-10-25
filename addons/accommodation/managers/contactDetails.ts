/**
 * A person's contact details as identity-record fields, the one mapping from the Occupancy
 * information form's answers (settled with ngdpbase core, 2026-10-24): the home address as
 * `address`; every other address and phone as a `contactPoint` entry typed by `contactType`, a
 * PostalAddress for an address and a ContactPoint for a phone (core's `ContactPointEntry`).
 * Answers left blank are left out.
 *
 * Used by association's approve (#33, through ResidencyManager.contactDetails) and by an owner's
 * edit of their occupant (#37), so the shape has one home.
 */
import type { ContactPointEntry, PostalAddress } from '@jwilleke/ngdpbase-types';

/** The contactPoint kinds an owner may change for their occupant (#37; operator, 2026-10-22). */
export const OCCUPANT_EDITABLE_TYPES = ['home', 'other', 'business', 'emergency'] as const;

/** The form answers an owner may change for their occupant: phones, work details, emergency contact. */
export const OCCUPANT_EDITABLE_FIELDS = ['homePhone', 'otherPhone', 'businessMailingAddress', 'businessPhone',
  'emergencyName', 'emergencyPhone', 'emergencyEmail'] as const;

function answer(data: Record<string, unknown>, name: string): string {
  const value = data[name];
  return typeof value === 'string' ? value.trim() : '';
}

export function contactDetailsFrom(data: Record<string, unknown>): { address?: PostalAddress; contactPoint: ContactPointEntry[] } {
  const a = (name: string): string => answer(data, name);
  const entry = (type: 'PostalAddress' | 'ContactPoint', contactType: string,
    fields: { name?: string; streetAddress?: string; telephone?: string; email?: string }): ContactPointEntry[] => {
    const given = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== ''));
    return Object.keys(given).length === 0 ? [] : [{ '@type': type, contactType, ...given } as ContactPointEntry];
  };
  const contactPoint = [
    ...entry('PostalAddress', 'mailing', { streetAddress: a('homeMailingAddress') }),
    ...entry('ContactPoint', 'home', { telephone: a('homePhone') }),
    ...entry('ContactPoint', 'other', { telephone: a('otherPhone') }),
    ...entry('PostalAddress', 'business', { streetAddress: a('businessMailingAddress') }),
    ...entry('ContactPoint', 'business', { telephone: a('businessPhone') }),
    ...entry('PostalAddress', 'agent', { name: a('agentName'), streetAddress: a('agentBusinessAddress'), telephone: a('agentBusinessPhone') }),
    ...entry('ContactPoint', 'emergency', { name: a('emergencyName'), telephone: a('emergencyPhone'), email: a('emergencyEmail') })
  ];
  const home = a('homeAddress');
  const address: PostalAddress = { '@type': 'PostalAddress', streetAddress: home };
  return { ...(home ? { address } : {}), contactPoint };
}

/**
 * The form answers an identity record's contactPoint entries hold, the reverse of
 * contactDetailsFrom for the kinds an owner may change: to fill in the owner's edit form.
 */
export function occupantAnswersFrom(contactPoint: unknown[] | undefined): Record<(typeof OCCUPANT_EDITABLE_FIELDS)[number], string> {
  const find = (type: 'PostalAddress' | 'ContactPoint', contactType: string): Record<string, unknown> =>
    ((contactPoint ?? []) as Array<Record<string, unknown>>).find(c => c['@type'] === type && c['contactType'] === contactType) ?? {};
  const s = (v: unknown): string => (typeof v === 'string' ? v : '');
  const emergency = find('ContactPoint', 'emergency');
  return {
    homePhone: s(find('ContactPoint', 'home')['telephone']),
    otherPhone: s(find('ContactPoint', 'other')['telephone']),
    businessMailingAddress: s(find('PostalAddress', 'business')['streetAddress']),
    businessPhone: s(find('ContactPoint', 'business')['telephone']),
    emergencyName: s(emergency['name']), emergencyPhone: s(emergency['telephone']), emergencyEmail: s(emergency['email'])
  };
}
