# accommodation — ngdpbase add-on

Accommodations (schema.org `Accommodation`: a condo unit, an HOA house, a rental apartment), keyed
by the county parcel, and their owners and occupants. The Fairways Condominiums is the reference
site; nothing here is condo-only, so a landlord can use it too. Work is tracked in epic
[#19](https://github.com/jwilleke/ngdpbase-addons/issues/19).

## Enable

In the site's `app-custom-config.json`:

```json
{
  "ngdpbase.managers.addons-manager.addons-path": ["./addons", "/path/to/ngdpbase-addons/addons"],
  "ngdpbase.addons.accommodation.enabled": true
}
```

Then `npm run build` here and restart ngdpbase.

## Accommodations

Accommodations live in `accommodations.json` under the data folder
(`ngdpbase.addons.accommodation.dataPath`, default `./data/accommodation` in the site's data folder),
read and written through the provider named by `ngdpbase.addons.accommodation.provider` (default
`json`). An accommodation's `id` is its county parcel. The fields the add-on names use schema.org
terms: `accommodationCategory`, `floorSize`, `address` and `containedInPlace`. Every other field it
has is kept as given.

An accommodation may also keep the county's record of it, `countyRecord`
([#41](https://github.com/jwilleke/ngdpbase-addons/issues/41)): the owner the county names, its
attention line if any, the mailing address it uses (schema.org PostalAddress), the date of the newest
transfer, the source and the date it was read. It sits beside the add-on's own owner entries and never
replaces them. The owners and occupants page for an accommodation shows it.

ngdpbase backs up and restores the data folder itself (ngdpbase#1985): every site backup holds it as
`<stem>.accommodation.tar`, and a whole-site restore puts it back before the add-on starts. The add-on
has no backup code of its own.

## Owners and occupants

Every owner and occupant is an ngdpbase user. Two extended fields on the user record hold their
dated links to accommodations, in schema.org shapes
([#21](https://github.com/jwilleke/ngdpbase-addons/issues/21)):

```json
"ownership": [
  { "typeOfGood": "66-00001.000", "ownedFrom": "2012-05-01", "ownedThrough": "2020-08-31", "share": 100, "period": "8f0c…" }
],
"occupies": [
  { "roleName": "occupant", "accommodation": "66-00002.000", "startDate": "2021-01-15", "endDate": "current" }
]
```

- `ownership` entries are `OwnershipInfo`: `typeOfGood` is the accommodation's parcel, and `share` the
  owner's percent of it: what they owe of each invoice (see Billing) and their part of the unit's
  vote. On any date an accommodation's current owners' shares add up to exactly 100; a sole owner
  writes 100. Every owner is an account (operator, 2026-10-25).
- `period` names the entry's ownership period ([#43](https://github.com/jwilleke/ngdpbase-addons/issues/43)):
  one stretch of the same owners with the same shares, which accounting bills as one folio. A unit's
  period is the entries that share the id; on any day a unit's owners are in exactly one, and
  `linkProblems` names any day they are not. Entries saved before it get one once at start-up: a
  unit's current owners share one period, and ended entries one per stretch of the same dates.
- `occupies` entries are `Role`: `roleName` is `occupant` (agent and tenant come later), and
  `accommodation` is the parcel. An owner who lives in the accommodation has an entry in each field.
- Start dates are ISO dates. An end is an ISO date, or `"current"`. Both days count.
- An entry that is not exactly this shape is left out and listed by `ResidencyManager.linkProblems(ctx)`,
  never guessed. It also lists every date an accommodation's owners' shares do not add up to 100.

`ResidencyManager.owners(ctx, id)` returns the accommodation's owners today (or on
`{ on: 'YYYY-MM-DD' }`). `ctx` is the caller's: the person who asked, or a job's context with its
reason; users are read as that caller (`UserManager.searchUsers`), inactive accounts included.
`occupants(ctx, id)` returns the people living there, who are never billed. `history(ctx, id)`
returns everyone the accommodation has had, with their dates. `withoutOwner(ctx, ids)` returns those
of `ids` with no owner today (or on `{ on }`); the add-on's status on Admin → Add-ons names them, worked
out each time it is shown. It also counts the accommodations with no usable billing address, which
cannot be invoiced (`withoutBilling(ids)`).

### Recording who owns and lives in each accommodation

__Admin → Owners and occupants__ (`/addons/accommodation/residents`, also a card on `/admin`) lists
every accommodation with its current owners and occupants, and the entries that need fixing
([#28](https://github.com/jwilleke/ngdpbase-addons/issues/28)). Seeing it needs `accommodation-read`.
Each accommodation is named by its street address with the parcel after it, "13 FAIRWAY DR
(66-09960.017)", and the list is sorted by street, then house number. Accommodations with no usable
billing address are counted at the top and marked, so they are fixed before a dues run. An
accommodation's page shows the county's record, its billing, and its owners and occupants.
Open an accommodation to change its entries, which needs `accommodation-manage`:

- __Add a person__: one Name box, owner or occupant, from, and an owner's share. For example "Pat
  Example owns 66-00001.000 from 2015-06-01". From starts as the county's newest sale date. A name
  picked from the list (or a username) is that account; any other name is someone new, and their
  account is made in the same save (operator, 2026-10-25): `ResidencyManager.addNewPerson` needs
  `accommodation-manage` and `user-create`, checks everything first (a name, an email if given and not
  already on an account, a username made from the name and free to use, and the entry), makes the
  account as the admin with no password, then adds the entry through changeLink. An invitation goes
  only when the box is ticked and there is an email. A refused add comes back with what was typed,
  kept in the page and never in the URL.
- __Every owner or share edit says what it is__ (operator, 2026-10-26): __correcting a mistake__ keeps
  the ownership period (an owner added as a correction joins it), or __the ownership really changed__,
  which goes to Ownership changed with what was typed filled in.
- __Ownership changed__: the date and every owner from that date with their share, adding up to 100%;
  someone new gets an account. `ResidencyManager.changeOwnership` checks everything first (a date
  after the current owners began, the shares, each person once), then ends every current owner's
  entry the day before and adds the new entries in a new ownership period, each through changeLink.
  The old period's folio keeps its own balance.
- __Edit__ an entry: as, from, through and share, then Save. Ending one is setting Through to the
  last day: "Lee Renter moved out 2026-09-30". A malformed entry is fixed the same way. Fields the
  page does not show (such as `acquiredFrom`) are kept. Changing As moves the entry between
  `occupies` and `ownership` in one write, recorded with `movedFrom`: an occupant who turns out to be
  an owner. An owner needs a share; fields only the old list kept are not carried over.
- __Remove__ (in Edit) an entry entered by mistake. An entry that ended is ended, not removed: it is
  the history.

There is no sale step: a change of ownership is several edits (end the old owner's entry, add the new
owner's). Each is saved on its own, so in between the accommodation's owners' shares may not add up to
100; the page flags it until they do (operator, 2026-10-24).

Each change goes through `ResidencyManager.changeLink(ctx, username, change)`:

- It asks for `accommodation-manage` with the caller's context; a "no" is `AccommodationRefusedError`.
- It refuses, with the reason and nothing written, a person or accommodation that does not exist, an
  entry that does not read as one (a bad date, an end before the start, a share outside 0–100), and an
  entry that changed since the page showed it (reload and try again).
- It records `accommodation-manage` before it writes (on-failure `refuse`), naming the accommodation,
  the person, the field and the names of the fields changed, never their values. A write that then
  fails is recorded as a failure.
- It writes the one field onto the person's account through `UserManager.updateUser`, as the caller,
  reading the person's current entries inside that write.
- Then it starts the roles job (below) as the admin who made the change, so the roles follow it now
  rather than at the next daily run. The job is the one place roles change.

Two admins changing the same person's entries at the same moment both stand: the list is read and
written in one step per account, through `UserManager.updateUser`'s function form (ngdpbase 5.28.0,
[ngdpbase#2025](https://github.com/jwilleke/ngdpbase/issues/2025)).

### A resident's own page

__My accommodation__ (`/addons/accommodation/mine`) shows a signed-in person the units they own or
live in today ([#36](https://github.com/jwilleke/ngdpbase-addons/issues/36)), under
`accommodation-self`, which every user holds through `vault-owner`. A person with no current entry
sees none, and is pointed at the Occupancy information form.

- Each unit shows its address, its category and assessment (in the site's currency, through core's
  `formatMoney`), its current owners by name, and its occupants.
- An owner also sees the occupants' emails and where the unit's invoices go. An occupant sees the
  owners' names only.
- No balance: bills, payments and balance are on the dues card the accounting add-on puts on the
  person's profile, which the page links to (ngdp-accounting-addons D-044).
- __Billing__ ([ngdpbase#2042](https://github.com/jwilleke/ngdpbase/issues/2042)): any current owner
  of the unit may change where its invoices go, everything the treasurer can: type each address, set
  the shares, add or remove an address (operator, 2026-10-25). It applies at once.
  `ResidencyManager.setBilling` decides with the caller's context (`accommodation-manage` for the
  treasurer, else `accommodation-self` and a current owner of the unit) and checks the entries before
  anything is written. It records `accommodation-billing-update` as the caller first (on-failure
  `refuse`; counts, never the addresses), has `AccommodationManager` write it under the system context
  with a reason naming the caller, then tells the holders of `accommodation-notices` (admins on day
  one; a site grants its board).
- An admin's edit and an owner's billing change at the same moment both stand: every
  `AccommodationManager` change runs from its read to its save inside one key of core's
  `host.keyedSerial()` (ngdpbase 5.30.1, [#39](https://github.com/jwilleke/ngdpbase-addons/issues/39)).
  It is one key for the whole store, since the provider saves every accommodation in one file.
- __An occupant moved out__ ([#37](https://github.com/jwilleke/ngdpbase-addons/issues/37)): an owner sets
  the last date of a current occupant's entry on their own unit. It goes through `changeLink`, which,
  without `accommodation-manage`, lets a current owner of the entry's unit end an occupies entry and
  nothing else. It is recorded the same way, and the holders of `accommodation-notices` are told.
- __An occupant's contact details__ (#37): an owner sees and changes a current occupant's home and
  other phones, business mailing address and phone, and emergency contact, never their name, email or
  home address. `ResidencyManager.updateOccupantDetails` decides with the owner's context
  (`accommodation-self`, a current owner, a current occupant of that unit, only those fields). It
  records `accommodation-occupant-update` as the owner first (on-failure `refuse`; names, never
  values). Then core's `IdentityManager` writes the occupant's identity record under the system
  context with a reason naming the owner, unit and occupant, and the board is told. Those kinds are
  replaced as given (a blank box clears one), and every other kind on the record stays.
- __Adding an occupant__ (#37; operator, 2026-10-25: only an owner with an account adds occupants, with
  no approval): the owner gives a name, email and move-in date. The account is found by email; with
  none, the owner gives a username. `ResidencyManager.addOccupant` decides with the owner's context
  (`accommodation-self`, a current owner, an occupies entry on that unit only), records
  `accommodation-occupant-add` as the owner first, and for someone new makes the account with no
  password and invites them under the system context, with a reason naming the owner and unit. Then
  it adds the entry through `changeLink`, which allows a current owner to add or end occupies entries
  on their own unit, and the board is told. An invitation that could not be sent is shown to the
  owner. If a later step fails, a new account stays, and adding again finds it.
- __Ask the Board to change the owners__ ([#40](https://github.com/jwilleke/ngdpbase-addons/issues/40);
  operator, 2026-10-26): an owner gives the date and every owner from it with their share, naming
  someone new by name and, if known, email. `ResidencyManager.requestOwnershipChange` checks it as a
  change of ownership is checked, then files it with core's reviews for the holders of
  `accommodation-ownership-review`; nothing changes until one approves. Approving applies it through
  `changeOwnership`, as the reviewer, in a new ownership period. Co-owners are shown by name only.
- A person's own phones and emergency contact are theirs to change on `/profile` (core).
- The mapping from the form's answers to identity-record fields (`address`, and `contactPoint` entries
  typed by `contactType`) lives in `managers/contactDetails.ts`. association's approve uses it through
  `ResidencyManager.contactDetails`, so it has one home. accommodation needs ngdpbase 5.30.0
  (`IdentityManager`).

## Owner and occupant roles

The add-on declares two ngdpbase roles, `owner` and `occupant`, and keeps them in step with the dated
entries above ([#23](https://github.com/jwilleke/ngdpbase-addons/issues/23)). A person holds `owner`
while any of their `ownership` entries is current, and `occupant` while any of their `occupies`
entries is; otherwise the role is taken away. The facts are the source: a role given by hand to someone
with no current entry is removed.

- A change on the admin page starts the job at once, as the admin who made it.
- The daily scheduled job `accommodation.roles` (00:05 in the site's time zone, `ngdpbase.default.timezone`) makes the
  changes the dates bring (an entry that starts or ends today), as the system principal; a day
  missed while the server was down runs at the next start. Run it now from Admin →
  Scheduled Jobs. `ngdpbase.jobs.accommodation.roles.schedule` changes when it runs.
- Each change goes through `RoleManager`, which records it in the audit log.
- A change `RoleManager` refuses does not stop the others. The run then fails, naming each refused
  change and its error, so the job manager retries it, records it and tells the admins.
- A role is never taken away over an entry that cannot be read; the job leaves it and counts it, and
  `ResidencyManager.linkProblems(ctx)` names the entry.
- The roles grant nothing by themselves; a site grants permissions to them in its own policies.

## Billing

Who owes and where the invoice goes are kept apart (operator, 2026-10-25,
[ngdpbase#2042](https://github.com/jwilleke/ngdpbase/issues/2042)).

__Who owes__ is always the unit's owners on the invoice date, each with their share of the unit (the
`share` on their ownership entry). Owner shares add up to exactly 100. Every owner is an account.

__Where invoices go__ is the unit's `billing` list. Each entry is an address typed the way it goes
on the envelope, names first, and that entry's share of the invoice:

```json
"billing": [
  { "address": "MOLLY E WILLEKE & JAMES S WILLEKE\n123 Main St\nAkron OH 44333", "share": 100 }
]
```

- The address is free text, several lines. It names no account.
- The shares add up to exactly 100. A single entry may leave its share out: it is 100.
- Every unit must have at least one entry (operator, 2026-10-25): there is no default address, and
  saving an empty list is refused.
- The treasurer sets them on the unit's owners and occupants page; an owner on their own page, with
  the same rights. For a unit with none yet, the form offers the county's owner and mailing address
  (else the unit's own address) as a suggestion, saved only when someone checks it and saves.

`ResidencyManager.billing(ctx, id, { on })` is a door: it needs `accommodation-billing-read` (admins;
a site, or the accounting add-on's policy, grants its invoice job), decided with the caller's context.
The owners are then read under the system context, with a reason naming the caller and unit. It
returns:

```json
{ "period": { "id": "8f0c…", "from": "2016-11-23" }, "billing": [{ "address": "…", "share": 100 }], "owners": [{ "@id": "urn:uuid:…", "share": 50 }] }
```

It also gives `period: { id, from, through? }`, the ownership period billed on that date, which
accounting maps to a folio; `ResidencyManager.ownershipPeriods(ctx, id)`, behind the same permission,
lists every period of the unit, oldest first, with its owners by `@id` and their shares, for past
folios.

Owners come by identity `@id`, ordered by it, never by username; accounting reads names through
IdentityManager. No names are copied in. It refuses, naming the accommodation, rather than bill
wrongly: no current owner, owner or billing shares that do not add up to 100, no billing entries, an
owner with no identity record, or billing still in the earlier shape.

__The earlier shape__ (entries naming owners in `to`, with a structured address) is converted once at
start-up, under the system context, one write per unit: the owners' names, joined with " & ", above
the address lines. A unit naming a username with no account is left as it is, for the treasurer to fix
on the unit's page; the log gives counts only.

## Categories

Each accommodation's `accommodationCategory` names an entry in
`ngdpbase.addons.accommodation.categories`, which carries the assessment. The add-on ships the map
empty; a site sets its own. The Fairways', as an example:

```json
"ngdpbase.addons.accommodation.categories": {
  "C": { "name": "C Model", "assessment": 41000, "period": "monthly", "datedue": 1 },
  "D": { "name": "D Model", "assessment": 58400, "period": "monthly", "datedue": 1 },
  "A": { "name": "A Model", "assessment": 33800, "period": "monthly", "datedue": 1 }
}
```

- `assessment`: whole cents.
- `period`: `"monthly"` or `"annual"`.
- `datedue`: monthly, the day of the month (1–28); annual, `"MM-DD"`.

A malformed entry stops the add-on loading and names the key.

### Charge lines

`ngdpbase.addons.accommodation.charge-lines` lists the parts an assessment is shown in on the invoice
([#44](https://github.com/jwilleke/ngdpbase-addons/issues/44)); the add-on ships it empty, which makes
each assessment one line named after its category. The Fairways':

```json
"ngdpbase.addons.accommodation.charge-lines": [
  { "description": "Reserve Contribution", "percent": 61.49 },
  { "description": "Operating Contribution" }
]
```

- A line with a `percent` (above 0, below 100, at most two decimals) is that share of the assessment,
  rounded to the nearest cent.
- Exactly one line has no percent and takes the rest, so the lines always add up to the assessment:
  a C Model's $410.00 is $252.11 + $157.89.
- `AccommodationManager.assessment(id)` gives them as `lines: [{ description, amount }]` (whole cents);
  accounting shows them as given. A malformed list stops the add-on loading and says why.

How a charge is split across accommodations: today only by category, a fixed amount per category
(The Fairways' practice). The two other bases in
[#22](https://github.com/jwilleke/ngdpbase-addons/issues/22) are not built: by percentage of interest
(each accommodation's `floorSize` share of a total, the basis The Fairways' Declaration sets) and
equal per accommodation.

## Late charges

`ngdpbase.addons.accommodation.late-charges` holds the site's late-charge rules; the add-on ships it
empty. The accounting add-on reads them with `AccommodationManager.lateCharges()`, works out each
charge as its own invoice line, and the treasurer confirms it. The Fairways', as an example:

```json
"ngdpbase.addons.accommodation.late-charges": {
  "late-10": { "days-late": 10, "amount": 1000, "repeat": "once" },
  "late-60": { "days-late": 60, "amount": 5000, "annual-percent": 8, "repeat": "monthly" }
}
```

- `days-late`: whole days past the due date after which the rule applies.
- `amount`: whole cents.
- `annual-percent`: simple interest on the overdue balance, charged monthly at the rate ÷ 12, never
  compounded.
- `repeat`: `"once"` per late assessment, or `"monthly"`.

A rule has an `amount`, an `annual-percent`, or both. A malformed rule stops the add-on loading and
names the key.

## Permissions and audit

What each accommodation permission and role means, and where it is checked and recorded:
[docs/permissions.md](docs/permissions.md).

## Develop

```bash
npm install
npm test        # builds, then runs vitest
```

Add-on rules: ngdpbase `docs/guides/addons-developer-guide.md`.
