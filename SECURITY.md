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

Security fixes are backported to the two most recent minor versions of each
product. See `SUPPORT.md` for the full lifecycle policy.

## Product security posture

This is a security and compliance product, so it is held to the standard it helps
customers meet:

- TLS on by default; self-signed on first boot, replaceable with a customer cert.
- Passwords hashed with Argon2id. Optional TOTP MFA. Optional OIDC/SAML SSO.
- Role-based access control enforced in middleware and again in the service layer.
- Append-only audit log of every mutation, exportable, optionally forwarded to syslog.
- Secrets encrypted at rest with a deployment-specific key.
- No telemetry. No outbound network calls unless the operator configures them.
- Every release ships an SBOM and is signed; images and dependencies are scanned
  in CI (Trivy, Semgrep, gitleaks, Dependabot).
