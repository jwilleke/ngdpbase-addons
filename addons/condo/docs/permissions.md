---
title: Condo permissions and roles
description: What each condo permission lets a person do, what it does not, where it is checked and recorded, and which roles hold it. The source of truth for their meaning.
last_updated: "2026-10-22"
---

# Condo permissions and roles

This page is the source of truth for what each condo permission __means__. The permissions that are
built are declared, with the policy that grants them, in
[config/default-config.json](../config/default-config.json); that file is what the site runs. When the
two disagree, the code is wrong or this page is, and one of them is fixed.

How ngdpbase decides, in one line: a policy grants a permission to a role, a person holds the roles
they are given, and condo asks for the permission, never for a role name. A site changes who holds
what in its own `app-custom-config.json`, without touching condo.

## Permissions

| Permission | Status | Day one |
| --- | --- | --- |
| [`condo-read`](#condo-read) | Built ([#5](https://github.com/jwilleke/ngdpbase-addons/issues/5)) | admin |
| [`condo-manage`](#condo-manage) | Built ([#5](https://github.com/jwilleke/ngdpbase-addons/issues/5)) | admin |
| [`condo-self`](#condo-self) | Planned ([#16](https://github.com/jwilleke/ngdpbase-addons/issues/16)) | residents |
| [`condo-review`](#condo-review) | Planned ([#17](https://github.com/jwilleke/ngdpbase-addons/issues/17)) | board |
| [`condo-maintenance-read`](#condo-maintenance-read) | Proposed | board |
| [`condo-board-read`](#condo-board-read) | Proposed | board |

### condo-read

- __Lets a person:__ see every unit, its type and assessment, its billing parties, and its current and
  past owners and occupants with their contact details.
- __Does not:__ change anything, or see a unit's files.
- __Implies:__ access to personal data (names, addresses, phones, emergency contacts) for every unit.
  Grant it only to people the association trusts with the whole roster: the board, a management
  company.
- __Checked:__ where a person asks: condo's routes and its plugin.
- __Recorded:__ not yet. Reads are not audited today.

### condo-manage

- __Lets a person:__ create, change and remove units, unit types, billing parties and owner and
  occupant links, for every unit.
- __Does not:__ by itself let a person see the units; pair it with `condo-read`.
- __Implies:__ the power to change who is billed and for how much. Every change goes through
  `CondoUnitManager`, which checks this permission against the caller's context and records the
  change before making it.
- __Checked:__ by `CondoUnitManager` on every change. A refusal is `CondoRefusedError`, which a route
  turns into 401 or 403.
- __Recorded:__ audit event `condo-manage`, with on-failure `refuse`: if the record cannot be written,
  the change is not made. The record names the unit, the action and the field names changed, never
  their values.

### condo-self

- __Lets a person:__ see their own unit (assessment, billing, owners and occupants, balance from the
  accounting add-on) and change their own details. An owner also edits, adds and removes the unit's
  occupants, and fills in the billing address.
- __Own unit means:__ a unit they hold a current link to, as owner or occupant. Condo checks that link
  on every request; the permission alone opens nothing.
- __Does not:__ change owners. Adding or removing an owner, a sale, or a change of agent waits for a
  holder of `condo-review`.
- __Implies:__ an owner sees their occupants' contact details. An occupant sees the owners' names.
- __Recorded:__ each change made under it is recorded, and the reviewers get an advisory notice.
- __Billing address:__ an owner's change applies at once, with an advisory notice to the Board of
  Directors (operator, 2026-10-22).

### condo-review

- __Lets a person:__ approve or refuse what waits for review: an Occupancy information form from
  someone not signed in, and every owner change.
- __Implies:__ approving a form can create an ngdpbase account for the person it names, so the holder
  also needs `contact-manage`, or condo's policy grants it alongside.
- __Recorded:__ each approval and refusal, by whom.

### condo-maintenance-read

- __Lets a person:__ see the maintenance files of every unit: request history and maintenance notes.
- __Does not:__ see board-only files, or owner and occupant contact details beyond what a maintenance
  file holds.
- __Who:__ the maintenance provider, usually through `condo-manager`. A unit's own current owners and
  occupants see that unit's maintenance files through `condo-self`.

### condo-board-read

- __Lets a person:__ see the board-only files of every unit: notices to the owner (such as late
  assessments), inspections, photos, and anything about an owner's standing.
- __Implies:__ the most sensitive condo data. The board only.
- __Adding and removing these files:__ `condo-manage` covers it, for now (operator, 2026-10-22).

## Roles

Condo ships these roles in its own config, as the accounting add-on ships `treasurer`. A role carries
nothing until a policy grants it permissions.

| Role | Who | Holds |
| --- | --- | --- |
| `admin` (core) | Site administrators | Every condo permission, on day one |
| `board-member` | The association's board | Planned: `condo-read`, `condo-review`, `condo-maintenance-read`, `condo-board-read` |
| `condo-manager` | Whoever the board grants permissions to: a management company, the reviewer, the maintenance provider | Only what the site's policy gives it; the board decides |
| Residents | Owners and occupants with an account | Planned: `condo-self` |

The board grants `condo-manager` its people and permissions through ngdpbase's own role and
configuration screens, as an admin (operator, 2026-10-22). Condo's admin page does not manage roles.

## Core permissions condo uses

| Permission | Why |
| --- | --- |
| `contact-read` | The directory import ([#8](https://github.com/jwilleke/ngdpbase-addons/issues/8)) matches people against ngdpbase contacts |
| `contact-manage` | The directory import, and approving a form, create people |
| `form-submit` | Submitting the Occupancy information form; the forms add-on asks it |

## Rules

- Condo never names a role in code; it asks for a permission.
- Changes are checked by `CondoUnitManager` with the caller's context; reads are checked where a
  person asks.
- No condo permission asks for a fresh sign-in (step-up), for now: ngdpbase add-on forms lose their
  typed fields across one.
