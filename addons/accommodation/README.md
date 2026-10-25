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

ngdpbase backs up and restores the data folder itself (ngdpbase#1985): every site backup holds it as
`<stem>.accommodation.tar`, and a whole-site restore puts it back before the add-on starts. The add-on
has no backup code of its own.

## Owners and occupants

Every owner and occupant is an ngdpbase user. Two extended fields on the user record hold their
dated links to accommodations, in schema.org shapes
([#21](https://github.com/jwilleke/ngdpbase-addons/issues/21)):

```json
"ownership": [
  { "typeOfGood": "66-00001.000", "ownedFrom": "2012-05-01", "ownedThrough": "2020-08-31", "share": 100 }
],
"occupies": [
  { "roleName": "occupant", "accommodation": "66-00002.000", "startDate": "2021-01-15", "endDate": "current" }
]
```

- `ownership` entries are `OwnershipInfo`: `typeOfGood` is the accommodation's parcel, and `share` the
  owner's percent of it (for joint owners' votes, not billing). On any date an accommodation's current
  owners' shares add up to exactly 100; a sole owner writes 100.
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
out each time it is shown.

### Recording who owns and lives in each accommodation

__Admin → Owners and occupants__ (`/addons/accommodation/residents`, also a card on `/admin`) lists
every accommodation with its current owners and occupants, and the entries that need fixing
([#28](https://github.com/jwilleke/ngdpbase-addons/issues/28)). Seeing it needs `accommodation-read`.
Open an accommodation to change its entries, which needs `accommodation-manage`:

- __Add__ an entry: the person (a username), owner or occupant, from, through (`current` or a date), and
  an owner's share. For example "Pat Example owns 66-00001.000 from 2015-06-01".
- __End__ a current entry on its last day: "Lee Renter moved out 2026-09-30".
- __Correct__ an entry, a malformed one too: that is how one `linkProblems` names is fixed. Fields the
  page does not show (such as `acquiredFrom`) are kept.
- __Remove__ an entry entered by mistake. An entry that ended is ended, not removed: it is the history.

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
- An owner also sees the occupants' emails and the unit's billing parties. An occupant sees the
  owners' names only.
- No balance: bills, payments and balance are on the dues card the accounting add-on puts on the
  person's profile, which the page links to (ngdp-accounting-addons D-044).
- __Billing address__ ([#38](https://github.com/jwilleke/ngdpbase-addons/issues/38)): an owner changes
  the address of a billing party they are on. It applies at once (operator, 2026-10-22). A unit that
  keeps no parties has one, all its current owners, and setting its address keeps that party.
  `ResidencyManager.setBillingAddress` decides with the owner's context (`accommodation-self`, a
  current owner, on that party). It records `accommodation-billing-update` as the owner first
  (on-failure `refuse`; the field names, never the address), has `AccommodationManager` write it under
  the system context with a reason naming the owner, then tells the holders of
  `accommodation-notices` (admins on day one; a site grants its board).
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
  replaced as given (a blank box clears one), and every other kind on the record stays. Adding an
  occupant comes later.
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

One invoice per billing address. The accommodation keeps its billing parties:

```json
"billing": [
  { "to": ["jim.willeke", "molly.willeke"], "address": { "streetAddress": "21 Fairway Dr", "addressLocality": "Mount Vernon", "addressRegion": "OH", "postalCode": "43050" }, "share": 100 }
]
```

`ResidencyManager.billing(ctx, id, { on })` is a door: it needs `accommodation-billing-read` (admins;
a site, or the accounting add-on's policy, grants its invoice job), decided with the caller's context.
The owners are then read under the system context, with a reason naming the caller and unit, and only
billing fields come back.

- `to`: the owners named on the invoice; each must be a current owner.
- `address`: where it goes (schema.org PostalAddress).
- `share`: that party's percent of the assessment; the parties add up to exactly 100.
- An accommodation with no `billing` has one party: every current owner, at the accommodation's own
  address (its `address` field, else its county street fields), 100%.

`ResidencyManager.billing(ctx, id, { on })` returns the parties with owners' names filled in, one per
invoice. It refuses, naming the accommodation, rather than bill wrongly: a party naming someone who is
not a current owner, shares that do not add up to 100, an accommodation with no owner or no address.

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
