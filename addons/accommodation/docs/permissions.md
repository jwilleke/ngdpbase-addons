---
title: Accommodation permissions and roles
description: What each accommodation permission lets a person do, what it does not, where it is checked and recorded, and which roles hold it. The source of truth for their meaning.
last_updated: "2026-10-23"
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
| [`accommodation-read`](#accommodation-read) | Built ([#5](https://github.com/jwilleke/ngdpbase-addons/issues/5)) | admin |
| [`accommodation-manage`](#accommodation-manage) | Built ([#5](https://github.com/jwilleke/ngdpbase-addons/issues/5)) | admin |
| [`accommodation-self`](#accommodation-self) | Planned ([#16](https://github.com/jwilleke/ngdpbase-addons/issues/16)) | every user, through `vault-owner` |
| [`accommodation-review`](#accommodation-review) | Planned ([#17](https://github.com/jwilleke/ngdpbase-addons/issues/17)) | board |
| [`accommodation-maintenance-read`](#accommodation-maintenance-read) | Proposed | board |
| [`accommodation-board-read`](#accommodation-board-read) | Proposed | board |

### accommodation-read

- __Lets a person:__ see every accommodation, its category and assessment, its billing parties, and its current and
  past owners and occupants with their contact details.
- __Does not:__ change anything, or see a unit's files.
- __Implies:__ access to personal data (names, addresses, phones, emergency contacts) for every unit.
  Grant it only to people the association trusts with the whole roster: the board, a management
  company.
- __Checked:__ where a person asks: the add-on's routes and its plugin.
- __Recorded:__ not yet. Reads are not audited today.

### accommodation-manage

- __Lets a person:__ create, change and remove accommodations, categories, billing parties and owner and
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

### accommodation-self

- __Lets a person:__ see their own unit (assessment, billing, owners and occupants, and a link to the
  dues card the accounting add-on puts on their profile, which shows their balance) and change their
  own details. An owner also edits, adds and removes the unit's
  occupants, and fills in the billing address.
- __Own unit means:__ a unit they hold a current link to, as owner or occupant. The add-on checks that link
  on every request; the permission alone opens nothing.
- __Granted:__ to every user, through the role `vault-owner`, in the add-on's own policy. Never to site
  roles or a list of roles, never to an `authenticated` subject, and never by editing a core policy
  (operator, 2026-10-24, [ngdpbase#1539](https://github.com/jwilleke/ngdpbase/issues/1539)): it is a
  permission over a person's own records.
- __Does not:__ change owners. Adding or removing an owner, a sale, or a change of agent waits for a
  holder of `accommodation-review`.
- __Implies:__ an owner sees their occupants' contact details. An occupant sees the owners' names.
- __Recorded:__ each change made under it is recorded, and the reviewers get an advisory notice.
- __Billing address:__ an owner's change applies at once, with an advisory notice to the Board of
  Directors (operator, 2026-10-22).

### accommodation-review

- __Lets a person:__ approve or refuse what waits for review: an Occupancy information form from
  someone not signed in, and every owner change.
- __Implies:__ approving a form can create an ngdpbase account for the person it names, so the holder
  also needs `contact-manage`, or the add-on's policy grants it alongside.
- __Recorded:__ each approval and refusal, by whom.

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
| `board-member` | The association's board | Planned: `accommodation-read`, `accommodation-review`, `accommodation-maintenance-read`, `accommodation-board-read` |
| `accommodation-manager` | Whoever the board grants permissions to: a management company, the reviewer, the maintenance provider | Only what the site's policy gives it; the board decides |
| Residents | Owners and occupants with an account | Planned: `accommodation-self` |

The board grants `accommodation-manager` its people and permissions through ngdpbase's own role and
configuration screens, as an admin (operator, 2026-10-22). The add-on's admin page does not manage roles.

## Core permissions the add-on uses

| Permission | Why |
| --- | --- |
| `contact-read` | The directory import ([#8](https://github.com/jwilleke/ngdpbase-addons/issues/8)) matches people against ngdpbase contacts |
| `contact-manage` | The directory import, and approving a form, create people |
| `form-submit` | Submitting the Occupancy information form; the forms add-on asks it |

## Rules

- The add-on never names a role in code; it asks for a permission.
- Changes are checked by `AccommodationManager` with the caller's context; reads are checked where a
  person asks.
- No accommodation permission asks for a fresh sign-in (step-up), for now: ngdpbase add-on forms lose their
  typed fields across one.
