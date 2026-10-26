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
- __Charges are split by category__ today. Percentage of interest (the Declaration's basis, from
  each unit's square feet) and equal per unit are not built.

### Folios (2026-10-26)

- __The folio is the billable account; the unit is what is charged for.__
- __Each unit always has exactly one folio assigned.__ New charges go on it.
- __A new folio starts whenever any owner changes__: a sale, an owner added or removed, or a
  transfer on death with no money changing hands. A billing-address change does not start one.
- __A folio keeps its own balance.__ The previous owners' folio stops being assigned but stays open
  as a debtor while it owes (a bankruptcy, an estate). The new owners never carry the old debt.
- __The unit's total__ is its folios added together. This supersedes accounting's D-047, one balance
  per unit.

### Maintenance (2026-10-26)

- __A new work-orders add-on__ (operator chose it over accommodation or accounting). A job records
  the unit, the request, the vendor, the cost and who pays.
- __Paid by the association__: recorded against the unit, so the unit keeps a maintenance history
  whatever the folio.
- __Asked for by the owners and not covered__: also charged to the unit's assigned folio as a charge
  line.

## Agreed with accounting, waiting to be built

- __Folio numbers__: accounting numbers them per unit, in order: `66-09960.043/F01`, `/F02`, ...
- __A folio closes__ when it is no longer assigned and its balance is 0.
- __Write-off or claim__ on a folio: a new treasurer action.
- __From accommodation's `billing(ctx, unitId, { on })`__, accounting needs the ownership period:
  `{ period: { id, from, through? }, billing: [...], owners: [...] }`. The period id is stable while
  the same owners hold the unit and new when any owner changes; a corrected date does not change it.
  Accounting maps the period id to its folio, opening the folio the first time it sees the id.
- __A list of a unit's past periods__ (id, from, through, owners' `@id`s), so an old folio still shows
  who owes it. `ResidencyManager.history(ctx, id)` is close.
- __Payments__: one naming only the unit goes on the assigned folio. Paying an old folio means naming
  it, or one of its invoices, so the new owners never pay the old debt by accident.
- __Who sees what__: current owners see the assigned folio; a past owner sees their own folio with its
  balance (this changes accounting's D-045); the board sees every folio, open ones flagged.
- __Late charges__ run per folio.

## Vendor bills: an open scope decision

Accounting has no payables. "Accounts payable (bills, vendors, scheduled payments)" is a stated
non-goal for its phase 1 (its README and requirements §1), so adding it reverses that decision.

- __Today__: money out is a ledger entry (`LedgerManager.postTransaction`, direction `out`) with its
  fund, account, category, payee (an identity `@id` or free text) and memo, recorded when the money
  actually leaves. The ledger holds only money that has moved (the operator's standing rule).
- __If payables are added__: an unpaid vendor bill lives outside the ledger, in a payables module with
  its own database, mirroring receivables. Paying it posts an ordinary money-out entry naming the bill.
- __A unit tag on spending__ is not possible today; line details exist only on receipts. Accounting's
  proposed change: allow the same line details on money-out entries, so work orders attaches
  `{ unit, job }` and can list a unit's spending across every folio.

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

## Open questions

- Does a change of shares alone, with the same owners, start a new folio?
- Should accounting add vendor bills (payables), reversing its non-goal, or record spending only when
  paid, with a unit tag on the payment?
- When should an add-on hand its bills to accounting: when accounting asks (a billing run, as dues
  work now), when something happens (a checkout, an order), or both?
- Which issues to file, and at what priority: folios (accommodation's ownership periods, accounting's
  folios), charge lines, the work-orders add-on, the generic bill.

## Test setup (local)

The ngdpbase-addons test instance (`http://ngdpbase-addons.localhost:3004`, ngdpbase v5.32.0) runs
accommodation, association, forms, accounting and accounting-receivables. No email can be sent:
`accounting-receivables.send-to-owners` is off, its monthly job is paused, site mail is disabled
(console provider), and accounting-donations is not enabled. All 95 Fairways units have a billing
array, a category and a floor size; a fund still has to be created before an invoice run.
