# Condos planning: billing, folios and maintenance

Notes from the operator's brainstorm with the accommodation session (ngdpbase-addons), the accounting
session (ngdp-accounting-addons) and ngdpbase core, 2026-10-25 and 2026-10-26. The Fairways
Condominiums is the reference site. Each decision is recorded on
[ngdpbase#2042](https://github.com/jwilleke/ngdpbase/issues/2042), which is where it is quoted from;
this page gathers them and says what is still open. The wider condo design is
[condo-brainstorm.md](plans/condo-brainstorm.md).

## The pieces

| Piece | What it is | Kept by |
| --- | --- | --- |
| __Unit__ | What is charged for: the parcel, permanent, e.g. `66-09960.043`, shown as "21 FAIRWAY DR" | accommodation |
| __Owners__ | Accounts on the site, each with a dated ownership entry and a share; every owner is an account | accommodation (on the account) |
| __Billing array__ | Where the unit's invoices go: free-form addresses, each with a share | accommodation (on the unit) |
| __Folio__ | The billable account: one stretch of the same owners, with its invoices, payments and balance | accounting |
| __Association's books__ | The general ledger and its funds (Operating, Reserve) | accounting |
| __Vendors__ | Organizations in core's identity records with a Vendor affiliation | core, with accounting |
| __Maintenance jobs__ | Work orders on a unit | a new add-on |

## Decided

### Billing (2026-10-25 and 2026-10-26)

- __Who owes__ is the unit's owners at invoice time, each with a share; owner shares total 100%.
  Owners are referred to by identity `@id`, never by username.
- __Every owner is an account.__ A contact without an account cannot be an owner.
- __The billing array is only where invoices go.__ Each entry is free-form address text, typed the
  way it goes on the envelope, names first, and a share. No identity references in it. Billing shares
  total 100%; a single entry's share defaults to 100%.
- __Every unit must have a billing array__, edited by any current owner or the treasurer, with the
  same rights. There is no default to the unit's own address.
- __The billing array decides invoicing.__ Each entry is one invoice for that entry's share.
  Ownership shares do not split invoices; they say who owns what, and votes. Example: 21 Fairway Dr
  has one entry at 100% and owners at 50/50, so one joint invoice.
- __Charge lines come from accommodation.__ Later, an invoice lists lines such as Reserve
  Contribution and Operating Contribution at the full amount, then "Your share: N%". Accounting
  renders them as given (its D-040: it bills exactly what the source says).
- __The Fairways' rates__ (monthly, due the 1st): C $410, D $584; A, B, E, F and G $338. CH
  (66-09960.000, 89 Fairway Dr) is the clubhouse and is not billed. Each unit's model, phase,
  building and original square feet come from the Shared-Fairways-Directory sheet, Reference tab,
  columns Q to V ([#22](https://github.com/jwilleke/ngdpbase-addons/issues/22)).
- __Monthly invoice lines__ (2026-10-26): the Reserve Contribution is 61.49% of the rate, rounded
  to the nearest cent, and the Operating Contribution is the rest, so the two add up to the rate
  exactly. A $338.00: $207.84 + $130.16. C $410.00: $252.11 + $157.89. D $584.00: $359.10 + $224.90.
  Those are the only two lines on the monthly invoice.
- __Late payment fees__ (confirmed 2026-10-26): $10 once when an assessment is 10 days late; from 60
  days late, $50 plus 8% a year simple interest on the overdue balance, charged monthly. They are
  accommodation's late-charge rules, which accounting applies as their own invoice lines.
- __Charges are split by category__ today. Percentage of interest (the Declaration's basis, from
  each unit's square feet) and equal per unit are not built.

### Folios (2026-10-26)

- __The folio is the billable account; the unit is what is charged for.__
- __Each unit always has exactly one folio assigned.__ New charges go on it.
- __A new folio starts whenever any owner or any share changes__: a sale, an owner added or removed,
  a transfer on death with no money changing hands, or the same owners with new shares. A share is a
  legal condition of ownership, and the record must show who owned what share when, in case it goes
  to court. A billing-address change does not start one.
- __A change of owners or shares requires approval__
  ([#40](https://github.com/jwilleke/ngdpbase-addons/issues/40)). An owner asks through a request that
  waits in core's review door for the treasurer, or whoever the site names; nothing changes until it
  is approved, and an approved request starts a new folio.
- __The treasurer or an admin may edit owners and shares directly__, and every such edit asks what it
  is: __correcting a mistake__ (same folio: a wrong date, a wrong share, someone entered by error) or
  __the ownership really changed__ (a new folio from its date).
- __Accommodation keeps each unit's ownership periods as their own record__ (id, from, through, owners
  with shares), because a correction and a real change can look the same in the owner entries. A real
  change adds a period; a correction edits the period it belongs to.
- __Starting periods__: each unit starts with one ownership period, its current owners from their
  start date (for most, the county's newest sale date). Earlier owners are not in the data, so there
  are no older periods or folios.
- __Opening balances__: every folio starts at $0 for now. The treasurer must be able to enter a
  balance brought forward on a folio later (an accounting treasurer action).
- __A folio keeps its own balance.__ The previous owners' folio stops being assigned but stays open
  as a debtor while it owes (a bankruptcy, an estate). The new owners never carry the old debt.
- __The unit's total__ is its folios added together. This supersedes accounting's D-047, one balance
  per unit.

### Maintenance (2026-10-26)

- __A new work-orders add-on__ (operator chose it over accommodation or accounting).
- __The flow__:
  1. An owner or the association turns in a request for a unit.
  2. A work order is created and sent to a vendor.
  3. The vendor fixes it and the work order closes; its date of service goes into the unit's
     maintenance history, whatever the folio.
  4. The vendor invoices the association; the bill goes into accounting's payables.
  5. The association pays the vendor; the bill leaves payables and the money goes out of the bank
     account.
- __Work the owners pay for__ (asked for by them, not covered by the association): the association
  generates an invoice to the unit's assigned folio only after the vendor has billed, for the
  vendor's amount.
- __Handing bills to accounting__: monthly dues stay as accounting asking each month; maintenance
  hands over each step as it happens.

## Agreed with accounting, waiting to be built

- __Folio numbers__: accounting numbers them per unit, in order: `66-09960.043/F01`, `/F02`, ...
- __A folio closes__ when it is no longer assigned and its balance is 0.
- __Write-off or lien__ on a folio: new treasurer actions. When the association deems a folio's debt
  uncollectable it files a lien with the county; the lien record (date filed, amount, the county's
  reference) does not change the balance (operator, 2026-10-26).
- __From accommodation's `billing(ctx, unitId, { on })`__, accounting needs the ownership period:
  `{ period: { id, from, through? }, billing: [...], owners: [...] }`. The period id is stable while
  the same owners hold the same shares, and new when any owner or share changes; a corrected date
  does not change it.
  Accounting maps the period id to its folio, opening the folio the first time it sees the id.
- __A list of a unit's past periods__ (id, from, through, owners' `@id`s), so an old folio still shows
  who owes it. `ResidencyManager.history(ctx, id)` is close.
- __Payments__: one naming only the unit goes on the assigned folio. Paying an old folio means naming
  it, or one of its invoices, so the new owners never pay the old debt by accident.
- __Who sees what__: current owners see the assigned folio; a past owner sees their own folio with its
  balance (this changes accounting's D-045); the board sees every folio, open ones flagged.
- __Late charges__ run per folio. An unassigned folio that still owes keeps getting late fees and the
  8% interest every month until it is paid off or written off; it gets no new assessments (operator,
  2026-10-26).

## Vendor bills (payables, decided 2026-10-26)

The operator chose payables, which reverses accounting's phase-1 non-goal "Accounts payable (bills,
vendors, scheduled payments)" (its README and requirements §1).

- __A bill received__ is added to payables: the association owes it, and no money has moved, so it is
  kept outside the ledger, in a payables module with its own store, as receivables are.
- __The unit's maintenance__ is recorded on the date of service, from the work order, whenever the
  bill arrives or is paid.
- __A bill paid__ leaves payables, and the money is recorded going out of the bank account as an
  ordinary money-out ledger entry (`LedgerManager.postTransaction`, direction `out`) naming the bill.
- __Vendors__ are organizations in core's identity records with a Vendor affiliation.
- __A unit tag on spending__: accounting's proposed change lets money-out entries carry line details,
  as receipts do, so work orders attaches `{ unit, job }`.

## How other systems do it

- __ERP (SAP and others)__: sold-to (the account), ship-to, bill-to (where the invoice goes, an address
  only) and payer (who owes, whose balance it is). Our billing array is bill-to; owners are the payer.
- __HOA and property software__ (Buildium, AppFolio, CINC): a ledger per unit; a sale closes the old
  owner's account and opens a new one; an old balance stays with the person who owed it.
- __Hotels__: a folio per stay; routing sends some charge types to another folio.
- __Receivables in general__: a balance belongs to an account or the party who owes, never to an
  address.

## The generic bill (not settled)

The operator wants one way for any add-on to hand bills to accounting, from a condo to a manufacturer
to a hotel, without a different billing array for each. The shape floated:

```text
account:  what is billed     (a unit, a customer, a hotel stay): id and label
folio:    who owes for now   (the period id, from accommodation's ownership periods)
lines:    what is charged    (description, amount, currency, period)
owedBy:   who owes           (identity @id and share; shares total 100%)
sendTo:   where it goes      (free-text address and share; shares total 100%)
```

Accounting has no generic intake today: it reads one configured accounts manager (`assessment(id)`,
`lateCharges`) and one billing manager (`billing()`). It would answer a proposed interface once the
operator settles it.

## The work, in issues (2026-10-26)

| Issue | What | Priority |
| --- | --- | --- |
| [#43](https://github.com/jwilleke/ngdpbase-addons/issues/43) | Ownership periods as their own record; billing() gives the period | P1 |
| [#40](https://github.com/jwilleke/ngdpbase-addons/issues/40) | Owner and share requests through core's review door; blocked by #43 | P1 |
| [#44](https://github.com/jwilleke/ngdpbase-addons/issues/44) | Charge lines: Reserve 61.49% and Operating | P1 |
| [accounting#75](https://github.com/jwilleke/ngdp-accounting-addons/issues/75) | Folios (accounting D-048); blocked by #43 | P1 |
| [accounting#76](https://github.com/jwilleke/ngdp-accounting-addons/issues/76) | Payables, and a unit tag on money out (accounting D-049) | P2 |
| [#45](https://github.com/jwilleke/ngdpbase-addons/issues/45) | The work-orders add-on | P2 |
| [#46](https://github.com/jwilleke/ngdpbase-addons/issues/46) | A generic bill any add-on can hand accounting | P2 |
| [#47](https://github.com/jwilleke/ngdpbase-addons/issues/47) | Split charges by percentage of interest | P2 |

The accommodation session works these with the operator and asks the accounting session anything that
touches accounting.

## Test setup (local)

The ngdpbase-addons test instance (`http://ngdpbase-addons.localhost:3004`, ngdpbase v5.32.0) runs
accommodation, association, forms, accounting and accounting-receivables. No email can be sent:
`accounting-receivables.send-to-owners` is off, its monthly job is paused, site mail is disabled
(console provider), and accounting-donations is not enabled. All 95 Fairways units have a billing
array, a category and a floor size; a fund still has to be created before an invoice run.
