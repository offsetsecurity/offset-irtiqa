# Installing Offset Irtiqa

Score every control from 0 to 5 against SAMA's own scale, and work towards level 3. For **SAMA Cyber Security Framework**, on your own server.

It runs on one machine, inside your network. No cloud account, no licence
server, and nothing leaves the machine you install it on.

## Before you start

| | |
|---|---|
| A server | 64-bit Windows or Linux. Under 150 MB of memory at rest |
| Disk | About 300 MB, plus whatever evidence you upload |
| A port | One. 8080 unless you choose another |
| Anything else | No. It brings its own Node.js, and needs no database server |

Up to about 50 users. For more, talk to us first.

---

## Windows

1. Download **OffsetIrtiqa-0.2.3-setup.exe**
2. Run it. Windows will warn you that the publisher is unknown - choose **More
   info**, then **Run anyway**. The installer is not code-signed yet
3. It asks which port to use, and offers one that nothing else is using.
   Accept it, or type your own
4. Finish. It installs itself as a background service, so it starts with
   Windows and keeps running with nobody signed in
5. The shortcut on your desktop opens it in your browser

The program goes in:

    C:\Program Files\Offset Security\Offset Irtiqa

Your data is kept outside the program folder, in:

    C:\ProgramData\Offset Security\Offset Irtiqa

That folder is hidden by default; type the path into File Explorer's address
bar to open it. The database, the evidence documents, the backups, the logs and
your settings are all in there. Back up that folder and you have backed up
everything.

**To remove it:** Settings, then Apps, then Offset Irtiqa, then Uninstall. Your
data is left behind on purpose.

**If you install it again,** it finds that data and uses it: the same
administrator and password, the same records, the same port. You will not be
asked to create an administrator. To start from nothing, uninstall, delete the
`C:\ProgramData\Offset Security\Offset Irtiqa` folder, then install. That erases
everything in it, and there is no undo.

---

## Linux

Ubuntu, Debian, RHEL, Amazon Linux and SUSE. It installs as two systemd
services.

1. Download **offset-ascend-0.2.3-linux-x64.tar.gz**
2. Unpack it and run the installer as root:

```bash
tar xzf offset-ascend-0.2.3-linux-x64.tar.gz
cd offset-ascend
sudo ./install.sh ascend
```

It picks a port nothing else is listening on and tells you which. To choose
one yourself:

```bash
sudo PORT=8085 ./install.sh ascend
```

Afterwards:

```bash
systemctl status offset-ascend          # is it running
journalctl -u offset-ascend -f          # watch the logs
```

Your data is in `/var/lib/offset-ascend`.

**To remove it:** `sudo ./uninstall.sh ascend` from the unpacked folder.
Add `--delete-data` only if you want the records gone too. There is no undo.

---

## Docker

Docker runs the product without installing anything else on the machine, and
it is the same on Windows and Linux.

**If you have never used Docker, follow the step-by-step guide instead:
[Installing Offset Irtiqa on Docker](docker-guide.md).** It starts with
installing Docker itself and says what you should see after every command.

The short version, for somebody who knows Docker already:

1. Download **offset-ascend-0.2.3-docker.zip** and unpack it
2. `cp env.example .env`, then fill in the two secrets it asks for
3. Change `HTTP_PORT` and `PUBLIC_URL` together if 8080 is taken
4. `docker compose up -d`

That pulls two images - the product and its updater - and starts three
containers.

```
ghcr.io/offsetsecurity/offset-ascend
ghcr.io/offsetsecurity/offset-ascend-updater
```

Your data lives in a Docker volume, not in that folder, so it survives
stopping and restarting. `docker compose down` keeps it; `down -v` deletes
it, with no undo.

---

## After installing, whichever way

Open it in a browser at the address it gave you - `http://localhost:8080`
unless you chose another port.

The first screen asks you to create the administrator account. Do that
straight away: until you do, anyone who can reach the address can create it.

Then, in order:

1. **Settings** - add your colleagues, and your logo for the reports
2. **Settings, Email** - point it at your mail server, so it can send
   reminders and password resets
3. **Get ready** - the plan. Start at the top

**HTTPS.** Out of the box it serves plain HTTP and only answers this machine.
To let colleagues reach it you must give it a certificate first - it refuses
to answer the network without one, rather than putting passwords on the wire
in clear. INSTALL.md, in the download, has the three lines this takes.

## Updating it

An administrator installs updates from **Settings**. It checks with us, shows
what is new, downloads it, checks our signature on it, installs it, and puts
the old version back if the new one does not start.

Nothing is downloaded or installed until somebody asks for it.

## Getting help

The whole guide - HTTPS, backups, restoring, moving to another machine,
what to do when something goes wrong - is **INSTALL.md**, inside every
download and in the `docs` folder after installing.

info@offsetsecurity.net
