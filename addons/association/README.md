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
- It keeps the submission in the add-on's encrypted database as pending, and files it with core's
  reviews ([ngdpbase#2112](https://github.com/jwilleke/ngdpbase/issues/2112)), as the person who sent
  it: an `association.occupancy` request decided by the holders of `association-review` (admins and
  core's `executive` role as shipped). Core tells them, with a notice that names only the kind, and
  lists it on `/reviews` and the Executive Hub. The request carries the answers, labelled as the form
  asks them, and what approval will do. If core cannot keep requests on the site, the sender is told
  and nothing is kept.

## Review

Every submission is decided through its core review request
([ngdpbase#2112](https://github.com/jwilleke/ngdpbase/issues/2112)), on any of three pages, with the
same outcome: `/reviews`, the Executive Hub (`/executive`), or __Admin → Occupancy review__
(`/addons/association/review`, also a card on `/admin`), which lists the submissions waiting with
their answers ([#33](https://github.com/jwilleke/ngdpbase-addons/issues/33)) and decides through
`host.reviews.decide`. Each page asks `association-review`; `OccupancyManager` asks it again with the
decider's context, and core asks it again and records the decision (`review-approved`,
`review-rejected`, `review-failed`).

- __Reject:__ nothing is applied. Core records it. A submission rejected on `/reviews` or the hub is
  marked rejected on association's own page the next time it lists.
- __Approve:__ core runs association's handler (`OccupancyManager.applyReview`), which applies the
  submission __as the system__, with a reason naming the submission, the request and the decider
  (`association: occupancy form <id> (review <id>) approved by <user>`), the way accommodation's
  owner-change requests are applied. The decider needs `association-review` and nothing that writes.
  In this order:
  - Check everything first. The account with the email is found through `UserManager.searchUsers`;
    more than one is never guessed. With none, a new one gets a username from the name (`first.last`,
    else the email's local part), with a short suffix from the request's id when that is taken
    ([#34](https://github.com/jwilleke/ngdpbase-addons/issues/34)). Accommodation must accept the
    entry. An owner's share is 100%, as the request says; a different split is set on the unit's page
    afterwards, where accommodation's share check shows it.
  - Record `occupancy-approve` (on-failure `refuse`), as the system, with `decidedBy` and `reviewId`.
  - For someone with no account: make it with no password (`UserManager.createUser`) and invite them
    (`AuthManager.inviteUser`), so they choose their own password or passkey. Core records both. An
    invitation that could not be sent (email off, say) is in the outcome, and the approval still
    completes; an administrator can resend it from User Management. If a later step fails, the
    account stays, and approving again finds it.
  - Add the ownership or occupies entry through accommodation's `changeLink`.
  - Write the details to the account's identity record through `IdentityManager.update`, in
    accommodation's own mapping (`ResidencyManager.contactDetails`). The home address goes in
    `address`. Every other address and phone, the agent and the emergency contact go in
    `contactPoint`, each typed by `contactType` (`mailing`, `home`, `other`, `business`, `agent`,
    `emergency`). Kinds the form does not write are kept.
  - Mark the submission approved. Core keeps a line saying what was done as the request's outcome.
- Not done, nothing half-done: the handler throws, and core keeps the request open with the reason,
  shown to the decider; approving again retries. If the details cannot be written, the entry is
  removed again first; if that removal fails too, the reason says the entry is still in effect.
- A refusal is a plain 403 on every page, never a 500. On association's page only the outcome code
  and the submission's id go in the URL; the page reads what was done, or why not, from core.
- __Submissions kept before reviews__ are filed at start-up, once each, under the system context, and
  then decided like any other; one not filed yet (core could not keep requests) is filed when the
  review page next lists or decides it, and is counted on the hub card meanwhile.
- association's review policy still grants admins `identity-read`, `identity-manage`, `search-user`
  and `user-create` with `association-review`. Approval no longer uses the first two or `user-create`;
  the page's account lookup uses `search-user`.
- Not yet: applying a signed-in owner's or occupant's own-unit submission directly ([#35](https://github.com/jwilleke/ngdpbase-addons/issues/35)).
- The details use core's own schema.org types (`ContactPointEntry`: a `ContactPoint` or a
  `PostalAddress`, each with `name`), so the add-on needs ngdpbase 5.34.0 or later (IdentityManager, `identity-manage`, core's reviews, and `identityIdOf` and `convertReference` for identity `@id`s, below).

## Executive Hub

The board's page, core's `/executive` ([ngdpbase#2094](https://github.com/jwilleke/ngdpbase/issues/2094)):

- __Grant.__ The policy `association-executive-access` gives core's `executive` role `association-review`: the board reads the occupancy submissions waiting and approves or rejects them, on the hub's list of requests, on `/reviews` or on the add-on's review page. An approval is applied by the system, naming the decider (Review, above), so the role needs nothing that writes.
- __Card.__ An __Occupancy review__ card (`surface: 'executive'`, gated by `association-review`, linking to `/addons/association/review`). Its `summary(ctx)` is `OccupancyManager.waitingCount(ctx)`: `association-review` asked again with the viewer's context, then the open `association.occupancy` requests core lists for the viewer, plus any submission kept before reviews and not filed yet.
- The card is registered only on a core with the hub (`AddonsManager.executiveCardsFor`). An older core keys cards by add-on alone, so the executive card would take the `/admin` card's place there.

## Who a record refers to

From ngdpbase 5.34.0 ([#2041](https://github.com/jwilleke/ngdpbase/issues/2041), step 7 of the identity model, [#2042](https://github.com/jwilleke/ngdpbase/issues/2042)) anything that refers to an identity stores its `@id`, never a username.

- __Audit rows:__ `occupancy-approve` writes `metadata.owner` as the owner's identity `@id` and `metadata.ownerUser` as their username (`IdentityManager.identityIdOf`, which never throws for a store that is down). A new account has no `@id` when the record is written first, and an unanswered lookup is null: `owner` is then the username, and the approval still completes. Rows written before this keep `owner` as the username. `occupancy-submit` names no owner, only the acting user, as before. Rows written before ngdpbase#2112 may be `occupancy-reject`; a rejection is now core's `review-rejected`.
- __Submissions__ keep `submitted_by` as the submitter's identity `@id` (the forms add-on sends it; this add-on looks a bare username up itself if it is sent one). `anonymous`, `orphan:<name>` and a name with no account are stored as given. The name is kept beside it in `submitter_name` for the review page.
- __Start-up conversion__, once, for submissions kept before this: each `submitted_by` that is still a username goes through `IdentityManager.convertReference` under the system context, one write per submission, and the name moves to `submitter_name`. A name with no account becomes `orphan:<name>`, so a later account with that name never becomes the submitter. `@id`s, orphans and `anonymous` are skipped, so a second start writes nothing. Counts only are logged. When the identity store cannot answer, the whole pass is postponed to the next start. Orphans and a postponed pass show in the add-on's status on Admin → Add-ons.
- Nothing else is stored by user: core tells the holders of `association-review` at the time, and records who decided; `occupancy-approve` is the system's row, naming the decider in its reason and `decidedBy`.

## Develop

```bash
cd addons/association && npm install && npm test
```

Rules: ngdpbase `docs/guides/addons-developer-guide.md` and the guides it links.
