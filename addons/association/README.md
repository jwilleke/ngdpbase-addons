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
- It is for owners only (operator, 2026-10-25), and asks whether the person is already an owner in
  the association; an owner adding another unit they own uses it too. Once approved, the owner signs
  in and adds the unit's occupants and its billing address from accommodation's My accommodation;
  occupants never use this form.
- Anyone may fill it in, signed in or not. The unit choice is the list of units by street address,
  from accommodation, under its `accommodation-units-list` permission (every visitor and every user),
  never with names.
- Every submission waits for review
  ([#32](https://github.com/jwilleke/ngdpbase-addons/issues/32)). The handler refuses a bad answer
  with its reason: no answer to whether they are already an owner, no email, or an entry accommodation
  would refuse (an unknown unit, a bad date, a last date before the first, checked by
  `ResidencyManager.checkEntry`). A blank last date is `current`.
- It records `occupancy-submit` before it keeps anything (on-failure `refuse`): who sent it, the unit,
  the entry type and the names of the questions answered, never the answers.
- It keeps the submission in the add-on's encrypted database as pending, and tells the holders of
  `association-review` (admins on day one; a site grants it to its board in its own policy) that one
  waits. The notice names the unit and the entry type, not the person. With nobody holding the
  permission, it logs only.

## Review

__Admin → Occupancy review__ (`/addons/association/review`, also a card on `/admin`) lists the submissions
waiting, with their answers ([#33](https://github.com/jwilleke/ngdpbase-addons/issues/33)). It needs
`association-review`, which `OccupancyManager` asks again with the reviewer's context.

- __Reject:__ nothing is applied. Recorded as `occupancy-reject` first.
- __Approve__ applies a submission for the person with its email, in this order:
  - Check everything first. The account with the email is found through `UserManager.searchUsers`
    with the reviewer's context; more than one is never guessed. With none, the reviewer gives a
    username for a new one ([#34](https://github.com/jwilleke/ngdpbase-addons/issues/34)).
    Accommodation must accept the entry, and an owner's share must be given (default 100 on the page).
  - Record `occupancy-approve` (on-failure `refuse`).
  - For someone with no account: make it with no password (`UserManager.createUser`) and invite them
    (`AuthManager.inviteUser`), both as the reviewer, so they choose their own password or passkey. Core
    records both. An invitation that could not be sent (email off, say) is shown to the reviewer, and
    the approval still completes; an administrator can resend it from User Management. If a later
    step fails, the account stays, and approving again finds it.
  - Add the ownership or occupies entry through accommodation's `changeLink`, which also asks
    `accommodation-manage`. A reviewer needs both permissions; association does not grant
    `accommodation-manage`.
  - Write the details to the person's identity record through `IdentityManager.update`
    (`identity-manage`), in accommodation's own mapping (`ResidencyManager.contactDetails`). The home address goes in `address`. Every other address and phone, the agent
    and the emergency contact go in `contactPoint`, each typed by `contactType` (`mailing`, `home`,
    `other`, `business`, `agent`, `emergency`). Kinds the form does not write are kept.
  - Mark the submission approved.
- If the details cannot be written, the entry is removed again, the submission stays pending, and the
  failure is recorded. If that removal fails too, the error says the entry is still in effect.
- association's review policy grants admins `identity-read`, `identity-manage`, `search-user` and
  `user-create` with
  `association-review`.
- Not yet: applying a signed-in owner's or occupant's own-unit submission directly ([#35](https://github.com/jwilleke/ngdpbase-addons/issues/35)).
- The details use core's own schema.org types (`ContactPointEntry`: a `ContactPoint` or a
  `PostalAddress`, each with `name`), so the add-on needs ngdpbase 5.34.0 or later (IdentityManager, `identity-manage`, and `identityIdOf` and `convertReference` for identity `@id`s, below).

## Executive Hub

The board's page, core's `/executive` ([ngdpbase#2094](https://github.com/jwilleke/ngdpbase/issues/2094)):

- __Grant.__ The policy `association-executive-access` gives core's `executive` role `association-review`: the board reads the occupancy submissions waiting and decides them. Approving one also writes an ownership or occupies entry (`accommodation-manage`) and the person's details (`identity-manage`), and may make an account (`user-create`); none of them is given to `executive`, which writes nothing. So, as shipped, the board can read and reject a submission, and an approval is refused at its first write with nothing changed. A site whose board approves grants those three in its own policy.
- __Card.__ An __Occupancy review__ card (`surface: 'executive'`, gated by `association-review`, linking to `/addons/association/review`). Its `summary(ctx)` is `OccupancyManager.waitingCount(ctx)`: `association-review` asked again with the viewer's context, then one count of the submissions waiting.
- The card is registered only on a core with the hub (`AddonsManager.executiveCardsFor`). An older core keys cards by add-on alone, so the executive card would take the `/admin` card's place there.

## Who a record refers to

From ngdpbase 5.34.0 ([#2041](https://github.com/jwilleke/ngdpbase/issues/2041), step 7 of the identity model, [#2042](https://github.com/jwilleke/ngdpbase/issues/2042)) anything that refers to an identity stores its `@id`, never a username.

- __Audit rows:__ `occupancy-approve` writes `metadata.owner` as the owner's identity `@id` and `metadata.ownerUser` as their username (`IdentityManager.identityIdOf`, which never throws for a store that is down). A new account has no `@id` when the record is written first, and an unanswered lookup is null: `owner` is then the username, and the approval still completes. Rows written before this keep `owner` as the username. `occupancy-submit` and `occupancy-reject` name no owner, only the acting user, as before.
- __Submissions__ keep `submitted_by` as the submitter's identity `@id` (the forms add-on sends it; this add-on looks a bare username up itself if it is sent one). `anonymous`, `orphan:<name>` and a name with no account are stored as given. The name is kept beside it in `submitter_name` for the review page.
- __Start-up conversion__, once, for submissions kept before this: each `submitted_by` that is still a username goes through `IdentityManager.convertReference` under the system context, one write per submission, and the name moves to `submitter_name`. A name with no account becomes `orphan:<name>`, so a later account with that name never becomes the submitter. `@id`s, orphans and `anonymous` are skipped, so a second start writes nothing. Counts only are logged. When the identity store cannot answer, the whole pass is postponed to the next start. Orphans and a postponed pass show in the add-on's status on Admin → Add-ons.
- Nothing else is stored by user: reviewers are looked up from `association-review` at the time and told by notification, and the approver is the acting user of the audit row.

## Develop

```bash
cd addons/association && npm install && npm test
```

Rules: ngdpbase `docs/guides/addons-developer-guide.md` and the guides it links.
