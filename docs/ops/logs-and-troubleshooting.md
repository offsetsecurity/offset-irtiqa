# Logs and troubleshooting

For whoever installed this and now has to keep it running. Written for a
Windows install; the Docker deployment puts the same files in the same
subfolders of its data volume.

---

## What actually runs

Two Node processes, started together by one launcher and stopped together:

| Process | What it does | If it stops |
|---|---|---|
| **app** | Serves the web interface and the API on the configured port, default 8080. Owns the database schema and applies migrations at start-up. | Nobody can sign in. |
| **jobs** | The background worker. Nightly backup and pruning, the daily readiness snapshot, WAL checkpoints, session and audit housekeeping. | The product still works. Backups stop, and yesterday's readiness figure never appears. |

They are one process tree. Closing the window, or pressing Ctrl+C, stops both.
If either one dies unexpectedly the launcher takes the other down with it,
rather than leaving a running application with no backups.

### Running in the background

Two ways to run it, and the installer asks which you want.

**By hand.** A shortcut. Somebody has to be signed in with the window open, it
does not start at boot, and it stops when that person signs out. Fine for one
machine somebody opens each morning.

**In the background.** Starts at boot, runs with nobody signed in, and restarts
itself if it stops. Tick **"Start with Windows"** during setup, or run this from
an elevated PowerShell inside the installed folder at any time:

```powershell
.\service\install-service.ps1
```

To undo it, keeping all your data:

```powershell
.\service\uninstall-service.ps1
```

#### It is a scheduled task, not an entry in services.msc

Worth knowing before you go looking for it in the wrong place.

Windows has no built-in way to run an ordinary program as a service. A real
service has to talk to the Service Control Manager itself, and `node.exe` does
not, so `sc create` on it produces a service that fails to start with error
1053. The usual answer is to ship a third-party wrapper such as NSSM or WinSW.

We do not, deliberately. This product is not code signed, and adding a second
unsigned executable whose entire job is launching other processes is the
quickest way to have the whole download quarantined by antivirus. A scheduled
task needs no extra binary, is built into Windows, and survives a reboot the
same way.

What you give up: it appears in **Task Scheduler** rather than the Services
console, and it is stopped with the script above rather than `net stop`.

#### Which account it runs as

By default, **LOCAL SERVICE** — a built-in account with almost no privileges. The
installer grants it write access to the data folder and nothing else.

If it will not start under that account, the script says so, tells you which
log to read, and suggests:

```powershell
.\service\install-service.ps1 -Account System
```

SYSTEM always has access. It also means the web application runs with complete
control of the machine, which for a security tool is a poor default and an
acceptable fallback. A named account works too:

```powershell
.\service\install-service.ps1 -Account DOMAIN\svc-offset
```

You will be prompted for its password; it is handed to Windows and not stored
by us.

#### Checking on it

```powershell
Get-ScheduledTask -TaskName "Offset Irtiqa"        # registered?
Get-ScheduledTask -TaskName "Offset Irtiqa" | Get-ScheduledTaskInfo   # last run, last result
```

The installer does not just register the task and call it done. It starts the
task, then waits up to thirty seconds for the product to answer. If it does
not answer, the installer tells you where to look.

### What talks to what

```
browser  ──http──►  app (port 8080)  ──►  data\offset.db
                                            ▲
                            jobs  ──────────┘   (same file, WAL mode)
```

Both processes open the same SQLite file. That is safe: writes are serialised
and readers are never blocked. Nothing listens on the network except the app,
and only on the port in `.env`.

---

## Who can reach it

**By default, only the machine it runs on.** That is deliberate, and it is the
setting most people should leave alone.

The product does not do HTTPS unless you give it a certificate. Answering the
network without one means every password and session cookie crosses that
network as readable text, so it **refuses to start** in that combination rather
than doing it quietly.

Three ways to run it:

| What you want | Settings |
|---|---|
| One machine, nobody else needs it | `HOST=127.0.0.1` (the default). Open <http://localhost:8080>. |
| Colleagues reach it, HTTPS from us | `HOST=0.0.0.0`, plus `TLS_CERT_FILE` and `TLS_KEY_FILE` pointing at PEM files. |
| Colleagues reach it, a proxy does TLS | `HOST=0.0.0.0` and `ALLOW_INSECURE_NETWORK=true`. Only correct when IIS, nginx or similar is terminating TLS in front. |

If you get the combination wrong it says so and stops, before it creates
anything:

```
Refusing to start.

HOST is 0.0.0.0, so this would answer other machines, and no
certificate is configured. Passwords and session cookies would be
sent as readable text across the network.
```

### Getting a certificate

For an internal server, your own certificate authority is usually the right
answer: the machines that need to trust it already do. Failing that, a public
certificate from Let's Encrypt works if the name resolves publicly.

A self-signed certificate works technically and every browser will warn about
it every time, which teaches people to click through warnings. Avoid it beyond
testing.

### The session cookie

Marked `Secure` automatically whenever the connection is HTTPS, including when
a proxy in front terminates TLS. Nothing to configure.

---

## Where everything lives

**Installed** (from the setup program):

```
C:\ProgramData\Offset Security\<product>\
```

**Portable** (from the zip): the folder you unzipped, beside the app.

Either way the layout is the same:

| Folder | What is in it |
|---|---|
| `data\` | The database. |
| `backups\` | Nightly copies of the database. The newest are kept, older ones pruned. |
| `evidence\` | Documents people have attached to evidence records. |

**Back up `data` and `evidence` together.** The nightly job copies the
database and nothing else.

So restoring from `backups` alone brings back every evidence record - its
name, owner and dates - but none of the documents attached to them. You would
be left with rows pointing at files that are not there.
| `logs\` | Everything below. |
| `.env` | Settings, including the two secrets generated on first run. |

The program files themselves are under `Program Files` and hold nothing you
need to keep. Reinstalling does not touch anything in the list above, and
neither does uninstalling.

---

## The log files

| File | Written by | Read it when |
|---|---|---|
| `launcher.log` | The launcher | It will not start at all. Short, plain text, and the first thing to look at. |
| `app.log` | The application | A page errors, a login fails, something is slow. |
| `worker.log` | The background worker | A backup did not happen. |
| `crash.log` | Either process | Something stopped by itself. Empty is good news. |
| `signin.log` | The application | Someone cannot sign in, or you want to see who tried. One plain line per refused sign-in, lock-out or blocked address. Never a password. |
| `install.log` | The setup program | The install itself went wrong. |

`app.log` and `worker.log` are JSON, one object per line — dense to read, but
searchable. The others are plain text.

### They cannot fill your disk

Each file rotates at **10 MB** and keeps **5** older generations, named
`app.log.1` through `app.log.5`. The ceiling per file is therefore about
60 MB, and it is reached only by a very busy or very broken install.

Change it in `.env`:

```ini
LOG_MAX_MB=10     # rotate at this size
LOG_KEEP=5        # how many older copies to keep
LOG_LEVEL=info    # fatal, error, warn, info, debug, trace
LOG_TO_FILE=true  # false writes to the console only
```

`LOG_LEVEL=debug` is for chasing a specific problem. It is noisy, it grows
fast, and it should be put back to `info` afterwards.

### They are safe to send

Passwords, password hashes, session cookies, authorization headers, the
session secret and the field encryption key are stripped before anything is
written. That is deliberate: a log is the one artefact a customer is asked to
email to a stranger, so it has to be safe to email.

It is still an operational log. It contains usernames, IP addresses, and the
paths people visited. Treat it as internal.

---

## When something is wrong

**Send `logs\launcher.log` and `logs\crash.log` first.** They are small, and
between them they explain most failures. Add `app.log` if the problem is
something the application did rather than something that stopped it.

### It will not start

Look at `launcher.log`. The launcher copies anything the two processes print
as they fail, which is the one window where they have no log of their own.

| What you see | What it means |
|---|---|
| `Invalid configuration:` and a list of settings | `.env` is wrong or incomplete. The list says which line. |
| `SESSION_SECRET is not a 32-byte hex value` | `.env` was hand-edited or copied from a template without the generated secrets. |
| `EADDRINUSE` | Something else already has port 8080. Change `PORT` in `.env`. |
| `SQLITE_CANTOPEN` | The data folder is not writable, or the path in `DATABASE_URL` does not exist. |
| Nothing at all in the file | The launcher itself never ran. Check that `node.exe` is beside the `app` folder. |

### It started, then stopped

Check `crash.log`. Each entry names the process, the kind of failure, and the
stack. An empty or missing `crash.log` means it was stopped deliberately —
by Ctrl+C, by closing the window, or by signing out.

### Backups are not happening

Check `worker.log`.

- `worker starting` present, `job done` for `backup` absent — the worker is
  running but the backup has not come round yet, or it is failing. The
  `schedule` line says when each job is next due.
- `job failed` with `backup` — the message says why. Usually the backup folder
  is not writable, or the disk is full.
- No `worker starting` line at all — the worker is not running. Restart from
  the shortcut, which starts both halves.

A job that fails is retried three times with a widening delay, then left
alone. It is not dropped silently.

### It is slow

Turn on `LOG_LEVEL=debug`, reproduce it, turn it back to `info`. Request lines
in `app.log` carry a `responseTime` in milliseconds, so a slow endpoint shows
up by sorting on it.

### The install itself failed

**Windows.** When an install starts and does not finish, the setup program saves
its transcript as `logs\install-failed-<date>-<time>.log` and says so on screen.
Send that file. A successful install leaves `logs\install.log` instead.

**Linux.** Everything the installer prints is also written to
`/var/log/offset-<product>-install.log`, newest at the bottom. When it fails, the
last lines on screen say so and name the file.

---

## Email

Optional, and off until somebody turns it on. An install with no mail server
works completely; email only adds notifications on top.

Settings live under **Settings — Outgoing email**, administrators only. The
password is encrypted with `FIELD_ENC_KEY` from `.env`, which has one
consequence worth knowing: **if that key is ever regenerated, the stored mail
password becomes unreadable** and has to be entered again. Nothing else
breaks.

The **Send test message** button connects first, then sends, so the two
failures are told apart:

| What it says | Where to look |
|---|---|
| Rejected the username or password | The account, not the address. |
| Nothing is listening at that address and port | Host and port. 587 for STARTTLS, 465 for TLS. |
| Could not reach the mail server | A firewall between this machine and the relay. |
| Certificate could not be verified | An internal relay with its own certificate. Turning the check off works, and means the connection is no longer protected against interception. |
| Refused the sender or recipient address | The relay will not accept mail from that "from" address. |

Every change and every test is written to the audit trail, without the
password.

### What else gets sent

Two messages go to individual people, and only when mail is switched on:

- **A new account was created for you** — address, username and role.
- **Your password was changed by an administrator** — with a line telling
  them to question it if they were not expecting it.

**Neither contains the password.** That is deliberate and not an oversight:
email is stored unencrypted, backed up, and searchable for years. Give the
password out the way you would any other credential.

Neither can stop the thing it follows. If mail is off or broken, the account
is still created and the password is still reset; `app.log` records whether
the message went and why not.

### The daily digest

Off until you turn it on, under **Settings — Daily digest**. It lists what
needs attention: evidence out of date or coming due, overdue tasks and
findings, policies due for review, and open risks in the top band.

**It sends nothing on a day when nothing needs attention.** If you want the
daily all-clear instead — as evidence the tool is still running — there is a
setting for it.

Leave the recipient list empty and it goes to every enabled administrator who
has an email address, so it keeps working when people join and leave without
a second list to maintain.

**Preview today's** shows exactly what would be sent, without sending it.

It runs once a day at `DAILY_JOB_HOUR`, after the readiness snapshot. If one
does not arrive, `worker.log` says why — the four normal reasons are that it
is off, email is not configured, nothing needed attention, or nobody is set
to receive it. A send that genuinely fails is retried three times with a
widening delay and then left as a failed job row.

### Settings that are known to work

Checked 2026-09-10. Providers change these; if one stops working, their own
documentation is the authority, not this table.

Two rules apply almost everywhere, and between them they cause most first-time
failures:

- **The "from" address usually has to be on a domain the provider has
  verified.** Putting any address you like in that box is what spam does, so
  providers refuse it. The test will connect happily and then the send will be
  refused.
- **The password is almost never your account password.** It is an API key or
  an app password, generated in the provider's console.

#### Resend

Choose **Resend** as the mail provider and there are two boxes: the API key and
the from address. The server fills in the rest.

| Field | Value |
|---|---|
| Mail provider | Resend |
| Resend API key | an API key, beginning `re_` |
| From address | an address on a domain verified in Resend |

Behind that it is ordinary SMTP — `smtp.resend.com` on port 465, with the
username `resend`, which is a routing marker telling their gateway to expect an
API key rather than a password. The preset exists so nobody has to know that.

**Resend has no shared sender address**: a domain must be verified before
anything sends at all, so there is nothing to test with until DNS is done.

#### Amazon SES

| Field | Value |
|---|---|
| Mail server | `email-smtp.<region>.amazonaws.com` |
| Encryption / port | STARTTLS (587), or TLS from the start (465) |
| Username / password | **SES SMTP credentials**, generated in the SES console |

The SMTP credentials are not your AWS access key and secret — they are derived
from them and generated separately. A new SES account is also in a sandbox
that will only send to addresses you have verified, until you ask AWS to
lift it.

#### Google Workspace or Gmail

| Field | Value |
|---|---|
| Mail server | `smtp.gmail.com` |
| Encryption / port | STARTTLS (587) |
| Username | the full address |
| Password | an **app password**, not the account password |

App passwords require two-step verification on the account. Google Workspace
administrators can use `smtp-relay.gmail.com` instead, which authenticates by
IP address and needs no password at all.

#### Microsoft 365

| Field | Value |
|---|---|
| Mail server | `smtp.office365.com` |
| Encryption / port | STARTTLS (587) |
| Username | the mailbox address |
| Password | the mailbox password, or an app password where MFA is on |

Two things to know before choosing this one.

**SMTP AUTH is switched off by default** on each mailbox and an administrator
has to enable it. That is the usual reason this fails immediately with a
rejected password on an account whose password is correct.

**Microsoft is retiring it.** Signing in to SMTP with a username and password
is disabled by default for existing tenants from the end of December 2026, and
unavailable on tenants created after that. Administrators can still switch it
back on for now, and Microsoft has said it will announce a final removal date
during the second half of 2027. If you are choosing a mail route today, this
is the one with a deadline on it.

#### An internal relay

| Field | Value |
|---|---|
| Mail server | whatever your mail team gives you |
| Port | often `25` — type it into the port box; the dropdown only sets a default |
| Username / password | usually blank |

Most internal relays accept mail from a known address without a sign-in. Leave
the username and password empty and no credentials are sent. Encryption is
used if the relay offers it and skipped if it does not.

If the relay has its own certificate rather than one from a public authority,
the test will complain that it cannot be verified. Turning off **Check the
mail server's certificate** is the fix, and the cost is that the connection is
encrypted but no longer proof against interception — acceptable on a network
you control, not otherwise.

---

## Routine checks

Worth doing monthly, and worth doing before you need them rather than after:

1. **A backup exists and is recent.** Look in `backups\`. The newest file
   should be from last night.
2. **The `evidence` folder is in your backup too.** It is not in the nightly
   one, and it holds every document somebody attached.
2. **`crash.log` is empty or absent.**
3. **A backup actually restores.** Copy a backup over a test install and open
   it. An untested backup is a hope, not a plan.

---

## Deliberate omissions

- **Nothing is sent anywhere.** There is no telemetry, no crash reporting
  service, no update check. Logs stay on the machine until somebody sends
  them.
- **Logs are not encrypted at rest.** They live inside a folder only
  administrators and signed-in users can reach. If that is not enough for your
  environment, encrypt the volume.
- **There is no log shipping.** No syslog, no Windows Event Log, no agent. If
  you need logs in a central system, point your collector at the `logs`
  folder; the JSON lines are meant to be parsed.
