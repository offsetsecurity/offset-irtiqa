# Using Offset

For the people who use it day to day. If you are installing it, read
[INSTALL.md](../INSTALL.md) instead.

You do not need to read this end to end. Find what you are trying to do.

| I want to | Go to |
|---|---|
| Understand what this is for | [What it does](#what-it-does) |
| Sign in the first time | [Getting in](#getting-in) |
| Know what the front page is telling me | [Dashboard](#dashboard) |
| Be told what to do next | [Get ready](#get-ready) |
| Check every risk is treated, and the proof is current | [Golden thread](#golden-thread) |
| Record what we have and have not done | [Controls](#controls) |
| Score maturity out of 5 | [Maturity scoring](#maturity-scoring) |
| Attach proof to a control | [Evidence on a control](#evidence-on-a-control) |
| Set deadlines and chase people | [Due dates and reminders](#due-dates-and-reminders) |
| Attach proof | [Evidence](#evidence) |
| Track risks | [Risks](#risks) |
| Plan a change safely | [Tasks](#the-other-registers) |
| Start a register from ready-made examples | [Sample library](#sample-library) |
| Read the guides inside the product | [Help and Documentation](#help-and-documentation) |
| Produce something for an auditor | [Reports](#reports) |
| Add a colleague | [Users](#users) |
| See who changed what, or give an auditor the record | [Audit trail](#audit-trail) |
| Take or restore a backup | [Backups](#backups) |
| Stop the browser saying "Not secure" | [Settings](#settings) |

---

## What it does

It keeps your compliance programme in one place, so that when somebody asks
"are we doing this, and can you show me" there is an answer.

**Offset Irtiqa** covers the **SAMA Cyber Security Framework**: 136 controls,
in SAMA's 32 subdomains and 4 domains, numbered as SAMA numbers them. The menu calls them Controls, and asks **how
mature is this?** You answer with a level from 0 to 5. Where this guide says
"status", read "maturity level".

The menu is on the left, in groups. Documentation and Help are at the bottom.
To make more room for the page, press the arrow at the top of the menu: it
shrinks to icons, and pointing at an icon shows its name. Press the arrow again
to bring the names back. Your browser remembers which way you left it.

**This does not make you compliant, and it is not an assessment.** It is a
place to record and show your own work. The assessment is SAMA's.

---

## Getting in

Your administrator gives you a username and a password, and the address, which
looks like `https://offset.yourcompany.local` or `http://localhost:8080`.

You may also get an email saying an account has been created. **It will not
contain your password.** That is deliberate: email is not a safe place to keep
one. Ask whoever set up your account.

### If you forget your password

**Everyone except administrators:** ask an administrator. They can set a new one
for you under **Users**.

**Administrators:** click **Forgot password?** on the sign-in page and enter
your username or email address. A temporary password is emailed to you.

- It works **once**, for **30 minutes**.
- Signing in with it takes you straight to **Choose a new password**. Nothing
  else opens until you have.
- Your old password keeps working until then, so if you remember it after all,
  just use it.
- Everywhere else you were signed in is signed out once the new password is set,
  and you get an email saying the password was changed.

The page says the same thing whatever you type, whether or not the account
exists. That stops anyone using it to find out who your administrators are. If
no email arrives, email may not be set up: ask another administrator, or see
**Locked out** in `INSTALL.md`.

To change your password when you do know it, use **Change password** at the top
right of any screen.

### If the browser warns you

**"Your connection is not private"** or **"Not secure"** means the server has
no certificate your browser trusts. Do not click through. Tell your
administrator: they can fix it for everyone in a few minutes, under
**Settings → HTTPS certificate**, with a certificate from your IT team. It costs
nothing.

### What you are allowed to do

Four roles. Yours is shown under your name, top right.

| Role | Can do |
|---|---|
| **Administrator** | Everything, plus adding people and changing settings |
| **Contributor** | Read and change all compliance data. Most people. |
| **Auditor** | Read everything, including the audit trail. Cannot change anything. |
| **Read only** | Read everything. Cannot change anything. |

If a button is missing or a change is refused, that is your role, not a fault.

---

## Get ready

If you have never done this before, start here.

It is a plan in 7 stages, from setting the product up to keeping it going,
working towards level 3 across the framework.
Each stage opens into a short list of steps, and each step says three things:
what to do, why it matters, and a button that takes you to the screen where you
do it.

### Your next step

The box with the blue border, under the stages, is the one thing to do now: the
first step not yet done, in the order of the plan. It says what to do and why,
with the same buttons as everywhere else: **Take me there**, **Assign it** and
**Does not apply to us**. Underneath, **After that** names the two steps that
follow.

**Nearly there** lists checks that are almost passing, such as "91 of 92 that
apply have an owner". Each is usually one or two fixes. It only appears when
there is something nearly done.

The golden thread box says how many links between your risks, what treats them
and the proof need fixing. Click it to open the [Golden thread](#golden-thread).

The page's longer introduction is behind **How this works**, at the top.

### Green on its own, or ticked by you

Every step is one of two kinds, and it says which:

- **Checked for you.** The product looks at its own data. "Score every control"
  goes green when they are all scored; until then it tells you how far off you
  are, like "104 of 136 answered". You cannot tick these by hand, and you do not
  need to.
- **Ticked by you.** Things no software can see: whether your board approved a
  policy, whether staff actually follow it, whether somebody was made
  accountable. You tick these, and the product records who ticked and when.

The difference is on purpose. A plan that claimed to verify "get management to
approve this" would be lying to you.

### Doing them out of order

Nothing is locked. The numbers are the order most organisations find easiest,
not a rule. If you want to write your policies before assessing anything, click
stage 4 and do it. The rings along the top show where everything stands:
each one fills as its steps are done, and turns solid green with a tick when the
stage is finished. The stage suggested next says **next** under it.

### If something does not apply to you

Any step can be excluded, and the product asks why. Excluded steps stop counting
against you — a stage of four steps with one excluded is finished when the other
three are done.

The same is true of controls. Open one and there is **Does this apply to you?**
near the top. Say no, write the reason, and it comes out of your average, your
percentage and your charts. Your score is kept, so if you change your mind you
get the assessment back rather than doing it again.

**Be strict with yourself.** "We have no payment systems" is a reason. "We have
not got round to it" is not — that one is just outstanding, and an assessor can
tell the difference at a glance.

### Printing it

The **Readiness plan** report puts the whole thing on paper: where each stage
stands, what is still to do, what you excluded and why, and who decided each
one. It is the document to take to your management when nobody has asked you
for a report yet.

### Get ready with the SAMA framework

7 stages, 24 steps. 13 of them are checked for you. What the plan works
towards is level 3 across the framework, which is the level a member
organisation is expected to reach.

| Stage | Aim | Goes green when |
|---|---|---|
| **1. Set the product up** | The tool ready and the right people in it | Colleagues added, email working, your logo on reports, a backup has run |
| **2. Decide what you are protecting** | Scope and ownership, written down | Your scope is written and your assets are listed |
| **3. Find out where you stand** | An honest score on all 136 controls | Every control has a maturity level and an owner |
| **4. Write it down** | Most low scores are missing documents, not missing work | Policies exist, are approved, and have review dates |
| **5. Work out what could go wrong** | SAMA is risk-based | Every risk has an owner and is linked to the controls that treat it |
| **6. Collect the proof** | Saying it is not showing it | Evidence is attached, linked and dated |
| **7. Close the gaps and keep it going** | Being ready once is not the point | Gaps are tasks with owners and dates, and next year's work is in the Calendar |

**Level 3 is the floor, not the target.** A control at level 3 is defined,
approved, in use and monitored. Stage 3 is where most of the time goes, and
scoring honestly there makes the rest of the plan useful.

Some things only a person can confirm, such as an approval that happened in a
meeting. You tick those.

---

## Golden thread

Every risk, the controls that treat it, and the proof that they work, drawn as
one map. In the menu under **Get ready**.

It is the line an auditor follows. They pick a risk, ask what reduces it, and
ask to see that working. A break anywhere along the line is where a finding
comes from.

- **Risks** are on the left, **every control** in the middle (grouped as in the
  framework, each with its owner), and **proof** on the right with its age in
  days.
- **Point at anything** and its whole thread lights up. **Click it** for the
  details: who owns it, what it is linked to, and what is wrong. Press Esc or
  click again to close them.
- **Only problems** hides everything that is fine. The search box finds a risk,
  a control or a piece of proof by name.

What the colours mean:

| Line | Means |
|---|---|
| Green | Satisfied. A control that is in place, with current proof and an owner, and the lines that join it |
| Red dashes | Broken. A risk you are reducing has nothing treating it, or a control marked implemented has no proof |
| Amber dashes | Weak. The newest proof is over 90 days old or has no date, or the control has no owner |
| Dotted box | Not applicable, so nothing is needed |

Accepted, avoided and closed risks need no control, so they never count as
broken. A control that is not linked to any risk is shown, and counted, but is
not a problem: it may be there for a law or a contract instead. Auditors do ask.

**Fixing a break from the screen.** Click a broken risk or control and the
details panel offers the fix, if you are allowed to edit:

- A risk with nothing treating it: **Link** the controls that treat it. Type to
  search, click one to add it, then **Save the link**. **change** beside "Treated
  by" edits links that already exist.
- A control marked implemented with no proof: **Link existing proof** lists the
  evidence you have recorded. For something new, **Add new proof** opens Evidence.

The same links are on the risk form in the Risk register, under **Controls that
treat this risk**.

One piece of proof often backs several controls. Fixing it, by collecting a
fresh copy and updating its date, fixes all of them.

The figures across the top are the same ones the Get ready page shows.
Products with a very large framework open on **Only problems**.

## Dashboard

The front page. Four figures across the top.

**Profile readiness** — how much of the framework you have implemented, as a
percentage of what is in scope. Anything marked Not Applicable is excluded, so
the number reflects what you actually intend to do.

**Open risks** — risks not yet closed. The note says how many are critical.

**Evidence items** — how many pieces of proof you hold, and how many need
refreshing.

**Evidence gaps** — **the most useful number here.** Controls you have marked
Implemented with no evidence attached. It is the answer to "we say we do this,
but can we prove it". An auditor will find these. Better that you do first.

Below: readiness by domain, and a coverage chart showing where you
are strong and where you are thin.

**The top row is different here**, because a maturity framework has
no statuses to count. You get **at or above target** and **average maturity**
instead of readiness and evidence gaps, the bars below show maturity by domain,
and the chart shows how many controls sit at each of the six levels. See
[maturity scoring](#maturity-scoring).

Every figure is worked out live from the same data as the screens. If a number
looks wrong, open the screen underneath it and the reason is usually obvious.

---

## Controls

The core of the product: every control in your framework, one row each.

Here this is 168 rows: 32 subdomains, each with its controls underneath,
136 in all. You score the controls. The subdomain above them is there to group
and to navigate by.

Skip the statuses below and read [maturity scoring](#maturity-scoring)
instead. Everything after that — owners, evidence, filtering — works the same
either way.

**Click a row to open the control.** At the top is what it means in plain
words: what it is, what to do about it, and what an assessor or auditor will
look for. It also lists the records that prove it.

### The four statuses

| Status | Means |
|---|---|
| **Not Started** | Nothing done yet |
| **In Progress** | Being worked on |
| **Implemented** | Done and operating |
| **Not Applicable** | Does not apply to you |

**Not Applicable needs a reason.** Write why in the justification. "We have no
industrial control systems" is a good reason. Blank is not, and an auditor will
ask about every single one.

Not Applicable controls come out of your readiness percentage. That is correct,
and it is also how a percentage gets dishonest — if you mark things Not
Applicable to make the number look better, the number stops meaning anything.

### Working through them

Change the status and the owner straight in the list. No save button; it saves
as you go, and puts it back if the server refuses.

Click a row for the detail: notes, what evidence is attached, related risks.

Filter by status, by theme or function, or search. The usual first job is
filtering to Not Started and giving each one an owner.

**Give everything an owner.** A control with nobody's name against it is one
nobody is doing.

## Maturity scoring

Irtiqa does not ask whether a control is done. It asks **how well you do it**,
on a scale of 0 to 5.

### What you are scoring

Four domains, 32 subdomains, and **136 controls** underneath them. You score the
136. Each one is one numbered control consideration from the framework, such as
3.1.1.4, "An approved committee charter, meeting at least quarterly".

### Every control explains itself

Open any control and the first thing you see is what it actually is, in plain
words. For example:

> **What this is.** At least one copy of your backups cannot be altered or
> deleted, even by someone with full administrator rights. This is what defeats
> ransomware.

Under that is what level 3 looks like for that particular control, and what an
assessor will be looking for. You do not need a security background to use this.

### The scale

| Level | Name | What it means |
|---|---|---|
| **0** | Non-existent | No documentation, no awareness |
| **1** | Ad-hoc | Done inconsistently, nothing defined |
| **2** | Repeatable but informal | Repeated, but not formally defined |
| **3** | Structured and formalised | Defined, approved, monitored |
| **4** | Managed and measurable | Effectiveness measured |
| **5** | Adaptive | Continuously improved |

**SAMA expects level 3 or above.** That is why 3 is the target on every control
until you change it. You can raise the target on a control that matters more to
you — set it to 4 or 5 and it is measured against the higher bar.

### What level 3 actually means

Level 3 is the line between *we do this* and *we can show we do this*. It needs
all four of:

- **Defined** — written down, not just understood
- **Approved** — signed off by someone with the authority to sign it off
- **In use** — people actually follow it
- **Monitored** — somebody checks that they do

Three out of four is level 2. An assessor will ask for the fourth.

### Scoring

Set the level straight in the list. Click a row to open the control and get the
explanation, the guidance, and everything else about it.

**If a control does not apply to you, say so.** Open it and set **Does this
apply to you?** to no, with a reason. It leaves your average and your percentage
entirely, rather than sitting at nought dragging them down. A company with no
ATMs has no ATM controls, and pretending otherwise helps nobody.

**Leave it blank until you have assessed it.** Not scored is not the same as
zero. Anything unscored is left out of your average entirely, so the figure on
the dashboard is about what you have actually looked at. Scoring everything 0 on
day one to "fill it in" makes the number wrong and makes your first real
assessment look like an improvement it isn't.

### The two numbers

The dashboard shows two, and they answer different questions:

- **At or above target** — the compliance answer. The share of what you have
  assessed that meets its target. This is the number SAMA's question maps to.
- **Average maturity** — how far along you actually are. A programme can sit at
  100% of a target of 3 and average exactly 3.0, which is a fine place to be and
  a poor place to stop.

Watch both. The first tells you whether you pass. The second tells you whether
you are still moving.

---

## Evidence on a control

Anything you mark as in place, you are claiming is defined, approved, in use
and monitored. An assessor will ask you to show it. Attach it while you are looking
at the control, rather than trying to remember later.

Open a control and there is an **Evidence** panel. Three ways to add something:

| Button | Use it when |
|---|---|
| **Upload a file** | You have the document on your computer. It is stored, named after the file, and linked to this control in one step |
| **Link something I already have** | You recorded it earlier against another control. Search and pick it |
| **Record it without a file** | The proof exists but not as a file — signed minutes in a cabinet, a report in another system. Record what it is and who owns it |

**It is the same evidence as the Evidence tab.** Not a copy. Attach something
here and it appears there; link it there and it appears here. One item can
support many controls, which is normal — one approved policy is evidence for a
dozen of them.

**Unlink** removes it from this control only. The evidence itself is kept.

---

## Due dates and reminders

Each control can carry a deadline and the address of whoever owns it. Open a
control and you will find them under Owner:

- **Due by** — when the work should be finished
- **Email reminders to** — where the chasing goes

**Both are needed, or nothing happens.** A date with nobody to tell, and an
address with no deadline, are each harmless on their own. That is deliberate.
The product should not start emailing your colleagues because somebody typed an
address once.

### What gets sent

Once a day, each person gets **one email about their own controls only** —
never a long list of everyone's work, which is how reminders end up in a filter.

It lists anything overdue first, then anything due within the next seven days,
with the reference, the deadline and the current status of each.

To stop the emails for a control, clear the address on it.

### On the register

The **Due** column shows the date. It turns amber as the deadline approaches and
red once it has passed, so you can see the pressure without opening anything.

The date is set on the control rather than edited in the list, on purpose:
deciding to start emailing a colleague deserves the screen where the
explanation sits next to it.

---

## Which report to hand over

**Maturity assessment** is the one to hand over: every control, its level, its
target, the gap, and the scale itself printed on the front so a reader who has
never seen the screen can follow it.

**Gap report** lists everything below its target, worst gap first — that is your
remediation plan, in order. Anything nobody has assessed is at the bottom, since
not knowing is its own gap.

**Readiness plan** is the plan from [Get ready](#get-ready) on paper: where each
stage stands, what is left, what you excluded and why.

---

## Evidence

Proof. Where most of the real value is, and where most programmes fall down.

Each item records what the proof is, who owns it, when it was collected, and
which controls it supports.

### Freshness

Evidence goes out of date. The colour tells you how far:

| | Age |
|---|---|
| **Fresh** | within 30 days |
| **Ageing** | 30–60 days |
| **Due** | 60–90 days |
| **Stale** | older than 90 days |
| **No date** | never recorded |

Work from Stale downwards. A firewall review from eighteen months ago proves
what was true eighteen months ago.

### Attaching the document

Click **Attach a file** in the Document column. Up to 25 MB.

The file is stored with the record, and a checksum is kept so you can tell
later whether it changed.

**Attach the actual thing.** A row saying "firewall review" is a claim. The
review itself is evidence. When an auditor says "show me", one of those works.

Click the filename to download it. **Remove** takes the file away and keeps the
record.

### Linking to controls

Link each item to the controls it supports. This is what makes the **Evidence
gaps** figure work, and what lets a report say which controls are proven.

One document often supports several controls. Link it to all of them.

---

## Risks

Your risk register, with a heat map.

Score each risk on **likelihood** and **impact**, 1 to 5. Multiplied together:

| Score | Band |
|---|---|
| 20 and above | **Critical** |
| 12 to 19 | **Elevated** |
| Below 12 | **Acceptable** |

Record an inherent score — before your controls — and a residual score after
them. The gap between the two is what your controls are worth, which is a
question you will eventually be asked.

Set a treatment: mitigate, transfer, avoid or accept. **A risk you accept will
not save without a name against it.** Somebody with the authority to accept it
did so, and that is the record. Put the date in too, even though it is not
forced — "who accepted this and when" is one question, not two.

Link risks to the controls that reduce them and to affected assets.

---

## Sample library

A blank register is the hardest place to start, so **Risks**
and **Assets** each have a **Sample library** tab next to the register.

It holds ready-made examples to react to, grouped so you can open only the ones
that fit you:

| | |
|---|---|
| **Assets** | Business processes, data, devices, infrastructure, cloud, security tools, people and facilities, plus financial services and the Saudi financial sector. 98 in all |
| **Risks** | Financial services, and the Saudi financial sector. 43 in all |

Each sample risk comes with a likelihood, an impact, a suggested owner and the
controls that usually treat it.

Each sample asset says whether it is a primary asset - the information and
the business processes - or a supporting one that holds or carries them, and
points at the controls that govern assets of that kind.

**Add** copies a row into your register, and that is all. Once added it is
yours: rename it, rescore it, or delete it like anything else. Samples you have
already added are shown dimmed, so you do not lose your place.

**Scores are a first guess, not an answer.** Change them to fit your
organisation. Ten risks that are really yours beat a hundred copied without
thought, and an auditor can tell the difference.

---

## Help and Documentation

Two items in the menu, both readable inside the product.
Nothing is downloaded, and nothing you read leaves the server.

**Help** — short answers: your first hour, what each screen is for, who can do
what, where your data lives, and the questions that come up in the first week.

**Documentation** — five guides: quick start, using it day to day, the
administrator guide, a playbook for the product's framework, and collecting
evidence from AWS, Azure, Microsoft 365 and Google Workspace.

| | |
|---|---|
| **Its playbook** | The maturity scale and the path to level 3 |
| **Its evidence page points at** | SAMA control numbers, such as 3.1.4 |

They ship with the product, so they describe the version you are running.

**The same documents come in the box.** Every installer has a `docs` folder.
In it: this user guide, the install guide, the security overview, the privacy
sheet, a troubleshooting guide and the release notes. On Windows the Start
menu has a shortcut to it.

---

## The other registers

Same shape: a list, a filter, a search, a dialog to add and edit.

**Assets** — what you hold that matters. Primary or supporting, with a
criticality and a classification.

**Policies** — Draft, In Review, or Approved. Set a review date. Version history
is kept, so "which version was in force in March" has an answer.

**Tasks** — the work outstanding. Owner, due date, priority. Anything overdue
appears in the daily email.

Set **Kind** to **Change** for a planned change - to the way you work, or to
a system. Then fill in **what this change means for security**: what it
affects, what could go wrong, and what you will do about it. That is clause 6.3 in two
boxes, and it keeps planned changes in the same list as the work, rather than in
a second list nobody updates. Filter the list by kind to show only changes.

**Incidents** — what happened. Severity Low to Critical; status from Open
through Investigating, Contained and Resolved, to Closed.

**Findings** — raised against you, by an auditor or internally. **A closed
finding must say what closed it.** "Closed" on its own is not a record of
anything.

---

## Reports

PDFs to hand to someone. Click **Download** on any of them.

| Report | What it is for |
|---|---|
| **Executive summary** | One or two pages for a board or a manager |
| **Gap report** | Everything not yet implemented, and who owns it |
| **Risk register** | The full register with scores and treatments |
| **Evidence register** | What proof you hold and how fresh it is |
| **Readiness plan** | Your Get ready plan on paper |

### Your own logo

Administrators can upload your organisation's logo under Reports. It appears at
the top of every report, where an auditor expects to see the name of the
organisation being audited.

Without one, reports carry the Offset Security mark instead.

### What is in them

Whatever is in the system when you press the button, with the date and your
name on it. A report that cannot say when it was produced is not evidence of
anything.

---

## Users

Administrators only.

Add someone with a name, a username, an email and a role. They get told the
account exists — **not the password.** Give them that yourself, in person or
through a password manager.

**Disable, do not delete.** The audit trail points at people. Deleting an
account would leave "who approved this" without an answer, which is the one
question an audit trail exists to answer. Disabling stops them signing in and
keeps the history.

If somebody is locked out after too many wrong passwords, **Unlock** clears it.

Two limits stop password guessing. Five wrong passwords lock that account for
15 minutes. Twenty failed sign-ins from one address, to any accounts, block
that address for 15 minutes, so one computer cannot guess at everyone's
password or lock everyone out.

---

## Audit trail

Administrators and auditors only. Nobody else sees it in the menu: it holds
failed sign-ins and addresses, which are security information.

It lists everything that happened, newest first: who, when, what they did,
which record, and the address they came from.

- **Search**, or pick a person, an action, or dates.
- **Click an entry** to see what it changed: each field, before and after.
  For something added or deleted, it shows the values it had.
- **Download CSV** gives everything that matches the filters, as a
  spreadsheet. Hand it to an auditor as evidence. The download is itself
  recorded.

**Nothing here can be changed or deleted**, by anybody, including
administrators. Entries are kept for ever unless whoever runs the server sets
a retention period (`AUDIT_RETENTION_DAYS`).

---

## Backups

Administrators only.

A backup is one file holding everything: the database and every evidence
document. One is taken automatically every night. The newest three backups are
kept, counting every kind together, and older ones are deleted.

**Take a backup now** before a big change, such as importing a lot of data.

**Download** saves a backup to your computer. Do this now and then and keep the
file somewhere other than the server. The file holds everyone's password hashes
and every document, so keep it safe.

**Upload a backup** adds a file you downloaded earlier back to the list. It is
checked first, and refused if it is damaged, not an Offset backup, from a
different product, or from a newer version.

**Restore** puts everything back as it was in that backup. You are asked to type
RESTORE first, because anything added or changed since that backup is replaced.
Before it starts, a backup of everything as it is now is taken, so a restore of
the wrong one can be undone. Everyone is signed out afterwards and signs in with
the accounts as they were in the backup.

---

## Settings

Administrators only.

**Outgoing email** — optional. Everything works without it. Set it up and you
can send the daily digest.

**Daily digest** — one message a day listing what needs attention: evidence out
of date, overdue tasks and findings, policies due for review, open risks in the
top band.

**It sends nothing on a day when nothing needs attention.** That is on purpose.
A message that arrives every morning saying nothing is one people stop reading,
and the morning it matters they will not read that one either.

Use **Preview today's** to see what it would say before turning it on.

**HTTPS certificate** — stops the browser saying "Not secure". Ask your IT team
for a certificate for the name people type to reach this server, issued by your
company's own certificate authority. It is free, and every company computer
already trusts it. A `.pfx` file with its password works, and so do a
certificate and key as PEM files.

Click **Choose files**, pick them, type the password if there is one, and click
**Upload certificate**. It is checked first. Anything worth knowing - it is for
a different name, it is self-signed, it expires soon - is shown before it
replaces the one you have.

If the product is already on HTTPS, the new certificate is used at once. That
is how you renew it each year. If it is still on plain HTTP, it needs a restart,
and the screen says how. Old `http://` links keep working afterwards: they are
sent on to `https://`.

The section also shows the certificate in use: who it is for, who issued it,
and when it expires. It warns 30 days before. Installing and network settings
are in `INSTALL.md`, under **Turning on HTTPS**.

**Updates** — shows which version you have. **Check for updates** asks Offset
Security's release server whether there is a newer one, and shows what changed.
Nothing is checked until somebody presses it.

If there is one, **Update** installs it. A backup is taken first. The product
is then unavailable for a minute or two while it restarts. If the new version
does not start properly, the old one and your data are put back for you. The
section shows each step as it happens. When it says **Updated**, reload the page.

If the button is not offered, the section says why: usually that the server
cannot reach the internet, or that this copy was installed without the updater.
Whoever installed it can see **Updating** in `INSTALL.md`.

---

## Things worth knowing

**Everything is recorded.** Every change is written to an audit trail with who,
what and when. That is the point of the tool, and it means nothing is quietly
undone.

**It is backed up nightly**, automatically, documents included. Administrators
can take, download and restore backups under [Backups](#backups). Ask whether a
restore has ever been tested. An untested backup is a hope.

**Your data does not leave your organisation.** There is no cloud service behind
this, no telemetry, and no update check. It runs on your own machines.

**Two numbers to watch**, if you only watch two:

1. **Evidence gaps** on the dashboard — controls you claim without proof.
2. **Stale evidence** — proof that has aged out.

Both are things you can fix quietly now, or have found for you later.

---

Questions your administrator cannot answer: **info@offsetsecurity.net**
