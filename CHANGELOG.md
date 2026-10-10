# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Offset Irtiqa is versioned on its own, independently of the other Offset
products.

Every release is numbered x.y.z, for example 1.4.2:

| Change | Example | What it means for you |
|---|---|---|
| Last number | 1.4.2 → 1.4.3 | Fixes only. Safe to install at any time |
| Middle number | 1.4.3 → 1.5.0 | New features. Nothing you rely on is taken away, and your data moves across on its own |
| First number | 1.5.0 → 2.0.0 | Something works differently. This file says what, and what to do |

## [Unreleased]

### Removed
- **The offline Docker bundle.** It packed the image into a 133 MB folder for a
  server with no internet at all, and it was a third delivery track to keep
  current for a customer nobody has met. The Windows and Linux installers still
  carry everything they need, including Node, so neither needs a registry; a
  Docker install pulls its image like any other. `deploy/docker/build-airgap.sh`
  is gone, and the documents no longer offer it.

### Added
- **Security fixes from the pre-release assessment.** Encrypted secrets now require the full
  16-byte integrity tag. Fastify updated to 5.12.5 and fast-uri to a fixed release, and the
  development tools' vulnerable components pinned to fixed versions, so `pnpm audit` reports
  nothing. The Content Security Policy no longer allows fonts from other sites.
- **The risk picker lists every risk, with tick boxes,** instead of the first eight; search narrows
  it. A risk that is not in the register can be typed and added from the control's window.
- **Item windows can be made full size** with the button beside ×, remembered on this computer,
  or dragged larger by the bottom-right corner.
- **A risk is never in the register twice.** A second risk with the same title (ignoring case and
  spacing) is refused, naming the one that exists; the example data no longer re-adds a risk you
  already have; and the Risks screen points out any already there twice.
- **The version moved to the top of Help,** so the foot of the menu keeps only "Developed by
  Offset Security" and the contact address.
- **Linking evidence on the Golden thread, finished.** "Add new evidence" opens the control's own
  Evidence section, where an upload links itself, and returns to the thread. Old or undated
  evidence gets a "Link newer evidence" button. The picker says how many more there are
  ("and 42 more. Type to search them.") and no longer offers evidence already linked.
- **The menu header is centred:** the product's icon in a soft tile, its name and standard beneath.
- **More tests.** A database built as four older versions left it is upgraded and checked row by
  row. Every register screen is added to, edited and deleted from in a real browser. An
  "Upgrade test" workflow (run by hand) installs an older release on a clean Windows machine,
  adds data, installs the newer one over it and checks nothing was lost. Screen tests now run
  on every push. Tests that waited on email or Word documents no longer time out on a busy machine.
- **Each product leads with its own name and icon.** The top of the menu now shows the
  product's icon and name, with its standard underneath. The foot says "Developed by Offset
  Security" and gives the contact address, above the version.
- **A Golden thread strip in every control's window.** At the top: the risks it treats, the
  control, and its evidence, green when linked and red when broken. Click a red box to fix it.
- **Link risks from the control's own window.** "No risk linked" opens a picker right there;
  tick the risks the control reduces and save. The risk register shows the same link.
- **"Check again" says it checked**, and the list rechecks by itself when evidence or a test
  is added in the window.
- **The Golden thread's fix buttons open the exact item.** "Name an owner" opens that control
  or risk with the Owner box selected; "Open the risk" opens it with its Controls box ready;
  old evidence opens with its Collected date selected. Closing it goes back to the thread.
- **Screen tests.** `pnpm --filter @offset/screens test:screens` runs the product in a real
  browser: first run, sign-in, every screen, Risks and the Golden thread, the control window,
  the fix links and the documents.
- **The SAMA document set, 01 to 34, filled in inside the product.** Policies → Templates
  now has 34 original documents covering every SAMA subdomain: governance and the committee
  charter, strategy, policy, roles, risk, compliance, audit, the operations and technology
  standards, incident, threat and vulnerability management, third parties and cloud, the
  SAMA approvals register, continuity and acceptable use. **Fill in** asks for the
  organisation, the CISO and the committee chair once; risks, assets, incidents, suppliers,
  training and audits are taken from their screens. Anything unanswered stays yellow.
- **Golden thread is a tab of Risks.** Risks now has three tabs: Register, Sample library
  and Golden thread. It left the Start menu. Old links to it still work.
- **"How to fix this" on every control.** A control's window now opens with a short list of
  what is missing: no owner, no evidence or evidence too old, not linked to a risk, never
  tested, no reason in the Statement of Applicability, no due date. Each has a button that
  takes you to the place to fix it. It is the Golden thread's verdict for that one control.
- **Sample risks keep their controls.** A risk added from the Sample library is linked to the
  controls the library names for it, so the Golden thread shows it treated at once. Risks
  added earlier get a one-click **Link them to their controls** on the Golden thread.
- **A reset-password file for administrators.** Windows has **Reset administrator
  password** in the install folder and the Start menu; Linux has
  `/opt/offset-<product>/reset-password.sh`. Run as administrator, it prints a temporary
  password that works once, for 30 minutes.
- **signin.log.** Every refused sign-in, lock-out and blocked address is written to
  `logs/signin.log`, one plain line each, never with the password.
- **A failed install leaves its log behind.** On Windows the setup program saves
  `logs\install-failed-<date>.log` and says where it is. On Linux everything the installer
  prints is kept in `/var/log/offset-<product>-install.log`.
- **The Golden thread now shows green for what is satisfied**, as well as red for what
  is broken and amber for what is weak.
- **Get ready shows the next step.** A box at the top names the one thing to do
  now, why, and what comes after, with the buttons to do it. The stages are
  drawn as rings that fill as steps are done and turn green with a tick when a
  stage is finished. **Nearly there** lists checks that are almost passing. The
  long introduction moved behind **How this works**.
- **Link a control to a risk from the risk register and from the Golden thread.**
  The risk form had no way to say what treats a risk, so the Golden thread's
  "nothing treats it" had no fix. The form now has a searchable picker, and the
  Golden thread's details panel links controls to a risk, and existing proof to
  a control, in place. The picker filters as you type, so it copes with 1,014
  controls.
- **Get ready names the template to start from.** A step that is a document in
  Policies, such as the ISMS scope or the internal audit procedure, now says so,
  names the template, and has **Open the template**, which opens Policies on its
  Templates tab.
- **Golden thread**, a new screen under Get ready: every risk, every control
  and every piece of proof in one map, joined by lines. A risk with nothing
  treating it, or a control claimed with no proof, shows as a red dashed line;
  proof over 90 days old or undated, or a control with no owner, as amber.
  Point at anything to trace its thread, click for the details, or show only
  the problems. Get ready shows how many links need fixing.
- **Upload an HTTPS certificate on the Settings screen.** Settings → HTTPS
  certificate takes the `.pfx` file (with its password) or the PEM certificate
  and key that a company's IT team hands over, checks it, and puts it to use.
  No file paths and no editing the settings file. It shows who the certificate
  is for, who issued it and when it expires, and warns 30 days before. Anything
  worth knowing - issued for a different name, self-signed, about to expire -
  is shown before it replaces a certificate that works. A server already on
  HTTPS starts using a new certificate at once, so renewing it needs no
  restart. With HTTPS on, plain `http://` on the same port is redirected to
  `https://`, so old links, bookmarks and the Start menu shortcut keep working.
  This is what stops the browser saying "Not secure", and it costs nothing:
  the certificate comes from the company's own certificate authority.
- **Every control explains itself.** Open a control and the top of it says
  what it is in plain words, what to do about it, what an assessor or auditor
  will look for, and which records prove it. A test fails the build if any
  control has no explanation.
- **An Audit trail screen**, for administrators and auditors. The help pages
  always said the Auditor role reads the audit trail; until now nobody could,
  short of opening the database. Newest first, with search and filters by
  person, action and dates; click an entry to see what it changed, field by
  field, before and after; **Download CSV** for an auditor, which is itself
  recorded. Read only, and it says so. Anything in an entry that looks like a
  password, key or token is hidden, and a downloaded cell that starts like a
  spreadsheet formula is made plain text. Contributors and read-only users do
  not see it: it holds failed sign-ins and addresses. Three endpoints under
  `/api/v1/audit`.
- **A limit on failed sign-ins from one address.** Twenty in fifteen minutes,
  to any accounts, block that address for fifteen minutes, checked before any
  account is looked at. Before, one address could try a few passwords against
  every account and lock them all out on purpose. Only failures count, so an
  office signing in from one address is unaffected.
- **Documents for customers and for the people building the product.** A
  security overview for a customer's security team, ready answers for security
  questionnaires, a privacy sheet listing every kind of personal data held and
  how long it stays, and a one-page datasheet. For the team: an API reference
  covering all 121 endpoints, and a threat model with what stops each threat,
  plus the known gaps in order. Every claim was checked against the code, and
  the gaps are stated as gaps: no multi-factor sign-in, no single sign-on, and
  nothing encrypted at rest by the product. The security overview and the
  privacy sheet also go in the `docs` folder of every installer and bundle.
- **Help and Documentation**, which this product did not have. Ten pages each:
  five short answers and five guides, written for the product rather than
  copied. Each names only screens that product has, points its cloud-evidence
  tables at SAMA control numbers, and has its own playbook: the maturity scale
  and the road to level 3. A test now fails the build if any product's help
  sends the reader to a screen its menu does not have.
- **The documents in every installer and bundle.** Windows, Linux and Docker
  each carry a `docs` folder: the user guide, the install guide, the technology
  page, the troubleshooting guide, the README and the changelog, with their
  links rewritten to work inside the folder (`deploy/bundle-docs.mjs`). The
  Windows installer adds a Start menu shortcut to it; the Linux installer copies
  it to `/opt/offset-<product>/docs`; the Docker bundle's checksums now cover
  files in sub-folders too.
- **A new menu.** It floats beside the page with rounded corners, in a lighter
  navy, and is split into groups: getting started, the framework, the
  day-to-day work, the registers, administration, and Documentation then Help
  at the end. Every item has an icon. A button at the top shrinks it to icons
  alone, with each name shown when you point at an icon; the browser remembers
  the choice. The logo in it is now a single colour, so it stays sharp on the
  dark background.
- **A button that builds one product's Docker images** (`Build a Docker image`
  on the Actions tab, `.github/workflows/docker-image.yml`). Pick the product
  and a version, and GitHub builds the application and its updater and stores
  them, private, in `ghcr.io/offsetsecurity`. For putting an image on a
  machine before any release exists; a release still builds everything.
- **Four more automatic checks**, for what 800-53 asks and the other frameworks
  do not: the system named, described and bounded; a baseline applied and the
  catalogue scoped; a value against every organisation-defined parameter on the
  controls in scope; and who implements each control.
- **Ten new automatic checks** for the plans: a reason against every control in
  the Statement of Applicability (inclusions as well as exclusions, as clause
  6.1.3 asks), an owner on every control that applies, the Statement exported,
  every policy approved with approver and date, a review date on every policy,
  the risk method written, an owner on every risk, every risk being reduced
  linked to a control, internal audit findings recorded, and every open finding
  with an owner and a due date. Evidence with a collected date is the tenth.
- **Architecture diagrams** in `docs/dev/architecture.md`, drawn in Mermaid so
  GitHub shows them as pictures.

- **Backups screen, for administrators.** Take a backup now, download one,
  upload one, restore one, delete one. A backup is now a single file holding
  the database and every evidence document, each document checked by SHA-256
  when it is restored. Restoring asks for RESTORE to be typed, takes a backup of
  the present first, swaps the data while the product keeps running (every
  other request gets a 503 for those seconds), runs any migrations the backup
  is behind on, and signs everybody out. A file is refused before anything
  changes if it is not SQLite, is damaged, is from another product, is from a
  newer version, or has no administrator who could sign in.
- **Forgot password? for administrators.** The sign-in page emails an
  administrator a temporary password that works once, for 30 minutes, and opens
  nothing but a page to choose a new password; the API refuses everything else
  until one is chosen. The real password keeps working until then, so nobody
  can lock an administrator out by typing their name into the form. The reply
  is identical whatever was typed, and the email is sent after it, so neither
  the words nor the timing reveal which accounts exist. Limited to five requests
  per address per 15 minutes and three emails per account per hour; a request
  whose email fails leaves nothing usable behind. It also works through an
  account lockout. Choosing the new password signs out every other session and
  sends a "your password was changed" email.
- **Change password** in the top bar, for anyone who knows their current one.
- **`dist/admin/reset-password.js`**, to issue the same temporary password at
  the server when email is not set up. See "Locked out" in INSTALL.md.
- **One-click updates from Settings → Updates**, for the Windows installer, the
  Linux installer and the Docker offline bundle. An administrator checks, reads
  what changed, and presses Update: a backup is taken, the release is
  downloaded and installed, and if the new version does not come up answering
  as itself the previous version and the database go back.
- **Releases are signed.** Tagging `vX.Y.Z` runs `.github/workflows/release.yml`,
  which builds every package, writes one manifest naming each file by SHA-256
  and each image by digest, signs it with Ed25519, checks the signature with
  the key compiled into the application, and publishes to the public
  `offsetsecurity/grc-suite-releases`. Built files only; the source stays
  private. See `docs/dev/releasing.md`.
- The web application never installs anything. It takes the backup and leaves
  a request; a separate updater with no web page does the install - a
  container holding the Docker socket, a root systemd unit started by a path
  unit, or a SYSTEM scheduled task - and each takes its release settings from
  somewhere the application cannot write. Updates only go forward, only to the
  signed latest release, and nothing contacts the internet until an
  administrator asks.
- The Docker updater is off unless `COMPOSE_PROFILES=updates` is set, because a
  container with the Docker socket is a decision about the host; the offline
  bundles set it. Adds two volumes, `update-requests` and `update-status`.
- The reported version is now the real one on every kind of install (`version.ts`),
  rather than a hard-coded 0.1.0 wherever `APP_VERSION` was not set.
- **A sample library for the asset and risk registers**, as a sub-tab on each
  rather than a screen of its own: samples are a way of filling in a register,
  not a separate thing to manage. 98 assets and 22 risks for Irtiqa - the
  generic material every organisation has, plus the financial-services set, plus
  Saudi-specific entries written for this pack: SARIE, mada, SPAN, SWIFT, HSMs,
  SIMAH, the SAMA reporting interface, in-country hosting. Adding copies a row
  into the register and nothing more; it is then theirs to edit or delete, with
  no tether back to the library.
- The risk half grew from 22 to **43** after a review against the framework:
  eleven subdomains had nothing against them at all, including the two that
  cause most real breaches - an unpatched critical vulnerability, and a supplier
  breached with your data. The mix was also ten-of-twenty-two Compliance, which
  reads like a list written by a compliance officer rather than by somebody
  thinking about what could go wrong; it is now weighted towards Security and
  Operational. Every one of the 24 subdomains has at least one sample risk, and
  a test fails the build if that stops being true or if a sample points at a
  control that does not exist.
- The five other sectors in the source material — healthcare, manufacturing,
  government, education, automotive — were deliberately left out of Irtiqa. SAMA
  regulates financial institutions, so a hospital would never use this product.
  They remain available for the three frameworks that are not sector-restricted.
- **Evidence is chased too.** It already carried an owner and a next review
  date, but the date was only ever a colour on screen, so proof could pass its
  review and sit stale for a year with nobody told. An email address goes beside
  the review date, and the same reminder schedule applies. That makes four
  things that can be chased — controls, tasks, plan steps and evidence — all
  carrying the same pair of fields and answering to the same job.
- **Reminders now cover tasks and readiness-plan steps, not only controls**, and
  go out on three days rather than every day: three days before the date, on the
  date, and then while the thing is still outstanding. A daily drip from the
  moment something is created teaches people to filter the sender, and then the
  one that mattered goes unread too. Tasks gained an email address; plan steps
  gained an owner, an address and a date, and keep them while outstanding, which
  is exactly when chasing matters.
- **A Linux installer.** `deploy/linux/build.sh` produces
  `offset-<product>-<version>-linux-x64.tar.gz` and `install.sh` puts it in as
  two systemd services, the application and its worker: their own locked-down
  account, the application under `/opt`, the data under `/var/lib`, secrets
  generated on the machine. An upgrade stops both, replaces the application,
  restarts them and never touches the data. Node is bundled, as on Windows, so
  the server needs nothing installed first. The two native modules are compiled
  on RHEL 8 rather than downloaded, because npm's prebuilt SQLite driver needs
  glibc 2.29 and crashed the service at start on RHEL 8, which has 2.28 and is
  what much of the target market runs. Tested by installing, upgrading and
  removing it on Ubuntu 22.04 and 24.04, Debian 12, RHEL 8 and 9, Amazon Linux
  2023 and openSUSE Leap 15.6, each booted with systemd.
- **docs/dev/product-parity.md**, which records what each of the four products
  has, what the other three are still owed — a readiness plan and plain
  explanations — and the rule that there is one shared set of documents rather
  than one per product.
- **A plain explanation on every control.** All 159 open with what the thing
  actually is, in a manager's words rather than an engineer's, above the
  maturity wording. A control used to open with its own title restated as
  "Item 42 of 159", which taught nobody anything.
- **Evidence attaches to a control, from the control.** You could link proof
  from the Evidence screen but not from the control - which is backwards, since
  the control is where somebody sits when they realise they need it. Three ways
  in: upload a file, link something already recorded, or record proof that lives
  outside the product. The same records the Evidence tab lists, so the two
  cannot drift apart.
- **A due date and an owner's email on each control, and a job that chases
  them.** One email per person, listing only their own controls, overdue first
  and anything due within a week alongside. Nothing is sent until somebody has
  filled in both fields: a product that starts emailing people on its own is a
  product that gets switched off. The register gains a Due column, amber as a
  date approaches and red once it has passed.
- **159 controls, not 32 subdomains.** The pack carries four domains, twenty-four
  subdomains and the 159 individual controls beneath them - 183 rows in all,
  scored 0 to 5 like everything else.
- The numbering is a working list rather than a quotation. SAMA writes
  principles and control considerations per subdomain and does not publish a
  canonical 1-to-159 sequence, so the pack's source note says plainly which part
  is the regulator's and which is ours. Every control title and every line of
  guidance is written by us.
- The readiness plan was rewritten to match. It used to point people at
  "subdomain 3.1.1 Cyber Security Governance"; under the new numbering 3.1.1 is
  an access control, and a plan that sends somebody to the wrong control is
  worse than one that names none.
- **Superseded: the earlier SAMA-numbered tree.** The pack was 32
  subdomains; it is now 32 subdomains and 141 control considerations beneath
  them, 173 items in all. Numbering follows the SAMA Rulebook, because an
  assessor works by number and ours have to match theirs. Every control title
  and every line of guidance is written by us - none of SAMA's text is
  reproduced.
- Risk management nests one level deeper than the rest: 3.2.1 has four named
  sub-sections and their considerations sit at the fifth level. Nothing needed
  changing to support that, because a control's parent is a ref rather than a
  level number.
- **Offset Ascend is now Offset Irtiqa**, for the Saudi market. Irtiqa is the
  Arabic for ascent, so the name it replaces is the name it translates. The
  spelling is Latin throughout - on screen, in the reports, in the installer -
  which keeps one name everywhere and keeps the PDFs working: their fonts are
  Latin-1 and turn anything else into a question mark. The build flag, the
  folder and the pack id stay `ascend`; nothing a customer sees mentions it.
- **Get ready: a readiness plan for customers with no security team.** Seven
  stages of plain-English steps, from setting the product up to keeping it
  going. Each step says what to do, why it matters, and links to the screen
  where it is done, because "improve your governance" is advice and "open
  People and add your colleagues" is an instruction.
- Steps come in two kinds and the screen says which. Thirteen of them the
  product checks against its own data and turns green on its own, with the
  shortfall spelled out {EM} "30 of 32 answered", "no backup has completed yet".
  The rest are ticked by a person, because no software can see whether a board
  approved a policy. Hand-ticking an automatic step is refused rather than
  stored and ignored.
- Nothing is locked. Stages carry a suggested order and a suggested next, and
  every one of them is reachable at any time: software that refuses to let
  somebody write their policies before finishing an assessment is software they
  stop opening.
- Any step can be excluded, and an exclusion needs a reason. Excluded steps
  leave the denominator rather than sitting outstanding forever, and an
  exclusion beats an automatic check {EM} a check that kept turning a deliberately
  excluded step green would be arguing with the customer about their own
  business.
- Subdomains can be excluded the same way, with **Does this apply to you?** in
  the subdomain and a reason beside it. An excluded subdomain leaves every
  maturity figure {EM} the average, the percentage, the spread, the per-domain
  table {EM} rather than counting as nought. Its score is kept, so changing your
  mind does not cost you the assessment.
- **Readiness plan** report: where each stage stands, what is still to do, what
  was excluded and why, and who decided each step.
- The plan is pack content (`packs/ascend/journey.json`), not code, so the
  wording changes when the framework does without a migration. A test fails the
  build if the pack names a check that does not exist, which would otherwise
  turn an automatic step into a manual one in silence.
- **Offset Ascend** — a fourth product, for the SAMA Cyber Security Framework:
  4 domains, 32 subdomains, and a maturity model scored 0 to 5 instead of a
  status. Pack numbers and titles follow SAMA's published framework; all
  guidance wording is original to Offset Security, and the product carries a
  notice that it is not affiliated with or endorsed by the Saudi Central Bank.
- Maturity scoring. `controls.maturity` and `controls.target_maturity` are real
  nullable columns, validated 0-5 by the API. Null means nobody has assessed the
  item, and every average excludes those rather than counting them as nought:
  treating "not looked at" as "does not exist" makes the first week of an
  assessment look like a catastrophe. Level 3 is the target unless a subdomain
  carries its own.
- The screens read the same data two ways, chosen by the pack. The register
  filters and scores by level rather than status; the dashboard shows "at or
  above target" and an average in place of readiness and evidence gaps, bars by
  domain, and a donut of the six levels; the readiness trend records the share
  at target where anything is scored and the share implemented where nothing is.
- **Maturity assessment** report: every item with its level, target and gap, the
  spread across the six levels, a per-domain summary, and the scale itself
  printed on the front so a reader who never saw the screen can follow it. The
  gap report and executive summary change contents — and their descriptions —
  on a scored framework.
- The pack's written guidance now appears in the control dialog: what the
  control is for, what level 3 looks like in practice, and what an assessor will
  look for. Scoring something out of five is guesswork without it.
- P0 scaffold: pnpm monorepo, Fastify API, database schema and migration runner,
  local authentication with Argon2id, session store, RBAC middleware,
  append-only audit log, health endpoint.
- Controls, evidence and risk APIs with summary endpoints, plus an end-to-end
  test suite covering auth, CSRF, RBAC and the audit trail.
- Brand assets and generated icon set.
- Executive dashboard: readiness, risk and evidence KPIs, per-function
  readiness bars, a coverage radar, a status donut and the top risks.
- Controls register with live filtering and in-place editing of status and
  owner, rolled back if the server refuses the change.
- Evidence register: the 30-60-90 freshness strip, filtering, and a picker for
  linking evidence to the controls it proves.
- Risk register: the 5x5 likelihood-by-impact heat map, band and status
  breakdowns, and add/edit/delete with the accepted-risk rule enforced in the
  browser as well as the server.
- Asset, policy, task, incident and finding registers — schema, API and screens.
  Field lists follow the standalone HTML tools so existing data maps across.
- Policy document control: changing a version archives the one it replaces,
  with a change note, and the history is shown on the policy.
- A closed finding must say what was done, enforced in the browser and again on
  the server.
- Programme-level settings API, and an SP 800-53B baseline operation that
  applies a whole baseline in one transaction with one audit entry.
- Control detail dialog, showing the fields this product actually uses. Which
  ones appear is decided by the pack's feature flags, not by three components.
- The dashboard adapts to the size of the framework: six CSF Functions get the
  radar, twenty 800-53 families get a readiness grid and a weakest-first list.
  A family with nothing in scope reads as excluded, not as zero progress.
- PDF reports with a Download button on each: executive summary, gap report,
  risk register and evidence register. Long tables paginate with a repeating
  header, and every page carries the Offset Security wordmark, who generated
  it, when, and the page number.
- Every export writes an audit row, so "who took a copy, and when" is a
  question the log can answer.
- A customer can put their own logo on their reports, from the Reports screen.
  It leads the header, where an auditor expects the audited organisation, and
  Offset moves to the footer as "Produced with...". Any shape is scaled into a
  fixed box, so a square mark and a wide banner both sit in the same space
  without being stretched or colliding with the title. A file the PDF engine
  cannot draw is refused at upload rather than breaking every later export.
- Reports carry the logo at letterhead size on the first page and a small mark
  in the running header on the rest, so it has presence where someone looks for
  it without costing space on page seven of a table.
- Background worker (`pnpm --filter @offset/api worker`): daily readiness
  snapshot, which is the only history the product keeps; nightly backup with
  pruning; WAL checkpoint on a schedule; session, job-log and optional audit
  purges. Admin can see what ran and what is due at `/api/v1/jobs`.
- People screen: add colleagues, set roles, reset passwords, unlock accounts.
  Administrators only. Accounts are disabled rather than deleted so the audit
  log keeps its answers, disabling ends that person's sessions immediately, and
  the server refuses anything that would leave the instance with no
  administrator — including an administrator demoting themselves.
- Windows bundle: `deploy/windows/build.ps1` produces a self-contained folder
  that runs with nothing installed — Node included, database as a file, secrets
  generated on first run. An Inno Setup script wraps it for a proper installer.
- `pnpm db:backup` — hot backup to a single file via SQLite's online backup API.
- Log files. The API and the worker write to `logs/` as well as the console,
  rotating at 10 MB and keeping five generations, so an installed copy still
  has an account of itself after the window is closed. Passwords, hashes,
  cookies and both secrets are redacted, because a log is the one artefact a
  customer is asked to email to a stranger.
- `crash.log`: uncaught exceptions and unhandled rejections are recorded with
  their stack before the process exits. Neither was handled at all before, so
  a crash left nothing behind.
- `launcher.log` on Windows, which captures what the two processes print as
  they fail. A bad `.env` kills the API before its logger exists, so this is
  the only place that reason was ever recoverable.
- The installer keeps its own transcript: `SetupLogging`, copied to the data
  folder at the end, plus a Start Menu shortcut to the logs folder.
- A start-up line recording product, version, Node, platform, port, database
  path and log folder — the questions support asks first.
- `docs/ops/logs-and-troubleshooting.md`: what runs when installed, where
  every file lives, what each log means, and the symptom-to-cause table.
  States plainly that the two processes are **not** Windows services, so they
  do not start at boot and stop when the user signs out.
- **Community Edition.** One edition, free to use, closed source. Named where
  a user sees it: the browser tab, the sidebar wordmark, the report footer,
  the installer entry in Add or remove programs, the README and the health
  endpoint. The word comes from the product’s pack, so everything says it and
  none of it can drift.
- **A real licence.** `LICENSE` replaces the placeholder that said
  "PROPRIETARY AND CONFIDENTIAL — PLACEHOLDER" and would have been shown to a
  customer mid-install. Free to install anywhere, for any purpose, for any
  number of people; no modifying, reverse engineering, re-branding, selling or
  running it as a service for others. It states explicitly that adding your own
  logo to an exported report is permitted, so the licence does not forbid a
  feature the product ships.
- The licence now travels with the product: copied into the Windows bundle as
  `LICENSE.txt` and installed alongside the application. The installer shows
  the same file it installs, so the two cannot disagree.
- A copyright line in the sidebar footer and on every page of every report:
  © 2026 Offset Security · Community Edition.
- **Outgoing email.** An administrators-only Settings screen for an SMTP
  server: host, port, STARTTLS or implicit TLS, optional sign-in, from
  address, and whether to verify the server's certificate. Nothing is sent
  until it is turned on, and an install with no mail server works exactly as
  before — which is the normal case on-premise.
- A **test button** that connects and then sends, so "the server rejected
  your password" and "that recipient does not exist" are different messages
  rather than one generic failure. Mail library errors are translated into
  something an administrator can act on.
- Turning email on while it could not possibly send is refused while somebody
  is still looking at the screen, instead of failing quietly the first night
  it was needed.
- **Field encryption** (`lib/secrets.ts`): AES-256-GCM under `FIELD_ENC_KEY`,
  which was declared at the start of the project and never used. The mail
  password is stored with it, never returned by the API, never written to the
  audit trail, and a rotated key loses the secret rather than breaking the
  product.
- Tests run a **real SMTP server** on a random port and assert the message
  arrives. Asserting that the mail library was called would prove nothing
  about whether anything leaves the process.
- Known-good mail settings for Resend, Amazon SES, Google Workspace,
  Microsoft 365 and a plain internal relay, with the two things that cause
  most first-time failures stated up front: the "from" domain usually has to
  be verified, and the password is almost never the account password.
- A **mail provider** choice. Picking Resend reduces the form to an API key
  and a from address; the host, port, encryption and the username `resend`
  are filled in by the server, not the browser, so a stale tab cannot offer
  an API key to somebody else's mail server. Changing provider forgets the
  old secret, because a mail password is not an API key and silently reusing
  one would fail unreadably. "Any SMTP server" remains the default.
- **Running in the background on Windows.** `install-service.ps1` registers a
  scheduled task that starts at boot, runs with nobody signed in, and restarts
  itself if it stops. The installer offers it as an unticked box and removes it
  again on uninstall. Not an entry in services.msc: that would mean shipping a
  second unsigned executable whose job is launching processes, which is how an
  unsigned download gets quarantined.
- The service runs as LOCAL SERVICE, granted write access to the data folder
  and nothing else. `-Account System` is a documented fallback rather than the
  default, because a web application with complete control of the machine is a
  poor default for a security tool.
- The installer verifies rather than assumes: it starts the task, waits for the
  health endpoint, and names the log to read if nothing answers.
- `start.js` takes `--data-dir` and `--service`. A scheduled task cannot set an
  environment variable for its action, and an installed copy cannot fall back to
  sitting beside the application because Program Files is read-only.
- **Docker: a compose stack that runs both halves.** The image only ever ran
  the API, so a container install had no nightly backup, no readiness history
  and no housekeeping, and nothing said so. `deploy/docker/compose.yaml` runs
  the worker from the same image with a different command, sharing all four
  volumes, because it is one SQLite file.
- Volumes for backups and logs, not only the database. Both were written
  inside the container and died with it, which made the backup worse than
  useless: it looked like it was working.
- `deploy/docker/README.md` and `env.example`, including the reason the
  published port is bound to 127.0.0.1 — the product terminates no TLS of
  its own.
- **The daily digest**, the job deferred from Phase 6 that was waiting for a
  mailer. Evidence out of date or coming due, overdue tasks and findings,
  policies due for review, open risks in the top band, and readiness with its
  movement over the week.
- It sends **nothing** on a day when nothing needs attention. A message that
  arrives every morning reporting nothing is one people stop opening, and the
  morning it matters they will not read that one either. The daily all-clear
  is a setting for anyone who wants proof the tool is running.
- A preview of today's digest that does not send it, because the honest way to
  decide whether to turn it on is to read one first.
- Turning the digest on before email works, or with nobody to send it to, is
  refused while somebody is looking at the screen.
- An empty recipient list means every enabled administrator with an email
  address, so it survives people joining and leaving without a second list.
- **A Windows installer that has actually been compiled.** Inno Setup 6.7.3,
  installed and uninstalled silently end to end. Uninstalling removes the
  application and leaves the database, the backups and `.env` untouched, which
  is the entire point of that section and had never been run.
- **Account notifications.** A new user is told their account exists, where
  to find it and what their username is. Anybody whose password an
  administrator changes is told it happened, and told to question it if they
  were not expecting it — which is the only way an account quietly taken over
  by somebody with administrator access gets noticed.
- **Neither message contains the password.** Email is stored unencrypted on
  machines nobody controls, backed up, searchable years later and forwarded.
  Both messages say so, so nobody helpfully adds it later. A test asserts the
  password's absence, including after quoted-printable line folding.
- Neither notification can break the operation it follows: creating a user
  and resetting a password both succeed with the mail server off, unreachable
  or refusing connections.
- **An offline bundle**, for a machine with Docker and no route to a
  registry: the image, a compose file pointed at it, an install script that
  generates its own secrets and verifies checksums, the licence, and a
  restore procedure written for the day it is needed. 90 MB.
- It is tested by being installed. The drill deletes the image locally,
  installs from the bundle, creates an administrator, takes a backup,
  destroys the database and restores it — and only passes if somebody can
  still sign in at the end.
- **Documents can be attached to evidence.** The schema has had columns for
  a file since the first migration and nothing ever wrote one, so "Evidence"
  meant a row describing a document rather than the document itself. Upload,
  download and remove, with a SHA-256 recorded for each.
- Files are stored under a key the server generates, never under the name the
  browser sent: a filename is attacker-controlled text and must not be able
  to become a path. Tested with traversal attempts, absolute paths, NULs and
  embedded newlines.
- Downloads are always an attachment, always `application/octet-stream`, and
  always `nosniff`. An uploaded `.html` served inline would run on our own
  origin with the viewer's session.
- **The nightly backup still covers the database only.** Documented in three
  places, because a restore that brings back every evidence record pointing
  at a missing file is a bad morning.
- The Docker image carries the licence, not only the installer.

### Changed
- **Node.js 24 instead of Node.js 20.** Node.js 20 stopped receiving security
  fixes on 30 April 2026, and the Windows and Linux packages were still
  shipping 20.11.1. Every package now runs on Node.js 24.21.0, which is
  supported until April 2028: the Docker images, the Windows and Linux bundles,
  CI and the release build, all pinned in `.nvmrc`. All 296 tests pass on
  Node.js 24, and a Windows bundle built with it starts, opens its database and
  answers.
- **better-sqlite3 13, the database driver, instead of 11.** Node.js 24.19 and
  later abort the process when the garbage collector frees a database object
  from any driver built on Node's older `ObjectWrap` interface and compiled
  with their headers, which is what better-sqlite3 12 is
  ([nodejs/node#65446](https://github.com/nodejs/node/issues/65446)). The
  ready-made 12.x drivers were compiled before 24.19 and escaped it; the Linux
  build compiles its own on RHEL 8, and that bundle aborted at its first start.
  Version 13 is built on Node-API, which the fault cannot reach however it is
  compiled. It carries ready-made drivers for Windows, Linux and Alpine in the
  package, so pnpm is told never to compile it; the Linux build still compiles
  it on RHEL 8, because its ready-made Linux driver needs glibc 2.34 and RHEL 8
  has 2.28, and removes the ready-made ones so that is the one that loads. The
  JavaScript interface is unchanged, and all 296 tests pass on it.
- **Newer test and build tools.** vitest 2.1.9 to 4.1.11, vite 5.4.21 to
  7.3.6, and esbuild 0.24.2 to 0.28.2. The old ones had known security
  problems, one rated critical and one high, and GitHub's security scan
  failed the build on them. None of them ships in the product; they only test
  it and bundle the web page. All 296 tests pass on the new ones, and the page
  they bundle is the same size.
- **The builds can no longer ship the wrong Node.** The Windows build used the
  build machine's own `node.exe` and the Linux build its version, which is how
  Node.js 20 stayed in long after its support ended. The Linux build now reads
  `.nvmrc`. The Windows build refuses to package any other version, and runs
  `npm install` on the Node it bundles, so the database driver it fetches is
  the one that Node can load.
- **Three backups, not fourteen.** The folder now keeps the newest three
  backups in all, counting every kind together: nightly, taken by hand, made
  before an update or a restore, and uploaded. Before, it kept fourteen nightly
  ones and every other kind until somebody deleted it, and each is a full copy
  of the evidence as well as the database. The check runs every time a backup
  is made. It never deletes the backup just taken, nor the undo copy and the
  source of a restore. `BACKUP_KEEP` still sets the number (1 to 365). The
  settings files new installs start from say 3; existing installs keep whatever
  their own settings file says.
- The Statement of Applicability now asks why an included control applies,
  rather than calling that reason optional.
- Irtiqa's backup step in Get ready points at the Backups screen.
- Email placeholders read `name@yourcompany.com`, not `name@yourbank.com`.
- "Linked to a subdomain" in the evidence check now uses this product's own
  word.
- **Database is now SQLite instead of PostgreSQL 16.** The target deployment is
  under 50 users, which does not need a client/server database, and an embedded
  one removes a service to install, patch and back up on customer hardware.
  Backup and restore become a file copy. See
  [ADR 0002](docs/dev/adr/0002-sqlite-not-postgres.md), superseding ADR 0001.
- Job queue moved from `pg-boss` to a `jobs` table with a polling worker.

### Changed
- **"Community Edition" removed from the product.** You name an edition to tell
  it apart from another edition; there is only one, so the label said nothing
  and invited the question it could not answer. It is gone from the sidebar, the
  footer, the browser title, the report footers, the installer and the Docker
  labels. The field stays in the pack, empty, so a second edition would be one
  string rather than a change to every pack and every report.

### Fixed
- **Updating in place on Windows failed, and the rollback then made it worse.**
  The installer stopped with "DeleteFile failed; code 5" on a file it could not
  replace, and putting the old version back died on a locked `offset.db-wal`,
  leaving the database neither updated nor restored. Stopping the application
  had matched processes by how they were started, so a copy started by any
  other Node survived and kept files open. Anything with a file open in the
  install folder is now stopped, whatever started it; whatever refuses is named
  in `updater.log`; and a rollback waits a few seconds for Windows to let go
  of a file instead of giving up on the first try.
- **Anyone could choose the address the audit trail recorded.** The server
  believed an `X-Forwarded-For` header from every caller, so a person could
  write any address they liked into the trail, and step round any limit that
  counts by address. It is now believed only from a proxy on the same machine,
  or from the proxies named in the new `TRUST_PROXY` setting; the Caddy stack
  in `deploy/compose` names its own network.
- **The menu disappeared in a narrow window.** Below 820 pixels wide it was
  hidden, leaving a phone or a half-screen window no way between screens. It
  now shows as icons there, the page beside it fits the width, and a wide
  table scrolls inside its card.
- A download link styled as a button (Backups, Audit trail) looked like an
  underlined link inside a box.
- **A Get ready step described something that was not so.** The risk stage
  named section 3.2, SAMA's own numbering for risk management; in this product
  risk management is 1.7 and 3.2 is operations security.
- **Windows and Linux bundles could install untested library versions.** They
  are installed with npm, which ignores pnpm's lockfile, so each build took
  the newest version inside each range. On 2026-09-17 that was @fastify/static
  10.1.4, whose new dependency Node 20.11 cannot load, and the Windows bundle
  built that day would not have started. `deploy/runtime-manifest.mjs` now
  pins every package, direct and beneath, to the version pnpm installed and
  the tests ran against. The Windows build also loads every dependency with
  the Node it ships before packaging, as the Linux build already started the
  app.
- **The Linux build failed on a Windows machine with Docker Desktop.** It passed
  Docker a Git Bash path, which Docker Desktop mounted as an empty folder.
- A refused update download could leave an empty file behind. When the first
  chunk was already too large, the file was deleted before the stream had
  finished creating it. It now waits for the stream to close first.
- The Get ready diagram fits each stage name to the space it has, over up to
  three lines, so eight stages no longer run into each other.
- **Rate-limited requests answered 500 "Something went wrong".** The error
  handler turned the limiter's 429, and any other refusal Fastify raises with
  its own status, into a server error. 4xx statuses now pass through.
- The test email's subject is now "Test Message".
- **Security: `@fastify/static` upgraded from 8.3.0 to 10.1.3** for
  CVE-2026-15074 (HIGH), a route guard bypass by path traversal in the
  component that serves the web interface. Version 10 hands `setHeaders` the
  Fastify reply rather than the raw response, which would have made every page
  and bundle request fail; the cache header code is updated for it, and a new
  test pins the cache headers and tries eight ways of spelling a path outside
  the web root.
- **The security scan had not run for as long as nobody noticed.** It named
  `aquasecurity/trivy-action@0.24.0`, a tag since removed upstream, so the job
  failed at set-up in three seconds without scanning anything, and the
  vulnerability above went unreported. Pinned to the v0.36.0 commit. The old
  scanner also never read `pnpm-lock.yaml`, so even when it ran it checked no
  dependencies at all.
- **The Linux bundle could not have run on Linux.** It was assembled on Windows,
  and npm installed the Windows build of the database driver: a DLL inside a
  Linux tarball. The dependencies are now installed inside the official Node
  image, and the build starts the finished bundle once and refuses to package
  it unless it answers.
- **The Linux install sent no reminders and took no backups.** It started the
  application but not the worker, which is the process that does both. Nothing
  on screen showed it. A second service now runs the worker, tied to the first
  so the two cannot be left on different versions.
- **Upgrading on Linux left the old version running.** The files were replaced
  under a live process and nothing restarted it.
- **Node was a prerequisite that could break the install silently.** The
  database driver is compiled for one Node version, so a server with Node 22
  would have loaded a driver built for Node 20 and crashed at start, after the
  installer had reported success. Bundling the runtime removes the case.
- **Setting `LOG_TO_FILE=false` in production crashed the application at
  start.** It asked for the pretty printer, which is a development dependency
  and not in an installed copy. Production now logs plain JSON to the console
  instead, which is what journald and container runtimes want.
- **The Docker offline bundle started up as a different product.** Its
  settings file was copied from `env.example`, which named another product,
  and the settings are handed to the container. The bundle now writes its own
  product in.
- **Two products on one Docker host shared a database.** The compose project was
  always called `offset`, so every product's volumes were `offset_data` and the
  second one opened the first one's database. The project, and its volumes, are
  now named after the product.
- **The plan's first instruction pointed at a screen that did not exist.** "Write
  down your scope" sent people to Settings, which had no scope on it: the
  `scope` and `methodology` columns had been on the programme row since the
  beginning with nothing in the product ever writing to them. There is now a
  Scope card on Settings, and the step goes green off what it saves. Same fault,
  smaller, on the backup step, which named a scheduled-jobs screen the product
  has never had; it now asks for the half that matters — get a copy off the
  machine and open it — since the check already reports when the last backup ran.
- **One product's build silently replaced another's.** Every product wrote its
  web bundle to the same `dist/web`, so the last build won and the rest were
  gone. A running server began serving another product's branding, navigation
  and pack against its own API, which the browser correctly reported as a
  version mismatch. The server was fine; the folder underneath it had been
  replaced. Each product now builds into `dist/web/<product>` and each server
  serves the one matching its own `PRODUCT`. `WEB_DIR` overrides both, and
  previously did nothing at all despite looking like a setting.
- **Controls listed in the wrong order.** SQLite sorts refs as text, so
  "3.3.10" came between "3.3.1" and "3.3.2", and ISO's "A.5.37" came before
  "A.5.4". On screen that reads as a missing control rather than a sorting
  quirk. Refs are now compared with the numbers inside them treated as
  numbers, in the register and in every report.
- **Reports grouped domains alphabetically rather than in the framework's own
  order** — SAMA's 3.1, 3.2, 3.3, 3.4 came out as LG, OT, RC, TP. They now
  follow the order the pack lists them in.
- **Setting a per-item maturity target from the register always failed.** The
  row carries `target_maturity` and the API only accepts `targetMaturity`,
  rejecting the other outright, so the select produced an error banner and never
  saved. The client now translates it in one place, as it already did for risks
  and evidence.
- The "Gap" column showed `-1` for anything above its target. A negative gap
  reads as a mistake; it now reports the shortfall only.
- The attachments test suite emptied its tables but not its files, so a leftover
  file from an earlier run failed a suite that was working correctly.
- **Concurrent writes could fail and lose data.** `withTransaction` awaits
  inside an open transaction, so a second request arriving during that await
  called BEGIN on a connection that already had one open. SQLite answers
  "cannot start a transaction within a transaction" and that request failed.
  Every register route uses it, so two people saving at the same moment was
  enough. Proved with three concurrent transactions: one succeeded and two were
  lost. Transactions are now serialised within the process, which costs nothing
  at 0.04 ms a write. The tests never caught it because `app.inject` calls are
  awaited one at a time.
- `pnpm typecheck` pointed at a root `tsconfig.json` that never existed, so it
  failed every time it ran. It now checks both projects, including the test
  files, which were excluded from typechecking altogether.
- `pnpm build && pnpm start` died at boot because `tsc` does not copy `.sql`
  files, so the migrations never reached `dist`. The Docker image was hiding
  this with its own COPY step; the build now does it for every track.
- A missing static file returned `index.html` instead of a 404, which surfaces
  as a confusing MIME type error rather than the real problem.
- Static files were enumerated once at start-up, so a bundle rebuilt while the
  server ran was served as 404 even though `index.html` pointed straight at it.
  This would have broken any in-place upgrade on the Windows track.
- The hashed bundle is now cached for a year and `index.html` never is, so a
  browser cannot hold on to a page that names a bundle which no longer exists.
- The two end-to-end suites shared one database and ran in parallel, so each
  wiped the other's fixtures mid-run. They now run one at a time.

- The Windows build scripts contained non-ASCII characters and were saved
  without a byte order mark, so PowerShell 5.1 read them as ANSI and printed
  mojibake: "building the API..." in the console, and a mangled product name
  in the shipped README. They are pure ASCII now.
- The launcher's start-up banner read the port from its own environment rather
  than from the `.env` its children read, so it printed 8080 while the
  application listened elsewhere. On a busy machine that sends somebody to
  whatever else is on 8080.
- **There was no `.dockerignore`.** The build does `COPY . .`, so a `.env`
  holding the session secret and the field encryption key was copied into an
  image layer, where it stays even if a later step removes it. Added, with
  `**/` patterns as well as bare ones: Docker matches from the context root,
  so a plain `.env` would still have left `deploy/docker/.env` in the context.
- **A silent install cancelled itself.** The running-copy prompt used
  `MsgBox`, which nothing can answer under `/SUPPRESSMSGBOXES`, so it took the
  default of No and exited with code 5. Unattended installation is how an IT
  department deploys this.
- That prompt also fired on any `node.exe` on the machine, including the
  developer's own server. It now matches our launcher by its command line.
- The bundle shipped an empty `dist/windows` tree that had never been part of
  it: `tsc` removes nothing it did not just write, so junk left in
  `apps/api/dist` was copied in and installed on to the target machine.
  `build.ps1` now clears that folder first, so the bundle is a function of the
  source rather than of what the build machine has accumulated.
- **`pnpm db:backup` wrote backups inside the container.** It hardcoded
  `./backups/` and ignored `BACKUP_DIR`, so once the container's working
  directory moved to the application folder the file no longer landed on the
  volume and died with the container. It printed "Backup written to
  ./backups/..." and exited 0, which is the worst way for a backup to fail.
  It now resolves `BACKUP_DIR` and prints the absolute path.
- **The restore procedure produced a database the application could not
  write to.** Copying the file in runs as root, so it arrived owned by root
  while the application runs as uid 10001. The container reported healthy and
  pages loaded; signing in failed with a server error, because that writes a
  session row. The procedure now sets ownership and says why.
- The offline bundle carried Windows line endings, so `SESSION_SECRET=\r`
  never matched the install script's `sed` and the secrets stayed empty. The
  customer would have seen a configuration error naming a setting plainly
  present in the file.
- **It answered the whole network over plain HTTP.** `HOST` defaulted to
  `0.0.0.0` with no TLS anywhere in the product, so a fresh install put every
  password and session cookie on the wire as readable text. The default is now
  loopback, HTTPS is supported with `TLS_CERT_FILE` and `TLS_KEY_FILE`, and
  answering the network without a certificate requires saying so explicitly
  with `ALLOW_INSECURE_NETWORK` — otherwise it refuses to start, and says why,
  before it creates a database.
- **The session cookie was marked `Secure` based on `NODE_ENV`.** A browser
  will not send a Secure cookie over plain HTTP, so a production install
  reached over HTTP from another machine silently failed to sign anyone in. It
  only appeared to work because browsers make an exception for localhost. The
  flag now follows the actual connection, including behind a proxy.
- `isLoopbackHost` treated `127.example.com` as local, because it matched on
  the prefix `127.` rather than a full address. A routable hostname would have
  been allowed to start exposed with no certificate. Caught by a test.
- TypeScript's incremental build state lived beside `tsconfig.json`, so
  deleting `dist` left it behind and the next build emitted declarations and
  no JavaScript — surfacing much later as a missing module at start-up. It now
  lives inside `dist`, so clearing the output always clears the state with it.
- **There was no .** The build does , so a 
  holding the session secret and the field encryption key was copied into an
  image layer, where it stays even if a later step removes it. Added, and
  written with  patterns: Docker matches from the context root, so a
  bare  would still have left  in the context.
### Removed
- Docker Compose development stack, and the `postgres` service from the
- `LICENSE_FILE` and `LICENSE_ENFORCE` settings. There is one edition and it is
  free, so there is no key to check and nothing to enforce.
  production stack. Development needs nothing running.
