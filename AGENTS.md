---
project_state: "active"
last_updated: "2026-10-16"
agent_priority_level: "medium"
blockers: []
requires_human_review: []
agent_autonomy_level: "high"
kit_version: "v1.15.0-2-gc79a0b9"
---

<!-- KIT:START v1.15.0-2-gc79a0b9 — managed by mjs-project-template; edit below the KIT:END marker -->
## Agent Kit Protocols

This section is __managed by the kit__ (`install-kit.sh`) — it is identical across repos. Put repo-specific context __below the `KIT:END` marker__; do not edit here.

The heading above names the kit on purpose. It used to read `Agent Context & Protocols`, which is the
same wording a repo naturally picks for its own agent section below `KIT:END` — two identical `##`
headings in one file, and `markdownlint` MD024 fails on it. The kit owns one heading string in every
repo that installs it, so that string says whose it is.

### Don't Repeat Yourself

Three parts of one rule. All fire before you write anything.

- __Knowledge: one representation.__ Every fact — a rule, a decision, a version, a list — has exactly one authoritative home. Point at it; never restate it. A second copy is not redundancy, it is a future contradiction: the copies drift, and nothing tells you which one is current. Before writing a fact down, find where it already lives. If it lives in two places already, that is a defect worth fixing, not a pattern to follow.
- __Work: check it is not already done.__ Before starting, read the `▶ Resume here` block in `TODO.md`, recent `git log`, and the related GitHub issue. Repeating finished work is the most common avoidable mistake.
- __Reuse: check the platform first.__ If this repo builds on a platform (for example an ngdpbase addon), search the platform's code for the feature before writing it — managers, helpers, config, routes, UI pieces. If it exists, use it. If it almost fits, extend it in the platform, not here. If it is missing and other addons would need it too, __open a P1 issue on the platform repo__ and link it, rather than building a private copy in the addon. Recreating platform code in an addon is a DRY defect.

The long form is the operator's __Do NOT Repeat Yourself (DRY)__ page. It lives on a private wiki, so it is named here, not linked. It is not copied here on purpose — copying it would be the very defect this protocol names. The kit owns this paragraph; the page owns the rest.

### Session continuity

- Before starting, read the `▶ Resume here` block at the top of `TODO.md` (committed, so it syncs across machines) and recent `git log`. That is where the last session left off — repeating finished work is the most common avoidable mistake.
- Commit a chunk of work with `/session-commit`: commits code + `TODO.md`, appends a journal entry to `private/project_log.md` (the log is never committed).
- Run `/pstatus` often (after every `/session-commit`): it ranks open work and recommends the next step.
- End a session with `/wrap`: commits anything outstanding, refreshes the `▶ Resume here` pointer, and reports whether it is safe to shut down the editor.
- While the operator is away, `/work-alone` progresses open issues in priority order, doing only reversible work. It logs what needs the operator (Stuck), decisions made without them, abnormalities, and new issues filed to `private/agent-work-alone.md`, which it creates on first use.

### Priorities — GitHub labels are the source of truth

Priority labels are mutually exclusive and mean:

- `P0` — __Broken. Stop all work and fix it.__ (production down / blocked / security breach)
- `P1` — __Delivers value to the mission.__
- `P2` — __Nice to have.__
- `deferred` — consciously postponed; `needs-triage` — awaiting a priority decision.

Then:

- Security comes first. Scanner alerts (Dependabot / code-scanning / GitGuardian / the ecosystem audit, e.g. `npm audit`) become issues labeled `security` + a graded priority: critical/high → `P0`, medium → `P1`, low → `P2`.
- Test credentials are generated at run time (e.g. `randomUUID()`), never written as literals, and no real secret is committed anywhere, tests and fixtures included. `.gitguardian.yaml` ignores test paths on that basis; gitleaks (`secret-scan.yml`) still scans them.
- `TODO.md` = a `▶ Resume here` block (maintained by `/wrap`) on top, then priority bands that `/pstatus` regenerates from the labels. Do not hand-edit the bands.
- The two halves have one writer each and a deliberate handover: `/wrap` writes the resume pointer at session end, `/context` reads it at session open, and the first `/pstatus` of the session __removes__ it — by then you have already resumed, so it has served its purpose. A bands-only `TODO.md` mid-session is expected, not a loss.
- Kit files are overwritten wholesale on every sync — `.claude/commands/*.md`, `utility/sync-labels.sh`, `.markdownlint-cli2.jsonc`. Never add a rule to one of them: it is destroyed at the next sync (the installer now warns, but the rule still goes). A __generic__ rule belongs upstream in [mjs-project-template](https://github.com/jwilleke/mjs-project-template) so every repo gets it. A __repo-specific__ note about a command — a package manager the kit does not name, a scanner only this repo has — goes in `.claude/commands/<command>.local.md`, which the kit never writes, reads, or deletes. Read that file, if present, as part of the command; commit it, so it travels with the repo.
- `TODO.md` holds __no history__ — only what is open right now. Never add "merged since last run", closed/merged counts, a session narrative, a dated changelog, or work from other repos. A closed item just stops appearing; that disappearance is the whole record. Session history goes in `private/project_log.md` via `/session-commit` and `/wrap`, and nowhere else.

### Working agreement

- Think before coding: state assumptions, surface trade-offs, ask when scope is ambiguous.
- Simplicity first: the minimum that solves the problem; nothing speculative.
- Use Conventional Commits for messages.
- Issue decomposition — NEVER put "Steps", "Phases", or numbered sequences inside a single GitHub issue. Break each step into its own issue and link them using GitHub relationships: `closes #N` / `fixes #N` (resolves another), `blocked by #N` (dependency), `relates to #N` (context link). Example: a 3-phase migration = 3 issues with "blocked by" chains, not one issue with Phase headings.
- Issue/PR links — Never use a bare `#N` reference alone. Always pair it with the full GitHub URL: `[#333](https://github.com/owner/repo/issues/333)`. This applies in commit messages, PR descriptions, comments, and any agent output. Use `/issues/N` for issues and `/pull/N` for PRs.
- Awaiting approval — When work is complete but requires human sign-off before closing, apply the `in-review` label and leave a comment on the issue/PR that states: what was done, what the human needs to verify, and what action closes it. Never self-close an issue or PR.
- Closing issues — __Always remove the `in-review` label when closing__ an issue or PR (`gh issue edit N --remove-label in-review` before or with the close). Closed items must not keep `in-review`, or the label stops meaning "awaiting a decision" and the queue it drives can no longer be trusted.
- Commits — always use the `/session-commit` skill. Never run a bare `git commit` directly. `/session-commit` enforces the session log update, conventional commit format, and co-author trailer.
- Direct commits by default — commit to the default branch; do not open a pull request unless someone other than you will actually look at it before it lands. On a single-maintainer repo a self-opened, self-merged PR reviews nothing: it just splits one explanation across a commit message and a near-identical PR body. Put the reasoning in the commit message. A change touching a "risky" path, closing an issue, or feeling significant is __not__ a reason to open one — CI runs on `push` as well as `pull_request`, so a direct commit is still tested. Where a PR does exist, its body points at the commit message rather than restating it.

### Markdown conventions

__Read `.markdownlint-cli2.jsonc` before writing markdown.__ It is the control file — rules, globs
and ignores in one place, read by the editor, the CLI, CI and you, and identical in every repo the
kit installs into. Do not rely on a summary: this section deliberately does not restate the rules,
because a second copy drifts from the first the moment someone changes one.

Most markdown here is written by agents, so these are writing rules, not review rules — conform on
the first draft rather than relying on `--fix`. There is no exemption mechanism and none is wanted;
a disabled check is a check nobody revisits. Verify with `npm run lint:md`, or `npx markdownlint-cli2`
where there is no `package.json`.

Only committed files are linted: anything `.gitignore`d is generated or vendored, so its source is
linted instead.
<!-- KIT:END -->

# ngdpbase-addons

## Project Context

General-purpose [ngdpbase](https://github.com/jwilleke/ngdpbase) add-ons, each independent of
the others and of any one site. Add-ons and plans are listed in [README.md](README.md).

- `accommodation`, `governance`, `association` — the condo work, being split into add-ons a site
  enables as it needs; epic [#19](https://github.com/jwilleke/ngdpbase-addons/issues/19), design in
  `docs/plans/condo-brainstorm.md`. `condo` is retired once they carry everything. Replaces
  `fairways-gen2-website/addons/fairways`; The Fairways is the reference site.
- Repo tooling follows [mjs-project-template](https://github.com/jwilleke/mjs-project-template).

## Platform guides

How to change an add-on is the guides in the platform checkout, the sibling
`../ngdpbase/docs/guides/`. On this machine that directory is
`/Volumes/hd2A/workspaces/github/ngdpbase/docs/guides/`. Open those files. Do not
copy them into this repo.

The instance below is a running checkout. Its `docs/guides` lags the platform.
Read the rules from the sibling, not from the instance. If the sibling checkout
is not on the machine, open the
[guide index](https://github.com/jwilleke/ngdpbase/blob/master/docs/guides/README.md)
on GitHub.

Read the file the change touches, then follow that file.

- Any add-on change: `addons-developer-guide.md`, including its standing rules and the section for what you are adding.
- A route, manager method, job, permission, policy, or audit event: also `security-developer-guide.md` and `audit-developer-guide.md`. Run each guide's "How you know you are done" list.
- Where pages, files, a database, or `dataPath` go: `storage-developer-guide.md`.
- A configuration key: `configuration-developer-guide.md`.
- A plugin whose output is on a page: `caching-developer-guide.md`.
- Backup of add-on data: `backup-restore-guide.md`.

## Local ngdpbase

- __Instance:__ a separate ngdpbase clone at `/Volumes/hd2A/test-instances/ngdpbase-addons-instance`
  (`npm ci`, `npm run build`), app name `ngdpbase-addons`, port 3004, its own `./data`. Its `.env`
  (git-ignored) holds the admin password and backup key. Its `data/config/app-custom-config.json` adds
  this repository's `addons/` to `addons-path` and enables the add-ons.
- __Only this instance.__ The operator runs several ngdpbase instances on this machine. Never touch
  another one's config, and never run a pm2 command on `all`; control this one with its `./server.sh`.
- __Build and test an add-on:__ `cd addons/<slug> && npm install && npm test` (builds `.ts` to `.js` in
  place, then runs vitest).
- __Run:__ `cd /Volumes/hd2A/test-instances/ngdpbase-addons-instance && ./server.sh restart`, then
  check `data/logs/app.log` for `Add-on loaded: <slug>`. The site is <http://ngdpbase-addons.localhost:3004>.
