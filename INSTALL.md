# Installing Offset

Free to use. See [LICENSE](LICENSE).

This guide is for whoever installs and looks after it. You do not need to be a
developer, but you do need to be an administrator on the machine.

**Pick one:**

| Your situation | Go to |
|---|---|
| A Windows computer or server | [Windows](#windows) |
| A Linux server | [Linux](#linux) |
| A server running Docker | [Docker](#docker) |

Then everyone should read [First run](#first-run) and
[Turning on HTTPS](#turning-on-https).

---

## What you can install it on

| Platform | How |
|---|---|
| **Windows** | An installer, `.exe`. Node is bundled, so the machine needs nothing |
| **Linux** | An installer, as systemd services (Linux's way of running a program in the background). Node is bundled here too. Or Docker |
| **macOS** | Not supported. Use Linux or Windows for the server |

What you download:

| Framework | Windows installer | Linux installer |
|---|---|---|
| SAMA Cyber Security Framework | `OffsetIrtiqa-0.1.5-setup.exe` | `offset-ascend-0.1.5-linux-x64.tar.gz` |

The version number in the file names changes with each release.

Both carry a `docs` folder. In it: this guide, the user guide and the
datasheet; the security overview, the privacy sheet and the security
questionnaire, for whoever reviews software before you install it; a page on
what the product is built with; the troubleshooting guide; and the release
notes. The Windows installer adds a
Start menu shortcut to it, and the Linux installer copies it to
`/opt/offset-ascend/docs`. The same help is inside the product,
under **Help** and **Documentation**.

**Two products on one machine** need different ports: `HTTP_PORT=` in each
one's `.env` on Docker, `PORT=` on Windows and Linux. For example 8081 for one
and 8082 for the other. Their data never mixes: each keeps its own database,
backups and evidence.

### Check the port is free first

8080 is a popular port. If something already has it, the application starts,
fails to take the port, and stops with `EADDRINUSE` in its log — which reads
like a fault in the product and is not one.

Check before you install:

```powershell
# Windows
Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue
```

```bash
# Linux
ss -ltn 'sport = :8080'
```

Nothing printed means the port is free. Anything printed means pick another, or
stop whatever is using it.

**Changing it later is safe.** No data is affected. Edit the same setting,
change `PUBLIC_URL` to match, then restart it: `docker compose up -d` on Docker,
`systemctl restart offset-<product> offset-<product>-worker` on Linux, or close
and reopen the window on Windows.

(`systemctl` is the command Linux uses to start and stop background programs.
The product runs as two of them: the application, and the worker that sends
reminders and takes backups.)

---

## Before you start

**Decide who needs to reach it.**

Out of the box it answers **only the computer it runs on**. That is the safe
setting and it needs nothing extra.

If colleagues need to reach it across the network, you must give it a
certificate first. It will refuse to start otherwise, because without one every
password would cross the network as readable text. That is covered in
[Turning on HTTPS](#turning-on-https).

**What it needs:** about 300 MB of disk, and one free port (8080 by default).
Nothing else. No database to install, no runtime to install.

---

## Windows

### Option A — the installer

1. Run **`OffsetIrtiqa-0.1.0-setup.exe`**.

2. Windows will say **"Windows protected your PC"**.

   This is expected. The software is not code signed yet. Click **More info**,
   then **Run anyway**.

3. Accept the licence and choose where to install it. The default is fine.

4. On the **Background service** page, decide:

   - **Leave it unticked** if one person will start it when they need it.
   - **Tick it** if it should start with Windows and keep running when nobody
     is signed in. This is what you want on a server.

5. Finish.

**What it puts where:**

| | |
|---|---|
| `C:\Program Files\Offset Security\Offset Irtiqa\` | The program: the application, its own copy of Node.js, the uninstaller and the documents. Replaced whole on an upgrade. Nothing you enter is stored here |
| `C:\ProgramData\Offset Security\Offset Irtiqa\data\` | The database (`offset.db`) |
| `C:\ProgramData\Offset Security\Offset Irtiqa\evidence\` | Uploaded evidence documents |
| `C:\ProgramData\Offset Security\Offset Irtiqa\backups\` | Backups: the nightly one, and those taken before an update or a restore |
| `C:\ProgramData\Offset Security\Offset Irtiqa\logs\` | Logs. This is what support asks for |
| `C:\ProgramData\Offset Security\Offset Irtiqa\.env` | Settings, the port, and the two secrets |

The data is in ProgramData rather than Program Files because Program Files is
read-only for ordinary users and the application has to be able to write its
own database. **ProgramData is a hidden folder:** in File Explorer, turn on
View, then Show, then Hidden items, or type the path into the address bar.

**Back up** the `data`, `evidence` and `backups` folders, and keep a copy of the
`.env` file somewhere safe. The `.env` holds the encryption key; without it a
restored database cannot read the stored mail password.

### Installing again on the same machine

Uninstalling removes the program and leaves your data. So **installing again
finds the old data and uses it**: the same administrator and password, the same
users and records, the same settings, and the same port. The installer shows a
Network port page that says it found data from an earlier install. You will not
be asked to create an administrator, because one already exists.

That is what you want after a reinstall or an upgrade. If you wanted a clean
start instead:

1. Uninstall Offset Irtiqa: Settings, then Apps, then Offset Irtiqa, then Uninstall.
2. Delete the folder `C:\ProgramData\Offset Security\Offset Irtiqa`.
3. Install again. It asks for a new administrator.

**Deleting that folder erases the database, the evidence, the backups and the
secrets, and there is no undo.** Take a copy of the folder first if there is
any chance you will need it.

If you only forgot the administrator password, do not start fresh: see
*Locked out* below.

### Starting and stopping it

**If you did not tick the service box**, use the Start Menu shortcut. A window
opens and stays open. Closing that window stops it.

**If you did tick it**, it is already running and will start with Windows. To
turn that off later, open PowerShell as administrator in the install folder:

```powershell
.\service\uninstall-service.ps1
```

To turn it on later:

```powershell
.\service\install-service.ps1
```

### Option B — the portable zip

No installer, nothing written to the registry.

1. Unzip it anywhere you can write to.
2. Double-click **`Start Offset Irtiqa.cmd`**.
3. Leave the window open.

Everything lives inside that folder. To move it to another machine, copy the
whole folder, including the hidden `.env` file.

---

## Linux

Two ways. Pick one.

| | Use it when |
|---|---|
| **The installer** | An ordinary server you administer. Installs as systemd services |
| **Docker** | You already run containers, or you want it isolated |

### Which distributions

The installer needs a **64-bit Intel or AMD** server (x86_64), **systemd**, and
**glibc 2.28 or newer**. Node is inside the bundle, so there is nothing to
install first.

| Distribution | Versions | |
|---|---|---|
| Ubuntu | 22.04, 24.04 | Tested |
| Debian | 12 | Tested |
| Red Hat Enterprise Linux | 8, 9 | Tested |
| Rocky Linux, AlmaLinux, Oracle Linux | 8, 9 | Same as RHEL, not tested separately |
| Amazon Linux | 2023 | Tested |
| SUSE Linux Enterprise, openSUSE Leap | 15 SP3 and later | Tested on Leap 15.6 |
| Ubuntu 20.04, Debian 11 | | Should work. Both are past or near end of support |

"Tested" means installed, used, upgraded and removed on that release, with the
application answering and the worker taking its first backup.

**Not supported by the installer:**

| | Why | Instead |
|---|---|---|
| Alpine, and anything else built on musl | The bundled Node needs glibc | Docker |
| RHEL 7, CentOS 7, Amazon Linux 2 | glibc too old | Docker, or upgrade the server |
| ARM servers (Graviton, Ampere) | The bundle is x86_64 only | Not available yet |
| Anything without systemd | Nothing to run the services | Docker |

On a server that cannot run it, the installer stops before writing anything and
says why.

### The installer

Unpack the release, check it arrived intact, and run the
installer:

```bash
sha256sum --check offset-ascend-0.1.0-linux-x64.tar.gz.sha256
tar xzf offset-ascend-0.1.0-linux-x64.tar.gz
cd offset-ascend
sudo ./install.sh
```

It takes about a minute and tells you everything it did. To use a different
port, set it first:

```bash
sudo PORT=9000 ./install.sh
```

**What it puts where:**

| | |
|---|---|
| `/opt/offset-<product>` | The application and its own copy of Node. Replaced whole on an upgrade |
| `/var/lib/offset-<product>` | Database, evidence, backups, logs. **Never touched by an upgrade** |
| `/var/lib/offset-<product>/.env` | Settings and the two secrets, readable only by the service |
| `/etc/systemd/system/offset-<product>.service` | The application |
| `/etc/systemd/system/offset-<product>-worker.service` | The worker: reminder emails and the nightly backup |

Both run as their own system account with no shell and no home directory, under
systemd restrictions that stop them reaching anything outside their own data.

**Both services matter.** If only the application is running, every screen
works and nobody is ever sent a reminder or backed up.

Afterwards:

```bash
systemctl status offset-ascend offset-ascend-worker     # are they running
systemctl restart offset-ascend offset-ascend-worker    # after changing .env
journalctl -u offset-ascend -u offset-ascend-worker -f  # watch the logs
```

**Back up `/var/lib/offset-<product>`.** It holds the database, the evidence
files and the encryption key. None of it can be recovered from anywhere else,
and the key is what makes the stored mail password readable.

To let colleagues reach it, edit the `.env`, set `HOST=0.0.0.0`, give it a
certificate, and restart. Without a certificate it refuses to start rather than
send passwords across your network in clear. See
[Turning on HTTPS](#turning-on-https).

**Upgrading** is the same command with a newer bundle. Your data, your settings
and your secrets are left alone.

**Removing it:**

```bash
sudo ./uninstall.sh ascend                 # keeps the data
sudo ./uninstall.sh ascend --delete-data   # removes it. No undo
```

### Docker

You need Docker and the Compose plugin. Nothing else.

```bash
cd deploy/docker
cp env.example .env
```

`PRODUCT=ascend` is already set for you; this image carries no other product.

Now fill in the two secrets `.env` asks for. Generate each one with:

```bash
docker run --rm node:24-alpine node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Run that **twice**. Put the first value after `SESSION_SECRET=` and the second
after `FIELD_ENC_KEY=`.

**Keep that file.** Without the same `SESSION_SECRET` everyone is signed out on
the next restart. Without the same `FIELD_ENC_KEY`, saved secrets such as the
mail password cannot be read back.

Then:

```bash
docker compose up -d --build
```

Two containers start: the application, and a background worker that sends the
reminder emails and takes the nightly backup. Their data lives in volumes named
after the product, such as `offset-ascend_data`, so two products on one machine
never share a database.

Useful afterwards:

```bash
docker compose logs -f app    # watch it
docker compose down           # stop it, keeping all data
docker compose down -v        # ALSO DELETES THE DATABASE. No undo.
```

**HTTPS on Docker.** Make a folder called `certs` beside `compose.yaml`, put
your certificate and its key in it as `cert.pem` and `key.pem`, and add to
`.env`:

```ini
TLS_CERT_FILE=/app/certs/cert.pem
TLS_KEY_FILE=/app/certs/key.pem
PUBLIC_URL=https://localhost:8080
```

Then `docker compose up -d`. The address becomes `https://` on the same port,
and plain `http://` is sent on to it. On a Linux host the key must be readable
by the container's user, uid 10001. Browsers warn about a certificate they do
not trust; see [Trusting the certificate](#trusting-the-certificate).

**Easier:** skip all of that and upload the certificate on the Settings screen
instead. See [Turning on HTTPS](#turning-on-https).

---

## Docker

You need Docker and the Compose plugin. Pull the image and
start it:

```bash
docker pull ghcr.io/offsetsecurity/offset-ascend:0.1.5
```

`deploy/docker/compose.yaml` and `env.example` in this repository show the
settings; copy `env.example` to `.env`, fill in the two secrets it asks for,
and run `docker compose up -d`.

The server needs to reach the registry to pull. Everything after that - the
database, the evidence, the backups - stays on the machine.

---
## First run

Open the address in a browser:

```
http://localhost:8080
```

**The first person to open it creates the administrator account.** There is no
default username and no default password, so there is nothing to forget to
change.

Do this immediately after installing. Until somebody does it, anyone who can
reach the address could claim the first account.

After that, add your colleagues under **Users**.

---

## Turning on HTTPS

Skip this if only one person uses it on one machine. `http://localhost` never
leaves the computer and browsers do not warn about it.

**Do not skip it if anyone reaches it over the network.** Without HTTPS the
browser shows **"Not secure"**, and passwords cross the network as plain text.

It costs nothing. You do not need to buy a certificate.

### Step 1 — get a certificate

Three ways, best first:

| Where it comes from | Warning in browser? | Cost | Good for |
|---|---|---|---|
| Your company's own certificate authority | None | Free | Office networks. Ask your IT team — this is routine for them. |
| Let's Encrypt | None | Free | A server with a public DNS name. |
| Self-signed, made below | Yes, every time, until you trust it | Free | Testing, or one machine. |

**What to ask your IT team for:** a web server certificate for the name people
will type to reach this server, such as `grc.yourcompany.local`. Ask for it as
a `.pfx` file with a password, or as a certificate and key in PEM files
(`.crt` or `.pem`, and `.key`). Either works.

You cannot buy one certificate that works for every customer. A certificate is
issued for one address, and public certificate companies will not issue one
for a private address like `.local` or `10.0.0.5`. That is why it comes from
the company's own IT team.

To make a self-signed one instead:

```bash
openssl req -x509 -newkey rsa:2048 -nodes -days 825 \
  -keyout offset-key.pem -out offset-cert.pem \
  -subj "/CN=offset.yourcompany.local" \
  -addext "subjectAltName=DNS:offset.yourcompany.local,DNS:localhost,IP:127.0.0.1"
```

Change `offset.yourcompany.local` to the name people will actually type. The
certificate is only valid for the names listed there.

**Keep the key file private.** Anyone who has it can impersonate your server.

### Step 2 — upload it on the Settings screen

1. Sign in as an administrator and open **Settings → HTTPS certificate**.
2. Click **Choose files**. Pick the `.pfx` file, or pick the certificate and
   its key together. A `fullchain.pem` and `privkey.pem` from Let's Encrypt
   also work.
3. Type the password, if the file has one.
4. Click **Upload certificate**.

Before anything changes, it checks the certificate and tells you in plain words
if something is wrong: the key does not belong to the certificate, the password
is wrong, it has expired, or the key is too weak. Those are refused.

Some things are allowed, but shown to you first, so you can stop before you
replace a certificate that works:

- It is self-signed, so browsers will still warn.
- It is not issued for the address in `PUBLIC_URL`.
- It expires within 30 days.

**When it takes effect:**

- **Already on HTTPS:** at once. No restart. This is how you renew it each year.
- **Still on plain HTTP:** after a restart. The screen shows the exact steps.

| Install | Restart with |
|---|---|
| Windows | Restart the server, or close the window and start it again if it runs in a window |
| Linux | `sudo systemctl restart offset-<product>` |
| Docker | `docker compose restart app`, in the folder with `compose.yaml` |

After the restart the address is `https://` on the same port. Old `http://`
links, bookmarks and the Start menu shortcut still work: they are sent on to
`https://` automatically.

**Where it is kept:** in a `tls` folder beside the database, in the data
folder. It is not in the backups, on purpose: a backup handed to someone should
not let them pretend to be your server. Keep your own copy of the certificate
file, as you would anyway. If it came as a `.pfx`, its password is stored
encrypted with `FIELD_ENC_KEY`, like the mail password.

**To go back to plain HTTP**, click **Remove uploaded certificate** and restart.
It will not let you do that while the server answers other computers, because
it would then refuse to start.

### Step 3 — let other computers reach it

Out of the box only the server itself can open the product. To let colleagues
in, edit the settings file (`.env`, see the table for your install above) and
set:

```ini
HOST=0.0.0.0
PUBLIC_URL=https://grc.yourcompany.local:8080
```

Use the name on the certificate, and your port. `PUBLIC_URL` is the address
put in emails. Then restart it.

On **Docker**, `HOST` is already right inside the container. Instead, in
`compose.yaml`, change the port line from `"127.0.0.1:${HTTP_PORT:-8080}:8080"`
to `"${HTTP_PORT:-8080}:8080"`, then run `docker compose up -d`.

If you set `HOST=0.0.0.0` without a certificate, **it will refuse to start** and
tell you so. That is deliberate.

### Or: name the files in the settings file

If you manage certificates with your own tools, you can point the product at
the files instead of uploading. Edit `.env` and set:

```ini
TLS_CERT_FILE=C:\path\to\offset-cert.pem
TLS_KEY_FILE=C:\path\to\offset-key.pem
```

Then restart it. A certificate uploaded on the Settings screen takes priority
over these two, so remove it there if you switch to this way.

> **Already have a proxy?** If IIS, nginx or a load balancer in front of this is
> already handling HTTPS, leave `TLS_CERT_FILE` blank and set
> `ALLOW_INSECURE_NETWORK=true` instead. That says the encryption is somebody
> else's job, which is true in that setup.

---

## Trusting the certificate

**Only needed for a self-signed certificate.** A certificate from your company's
CA or from Let's Encrypt is already trusted and this whole section can be
skipped.

Without this, everyone sees **"Your connection is not private"** every single
time. People learn to click through security warnings, which is a worse habit
than the warning is worth.

Install the **certificate** (`offset-cert.pem`). Never the key.

### Windows — one machine

1. Press <kbd>Win</kbd>+<kbd>R</kbd>, type `certlm.msc`, press Enter.
2. Open **Trusted Root Certification Authorities → Certificates**.
3. Right-click → **All Tasks → Import**.
4. Choose `offset-cert.pem`. If you cannot see it, change the file type filter
   to **All Files**.
5. When asked, choose **Place all certificates in the following store** and
   leave it on **Trusted Root Certification Authorities**.
6. Finish, then **close and reopen the browser**.

Or in PowerShell as administrator:

```powershell
Import-Certificate -FilePath "C:\path\to\offset-cert.pem" `
  -CertStoreLocation Cert:\LocalMachine\Root
```

This covers **Chrome and Edge**, which use the Windows store.

### Windows — everyone in the company

Do not visit every desk. Push it with Group Policy:

**Computer Configuration → Policies → Windows Settings → Security Settings →
Public Key Policies → Trusted Root Certification Authorities** → right-click →
**Import**.

Every machine in the domain picks it up at the next policy refresh.

### Firefox — read this

**Firefox ignores the Windows certificate store.** It keeps its own list, so the
steps above do nothing for it.

Either:

- Type `about:config`, accept the warning, search for
  `security.enterprise_roots.enabled`, and set it to **true**. Firefox then also
  uses the Windows store.

- Or import it directly: **Settings → Privacy & Security → Certificates →
  View Certificates → Authorities → Import**, choose the file, and tick
  **Trust this CA to identify websites**.

### Linux

For the system and for command-line tools:

```bash
sudo cp offset-cert.pem /usr/local/share/ca-certificates/offset.crt
sudo update-ca-certificates
```

On Red Hat, Fedora or Rocky:

```bash
sudo cp offset-cert.pem /etc/pki/ca-trust/source/anchors/offset.crt
sudo update-ca-trust
```

**Chrome on Linux does not use that store either.** It has its own:

```bash
certutil -d sql:$HOME/.pki/nssdb -A -t "C,," -n "Offset" -i offset-cert.pem
```

Install `certutil` first if needed: `sudo apt install libnss3-tools`.

Firefox on Linux: same as Firefox on Windows, import it in the settings.

### Checking it worked

Close the browser completely and reopen it. Go to the address.

**No warning, and a padlock** means it worked.

Still warned? The usual causes, in order:

1. The browser was not restarted.
2. It is Firefox, and you did the Windows store instead of Firefox's.
3. The name you typed is not one of the names in the certificate. `localhost`
   and `offset.company.local` are different names; the certificate must list the
   one you are using.

---

## Email (optional)

Everything works without it. Email only adds notifications.

**Settings → Outgoing email**, as an administrator.

If you use Resend, pick it as the provider and there are two boxes: the API key
and the from address. Everything else is filled in for you.

For anything else, choose **Any SMTP server** and fill in your relay's details.
Known-good settings for Microsoft 365, Google Workspace, Amazon SES and an
internal relay are in
[logs and troubleshooting](docs/ops/logs-and-troubleshooting.md).

Use **Send a test message** before turning it on. The test tells you whether the
server rejected your password or the recipient, which are different problems.

---

## Backups

A backup is taken every night automatically. The folder keeps the newest
three backups in all, of every kind: nightly, taken by hand, and made before an
update or a restore. Change the number with `BACKUP_KEEP` in the settings file. **Each backup is one file holding the database and every evidence
document.**

An administrator manages them under **Backups** in the menu:

| Button | What it does |
|---|---|
| **Take a backup now** | Takes one straight away, without stopping anything |
| **Download** | Saves a backup file to your computer |
| **Upload a backup** | Adds a backup file from your computer to the list. It is checked first: a file that is damaged, is not an Offset backup, is from a different product, or is from a newer version is refused |
| **Restore** | Replaces everything with what is in that backup |

**Restoring.** Press **Restore** on a backup and type `RESTORE` to confirm. Then:

1. A backup of everything as it is now is taken first, named "Before a
   restore". If you restored the wrong one, restore that one to undo it.
2. The database and the evidence documents are replaced. Nobody can use the
   product for the few seconds this takes.
3. Everyone is signed out, and signs in again with the accounts and passwords
   as they were in the backup.

Nothing needs to be stopped or restarted.

**Moving to a new server.** Install the same product on the new server, create
the first account, then **Upload a backup** and **Restore** it. Keep a copy of
the old `.env` too: without the same `FIELD_ENC_KEY` the mail password has to be
entered again under Settings. Nothing else is lost.

**Keep copies somewhere else.** **Download** one regularly and put it somewhere
that is not this machine. A backup on the same disk as the original protects
you from exactly one kind of accident, and not the common one.

**A backup file holds every password hash and every document.** Store it as
carefully as the server itself.

**Test a restore before you need one.** An untested backup is a hope.

Backups taken before an update, and any taken before this version, hold the
database only. They restore the same way; evidence documents already on the
server are left as they are.

From the command line, the same full backup:

| Install | Command |
|---|---|
| Docker | `docker compose exec app node dist/db/backup.js` |
| Linux | `sudo runuser -u offset-<product> -- sh -c 'cd /var/lib/offset-<product> && /opt/offset-<product>/node/bin/node /opt/offset-<product>/dist/db/backup.js'` |

It appears in the Backups list like any other.

---

## Updating

Every version is numbered x.y.z, for example 1.4.2:

| Change | Example | What it means for you |
|---|---|---|
| Last number | 1.4.2 → 1.4.3 | Fixes only. Safe to install at any time |
| Middle number | 1.4.3 → 1.5.0 | New features. Nothing you rely on is taken away, and your data moves across on its own |
| First number | 1.5.0 → 2.0.0 | Something works differently. The release notes say what, and what to do |

An administrator can install a new version from **Settings → Updates**:
**Check for updates**, read what changed, then **Update**.

What happens when you press it:

1. A backup of the database is taken.
2. The new version is downloaded and checked against Offset Security's
   signature. Anything unsigned, altered, or older than what you have is
   refused, and nothing changes.
3. It is installed and restarted. Expect a minute or two when nobody can use
   it.
4. If the new version does not start properly, the previous version and the
   database are put back automatically.

Your data, settings and secret keys are never touched by an update.

**The server needs to reach `github.com` over HTTPS** to check and download.
It only does so when somebody presses the button; it never checks on its own.
A server that cannot reach it updates the way it was installed: run the newer
installer, or pull the newer image.

**How each kind of install does it:**

| | |
|---|---|
| **Windows installer** | A task called *Offset … Updater* runs as SYSTEM and does the install. Untick **Let administrators install updates from Settings** during setup to leave it out. If the product does not run as a background service, start it again after updating |
| **Linux installer** | A service, `offset-<product>-updater`, starts when an update is requested, installs it as root, and stops |
| **Docker** | An `updater` container, started alongside the product because `env.example` sets `COMPOSE_PROFILES=updates`. Delete that line from your `.env` if your policy does not allow a container access to the Docker socket; updates are then a pull and a restart by hand |
| **Portable zip, or Docker built from source** | No one-click update. Use the newer zip, or `git pull` and rebuild |

Whatever the kind, updating by running the newer installer still works too.

---

## If something goes wrong

Look in the `logs` folder next to `data`.

Send `launcher.log` and `crash.log` first. They are small, and between them they
explain most failures. Passwords and keys are stripped before anything is
written, so they are safe to send.

[Logs and troubleshooting](docs/ops/logs-and-troubleshooting.md) has a
symptom-by-symptom table.

---

## Locked out

An administrator who has forgotten their password normally uses **Forgot
password?** on the sign-in page, which emails a temporary password. That needs
email to be set up. When it is not, or the only administrator's address is
wrong, issue the temporary password at the server instead. It works the same
way: once, for 30 minutes, and only to choose a new password.

Replace `admin` with the administrator's username.

**Docker**, from the install folder:

```bash
docker compose exec app node dist/admin/reset-password.js admin
```

**Linux:**

```bash
sudo /opt/offset-ascend/reset-password.sh admin
```

**Windows:** open the Start menu, find **Reset Offset Irtiqa administrator
password**, right-click it and choose **Run as administrator**. Type the
administrator's username when it asks. The same file is in the install folder,
`C:\Program Files\Offset Security\Offset Irtiqa\Reset administrator password.cmd`.

It prints the temporary password. Sign in with it, and choose a new password.
Using it is recorded in the audit log.

---

## Removing it

**Windows:** Settings → Apps → Offset Irtiqa → Uninstall.

**Linux installer:** `sudo ./uninstall.sh ascend`, from the unpacked bundle.

**Docker:** `docker compose down`.

None of them deletes your data. The database, the backups, the evidence and
your settings stay exactly where they are. Delete the data folder by hand if you
really want it gone — there is no undo.

---

Questions: **info@offsetsecurity.net**
