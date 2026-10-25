/**
 * The Occupancy information form (https://github.com/jwilleke/ngdpbase-addons/issues/17):
 * what ORC 5311.09(A)(2) asks an association to collect for the unit owner and
 * every occupant, replacing The Fairways' Google form "Contact information".
 *
 * A definition for the forms add-on, registered by index.ts at every start
 * (registerShippedForm) with the handler that keeps each submission for review
 * (#32). For owners only, every submission approved before it applies (operator, 2026-10-25):
 * a signed-in owner then manages the unit's occupants, owners and billing from My accommodation.
 * Every question is a plain field: the forms add-on has no conditional
 * fields, so the "if working" and "if an agent" fields are optional and say so
 * (operator, 2026-10-22).
 */

export const OCCUPANCY_FORM_ID = 'association-occupancy';

export const occupancyForm = {
  id: OCCUPANCY_FORM_ID,
  title: 'Occupancy information',
  description: 'Ohio Revised Code 5311.09 asks the association to keep contact information for each unit owner. '
    + 'For owners: fill this in when you become an owner, or when your information changes. The association reviews it before anything is changed. '
    + 'Once approved, sign in to add your unit\'s occupants and its billing address.',
  // The add-on's handler keeps the record and sends its own notices (#17).
  store: false,
  notify: false,
  proxySubmission: true,
  fields: [
    { name: 'person', type: 'section', label: 'This person' },
    { name: 'email', type: 'email', label: 'Email', required: true },
    { name: 'firstName', type: 'text', label: 'First name', required: true },
    { name: 'lastName', type: 'text', label: 'Last name', required: true },
    { name: 'existingOwner', type: 'dropdown', label: 'Are you already an owner in this association?', required: true, options: ['Yes', 'No'],
      description: 'Yes if you already own a unit here, for example when you are adding another unit you own.' },
    { name: 'unit', type: 'dropdown', label: 'Unit address', required: true, optionsSource: 'fetch:AccommodationManager.toFormOptions()',
      description: 'The unit you own.' },
    { name: 'from', type: 'date', label: 'First date', required: true,
      description: 'The date you became an owner of the unit.' },
    { name: 'to', type: 'date', label: 'Last date',
      description: 'Only if you no longer own the unit.' },

    { name: 'home', type: 'section', label: 'Home (ORC 5311.09(A)(2)(a))' },
    { name: 'homeAddress', type: 'textarea', label: 'Home address',
      description: 'Only if you do not live in the unit.' },
    { name: 'homeMailingAddress', type: 'textarea', label: 'Home mailing address',
      description: 'Only if different from the home address.' },
    { name: 'homePhone', type: 'tel', label: 'Home phone', required: true,
      description: 'The best number to reach this person.' },
    { name: 'otherPhone', type: 'tel', label: 'Other phone' },

    { name: 'work', type: 'section', label: 'Work (ORC 5311.09(A)(2)(a))' },
    { name: 'working', type: 'dropdown', label: 'Are you working?', required: true, options: ['Yes', 'No'] },
    { name: 'businessMailingAddress', type: 'textarea', label: 'Business mailing address', description: 'If working.' },
    { name: 'businessPhone', type: 'tel', label: 'Business phone', description: 'If working.' },

    { name: 'agent', type: 'section', label: 'Who manages the unit (ORC 5311.09(A)(2)(b))' },
    { name: 'managedBy', type: 'dropdown', label: 'Managed by', required: true, options: ['The owner', 'An agent'],
      description: 'An agent is a paid property manager the owner hires, besides the association\'s own.' },
    { name: 'agentName', type: 'text', label: 'Agent name', description: 'If an agent.' },
    { name: 'agentBusinessAddress', type: 'textarea', label: 'Agent business address', description: 'If an agent.' },
    { name: 'agentBusinessPhone', type: 'tel', label: 'Agent business phone', description: 'If an agent.' },

    { name: 'emergency', type: 'section', label: 'Emergency contact',
      description: 'Recommended by the board, so the right people can be reached if the owner is not available when a unit issue arises.' },
    { name: 'emergencyName', type: 'text', label: 'Name' },
    { name: 'emergencyRelationship', type: 'text', label: 'Relationship', description: 'For example son or daughter.' },
    { name: 'emergencyPhone', type: 'tel', label: 'Phone' },
    { name: 'emergencyEmail', type: 'email', label: 'Email' },
    { name: 'emergencyAddress', type: 'textarea', label: 'Address' }
  ]
} as const;
