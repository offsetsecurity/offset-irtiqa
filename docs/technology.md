# What Offset Irtiqa is built with

One page, for the questions that come up in a demonstration, a security review
or a procurement form. Every version below is what ships today, not a plan.

**In one sentence:** a self-contained Node.js web application with an embedded
SQLite database, installed on the customer's own server, with no cloud service,
no external dependencies at runtime and no database server to operate.

## The stack

| Layer | What it is | Why |
|---|---|---|
| Language | TypeScript, front and back | One language, checked before anything ships |
| Runtime | Node.js 24.21.0, bundled with the product. Supported by the Node.js project until April 2028 | The customer installs nothing else |
| Backend | Fastify 5 | Small, fast, and validates every request |
| Database | SQLite, through better-sqlite3 13. A database kept in a single file, rather than a server you install and run | One file. No service to install, patch or back up |
| Frontend | Preact 10 with htm | The whole interface is one file of about 205 KB |
| Build | esbuild | The web bundle builds in under a second |
| Package manager | pnpm 9 | One lock file, reproducible installs |

## Backend

- **Validation:** Zod on every request body and query. Nothing reaches the
  database unchecked.
- **Passwords:** Argon2id (19 MiB, 2 passes), with automatic re-hashing when
  the parameters are raised. Argon2id is the current standard for storing
  passwords: deliberately slow and memory-hungry, so guessing them in bulk is
  expensive.
- **Encryption at rest:** AES-256-GCM - the same encryption banks use - for stored secrets, today the mail
  password, keyed from `FIELD_ENC_KEY` in the install's own settings.
- **Reports:** ten PDFs, generated on the server with pdfmake. No headless
  browser, so the install stays about 300 MB rather than 500.
- **Email:** Nodemailer over SMTP, optional. An install with no mail server
  behaves exactly as before, deliberately.
- **Logging:** pino, to rotating files. Passwords, hashes, cookies and secrets
  are stripped before anything is written, so a log is safe to send to us.
- **Background work:** a `jobs` table and a polling worker. No Redis, no broker,
  nothing extra to operate on a customer's machine.
- **API:** 126 REST endpoints, listed in [the API reference](dev/api.md). Cookie sessions, CSRF on every write, four roles
  checked twice, and an append-only audit log of every change, which administrators and auditors read on screen.

## Database

- **SQL, no ORM.** (An ORM is a layer that writes the database queries for you; this does not use one.) One dialect, one migration history, the same schema on every
  install and every platform.
- **40 tables, 10 migrations**, applied automatically at start-up and safe to
  re-run.
- **Shared columns for the parts every framework has in common**, plus a JSON
  `attrs` column for the fields this one needs and the others do not. The
  framework is content; the schema does not change with it.
- **Backups** use SQLite's online backup API, so a copy can be taken while the
  product is running and serving.

## Frontend

- Preact with htm: standard HTML in template literals, no JSX compiler and no
  framework runtime beyond 10 KB.
- A strict Content-Security-Policy. No inline scripts, no fonts, analytics or
  code fetched from the internet: the page loads what the server ships and
  nothing else.
- One JavaScript file and one stylesheet, served by the application itself.

## How it is installed

| Track | What it is |
|---|---|
| Windows | An installer. Node is bundled; nothing else is required |
| Linux | A tarball installed as two systemd units. Node is bundled. Works back to RHEL 8 (glibc 2.28) |
| Docker | Two containers, application and worker, with an optional updater. The images are pulled from the registry |

- **HTTPS** is terminated by the application itself, using the customer's own
  certificate. No proxy is required.
- **Updates** are signed with Ed25519 and verified against a key compiled into
  the application. Every file is checked by SHA-256 and every container image by
  digest. Nothing is contacted until an administrator presses the button.
- **The data** is one database file, one folder of evidence documents and one
  folder of backups, all on the customer's disk.

## What the product is

The framework content lives in `packs/ascend/` and is compiled into the build, so
changing the wording of a requirement never means touching the application.

| | |
|---|---|
| Framework | SAMA Cyber Security Framework |
| What you work through | 183 controls, in 4 domains |
| Called | Control / Domain |
| Guidance per item | Plain English: what it means, what to do, what an assessor looks for, what proof to keep |
| Get ready | 7 stages, 24 steps, 13 checked for you |
| Sample library | 98 assets, 43 risks |
| Help in the product | 10 pages |

**It has** HTTPS, the four roles, the audit trail, backups and
restore, signed one-click updates, Forgot password for administrators, email and
reminders, the registers (evidence, risks, assets, policies, tasks, incidents,
findings), the PDF reports, and Help and Documentation in the menu: 10 pages,
including a playbook for its framework. Every installer and
image also carries the documents in a `docs` folder.

**The pack decides what appears.** Feature flags in `packs/ascend/pack.json` switch
screens on and off, so the framework content and the application stay separate:
changing the wording of a control never means touching the code.

## Scale and quality

| | |
|---|---|
| Code | About 30,000 lines, 26,800 of them TypeScript |
| Tests | 286 automated tests, run on every change |
| Sizing | Up to roughly 50 users per install |
| Products | Four, each a separate install with its own database |

## The two questions that always come

**Why SQLite rather than PostgreSQL?** Because this runs on the customer's
server, for a small team, and the workload is nearly all reads. An embedded
database removes a service they would have to install, tune, patch and back up
on a machine we cannot see, and makes backup and restore a file copy. The limit
is concurrent writers, not users. The decision, and the signal that would make
us revisit it, are written down in
[ADR 0002](dev/adr/0002-sqlite-not-postgres.md).

**Is it open source?** No. It is free to use, closed source, one edition. See
[LICENSE](../LICENSE).
