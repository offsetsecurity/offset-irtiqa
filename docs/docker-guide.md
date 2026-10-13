# Offset Irtiqa on Docker, step by step

This guide assumes you have never used Docker. Every step says what to type
and what you should see afterwards. If what you see does not match, stop and
look at **Something went wrong** at the end - the error is probably listed.

You need: a computer, a mouse, and the ability to open Command Prompt.

Roughly 20 minutes, most of it waiting for downloads.

---

# Part 1. Do you already have Docker?

**1.1** Open Command Prompt.

Press the Windows key, type `cmd`, press Enter. A black window opens with
white text. This is where you type commands.

**1.2** Click inside that black window and type this, then press Enter:

    docker --version

**1.3** Look at what it says.

**If you see something like this**, you have Docker. Skip to Part 3:

    Docker version 29.7.2, build 1a2b3c4

**If you see this**, you do not have it yet. Go to Part 2:

    'docker' is not recognized as an internal or external command

---

# Part 2. Installing Docker

Only if Part 1 said you do not have it.

**2.1** Open your web browser and go to:

    https://www.docker.com/products/docker-desktop

**2.2** Click the **Download for Windows** button.

A file called something like `Docker Desktop Installer.exe` downloads. It is
large - about 600 MB - so this takes a few minutes.

**2.3** When it finishes, double-click that file.

**2.4** A window appears with some tick boxes. Leave them as they are. Click
**OK**.

**2.5** Wait. It installs for a few minutes and then says **Installation
succeeded**. Click **Close and restart** if it offers.

Your computer may restart. That is normal. Let it.

**2.6** After restarting, open Docker Desktop: press the Windows key, type
`Docker`, press Enter.

**2.7** The first time, it shows a licence agreement. Click **Accept**. It may
ask you to sign in or create an account - you can skip that, look for
**Continue without signing in** or just close the sign-in box.

**2.8** Now wait. Look at the bottom-left corner of the Docker Desktop window.
There is a small whale icon and a word next to it.

- **Starting** - wait, it is not ready
- **Running** - ready. This is what you want

The first start can take two or three minutes. Leave it alone until it says
Running.

**2.9** Leave Docker Desktop open. It must be running whenever you use the
product. It starts by itself when you switch your computer on.

**2.10** Check it worked. Open a **new** Command Prompt - close the old one
first, it will not know about Docker yet - and type:

    docker --version

You should now see a version number. If you do, Docker is installed.

---

# Part 3. Getting Offset Irtiqa

**3.1** Download this file from the release page:

    offset-ascend-0.2.3-docker.zip

It is small, about 6 KB. It is not the product - it is the instructions
Docker needs to fetch the product for you.

**3.2** Make a folder for it. In File Explorer, go to your C: drive and make
a folder called `Offset`, and inside that one called `Irtiqa`.

So you end up with:

    C:\Offset\Irtiqa

**3.3** Right-click the zip file you downloaded, choose **Extract All**,
and extract it into that folder.

**3.4** Open that folder. You should see exactly three files:

    compose.yaml
    env.example
    README.txt

If you see a folder inside the folder instead, open it and move those three
files up one level.

---

# Part 4. Your settings file

**4.1** Open Command Prompt again (Windows key, `cmd`, Enter).

**4.2** Tell it to work in your new folder. Type this and press Enter:

    cd C:\Offset\Irtiqa

`cd` means "change directory" - it is how you tell the black window which
folder to work in. The text at the left of the window changes to show the
folder you are now in. It should end with `Irtiqa>`.

**4.3** Make your own copy of the settings file:

    copy env.example .env

It says **1 file(s) copied.**

Why copy it: `env.example` is the blank one we ship. `.env` is yours, with
your settings in it. Keeping them separate means an update can never
overwrite your settings.

**4.4** Open your copy in Notepad:

    notepad .env

Notepad opens with a lot of text in it. Most of it is explanations, with a #
at the start of each line. Those lines do nothing - they are just notes to
you.

**4.5** Scroll down until you find these two lines. They have nothing after
the equals sign:

    SESSION_SECRET=
    FIELD_ENC_KEY=

These are two passwords the product uses internally. You never type them
again, and you never tell anyone. They just have to exist, and they have to
be long and random.

**4.6** Leave Notepad open. Go back to the Command Prompt window and type
this, then press Enter:

    docker run --rm node:24-alpine node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

The first time, this downloads a small helper - you will see some progress
bars. Then it prints one long line of letters and numbers.

It is 64 characters long, it is different every time, and no two people
ever get the same one. It is not printed here on purpose: an example
somebody copies is not a secret any more.

That is all it does. It makes one random value and prints it.

**4.7** Copy that line. In Command Prompt you copy by selecting the text with
your mouse and pressing Enter - that copies it.

**4.8** Go to Notepad. Click right after `SESSION_SECRET=` and paste
(Ctrl+V). The line now looks like:

    SESSION_SECRET=<the long line you just copied>

**4.9** Now do it again for the second one. Go back to Command Prompt, press
the Up arrow to bring back the same command, press Enter. It prints a
**different** line. Copy that one, and paste it after `FIELD_ENC_KEY=`.

The two must be different from each other. That is the whole point.

**4.10** In Notepad, press Ctrl+S to save, then close Notepad.

**Keep this file safe.** If you lose those two values: everyone is signed out,
and any password the product has stored cannot be read back. Back the file up
somewhere, or at least do not delete the folder.

---

# Part 5. Choosing a port

A port is a numbered door on your computer. Only one program can use a door
at a time. The product uses **8080** unless you tell it otherwise.

**5.1** Check whether anything is already using 8080. In Command Prompt:

    netstat -ano | findstr :8080

**If nothing is printed**, port 8080 is free. Skip to Part 6.

**If you see a line of numbers**, something is already using it. Pick another
number - 8081, 8082, 8090, anything up to 65535 - and check that one the same
way until you find a free one.

**5.2** If you had to change it, open your settings again:

    notepad .env

Find these **two** lines and change the number in both. They must match:

    HTTP_PORT=8080
    PUBLIC_URL=http://localhost:8080

If you chose 8085, they become:

    HTTP_PORT=8085
    PUBLIC_URL=http://localhost:8085

Why both: the first is the door it listens on. The second is the address the
product writes into the emails it sends. If they differ, your colleagues get
emails with links that go nowhere.

Save with Ctrl+S and close Notepad.

---

# Part 6. Starting it

**6.1** Make sure Docker Desktop is open and says **Running** at the bottom
left.

**6.2** In Command Prompt, make sure you are still in your folder. The text
at the left should end with `Irtiqa>`. If not:

    cd C:\Offset\Irtiqa

**6.3** Type this and press Enter:

    docker compose up -d

**6.4** Wait. The first time, this downloads the product - about 200 MB - so
give it a few minutes on a normal connection. You will see lines of progress
bars scrolling past.

**6.5** When it finishes you see three lines ending in **Started**, something
like:

    Container offset-ascend-app-1      Started
    Container offset-ascend-worker-1   Started
    Container offset-ascend-updater-1  Started

That is it. The product is running.

**What those three are:** the first is the product itself. The second does
the quiet jobs - reminder emails, nightly backups. The third installs
updates later, when you ask it to.

---

# Part 7. Opening it

**7.1** Open your web browser.

**7.2** Go to:

    http://localhost:8080

(or whatever port you chose in Part 5)

**7.3** The first screen asks you to create the administrator account. Fill
it in and submit.

Do this straight away. Until you do, anyone who can reach that address could
create it instead of you.

**7.4** You are in. That is the install finished.

---

# Part 8. The five commands you will use

All of these must be typed in your folder - `cd C:\Offset\Irtiqa` first.

**Is it running?**

    docker compose ps

**Stop it** (your data is kept):

    docker compose down

**Start it again:**

    docker compose up -d

**See what it is doing** (press Ctrl+C to stop watching):

    docker compose logs -f app

**Danger.** This one deletes everything - your accounts, your evidence, all
of it, with no undo:

    docker compose down -v

The difference is that `-v` on the end. Without it, your data is safe. With
it, your data is gone. Do not type it unless you mean it.

---

# Part 9. Where your data is

Not in the folder you made. Docker keeps it in its own storage, called a
volume, so that stopping and restarting never touches it.

You do not need to find it. To back it up, use **Backups** inside the
product - Settings, then Backups - which writes a file you can copy anywhere.

---

# Part 10. Something went wrong

**"'docker' is not recognized as an internal or external command"**

Docker is not installed, or you opened Command Prompt before installing it.
Close the black window, open a new one, and try again. If it still says this,
go back to Part 2.

**"Cannot connect to the Docker daemon" or "Docker Desktop is not running"**

Docker Desktop is not open, or has not finished starting. Open it from the
Start menu and wait until the bottom left says **Running**.

**"no configuration file provided: not found"**

You are in the wrong folder. The black window must be in the folder holding
`compose.yaml`. Type:

    cd C:\Offset\Irtiqa

and try again.

**"port is already allocated" or "bind: address already in use"**

Something else is using that port. Go back to Part 5 and pick another number,
remembering to change both lines.

**"pull access denied" or "repository does not exist"**

Your `.env` is naming an image that cannot be reached. Open it and check
these two lines are exactly as shipped:

    OFFSET_IMAGE=ghcr.io/offsetsecurity/offset-ascend:latest
    OFFSET_UPDATER_IMAGE=ghcr.io/offsetsecurity/offset-ascend-updater:latest

**The page will not load in the browser**

Check it is running with `docker compose ps`. All three should say **Up**.
If one says **Exited**, look at why:

    docker compose logs app

**The product says it cannot start because a secret is missing**

Part 4 did not save properly. Open `notepad .env` and check that both
`SESSION_SECRET=` and `FIELD_ENC_KEY=` have a long line of letters and
numbers after the equals sign, with no spaces.

**Still stuck**

Send us this, and we will tell you what it means:

    docker compose logs app > logs.txt

That writes a file called `logs.txt` in your folder. Email it to
info@offsetsecurity.net.

---

# On Linux instead of Windows

The steps are the same. The differences:

- Install Docker with your package manager, or the script at
  https://get.docker.com
- `cp env.example .env` instead of `copy env.example .env`
- `nano .env` instead of `notepad .env`
- `ss -ltn | grep 8080` instead of the netstat command

Everything else - the same commands, the same order.

---

Offset Security - info@offsetsecurity.net
