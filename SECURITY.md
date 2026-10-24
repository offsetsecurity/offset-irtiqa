# Security Policy

## Reporting a vulnerability

Email **security@offsetsecurity.net** with:

- a description of the issue and its impact,
- the version, e.g. `1.2.0`,
- steps to reproduce, and
- any proof-of-concept.

Please do not open a public issue for security reports.

**Our commitment:** acknowledgement within 3-5 business days, an assessment within
10 business days, and a fix or documented mitigation within 90 days for confirmed
issues. We will credit reporters who wish to be named.

## Supported versions

Security fixes go into the next release of each product, and only the latest
release is supported. Updating from the Settings screen, or with the updater,
is how a fix reaches an installation. Older releases stay available on GitHub
so an installation can be rolled back, but they are not patched.

## Product security posture

What the product does today. Nothing below is planned work.

**Signing in**
- Local accounts only. Passwords are hashed with Argon2id (OWASP parameters)
  and must be at least 12 characters.
- Five wrong passwords lock an account for 15 minutes; twenty failed sign-ins
  from one address pause that address for 15 minutes.
- Multi-factor sign-in and single sign-on (OIDC/SAML) are **not** available.
  Where a second factor is required, put a sign-in gateway that provides one
  in front of the product.

**Access**
- Four roles (administrator, contributor, auditor, read-only), checked on the
  server for every API route and again before every change. An automated test
  checks every route against every role on each build.
- Sessions are HttpOnly, SameSite cookies, marked Secure over HTTPS, and end
  on the server at sign-out, at a password change and when an account is
  disabled. Every change also needs a CSRF token.

**Network**
- Listens on 127.0.0.1 by default. It will not listen on a network address
  without a certificate unless an administrator says so
  (`ALLOW_INSECURE_NETWORK`). HTTPS uses the customer's own certificate, set on
  the Settings screen or in `.env`.
- A strict Content Security Policy, HSTS over HTTPS, and no cross-origin access.

**Data**
- Mail and certificate passwords are encrypted in the database with
  AES-256-GCM and a key generated for each installation.
- Uploaded files are stored under random names and are always downloaded,
  never opened in the browser.
- Every change is recorded in the audit trail with who, when, from where, and
  the values before and after. It can be exported as CSV. It is kept for ever
  unless an administrator sets a retention period.
- Backups are taken nightly and on demand. They are not encrypted; keep them
  somewhere only administrators can reach.
- No telemetry. The product makes no outbound connections except to a mail
  server and to GitHub for updates, and only when those are set up.

**Releases**
- Updates are checked against an Ed25519 signature before they are installed,
  and Docker images are pulled by digest.
- Each release publishes a component list (SBOM).
- Every build runs gitleaks over the whole history, Trivy over the
  dependencies, and the full test suite. GitHub CodeQL scans the code.
- The Windows installer is not yet code-signed.
