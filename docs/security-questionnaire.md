# Security questionnaire answers

Ready answers to the questions a customer's security or procurement team
usually asks. Copy them into their form. Every answer describes the product as
it is today. The explanations behind them are in the
[security overview](security-overview.md).

Applies to Offset Irtiqa.

## Hosting and data location

| Question | Answer |
|---|---|
| Is this a SaaS or cloud service? | No. It is installed on the customer's own server, on their own network |
| Where is our data stored? | On the customer's server only: one database file, one evidence folder, one backup folder |
| Does the vendor have access to our data? | No. Offset Security has no access to the server and no copy of the data |
| Does the product send data to the vendor or third parties? | No. There is no telemetry, analytics or licence check |
| What outbound connections does it make? | Only to the customer's own mail server, if one is configured, and to GitHub when an administrator presses Check for updates |
| Can it run with no internet at all? | Yes. It installs, runs and updates offline. Updates are then installed by hand |
| Which operating systems are supported? | Windows (64-bit), Linux x86_64 with glibc 2.28 or newer (Ubuntu, Debian, RHEL, Amazon Linux, SUSE), or Docker |
| Is a separate database server needed? | No. The database is an embedded SQLite file |

## Authentication

| Question | Answer |
|---|---|
| How are passwords stored? | Argon2id hashes (19 MiB memory, 2 passes). Never stored or logged readable |
| What is the password policy? | At least 12 characters |
| Is there account lockout? | Yes. 5 failed attempts lock the account for 15 minutes |
| Is sign-in rate limited? | Yes. 20 failed sign-ins from one address, to any accounts, block that address for 15 minutes. The address used is the connection's own; a proxy's forwarded-for header is only trusted from proxies the customer names |
| Is multi-factor authentication supported? | Not yet. It is on the roadmap |
| Is single sign-on (SAML, OIDC, Active Directory) supported? | Not yet. It is on the roadmap |
| How long do sessions last? | They end after 12 hours without use. This is configurable |
| Are sessions ended when a password changes? | Yes. All other sessions of that user end. Disabling an account ends all of its sessions at once |
| How does password recovery work? | Administrators can have a one-time temporary password emailed, valid for 30 minutes. Other users are reset by an administrator |
| Are default passwords shipped? | No. The first person to open a new install creates the administrator account |

## Authorisation

| Question | Answer |
|---|---|
| Is there role-based access control? | Yes. Four roles: Administrator, Contributor, Auditor, Read only |
| Where are permissions enforced? | On the server, for every request, not only in the browser |
| Can user accounts be deleted? | They are disabled instead, so the audit trail keeps a name against every action |

## Application security

| Question | Answer |
|---|---|
| Is traffic encrypted? | Yes. HTTPS with the customer's own certificate, TLS 1.2 minimum. The product refuses to serve the network without it unless the customer deliberately turns that off for a proxy |
| Is there protection against XSS? | Yes. A strict Content-Security-Policy runs only the product's own scripts, with no inline scripts |
| Is there protection against CSRF? | Yes. A double-submit token on every change, compared in constant time |
| Is there protection against clickjacking? | Yes. The page cannot be framed by another site |
| Is there protection against SQL injection? | Yes. Every request is validated against a schema, and user input only reaches the database as a query parameter |
| How are uploaded files handled? | They are size-limited (25 MB by default) and always served as downloads, never rendered in the browser |
| Are security headers set? | Yes: Content-Security-Policy, HSTS, X-Content-Type-Options, Referrer-Policy and others |

## Data protection

| Question | Answer |
|---|---|
| Is data encrypted at rest? | Passwords are hashed and the mail server password is encrypted (AES-256-GCM). The database, evidence and backups are not encrypted by the product; we recommend disk encryption (BitLocker, LUKS) on the server |
| Who holds the encryption keys? | The customer. Keys are generated on their server at install |
| What personal data is stored? | See [Privacy and personal data](privacy.md) |
| Are logs free of sensitive data? | Passwords, hashes, cookies and keys are stripped before anything is written. Logs do contain IP addresses |

## Audit and monitoring

| Question | Answer |
|---|---|
| Is there an audit trail? | Yes. Every change is recorded with who, when, from which IP address, and the values before and after. Sign-ins, failed sign-ins, password resets, backups, restores and updates are recorded too |
| Can audit entries be changed or deleted? | Not through the product. There is no screen or API that edits or deletes them |
| How long is the audit trail kept? | For ever, unless the customer sets a retention period |
| Can the audit trail be viewed in the product? | Yes, by administrators and auditors only, on the Audit trail screen. It can be searched, filtered by person, action and dates, and downloaded as CSV. It cannot be edited or deleted there or anywhere else |
| Is there a health check endpoint for monitoring? | Yes. `/api/v1/health` and `/api/v1/health/ready` |

## Backup and recovery

| Question | Answer |
|---|---|
| Are backups taken automatically? | Yes, every night. The newest three backups of every kind are kept; the number is configurable |
| What does a backup contain? | The database and every evidence document, in one file |
| Can we restore without downtime? | Yes. A restore runs while the product stays up, takes a backup of the present first, and signs everyone out |
| Are backups encrypted? | No. Store them somewhere protected, off the server |

## Updates and vulnerability management

| Question | Answer |
|---|---|
| How are updates delivered? | An administrator presses a button, or installs the newer package by hand. Nothing updates on its own |
| How are updates verified? | Every release is signed with Ed25519, and every file is checked by SHA-256 (container images by digest) before anything is installed |
| What happens if an update fails? | A backup is taken first, and the previous version and data are restored automatically |
| Does the updater need elevated rights? | Yes: root on Linux, SYSTEM on Windows, the Docker socket on Docker. It is optional; leave it out to update by hand |
| How are vulnerabilities reported? | By email to security@offsetsecurity.net |
| Has the product been penetration tested? | Not yet by an independent party |

## Development

| Question | Answer |
|---|---|
| What is it written in? | TypeScript, on Node.js 24 (supported until April 2028), with Fastify and SQLite. See [What it is built with](technology.md) |
| Is there automated testing? | Yes. 295 tests run on every change |
| How are third-party libraries managed? | They are pinned to the exact versions the tests ran against, and bundled, so nothing is fetched at install time |
| Is the code scanned for vulnerabilities? | Yes. Every change is scanned for known vulnerabilities, misconfiguration and leaked secrets (Trivy and gitleaks). A high or critical finding fails the build |
| Is the product open source? | No. It is closed source and free to use under its licence |

## Running on the server

| Question | Answer |
|---|---|
| What account does it run as? | Windows: LocalService when set to start with Windows. Linux: a dedicated user per product. Docker: a non-root user |
| Is the service hardened on Linux? | Yes. systemd with NoNewPrivileges, ProtectSystem=strict, ProtectHome and PrivateTmp, writing only to its data folder |
| Which ports does it need? | One inbound HTTPS port, chosen at install (8080 by default) |
