# Administrator guide

For whoever installs and looks after the server. You do not need to be a
developer.

## What it runs on

| Platform | How |
|---|---|
| Windows | An installer. Node is bundled, so the machine needs nothing else |
| Linux | An installer, as systemd services. Node is bundled here too |
| Docker | An offline bundle: the image, a compose file and an install script |

About 300 MB of disk, and one free port. No database to install.

## First run

Open the address. **The first person to open it creates the administrator
account.** Do it immediately: until somebody does, anyone who can reach the
address could claim it.

## HTTPS

Out of the box it answers only the machine it runs on. **If anyone reaches it
across the network, give it a certificate first** — it refuses to start on a
network address without one, because passwords would otherwise cross the
network as readable text.

**Settings → HTTPS certificate.** Ask your IT team for a certificate for the
name people type to reach this server, from your company's own certificate
authority. It is free, and every company computer already trusts it. Upload the
`.pfx` file with its password, or the certificate and key as PEM files. It is
checked before it is used, and anything odd - a different name, self-signed,
about to expire - is shown first.

Already on HTTPS, the new certificate is used at once; that is how you renew it.
Still on plain HTTP, restart once; the screen says how. Old `http://` links are
sent on to `https://`.

To let colleagues in, set `HOST=0.0.0.0` and `PUBLIC_URL=https://` plus the
server's name in `.env`, and restart. The install guide, under **Turning on
HTTPS**, has the details, and how to name certificate files in `.env` instead.
A self-signed certificate works, but every browser warns until it is trusted.

## Email

**Settings → Outgoing email.** Without it: no reminders, no daily digest, and no
Forgot password for administrators. The password is encrypted at rest and never
shown again.

## Backups

Nightly and automatic. The folder keeps the newest three backups of every kind
together; the number is the `BACKUP_KEEP` setting. Each is one file holding the
database and every evidence document.

**Download one regularly and keep it off this machine.** Restoring is done from
the Backups screen: it takes a backup of the present first, swaps the data while
the product keeps running, and signs everybody out.

To move to a new server: install there, create the first account, then upload
the backup and restore it. Keep the old `.env` too, or the mail password has to
be entered again.

## Updates

**Settings → Updates.** Nothing is checked until somebody presses the button.
An update takes a backup, downloads a release signed by Offset Security, checks
the signature and the file hash, installs it, and puts the old version back if
the new one does not answer.

The server needs to reach `github.com` over HTTPS to check and download. A
server with no internet updates the way it was installed: run the newer
installer, or load the newer offline bundle.

## Locked out

If email is not set up and the only administrator is locked out, issue a
temporary password at the server:

| Install | Command |
|---|---|
| Docker | `docker compose exec app node dist/admin/reset-password.js admin` |
| Windows | Start menu → **Reset Offset Irtiqa administrator password**, run as administrator. It is also `Reset administrator password.cmd` in the install folder |
| Linux | `sudo /opt/offset-ascend/reset-password.sh admin` |

It prints a password that works once, for 30 minutes.

## Logs

The API, the worker and the launcher each write a rotating log, and uncaught
errors land in `crash.log`. Refused sign-ins, lock-outs and blocked addresses are listed in
`signin.log`, one plain line each. Passwords, hashes and cookies are stripped before
anything is written, so a log is safe to send to somebody.
