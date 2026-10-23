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

Every owner and occupant is an ngdpbase user. The extended field on the user record, `condoUnits`,
holds dated links to their accommodations, until it becomes `OwnershipInfo` and `Role`
([#21](https://github.com/jwilleke/ngdpbase-addons/issues/21)):

```json
"condoUnits": [
  { "parcel": "66-00001.000", "type": "owner", "from": "2012-05-01", "to": "2020-08-31" },
  { "parcel": "66-00002.000", "type": "occupant", "from": "2021-01-15", "to": "current" }
]
```

- `type`: `owner` or `occupant`; an owner who lives in the accommodation has one link of each.
- `from`: an ISO date. `to`: an ISO date, or `"current"`. Both days count.
- A link that is not exactly this shape is left out and listed by `ResidencyManager.linkProblems(ctx)`,
  never guessed.

`ResidencyManager.owners(ctx, id)` returns the accommodation's owners today (or on
`{ on: 'YYYY-MM-DD' }`). `ctx` is the caller's: the person who asked, or a job's context with its
reason; users are read as that caller (`UserManager.searchUsers`), inactive accounts included.
`occupants(ctx, id)` returns the people living there, who are never billed. `history(ctx, id)`
returns everyone the accommodation has had, with their dates.

## Billing

One invoice per billing address. The accommodation keeps its billing parties:

```json
"billing": [
  { "to": ["jim.willeke", "molly.willeke"], "address": { "streetAddress": "21 Fairway Dr", "addressLocality": "Mount Vernon", "addressRegion": "OH", "postalCode": "43050" }, "share": 100 }
]
```

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
