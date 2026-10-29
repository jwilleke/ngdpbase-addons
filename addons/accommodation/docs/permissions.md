---
title: Accommodation permissions and roles
description: What each accommodation permission lets a person do, what it does not, where it is checked and recorded, and which roles hold it. The source of truth for their meaning.
last_updated: "2026-10-29"
---

# Accommodation permissions and roles

This page is the source of truth for what each accommodation permission __means__. The permissions that are
built are declared, with the policy that grants them, in
[config/default-config.json](../config/default-config.json); that file is what the site runs. When the
two disagree, the code is wrong or this page is, and one of them is fixed.

How ngdpbase decides, in one line: a policy grants a permission to a role, a person holds the roles
they are given, and the add-on asks for the permission, never for a role name. A site changes who
holds what in its own `app-custom-config.json`, without touching the add-on.

## Permissions

| Permission | Status | Day one |
| --- | --- | --- |
| [`accommodation-read`](#accommodation-read) | Built ([#5](https://github.com/jwilleke/ngdpbase-addons/issues/5)) | admin, executive |
| [`accommodation-billing-read`](#accommodation-billing-read) | Built | admin, executive; accounting's policy grants its invoice job |
| [`accommodation-units-list`](#accommodation-units-list) | Built ([#32](https://github.com/jwilleke/ngdpbase-addons/issues/32)) | every visitor and every user |
| [`accommodation-manage`](#accommodation-manage) | Built ([#5](https://github.com/jwilleke/ngdpbase-addons/issues/5)) | admin |
| [`accommodation-notices`](#accommodation-notices) | Built ([#38](https://github.com/jwilleke/ngdpbase-addons/issues/38)) | admin, executive |
| [`accommodation-self`](#accommodation-self) | Seeing your own units built ([#36](https://github.com/jwilleke/ngdpbase-addons/issues/36)); changes planned ([#16](https://github.com/jwilleke/ngdpbase-addons/issues/16)) | every user, through `vault-owner` |
| [`accommodation-ownership-review`](#accommodation-ownership-review) | Built ([#40](https://github.com/jwilleke/ngdpbase-addons/issues/40)) | admin, executive |
| [`accommodation-maintenance-read`](#accommodation-maintenance-read) | Proposed | board |
| [`accommodation-board-read`](#accommodation-board-read) | Proposed | board |

### accommodation-read

- __Lets a person:__ see every accommodation, its category and assessment, its billing, and its current and
  past owners and occupants with their contact details.
- __Does not:__ change anything, or see a unit's files.
- __Implies:__ access to personal data (names, addresses, phones, emergency contacts) for every unit.
  Grant it only to people the association trusts with the whole roster: the board, a management
  company.
- __Checked:__ where a person asks: the add-on's routes and its plugin, and the Executive Hub card's
  figures, which core shows only to a holder and the card asks again with the viewer's context.
- __Granted:__ to admins, and to core's `executive` role (the board: nothing the organization keeps is
  hidden from it, operator 2026-10-26), in accommodation's own policies ([ngdpbase#2094](https://github.com/jwilleke/ngdpbase/issues/2094)).
- __Recorded:__ not yet. Reads are not audited today.

### accommodation-billing-read

- __Lets a person or a job:__ read a unit's billing, `ResidencyManager.billing(ctx, id, { on })`: where
  its invoices go and for what share, and its owners on the date by identity `@id` with their shares.
  It is what the accounting add-on's invoice job asks.
- __Does not:__ show anything else about the unit or its people.
- __Checked:__ by `ResidencyManager.billing` with the caller's context. Only then are the owners read,
  under the system context with a reason naming the caller and unit, and only billing fields are
  returned, so the caller needs no `search-user` (asked by ngdpbase core for accounting, 2026-10-25).
- __Granted:__ to admins and to core's `executive` role in accommodation's own policies ([ngdpbase#2094](https://github.com/jwilleke/ngdpbase/issues/2094)).
  accounting's policy grants it to its job `accounting-dues.issue-invoices`, a job subject.

### accommodation-units-list

- __Lets a person:__ see the list of accommodations by street address, to pick their unit: the unit
  choices on the Occupancy information form.
- __Does not:__ show who owns or lives in any of them, or anything else about a unit. The label is the
  street address only; the value is the parcel.
- __Granted:__ in accommodation's own policy to the roles `anonymous` (every visitor) and `vault-owner`
  (every user), the core pattern for "anyone" (settled with ngdpbase core, 2026-10-24).
- __Checked:__ by `AccommodationManager.toFormOptions`, with the viewer's context; a "no" offers no
  choices. The forms add-on asks again when the form is submitted.
- __Recorded:__ no; it changes nothing.

### accommodation-manage

- __Lets a person:__ create, change and remove accommodations, categories, billing entries and owner and
  occupant links, for every unit.
- __Does not:__ by itself let a person see the units; pair it with `accommodation-read`.
- __Implies:__ the power to change who is billed and for how much, and who holds the `owner` and
  `occupant` roles. Every change goes through `AccommodationManager` (accommodations) or
  `ResidencyManager.changeLink` (owner and occupant entries, on the admin page,
  [#28](https://github.com/jwilleke/ngdpbase-addons/issues/28)), which checks this permission against
  the caller's context and records the change before making it.
- __Checked:__ by `AccommodationManager` and `ResidencyManager` on every change, and first by the admin
  page's route. A refusal is `AccommodationRefusedError`, which a route turns into 401 or 403.
- __Recorded:__ audit event `accommodation-manage`, with on-failure `refuse`: if the record cannot be written,
  the change is not made. The record names the accommodation, the action (`owner-add`, `occupant-end`, …)
  and the field names changed, never their values; for an entry, also the person (`metadata.owner`).

### accommodation-notices

- __Lets a person:__ be told of residents' changes the board should know about: an owner's billing
  address now, and changes to occupants later.
- __Does not:__ let them see or change anything.
- __Granted:__ to admins and to core's `executive` role in accommodation's own policies, so board
  members are told of owners' changes (operator, 2026-10-29,
  [ngdpbase#2094](https://github.com/jwilleke/ngdpbase/issues/2094)). A site may grant it to another
  role in its own policy; when `governance` exists, it can grant it to its board roles (settled with
  ngdpbase core, 2026-10-25).
- __Used:__ notices go to `PolicyDecisionPoint.usersHolding('accommodation-notices')`; with nobody
  holding it, the add-on logs only.

### accommodation-self

- __Lets a person:__ see their own unit (assessment, billing, owners and occupants, and a link to the
  dues card the accounting add-on puts on their profile, which shows their balance) and change their
  own details. An owner also edits, adds and removes the unit's
  occupants, and sets where the unit's invoices go.
- __Own unit means:__ a unit they hold a current link to, as owner or occupant. The add-on checks that link
  on every request; the permission alone opens nothing.
- __Checked:__ by `ResidencyManager.ownUnits` with the person's context, first the permission and then
  their own current entries. Only then are the unit's other people read, under the system context with
  a reason naming the person, and only the fields above are returned: co-owners' and occupants' names,
  occupants' emails and the billing entries to an owner (settled with ngdpbase core, 2026-10-25).
- __Granted:__ to every user, through the role `vault-owner`, in the add-on's own policy. Never to site
  roles or a list of roles, never to an `authenticated` subject, and never by editing a core policy
  (operator, 2026-10-24, [ngdpbase#1539](https://github.com/jwilleke/ngdpbase/issues/1539)): it is a
  permission over a person's own records.
- __Does not:__ change owners. An owner asks for a change of owners or shares, and it waits for a
  holder of `accommodation-ownership-review`.
- __Implies:__ an owner sees their occupants' contact details. An occupant sees the owners' names.
- __Recorded:__ each change made under it is recorded, and the reviewers get an advisory notice.
- __Billing:__ any current owner may change where the unit's invoices go, as the treasurer can: the
  addresses, the shares, adding or removing one (operator, 2026-10-25,
  [ngdpbase#2042](https://github.com/jwilleke/ngdpbase/issues/2042)). It applies at once, with an
  advisory notice to the Board of Directors.

### accommodation-ownership-review

- __Lets a person:__ decide an owner's request to change a unit's owners or shares, on core's
  reviews (`/reviews`) (operator, 2026-10-26: the Board approves). Approving applies the change: the
  current owners end the day before its date and the new owners start on it, in a new ownership
  period, which accounting bills as a new folio.
- __The only permission approving needs__ (operator, 2026-10-26: the executive is read-only except
  for deciding Board reviews). Core checks it when the request is decided. The add-on's review handler
  (`accommodation.ownership-change`) then does the work, new accounts included, under the system
  context, with a reason naming the request and the decider.
- __Granted:__ to admins and to core's `executive` role in accommodation's own policies, so the
  board decides owners' requests from the Executive Hub ([ngdpbase#2094](https://github.com/jwilleke/ngdpbase/issues/2094)). A site may grant it to another
  role in its own policy.
- __Recorded:__ core records the request and the decision (`review-filed`, `review-approved`,
  `review-rejected`); each entry the approval writes is recorded as `accommodation-manage` by the
  system, its reason naming the request and the decider.

### accommodation-maintenance-read

- __Lets a person:__ see the maintenance files of every unit: request history and maintenance notes.
- __Does not:__ see board-only files, or owner and occupant contact details beyond what a maintenance
  file holds.
- __Who:__ the maintenance provider, usually through `accommodation-manager`. A unit's own current owners and
  occupants see that unit's maintenance files through `accommodation-self`.

### accommodation-board-read

- __Lets a person:__ see the board-only files of every unit: notices to the owner (such as late
  assessments), inspections, photos, and anything about an owner's standing.
- __Implies:__ the most sensitive accommodation data. The board only.
- __Adding and removing these files:__ `accommodation-manage` covers it, for now (operator, 2026-10-22).

## Roles

The add-on ships these roles in its own config, as the accounting add-on ships `treasurer`. A role carries
nothing until a policy grants it permissions.

| Role | Who | Holds |
| --- | --- | --- |
| `admin` (core) | Site administrators | Every accommodation permission, on day one |
| `executive` (core) | The board, on the Executive Hub (`/executive`) | `accommodation-read`, `accommodation-billing-read`, `accommodation-ownership-review`, `accommodation-notices`, in the policy `accommodation-executive-access`. Nothing that changes a unit |
| `board-member` | The association's board | Planned: `accommodation-read`, `accommodation-ownership-review`, `accommodation-maintenance-read`, `accommodation-board-read` |
| `accommodation-manager` | Whoever the board grants permissions to: a management company, the reviewer, the maintenance provider | Only what the site's policy gives it; the board decides |
| Residents | Owners and occupants with an account | Planned: `accommodation-self` |

The board grants `accommodation-manager` its people and permissions through ngdpbase's own role and
configuration screens, as an admin (operator, 2026-10-22). The add-on's admin page does not manage roles.

## Core permissions the add-on uses

| Permission | Why |
| --- | --- |
| `identity-read` | The directory import ([#8](https://github.com/jwilleke/ngdpbase-addons/issues/8)) matches people against ngdpbase contacts |
| `identity-manage` | The directory import, and approving a form, create people |
| `form-submit` | Submitting the Occupancy information form; the forms add-on asks it |

## Rules

- The add-on never names a role in code; it asks for a permission.
- Changes are checked by `AccommodationManager` with the caller's context; reads are checked where a
  person asks.
- No accommodation permission asks for a fresh sign-in (step-up), for now: ngdpbase add-on forms lose their
  typed fields across one.
