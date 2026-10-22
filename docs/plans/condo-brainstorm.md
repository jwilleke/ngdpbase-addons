---
title: Condo add-on — brainstorm notes
description: Mission, decisions so far, the Ohio 5311.09 record-keeping requirements mapped to condo, and open questions. Decisions live on their GitHub issues; this page points at them.
last_updated: "2026-10-22"
---

# Condo add-on — brainstorm notes

Status: __building__. Epic [#9](https://github.com/jwilleke/ngdpbase-addons/issues/9).
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
| How assessments are set | By unit type, for now (operator, 2026-10-22). Assessing by undivided interest is not built | — |
| Late charges | Site rules: days late, amount, simple annual interest, once or monthly; accounting applies them | [#10](https://github.com/jwilleke/ngdpbase-addons/issues/10) |
| People | Every owner and occupant is an ngdpbase user; managers read users with the caller's context | [#11](https://github.com/jwilleke/ngdpbase-addons/issues/11) |
| History | Dated links on the user record, `condoUnits: [{ parcel, type, from, to }]`, `to` a date or `"current"` | [#15](https://github.com/jwilleke/ngdpbase-addons/issues/15) |
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

- Should the admin page edit who owns or lives in a unit (part of
  [#6](https://github.com/jwilleke/ngdpbase-addons/issues/6), or its own issue)?
- Site-specific questions on the Occupancy information form: later. A form an add-on ships is
  read-only on the site (ngdpbase#1973). ("Are you working?" is not one: it asks for 5311.09's
  business address and phone.)
- Should condo flag units with no current owner, and where: its status, the compliance view, both?
- Board members and officers: modelled in condo, or a role in ngdpbase?
- Which resident needs come first?
