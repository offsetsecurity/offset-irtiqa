# Roadmap

> **This is the history of the engine**, from when one codebase built every
> Offset product. Offset Irtiqa now has this repository to itself, and the
> products no longer share code. Kept because it explains why things are the
> way they are.

Where the product is, what is left, and the order to build it in.

Status: Phases 1 to 6 are done, plus user administration and the Windows
portable bundle. All three products run — Assure on ISO 27001, Align on
CSF 2.0, Anchor on SP 800-53 — each with the screens its framework needs, ten
in total, on a shared API with roles, an audit trail, six PDF reports, a
background worker and 60 tests.

All of that is the **Community Edition**, which is free to use and closed
source — and, as of 2026-09-10, the only edition. What is left is the rest of
packaging (installer, edition naming, running as a service) and email.

The ordering principle throughout: **prove the risky thing early, and keep
something showable at every step.** Building the whole API first would mean
weeks of work with nothing to look at, and would only discover a bad UI
decision after it had been repeated nine times.

---

## Editions

**There is one edition: the Community Edition, and it is free.** Decided
2026-09-10. A paid Enterprise edition was considered and shelved — revisit
around September 2027, not before.

**Free to use, closed source.** Anyone may install it, on as many machines as
they like, for commercial work, with as many users as they like, at no charge.
They may not modify it, reverse engineer it, re-brand it, sell it, or run it
as a service for other people. The source is not published and the repository
stays private. `LICENSE` holds the agreement, v1.0, and the installer shows it
before anything is copied.

One point in that licence is easy to get wrong, so it is written down twice:
customers **may** put their own logo on reports they export — the product
offers that — and **may not** remove Offset Security's branding from the
product itself. Adding your logo to your document is not white-labelling.

The edition split has no code behind it and does not need any. The pack's
`features` flags already decide what each of the three products shows, and
that is the only axis that matters now.

**Naming.** "Community Edition" has to appear where a user sees it: the app
title, the installer display name, the PDF report footer, the README and the
shortcut names. Listed in Phase 7.

---

## Phase 1 — One screen, end to end ✅ done 2026-09-09

Port the dashboard and the controls screen from the HTML tool onto the live
API. One product only (Align), one screen, done properly.

This phase is not about the dashboard. It is about answering the questions that
every later screen depends on:

- How is the front end structured? Preact with htm —
  [ADR 0003](adr/0003-preact-and-htm-for-the-front-end.md). Forced by the
  Content-Security-Policy, which blocks the tools' inline `onclick=`, and by
  inline editing, which cannot survive `innerHTML` replacement.
- How does a framework pack drive the UI? The pack ships beside the bundle and
  supplies the labels, so "Subcategory" and "Function" come from the same file
  the API seeded from.
- Where do chart numbers come from? The API's summary endpoints, so the list
  and the dashboard can never disagree.

**Done when:** two people log in from different machines, change a control, and
see each other's change on a real dashboard. **Met** — proved with three
accounts on separate sessions, including a read-only auditor refused with 403.

**Result:** 30.8 KB bundle. Also uncovered three older bugs, all fixed: a
`pnpm typecheck` that never ran, a build that could not start outside Docker,
and a missing asset returning HTML instead of a 404.

## Phase 2 — The screens for what already exists ✅ done 2026-09-09

Controls, evidence and risks already have working APIs. Give them their real
screens, repeating the Phase 1 pattern.

**Done when:** the three areas we have built are fully usable by a normal user,
with no API client or curl needed. **Met.**

**Result:** the pattern held. Both screens came out the same shape as the
controls register, and the only new machinery either needed was the add/edit
dialog, written once in `Modal.ts` and now available to every register Phase 3
adds. Bundle grew 30.8 KB to 49.4 KB for two complete screens.

## Phase 3 — The five missing areas ✅ done 2026-09-09

Assets, Policies, Tasks, Incidents, Findings. None of these exist yet — not in
the database, not in the API, not in the UI.

Each one is the same shape of work: migration, API routes, tests, screen. This
phase is deliberately boring and predictable.

**Done when:** every tab in the HTML tool has a real equivalent. **Met** for
these five.

**Result:** the CRUD behaviour is written once — `register.ts` on the server,
`Register.ts` in the browser — and each register is configuration. Controls,
evidence and risks kept their own files, because each has logic that does not
generalise. Two rules earned bespoke code: policy document control, and the
requirement that a closed finding says what closed it. 29 tests, bundle at
65.1 KB.

## Phase 4 — What makes each product different ✅ done 2026-09-09

Everything above is shared. This is where Assure, Align and Anchor stop being
the same app:

- **Align:** CSF Tiers, Current and Target profiles, the function radar.
- **Anchor:** baseline picker (Low/Moderate/High), the ODP editor for the 679
  controls with parameters, the family heatmap.
- **Assure:** Statement of Applicability, ISMS scope.
- **All three:** the `programme` and `settings` tables, which exist but have no
  routes.

**Done when:** all three products are genuinely different products, not one app
with three logos. **Met.**

**Result:** the pack's `features` flags decide which screens and fields appear,
so each product is a configuration rather than a fork. Align gets Profile &
Tiers, Assure gets the Statement of Applicability, Anchor gets System &
Baseline with the parameter editor. Verified by running all three against
their own databases: Anchor seeded 1,014 controls across 20 families and
applied the moderate baseline — exactly the 287 SP 800-53B specifies — in
60 ms.

## Phase 5 — Reports ✅ done 2026-09-09

The thing customers actually pay for: the evidence pack, the SoA export, the
gap report, the board pack.

**Decided:** the requirement was a Download button that yields a PDF file, which
rules out print-to-PDF — that needs a person at a print dialog. So the server
generates them, with `pdfmake` rather than a bundled browser: 14 MB against
roughly 300 MB, for a document a library renders in under a second.

Fonts are the PDF standard 14, so nothing is embedded and nothing extra ships.
The trade is WinAnsi encoding — Western European Latin only. `safe()` maps the
punctuation the reports generate and turns anything else into a visible marker,
because a compliance document that silently drops text is worse than one that
admits it. Swapping in an embedded font is the fix when a customer needs it.

**Result:** six reports, feature-gated per product. Verified by extracting the
text back out of the generated PDFs and reconciling it against the dashboard.

## Phase 6 — The background worker ✅ done 2026-09-10

The `jobs` table exists; nothing runs it. Jobs needed:

Built: the daily readiness snapshot (the only history the product keeps),
nightly backup with pruning, the WAL checkpoint — the benchmark in
[ADR 0002](adr/0002-sqlite-not-postgres.md) showed the automatic one puts
~15 ms in the write tail — and session, job-log and optional audit purges.

Two items on the original list were dropped, deliberately:

- **Evidence freshness recompute.** Freshness is derived in SQL from the
  collected date when it is read, so there is nothing to recompute. The job
  would only have pretended to work.
- **Email digest.** It needs SMTP, which arrives with the rest of the
  notification settings in Phase 8. A digest that silently sends nothing is
  worse than no digest.

**Result:** a table and a poller, no broker. Claiming is a conditional update
inside a write transaction, so two workers cannot take the same job; failures
retry with a widening delay and give up after three; a job stranded by a
crashed worker is released. Recurring work never piles up while the worker is
down, and anything that has never run runs immediately so a fresh install is
not empty until 2am. 60 tests.

This phase also turned up a real concurrency bug in `withTransaction` that
predated it — see the changelog.

## Outside the phases — user administration ✅ done 2026-09-10

Not on the original plan, and it should have been. Until this, adding a second
person meant inserting a row by hand, which makes a multi-user product
undemonstrable. Add, edit, set roles, reset passwords, unlock. Administrators
only, and the server will not let the last administrator be removed.

## Phase 7 — Making it deliverable

> **Docker on the build machine.** Docker Desktop does not work here and is
> not to be reinstalled: something on this machine blocks AF_UNIX socket
> files, proven by those files still being undeletable after Docker was
> completely removed. Docker Engine runs inside WSL instead (`wsl -d Ubuntu`),
> which keeps its socket in the Linux filesystem and avoids the fault.

Turning a working application into something a customer can install:

- **Windows portable bundle** ✅ done 2026-09-10. `deploy/windows/build.ps1`
  produces a folder that runs on a machine with nothing installed: Node is
  bundled, the database is a file, and the secrets are generated on first run.
  42.7 MB zipped, 124.7 MB unpacked. Verified by copying it outside the repo
  and running it — first run created its own settings, migrated, seeded the
  pack, served the app, created the first administrator and took a backup.
- **Windows installer** ✅ done 2026-09-11. `deploy/windows/offset.iss`,
  compiled with Inno Setup 6.7.3 and installed and uninstalled silently into
  a scratch location. Data lives under ProgramData, because Program Files is
  read-only for ordinary users; the setup transcript is copied into the data
  folder; running as a background service is an unticked box; and uninstalling
  removes the application while leaving the database, the backups and `.env`
  exactly where they were — verified, not assumed.

  Compiling it for the first time found three faults, the worst being that a
  silent install cancelled itself: the running-copy prompt used `MsgBox`,
  which nothing can answer under `/SUPPRESSMSGBOXES`, so it defaulted to No.
  Unattended installation is how this gets deployed.

  Still unsigned. Windows will show "Windows protected your PC" until there
  is a certificate.
- **Licence verification** — **cancelled.** There is one edition and it is
  free: no licence key, no activation, nothing phoning home. `LICENSE_FILE`
  and `LICENSE_ENFORCE` are still in `config.ts` and should come out.
- **Air-gapped bundle** ✅ done 2026-09-11, ❌ removed 2026-09-24. Three
  delivery tracks was one too many to keep current, and the customer it was
  for - a server with no internet at all - was not one we have. Windows and
  Linux installers carry everything they need; Docker pulls its image.
  produces a folder holding the image, a compose file pointed at it rather
  than at a build, an install script, checksums, the licence and a restore
  procedure. 90 MB.

  Tested by pretending to be the target machine: the image is deleted
  locally first, checksums are verified as a recipient would, the bundle is
  installed, an administrator is created, a backup is taken, **the database
  is deleted**, and the restore procedure is followed literally. It passes
  when the administrator can still sign in afterwards.

  That drill found two faults that reading could not have. Backups taken by
  hand were written inside the container and died with it. And the restore
  procedure produced a database the application could read but not write, so
  everything looked healthy until somebody tried to sign in.
- **Logs and troubleshooting** ✅ done 2026-09-10. The API, the worker and
  the Windows launcher all write rotating log files; uncaught errors land in
  `crash.log`; the installer keeps its own transcript. Secrets and passwords
  are redacted so a log is safe to send. Documented in
  [logs and troubleshooting](../ops/logs-and-troubleshooting.md), which also
  records what runs when installed — and that it runs as a console
  application, not a Windows service.
- **Run in the background** ✅ done 2026-09-10. A scheduled task, registered
  by `deploy/windows/service/install-service.ps1`: starts at boot, runs with
  nobody signed in, restarts itself three times before giving up. Offered as
  an unticked box during setup and removed again on uninstall.

  **Not** an entry in services.msc, deliberately. A real service must talk to
  the Service Control Manager and `node.exe` does not, so it would mean
  shipping a wrapper such as NSSM or WinSW — a second unsigned executable
  whose job is launching other processes, which is the quickest way to have
  an unsigned download quarantined. Revisit if a customer insists, or once
  there is a code signing certificate.

  Runs as LOCAL SERVICE by default, with write access granted to the data
  folder and nothing else. `-Account System` is the documented fallback and
  the script suggests it by name when the limited account cannot start.
- **Community Edition naming** ✅ done 2026-09-10. The browser tab, the
  sidebar wordmark, the report footer, the Add or remove programs entry, the
  README and the health endpoint. The word comes from each product's pack, so
  all three say it and none can drift.

**Size:** large, and the least glamorous work in the project.

### On code signing

A publicly trusted certificate costs real money every year, and since June 2023
the key must live on hardware, so there is no free tier and no cheap trick.

**The Community Edition is free, so there is no revenue to fund one.** An
earlier version of this section said "buy it when the first paying Windows
customer appears". That trigger no longer exists, so unsigned is the default
state rather than a temporary one.

Costs, checked 2026-09-10 so they need not be looked up again:

- **One certificate covers all three products.** It binds to the publisher, not
  to a binary, so the cost does not multiply by three.
- **Azure Artifact Signing** (was Trusted Signing), the $9.99/month option
  usually recommended, is **not available in India**. Organisations are limited
  to the US, Canada, the EU, the UK, Australia, New Zealand, Japan, South
  Korea, Singapore, Switzerland, Norway and Israel; individuals to the US and
  Canada.
- The realistic route is **Sectigo EV through a reseller, about $280 a year**
  (roughly ₹25,000), which removes the SmartScreen warning immediately.
  Sectigo OV for an individual is about $220 but leaves the warning in place
  until download reputation builds.
- **EV requires a registered entity.** Sectigo is one of the last authorities
  still issuing certificates to an individual, so OV is the only route while
  unregistered.
- From 23 February 2026 certificates last at most 459 days, so this is a
  recurring bill either way.

**If the Community Edition goes open source, check SignPath's foundation
programme** — it provides free code signing to open source projects.
Unverified, but it is the difference between paying every year and paying
nothing.

What unsigned actually costs: Windows shows a "Windows protected your PC"
warning that the user must click through, some locked-down environments block
it outright, and antivirus is quicker to flag it.

Until this is resolved:

- The **Docker track needs no signing at all.**
- For early Windows testers, ship a **zip** rather than an EXE. There is no
  installer for SmartScreen to flag.
- **Build the installer unsigned.** Signing is one line in `offset.iss`
  (`SignTool=offset`) and the script does not otherwise change, so nothing is
  wasted by deferring it.
- For a **pilot inside one organisation**, their IT can trust a self-signed
  certificate through Group Policy. Fine for a controlled pilot, not for
  general distribution.

## Outside the phases — evidence attachments ✅ done 2026-09-11

The `evidence` table had `file_key`, `file_name`, `file_size` and
`file_sha256` from the first migration, the installer created an `evidence`
folder, and nothing ever wrote a file. "Evidence" meant a row describing a
document rather than the document, which is not what the word means to an
auditor asking to see one.

Upload, download and remove, with the checksum recorded. Three rules the
implementation is built around:

- **A filename never becomes a path.** It is attacker-controlled text. Files
  are stored under a key the server generates, sharded two characters deep;
  the name is kept as a label to display.
- **Nothing is served in a way a browser will run.** Always an attachment,
  always `application/octet-stream`, always `nosniff`. An uploaded `.html`
  rendered inline would execute on our origin with the viewer's session.
- **The size limit is a fact about bytes written**, not a promise in a
  header, and a file that exceeds it is deleted rather than left truncated.

When this was built, the nightly backup covered the database only, so
`evidence/` had to be backed up alongside it. **That is no longer so:** every
backup is now one file holding the database and every evidence document, and
the folder keeps the newest three (`BACKUP_KEEP`). Backups taken by an older
version still hold the database only.

## Phase 8 — Email

One item. **SSO was dropped on 2026-09-10** — it only ever existed to give an
Enterprise edition something to sell, and there is no Enterprise edition. The
three-layer test plan written for it is in this file's git history if it ever
comes back.

- **SMTP settings** ✅ done 2026-09-10. An admin-only Settings screen: mail
  server, port, STARTTLS or TLS, optional sign-in, from address, and whether
  to check the server's certificate. The password is encrypted at rest with
  `FIELD_ENC_KEY` (`lib/secrets.ts`, AES-256-GCM) and never leaves the server.
  A test button connects first and then sends, so "wrong password" and
  "no such recipient" are told apart. Turning email on while it could not
  possibly send is refused at the moment somebody is looking at the screen,
  rather than failing silently at 2am.

  Sending nothing stays a valid state, and that is enforced rather than
  hoped for: an install with no mail server behaves exactly as before.

- **The daily digest** ✅ done 2026-09-10. One message listing what needs
  attention: evidence out of date or coming due, overdue tasks and findings,
  policies due for review, and open risks in the top band, with readiness and
  its movement over the week as context. Runs after the readiness snapshot so
  the figure it quotes is today's.

  **It sends nothing when there is nothing to say.** That is the whole design:
  a message that arrives every morning reporting nothing is one people stop
  opening, and the day it matters they will not read that one either. The
  daily all-clear is available as a setting for anyone who wants proof the
  tool is alive.

  A preview shows what tonight's would say without sending it, because the
  honest way to decide whether to turn it on is to read one.

- **Account notifications** ✅ done 2026-09-11. A new user is told their
  account exists, where it is and what their username is; anybody whose
  password an administrator changes is told that it happened.

  **Neither message contains the password**, deliberately. Mail sits
  unencrypted on machines nobody here controls, is backed up, stays
  searchable for years and gets forwarded. A tool for managing information
  security should not be the thing that leaves a working credential in an
  inbox. The password still travels the way it should: out of band, from the
  administrator who set it.

  The password-changed message is the more useful of the two, and not for
  convenience: somebody who did not ask for it finding out is the only way an
  account quietly taken over by a rogue administrator gets noticed.

  Neither can break the operation it follows. Creating a user succeeds with
  the mail server off, unreachable, or refusing connections — tested for all
  three.

- **A one-time link to choose your own password** — not started, and better
  than both of the above. Needs a token table, an unauthenticated endpoint
  and a page to redeem it, which is a feature rather than a note.

## Definition of done

No item counts as finished until all of it is true:

- schema migration, applied cleanly from empty and idempotent on re-run
- API routes with RBAC enforced twice, and CSRF on every write
- every mutation writes an audit row
- tests covering the happy path and the refusals
- the screen, working, in all three products where it applies
- `CHANGELOG.md` updated, and an ADR if a decision was made

## Decisions needed

1. **Which product ships first.** Align is currently the default. Assure
   (ISO 27001) is the strongest fit for the author's own expertise, which
   usually matters more than technical readiness.
2. *(resolved 2026-09-11: Inno Setup 6.7.3 installed at user scope, no
   elevation needed. The installer compiles and has been tested.)*
3. *(resolved 2026-09-11: built and tested. It remains the narrower of the
   two offline options — the Windows installer needs no internet and no
   container runtime, so reach for this one only when the customer runs
   containers and cannot reach a registry.)*
4. **Code signing.** Deferred, and now without a revenue trigger. See Phase 7.

### Decided

- **2026-09-10 — no Enterprise edition.** Revisit around September 2027.
- **2026-09-10 — free to use, closed source.** `LICENSE` v1.0 written; the
  repository stays private.
- **2026-09-10 — SSO dropped.** No paid tier to sell it with. This also
  removes the need for a JDK and Keycloak on the build machine.
- Front-end approach: Preact and htm
  ([ADR 0003](adr/0003-preact-and-htm-for-the-front-end.md)).
- Report generation: pdfmake (Phase 5).

## Phase 9 — Get ready for every product

**Decided 2026-09-12.** The readiness plan ships with all four products, not
only Irtiqa.

It is the feature that changes who can use this. Everything else assumes
somebody already knows what a control programme looks like; Get ready is the
part that takes an administrator with no security team from a fresh install to
an assessed, evidenced programme. A customer buying Assure or Anchor needs that
every bit as much as one buying Irtiqa — arguably more, since 800-53 is 1,014
controls to stare at.

**None of it is engineering.** The engine, the screen, the automatic checks, the
printed plan and the exclusion flow are shared code already. What each product
needs is `packs/<product>/journey.json` and `"journey": true` in its
`pack.json`.

| Product | Framework | Status |
|---|---|---|
| Offset Irtiqa | SAMA CSF | done, 7 stages, 24 steps |

Copy `packs/ascend/journey.json` for the shape. The checks it names live in
`apps/api/src/journey/checks.ts` and none of them are framework-specific, so
they are reusable as they stand — a test fails the build if a pack names one
that does not exist.

The stages will differ. ISO wants an ISMS scope, a Statement of Applicability
and a management review; 800-53 wants a system boundary and a baseline chosen
before anything else. The shape — set up, decide scope, assess, write it down,
risk, evidence, keep going — should survive.

Budget roughly a day per product of writing, and do the plain-language control
explanations in the same pass, since both live in the pack and both are the same
kind of work.

## What this plan deliberately avoids

- Building the rest of the API before any of it has a screen.
- Starting the installer early. It is the last thing that changes and the first
  thing to rot.
- Building SSO before a customer has asked for it by name.
