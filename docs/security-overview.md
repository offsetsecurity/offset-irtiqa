# Security overview

How the Offset products protect the data you put in them. Written for a
customer's security team. Everything here describes what the product does
today; where something is not built yet, it says so.

Applies to Offset Irtiqa.
They are one codebase and share every control on this page.

## In one paragraph

The product runs on **your** server, inside **your** network. Offset Security
has no access to it and no copy of your data. There is no cloud service, no
telemetry and no licence server. The only outbound connections are to your own
mail server (if you set one up) and, when an administrator presses **Check for
updates**, to GitHub to fetch a signed release.

## Where your data is

| What | Where |
|---|---|
| All records | One SQLite database file on your server |
| Uploaded evidence | A folder on your server |
| Backups | A folder on your server: the newest three, of every kind together |
| Logs | A folder on your server, rotated at 10 MB, 5 old files kept |

Nothing is stored anywhere else. Moving the product means copying those
folders.

## Signing in

- **Passwords** are hashed with **Argon2id** (19 MiB of memory, 2 passes), the
  algorithm OWASP recommends. They are never stored or logged in readable form.
  Hashes are upgraded automatically when the settings are raised.
- **Minimum length is 12 characters.**
- **Lockout:** 5 wrong passwords lock the account for 15 minutes. Every failed
  sign-in is recorded with the address it came from.
- **Limit per address:** 20 failed sign-ins from one address, to any accounts,
  block that address for 15 minutes. It is then refused before any account is
  looked at, so it can neither keep guessing nor lock anyone out.
- **The address is the real one.** A proxy's "forwarded for" header is only
  believed from the machine itself, or from proxies you name in `TRUST_PROXY`.
  Nobody else can choose the address the audit trail and the limits use.
- **Sessions** live on the server. The browser holds only a signed, random
  session ID in a cookie that scripts cannot read (`HttpOnly`), that is sent
  only over HTTPS (`Secure`) and not by other sites (`SameSite=Lax`).
- **Timeout:** a session ends after 12 hours without use (configurable).
- **Changing a password signs out every other session** of that user.
  Disabling an account, or an administrator setting its password, ends all of
  its sessions at once.
- **Forgot password (administrators only):** a temporary password is emailed
  to the address on the account. It works once, for 30 minutes, and opens only
  the page that sets a new password. The old password keeps working until the
  temporary one is used, so nobody can lock an administrator out by typing
  their name into the form. The form answers the same way whether or not the
  account exists, and is limited to 5 requests per 15 minutes.
- **Not built yet:** multi-factor authentication, and single sign-on (SAML or
  OpenID Connect). Both are on the roadmap.

## Who can do what

Four roles, checked on the server for every request:

| Role | Read | Change | Users, backups, settings |
|---|---|---|---|
| Administrator | Yes | Yes | Yes |
| Contributor | Yes | Yes | No |
| Auditor | Yes | No | No |
| Read only | Yes | No | No |

Accounts are disabled, not deleted, so the record of who did what keeps a name
against it.

## Protecting the web application

- **HTTPS** with your own certificate, uploaded by an administrator on the
  Settings screen or named in the settings file. It is checked before use: the
  key must match, it must be in date, and RSA keys under 2048 bits are refused.
  Plain `http://` on the same port is redirected to `https://`. The product
  refuses to start on a network address without a certificate, so passwords
  never cross the network readable.
  The only way round that is a setting you turn on yourself, for when a proxy
  in front of it handles HTTPS. TLS 1.2 is the minimum.
- **Strict Content-Security-Policy:** the page runs only scripts served by the
  product itself. No inline scripts, and nothing is loaded from the internet.
  The page cannot be framed by another site.
- **HSTS** tells browsers to use HTTPS only.
- **CSRF protection** on every change: a token in a cookie must be echoed in a
  request header, compared in constant time.
- **Every request is validated** against a schema before it reaches the
  database, and what a user types only ever reaches the database as a query
  parameter, never pasted into the query itself.
- **Uploaded files** are always sent back as downloads, never opened in the
  browser, so an uploaded file cannot run anything in a user's session.
  Uploads are limited in size (25 MB by default).

## Encryption

| Data | Protection |
|---|---|
| Traffic | TLS, with your certificate |
| Passwords | Argon2id hashes |
| Mail server password | AES-256-GCM, with a key generated on your server at install |
| Database, evidence and backups on disk | **Not encrypted by the product.** Use disk encryption (BitLocker, LUKS) on the server |

## Audit trail

Every change is recorded: who made it, when, from which address, and the
values before and after. Sign-ins, failed sign-ins, password resets, backups,
restores and updates are recorded too. There is no screen or API that edits or
deletes an entry.

The trail is kept for ever unless you set a retention period.

Administrators and auditors read it on the **Audit trail** screen: search,
filter by person, action and dates, see what each change did field by field,
and download it as CSV. Nobody else can open it. Anything in an entry that
looks like a password, key or token is hidden on screen and in the download,
and a downloaded cell that starts like a spreadsheet formula is made plain
text. Downloading is itself recorded.

## Backups and recovery

- A backup is taken **every night**. The newest three backups are kept,
  counting every kind together: nightly, taken by hand, and made before a
  restore or an update. The number is a setting. Each is one file holding the
  database and every evidence document.
- An administrator can take, download, upload and restore backups from the
  **Backups** screen.
- **Restoring takes a backup of the present first**, then swaps the data while
  the product keeps running, and signs everybody out.
- A backup holds everything, including password hashes. **Keep copies off the
  server, and protect them like the server.**

## Updates

- **Nothing is checked or downloaded until an administrator presses the
  button.**
- Every release is **signed with Ed25519 (the signature scheme, the same one OpenSSH uses)**. The product checks the signature
  against a public key built into it, then checks every file by SHA-256 (and
  every container image by digest) before installing anything.
- An update **takes a backup first**. If the new version does not start
  properly, the old version and the data are put back automatically.
- A server with no internet is updated by installing the newer package by hand.

## How it runs on your server

| Install | Runs as |
|---|---|
| Windows | When set to start with Windows: a scheduled task under the **LocalService** account, with limited rights |
| Linux | A dedicated user per product, under systemd with `NoNewPrivileges`, `ProtectSystem=strict`, `ProtectHome` and `PrivateTmp`, writing only to its data folder |
| Docker | A non-root user (uid 10001), published on `127.0.0.1` only until you choose otherwise |

The one-click updater needs more rights than the product, because it installs
software: it runs as root on Linux, as SYSTEM on Windows, and on Docker it
needs access to the Docker socket. **It is optional.** Leave it out and update
by hand if you prefer.

## Logs

Logs never contain passwords, password hashes, session cookies or keys: they
are stripped before anything is written. Logs do contain IP addresses and the
pages requested. A log is safe to send to Offset Security for support.

## How it is built

- TypeScript throughout, checked before anything ships.
- 295 automated tests, run on every change, including tests that auditors
  and read-only users cannot change anything.
- Dependencies are pinned to the exact versions the tests ran against.
- Every change is scanned for leaked secrets (gitleaks) and for known
  vulnerabilities and misconfiguration (Trivy). A high or critical finding
  fails the build.
- Each release is built from a tagged commit and signed.

**Not done yet:** an independent penetration test.

## Reporting a vulnerability

Email **security@offsetsecurity.net**. See `SECURITY.md` for what to include.

## See also

- [Security questionnaire answers](security-questionnaire.md): the same
  ground as a list of questions.
- [Privacy and personal data](privacy.md): what personal data the product
  holds, and for how long.
- [What it is built with](technology.md): the technology, on one page.
