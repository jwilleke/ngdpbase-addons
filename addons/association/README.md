# association

A unit owners association's own rules, on top of the [accommodation](../accommodation/README.md)
add-on, which keeps the units and who owns and lives in them. The Fairways Condominiums is the
reference site (epic [#19](https://github.com/jwilleke/ngdpbase-addons/issues/19)).

## Enable

Needs `accommodation` enabled, the site's database on, and its key set. The forms add-on is optional
but carries the Occupancy information form.

```json
{
  "ngdpbase.addons.accommodation.enabled": true,
  "ngdpbase.addons.forms.enabled": true,
  "ngdpbase.addons.association.enabled": true,
  "ngdpbase.database.provider": "sqlite"
}
```

- `NGDPBASE_DATABASE_KEY` in `<FAST_STORAGE>/.env`. The add-on's database is declared
  `encrypt: "required"`, because occupancy submissions hold personal data, so without the key ngdpbase
  does not load the add-on and Admin → Add-ons says why. Turning on the database and setting the key is
  the site operator's setup, not the add-on's. Keep a copy of the key off the server.
- With the database off, the add-on does not start, and its status says how to fix it.

## What it is, for now

Thin to start (operator, 2026-10-24,
[#25](https://github.com/jwilleke/ngdpbase-addons/issues/25)): a working framework first, then
iterate.

- The association's rules become settings here, each citing where it comes from: ORC 5311, the
  Declaration, the Bylaws, or a board rule. A setting is added when a feature needs one.
- No statute profiles yet, and no checking a setting against a statute's limits. Ohio 5311 is not the
  only law that applies; profiles wait until a second site shows what they need
  (`docs/plans/condo-brainstorm.md`).
- The first feature is the Occupancy information form, ORC 5311.09
  ([#17](https://github.com/jwilleke/ngdpbase-addons/issues/17)), below.
- `governance` (members, board and officers) is deferred
  ([#24](https://github.com/jwilleke/ngdpbase-addons/issues/24)).

Its status on Admin → Add-ons says how many accommodations it works on, and how many occupancy
submissions wait for review. It ships two pages: "Using Association", and "Occupancy Information",
which shows the form.

## Occupancy information form

What ORC 5311.09(A)(2) asks the association to keep for each unit owner and every occupant: who, the
unit, the dates, home and business addresses and phones, the owner's agent, and an emergency contact.
It replaces The Fairways' Google form "Contact information".

- The form (`association-occupancy`) is shipped to the forms add-on at every start
  (`registerShippedForm`) and is read-only on the site. It keeps no submission file and sends no
  notice of its own (`store: false`, `notify: false`): this add-on's record is the record.
- Anyone may fill it in, signed in or not. The unit choice is the list of units by street address,
  from accommodation, under its `accommodation-units-list` permission (every visitor and every user),
  never with names.
- Every submission waits for review
  ([#32](https://github.com/jwilleke/ngdpbase-addons/issues/32)). The handler refuses a bad answer
  with its reason: an entry type that is not Owner or Occupant, no email, or an entry accommodation
  would refuse (an unknown unit, a bad date, a last date before the first, checked by
  `ResidencyManager.checkEntry`). A blank last date is `current`.
- It records `occupancy-submit` before it keeps anything (on-failure `refuse`): who sent it, the unit,
  the entry type and the names of the questions answered, never the answers.
- It keeps the submission in the add-on's encrypted database as pending, and tells the holders of
  `association-review` (admins on day one; a site grants it to its board in its own policy) that one
  waits. The notice names the unit and the entry type, not the person. With nobody holding the
  permission, it logs only.
- Not yet: the review page and applying an approved submission
  ([#33](https://github.com/jwilleke/ngdpbase-addons/issues/33)), creating an account for someone new
  ([#34](https://github.com/jwilleke/ngdpbase-addons/issues/34)), and applying a signed-in owner's or
  occupant's own-unit submission directly
  ([#35](https://github.com/jwilleke/ngdpbase-addons/issues/35)).

## Develop

```bash
cd addons/association && npm install && npm test
```

Rules: ngdpbase `docs/guides/addons-developer-guide.md` and the guides it links.
