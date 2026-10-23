---
title: Condo add-on — brainstorm notes
description: Mission, decisions so far, the Ohio 5311.09 record-keeping requirements mapped to condo, and open questions. Decisions live on their GitHub issues; this page points at them.
last_updated: "2026-10-23"
---

# Condo add-on — brainstorm notes

Status: __brainstorm closed (operator, 2026-10-23)__. The structure below is decided and being built
as the `accommodation`, `governance` and `association` add-ons. Epic [#9](https://github.com/jwilleke/ngdpbase-addons/issues/9) holds the condo work done
so far.
Each decision below is recorded, with its reasons, on the issue it links to. This page gathers them in
one place and holds the ideas that don't have an issue yet.

## Mission

A general [ngdpbase](https://github.com/jwilleke/ngdpbase) add-on that any condominium association can
run. It keeps the association's units, who owns them and who lives in them, and what each unit is
assessed.

- __Reference site:__ The Fairways Condominiums (Mount Vernon, Ohio). Its data and practice set condo's
  defaults. Its values (unit types, late charges) are development examples, never shipped defaults.
- __Replaces__ `fairways-gen2-website/addons/fairways`. Fairways becomes an ngdpbase site running condo.
- __First jurisdiction:__ Ohio ([ORC 5311.09](https://codes.ohio.gov/ohio-revised-code/section-5311.09),
  below). Many states have similar rules.
- __Not condo's:__ money. The accounting add-on keeps the ledger and invoices, and reads units, owners,
  assessments and late-charge rules from condo.

## Decided

| Topic | Decision | Issue |
| --- | --- | --- |
| Identity | Slug `condo`; manager `CondoUnitManager`; plugin `[{CondoUnit}]`; no Fairways names | [#3](https://github.com/jwilleke/ngdpbase-addons/issues/3) |
| Units | One record per unit, keyed by the county parcel; every field a site gives is kept | [#4](https://github.com/jwilleke/ngdpbase-addons/issues/4) |
| Storage | A JSON file through a provider chosen by config, for now | [#4](https://github.com/jwilleke/ngdpbase-addons/issues/4) |
| Unit types | Each type carries the assessment: cents, `monthly` or `annual`, due day 1–28 or `MM-DD` | [#4](https://github.com/jwilleke/ngdpbase-addons/issues/4) |
| How assessments are set | By unit type, for now (operator, 2026-10-22). Revisited 2026-10-23: The Fairways' Declaration sets percentage of interest (see below) | — |
| Late charges | Site rules: days late, amount, simple annual interest, once or monthly; accounting applies them | [#10](https://github.com/jwilleke/ngdpbase-addons/issues/10) |
| People | Every owner and occupant is an ngdpbase user; managers read users with the caller's context | [#11](https://github.com/jwilleke/ngdpbase-addons/issues/11) |
| History | Dated links on the user record: `ownership` (`OwnershipInfo`, with an ownership `share`) and `occupies` (`Role`), an end a date or `"current"` | [#21](https://github.com/jwilleke/ngdpbase-addons/issues/21) |
| Billing | One invoice per billing address, kept on the unit as billing parties with shares | [#14](https://github.com/jwilleke/ngdpbase-addons/issues/14) |
| How people are reached | Email, mail, text: a core preference per person | [ngdpbase#1969](https://github.com/jwilleke/ngdpbase/issues/1969) |
| Permissions and roles | Their meaning: [addons/condo/docs/permissions.md](../../addons/condo/docs/permissions.md) | [#5](https://github.com/jwilleke/ngdpbase-addons/issues/5) |
| Backup | ngdpbase backs up each add-on's `dataPath`; condo's interim code goes then | [#13](https://github.com/jwilleke/ngdpbase-addons/issues/13) |
| Directory import | The board's CSV, with its column names set in config | [#8](https://github.com/jwilleke/ngdpbase-addons/issues/8) |
| Resident self-service | Owners and occupants sign in, see their own unit (assessment, balance, who is listed) and update their own details; `condo-self` | [#16](https://github.com/jwilleke/ngdpbase-addons/issues/16) |
| Occupancy information form | Replaces the Google form; only the 5311.09 questions for now; a signed-in resident's own-unit submission applies directly (`condo-self`) with an advisory notice to the reviewers; anyone else's waits for review by the board or a delegated person | [#17](https://github.com/jwilleke/ngdpbase-addons/issues/17) |

Who is who at The Fairways: __owners__ own units; __occupants__ are the day-to-day residents. An owner
who lives in the unit is both.

## Ohio Revised Code 5311.09

What the section asks of a unit owners association, and where each part lands.

| Subsection | Requirement | Where it lands |
| --- | --- | --- |
| (A)(1)(a)–(b) | Books of account; how common expenses are allocated, distributed and collected among owners | Accounting keeps the books. Condo supplies the allocation (unit types, late-charge rules) |
| (A)(1)(c) | Minutes of association and board meetings | Pages, not condo data. Perhaps a "minutes" page category |
| (A)(1)(d) | Owners' names and addresses, and each owner's undivided interest in the common elements | Names from users, addresses from billing ([#14](https://github.com/jwilleke/ngdpbase-addons/issues/14)). `undividedInterest` becomes a named unit field. A roster report |
| (A)(2) | Within 30 days of acquiring a unit, the owner gives, for the owner and every occupant: home address, home and business mailing addresses, home and business phones | Personal details belong on the core person or user record, not in condo's own data |
| (A)(2) | Name, business address and phone of anyone who manages the unit as the owner's agent | A third link type, `agent`, on the dated links ([#15](https://github.com/jwilleke/ngdpbase-addons/issues/15)); a person or an organization |
| (A)(3) | Changes reported within 30 days; on the board's request, the owner verifies or updates the information | When each owner last verified; who is overdue; the board can ask for verification |
| (B) | On turnover, the developer delivers the declaration, bylaws, drawings and plans | Documents: pages or attachments in a "governing documents" category |

Source read 2026-10-22. The section says nothing about retention periods or who may inspect the
records; those are elsewhere in the code or in the association's own documents.

## Unit files and roles (operator, 2026-10-22)

The Fairways keeps one Google Drive folder per unit at each of two levels, named by address and
parcel: `<address> - maintenance - <parcel>` and `<address> - unit owner - <parcel>` (board only).
Recorded on [#9](https://github.com/jwilleke/ngdpbase-addons/issues/9).

| Who | Sees |
| --- | --- |
| Board | Everything |
| The unit's current owners and occupants, and the maintenance provider | That unit's maintenance files: request history, maintenance notes |
| Board only | That unit's board files: notices to the owner, inspections, photos, the owner's standing |

- Roles condo ships in its own config (as accounting ships `treasurer`): `board-member`,
  `condo-manager`. Policies grant permissions to them; code never names a role.
- `condo-manager` is whoever the board grants permissions to: who holds it and which permissions it
  carries are the board's choice (a property manager, the reviewer, the maintenance provider).
- A board "vault": open. An ngdpbase vault is one person's private store, so a space the board shares
  is more likely condo's own page category, restricted by permission.
- Maintenance requests themselves belong to the request-response engine
  ([request-response-brainstorm.md](request-response-brainstorm.md)); the Fairways process doc is
  "Maintenance Requests Process" in the shared folder.

## Structure: accommodation, governance, association, rentals (2026-10-23)

__Decided (operator, 2026-10-23): split into separate add-ons.__ Each add-on declares the add-ons it
needs, and a site enables only the ones it uses. "Condo" wording stays out of anything that manages
units and occupants, so the same parts can serve rentals later (operator, 2026-10-22). The layers and
their names below are still a proposal.

The governance layer is named `governance` (operator, 2026-10-23), not "organization": ngdpbase core
already uses organization for a contact record (`OrganizationManager`). The association itself can be
one of core's organization contacts, with its officers affiliated to it.

__Decided (operator, 2026-10-23): use schema.org terms, including `Accommodation`,__ because they fit
better and are more generic. ngdpbase core already uses schema.org shapes (`Person`, `Organization`,
`PostalAddress`).

| Idea | schema.org |
| --- | --- |
| A unit (condo unit, HOA house, rental apartment) | `Accommodation` (subtypes `Apartment`, `House`, `Room`, `Suite`) |
| Unit type | `accommodationCategory` |
| Square feet (basis of percentage of interest) | `floorSize` |
| Unit address | `address` (`PostalAddress`) |
| Building, complex, community | `containedInPlace` / `containsPlace`; `Residence`, `ApartmentComplex`, `GatedResidenceCommunity` |
| Owner; dated ownership | `owner` / `owns`; `OwnershipInfo` (`ownedFrom`, `ownedThrough`, `acquiredFrom`) |
| Occupancy, board and officer terms | `Role` / `OrganizationRole` (`startDate`, `endDate`) |
| Pets, use, lease | `petsAllowed`, `permittedUsage`, `leaseLength` |

### Facts and access roles (operator, 2026-10-23)

Two kinds of "role", kept apart:

- __The facts__ are dated records the add-ons hold: an owner is an `OwnershipInfo` (`ownedFrom`,
  `ownedThrough`); an occupant, an agent and later a tenant are a `Role`; a board member or officer is
  an `OrganizationRole` (`roleName`, `startDate`, `endDate`).
- __Access__ is ngdpbase roles (`ngdpbase.roles.definitions`), declared by each add-on in its config and
  granted permissions by policy: `owner`, `occupant` (accommodation), `board-member` (association),
  `accommodation-manager` (the board's delegates). They are site-wide and undated; the add-ons still
  check the facts for which unit.
- __Decided: the facts are the source.__ When a link or term starts or ends, the add-on adds or removes
  the matching ngdpbase role through `RoleManager.assignRole` / `removeRole` (which take a context and
  record the change); a daily scheduled job catches terms that end on a date. A person keeps a role
  while any matching fact is current (an owner of two units who sells one stays an owner).
  `accommodation-manager` stays by hand, the board's choice, on ngdpbase's own screens.
- End dates (operator, 2026-10-23): a term whose end is known carries its date (a board term ends
  at the next annual meeting); one that is undetermined (an owner, an occupant) carries `"current"`.
  schema.org would leave the end out; `"current"` is our extension, so a blank is never read as
  unknown.
- Roles need an account: every owner and occupant is a user (decided on
  [#11](https://github.com/jwilleke/ngdpbase-addons/issues/11)).

ngdpbase already supports this: an add-on's module lists `dependencies` (must be installed and
enabled, or it does not load) and `optionalDependencies` (loaded first when present). They name
other add-ons by slug only, with no version range; each add-on's `ngdpbase.minVersion` is about core,
not about other add-ons.

| Layer | Owns | Who uses it |
| --- | --- | --- |
| `accommodation` | Accommodations (units, houses, apartments), their categories, dated links (owner, occupant, later tenant and agent), history, billing parties, charges per period, late-charge rules, per-accommodation files | Associations and landlords |
| `governance` | Running the nonprofit corporation (ORC 1702): members, board and officers, meetings and minutes, votes and proxies, the register of governing documents | Associations, and clubs with no property (an Elks lodge) |
| association | Governance plus accommodation plus a statute profile: members are the owners, votes are per unit, the property rules apply | Condos (ORC 5311) and HOAs (ORC 5312) |
| `rentals` | Leases (a dated link with terms), rent, deposits, tenant billing | Landlords; built when a real rental site exists |

Accounting would depend on `accommodation` (owners, billing, charges), not on the association layer.

__Decided (operator, 2026-10-23): the add-ons are `accommodation` (base), `governance` and `association`; `rentals` later.__ The base is `accommodation`, not "units". The renames this
implies are not made yet: `CondoUnitManager` to `AccommodationManager`, `[{CondoUnit}]` to
`[{Accommodation}]`, the user field `condoUnits` to an `OwnershipInfo`/`Role`-shaped link list,
`condo-*` permissions to `accommodation-*`, the unit field `unitType` to `accommodationCategory`.

### Governing documents as data

Every Ohio condo sits in the same stack: federal law, Ohio law (ORC 5311, 5312, 1702), local rules,
then its own Declaration, Bylaws and board rules. Each layer may tighten what is above it, never go
below it.

- Each setting records its value, the document and section it comes from, and the date it took
  effect. An amendment changes the value and keeps the old one in the history (the amendment
  register the documents call for).
- Statute profiles ship with the software ("Ohio 5311", "Ohio 5312", "Ohio 1702 only"). A profile
  gives defaults and the limits the law sets; a Declaration value outside them is refused, naming the
  statute. Each association enters only where its own documents differ.
- Federal law (for example the Fair Housing Act's reasonable accommodation) is listed in the document
  register as obligations, not as settings.

## Outside advice (2026-10-23)

Advice the operator brought in, with our view beside each point. The three core candidates are filed:
[ngdpbase#2002](https://github.com/jwilleke/ngdpbase/issues/2002) version ranges on add-on dependencies,
[ngdpbase#2003](https://github.com/jwilleke/ngdpbase/issues/2003) dated affiliations,
[ngdpbase#2004](https://github.com/jwilleke/ngdpbase/issues/2004) optional expiry on role assignments.

__The placement test__ (worth adopting): if a feature mentions a law, a profile or "condo", it belongs
in the association layer; if a club and a landlord could both use it, it belongs in a shared add-on
(`accommodation`, `governance`); if any add-on could use it, it belongs in ngdpbase core.

| Advice | Our view |
| --- | --- |
| The association layer is profiles, not code: condo and HOA share the same blocks with different settings | Mostly agree. The differences should be settings (statute profile, assessment basis, kind). But some is real code: the occupancy form and its review, the enforcement and hearing path, approvals, checking settings against the statute's limits. A thin `association` add-on driven by profiles, not zero code |
| Keep `governance` independent of `accommodation`: governance asks "who are the members, and how many votes does each have?" and something else answers | Agree. A provider governance asks through: for a condo, the owners (one vote per unit, split by ownership share) from `accommodation` or `association`; for a club, governance's own member list. ngdpbase supports it with `optionalDependencies` and a registered provider. Clubs never need `accommodation` |
| Accounting bills parties, not units: `accommodation` supplies them for condos, `governance` supplies dues payers for clubs | Agree; it is what billing parties ([#14](https://github.com/jwilleke/ngdpbase-addons/issues/14)) already are. `accommodation` becomes optional for accounting. Needs agreeing with the accounting add-on |
| Core: version checks between add-ons ("needs accommodation 1.x") | Agree, P1-worthy. Dependencies name add-ons by slug only today |
| Core: dated role links (owner, occupant, tenant, agent, board, officer) as schema.org `Role` | Half agree. Core already keeps affiliations on persons (`affiliation: [{ organization, role }]`) without dates; adding `startDate` / `endDate` there (`OrganizationRole`) is a natural core change and covers board and officer terms. Links to an accommodation point at something core does not know; keep those in `accommodation` |
| Core: an optional expiry on a role assignment (our idea, 2026-10-23) | Candidate core issue. For roles assigned by hand (`admin`, `accommodation-manager`): an outside auditor for a month, a management company for its contract term, a volunteer for the annual meeting. A daily job removes expired assignments under the system context. Roles derived from facts (`owner`, `occupant`, `board-member`) never set it: their dates are the facts'. History is already in the audit log (`RoleManager.recordRoleChange`); this adds expiry, as agent tokens and proxy grants already have |
| Core: settings that record their source (document, section, effective date, old values) | Wait. Only `governance` needs it today and core already audits configuration changes; build it in `governance`, move it to core when a second add-on needs it |

## The Fairways' governing documents (read 2026-10-23)

The Fairways' Declaration (with the Bylaws as its Exhibit B) and its Bylaws, consolidated copies "not
for legal purposes", held by the board in Google Docs. What bears on the software:

- __Assessments follow percentage of interest__, Declaration §17.A: "according to each unit owner's
  percentage of interest in the Common Elements". The percentage comes from each unit's square feet
  of living area (§9), in Exhibit C, which The Fairways keeps in the Shared-Fairways Directory (columns
  R–V), not in the documents.
  - The Fairways bills by unit type instead (C $410, D $584, others $338 a month). The operator's view
    (2026-10-23): a shortcut that would likely not survive a legal challenge. So the software treats
    percentage of interest as the basis the Declaration sets, and assessment by unit type as a site's
    configured shortcut, not the model. This revisits "by unit type, for now" on
    [#4](https://github.com/jwilleke/ngdpbase-addons/issues/4).
- __Votes:__ one per unit (Bylaws §3.2); joint owners split it by their share of the unit, so owner
  links need an ownership share, separate from the billing share. Proxies in writing, valid six
  months (§3.3). Voting can be suspended after 30 days' delinquency (Declaration §14).
- __Board and officers:__ five directors, elected yearly at the annual meeting (April 15); officers
  elected by the board. The Declaration (§5.B) says officers must be owners or owners' spouses; the
  Bylaws (§6.1) say they need not be. The documents contradict each other.
- __Meetings:__ owners' notice 5 to 30 days before, by hand or mail; quorum is whoever attends; board
  meets at least quarterly, may meet electronically.
- __Payments apply in order__ (Declaration §17.E): interest, then late fees, then collection costs,
  then principal. Interest at the legal maximum after 10 days unpaid; liens valid five years. For the
  accounting add-on.
- __Email notice only with the owner's written consent__ (Bylaws Art. XI), falling back to mail when
  undeliverable. In Ohio "written" includes electronic (ORC Chapter 1306, the Uniform Electronic
  Transactions Act; operator, 2026-10-23), so consent can be given on the site. Core's communication
  preference ([ngdpbase#1969](https://github.com/jwilleke/ngdpbase/issues/1969)) needs to keep who
  consented, when, to what wording (or its version), and any withdrawal.
- __Leasing:__ no lease until the owner has lived in the unit 24 consecutive months; leases at least 12
  months, in writing; the board told the tenants and term before it starts (Declaration §3.A). Dated
  links (#15) can answer the 24-month rule.
- __Approvals:__ exterior changes, antennas, awnings, satellite dishes, windows and doors need the
  board's prior consent (Declaration §3.F, §8.C, §16.B).
- __Enforcement__ (Declaration §14.1): written notice with a cure date; 10 days to ask for a hearing;
  7 days' notice of the hearing; the charge within 30 days after. A workflow, closest to the
  request-response engine.
- __Records the board may withhold__ (Declaration §21.G): personnel, legal advice, contracts under
  negotiation, enforcement against an owner, protected information, records over five years old.
- __Other:__ mortgagees per unit (insurance notices, §19.A); a dated register of board rules (owners
  get a copy two days before they take effect, Bylaws Art. IX); the owner's 30-day duty to report
  owner, occupant and agent details (Declaration §3.H), already the Occupancy information form.

## Ideas, not yet issues

- __Roster report__ for the board: every unit with its current owners, their addresses and the unit's
  undivided interest, as 5311.09(A)(1)(d) asks.
- __Compliance view:__ units with no current owner (one Fairways unit has only an occupant), owners
  with no address, owners not verified within the period, units with no undivided interest.
- __Verification:__ record when an owner last confirmed their details; a "please verify" request from
  the board; a reminder before the period runs out.
- __Agents:__ the owner's property manager as a dated `agent` link.
- __Per-state rules as config:__ the 30-day periods and the required fields, so another state's rules
  fit without code.
- __Resident needs__ (operator: yes, to explore): resident directory, emergency contacts (Fairways users
  carry `emergencyContact`), vehicles and parking, pets, maintenance requests (see
  [request-response-brainstorm.md](request-response-brainstorm.md)).

## Open questions

- Site-specific questions on the Occupancy information form: later. A form an add-on ships is
  read-only on the site (ngdpbase#1973). ("Are you working?" is not one: it asks for 5311.09's
  business address and phone.)
