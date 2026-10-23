# condo — ngdpbase add-on

A condominium's units, keyed by the county parcel, and their owners. The Fairways Condominiums is
the reference site. Work is tracked in epic
[#9](https://github.com/jwilleke/ngdpbase-addons/issues/9).

## Enable

In the site's `app-custom-config.json`:

```json
{
  "ngdpbase.managers.addons-manager.addons-path": ["./addons", "/path/to/ngdpbase-addons/addons"],
  "ngdpbase.addons.condo.enabled": true
}
```

Then `npm run build` here and restart ngdpbase.

## Units

Units live in `units.json` under the data folder (`ngdpbase.addons.condo.dataPath`, default
`./data/condo` in the site's data folder), read and written through the provider named by
`ngdpbase.addons.condo.provider` (default `json`). A unit's `id` is its county parcel; every other
field it has is kept as given.

ngdpbase backs up and restores the data folder itself (ngdpbase#1985): every site backup holds it as
`<stem>.condo.tar`, and a whole-site restore puts it back before condo starts. Condo has no backup
code of its own.

## Owners and occupants

Every owner and occupant is an ngdpbase user. Condo's extended field on the user record,
`condoUnits`, holds dated links to their units:

```json
"condoUnits": [
  { "parcel": "66-00001.000", "type": "owner", "from": "2012-05-01", "to": "2020-08-31" },
  { "parcel": "66-00002.000", "type": "occupant", "from": "2021-01-15", "to": "current" }
]
```

- `type`: `owner` or `occupant`; an owner who lives in the unit has one link of each.
- `from`: an ISO date. `to`: an ISO date, or `"current"`. Both days count.
- A link that is not exactly this shape is left out and listed by `ResidencyManager.linkProblems(ctx)`,
  never guessed.

`ResidencyManager.owners(ctx, id)` returns the unit's owners today (or on `{ on: 'YYYY-MM-DD' }`).
`ctx` is the caller's: the person who asked, or a job's context with its reason; users are read as
that caller (`UserManager.searchUsers`), inactive accounts included. `occupants(ctx, id)` returns the
people living there, who are never billed. `history(ctx, id)` returns everyone the unit has had, with
their dates.

## Billing

One invoice per billing address. The unit keeps its billing parties:

```json
"billing": [
  { "to": ["jim.willeke", "molly.willeke"], "address": { "streetAddress": "21 Fairway Dr", "addressLocality": "Mount Vernon", "addressRegion": "OH", "postalCode": "43050" }, "share": 100 }
]
```

- `to`: the owners named on the invoice; each must be a current owner.
- `address`: where it goes (schema.org PostalAddress).
- `share`: that party's percent of the assessment; the parties add up to exactly 100.
- A unit with no `billing` has one party: every current owner, at the unit's own address (its
  `address` field, else its county street fields), 100%.

`ResidencyManager.billing(ctx, id, { on })` returns the parties with owners' names filled in, one per
invoice. It refuses, naming the unit, rather than bill wrongly: a party naming someone who is not a
current owner, shares that do not add up to 100, a unit with no owner or no address.

## Unit types

Each unit's `unitType` names an entry in `ngdpbase.addons.condo.unit-types`, which carries the unit
assessment. Condo ships the map empty; a site sets its own. The Fairways', as an example:

```json
"ngdpbase.addons.condo.unit-types": {
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

`ngdpbase.addons.condo.late-charges` holds the site's late-charge rules; condo ships it empty. The
accounting add-on reads them with `CondoUnitManager.lateCharges()`, works out each charge as its own
invoice line, and the treasurer confirms it. The Fairways', as an example:

```json
"ngdpbase.addons.condo.late-charges": {
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

What each condo permission and role means, and where it is checked and recorded:
[docs/permissions.md](docs/permissions.md).

## Develop

```bash
npm install
npm test        # builds, then runs vitest
```

Add-on rules: ngdpbase `docs/guides/addons-developer-guide.md`.
