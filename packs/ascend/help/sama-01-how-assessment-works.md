# How SAMA assessment works

This handbook takes you through the SAMA Cyber Security Framework in the order
SAMA sets it out: how compliance is judged, then the four domains and every
control in them, then the documents and SAMA approvals you need, then how to be
ready when SAMA reviews you.

The wording in this handbook is ours. It explains the framework; it is not the
framework. The in-force text is on the SAMA Rulebook, rulebook.sama.gov.sa,
free. Where this handbook and the framework differ, the framework wins.

## Who it applies to

The framework applies to every member organisation SAMA regulates:

- all banks operating in Saudi Arabia,
- all insurance and reinsurance companies operating in Saudi Arabia,
- all financing companies operating in Saudi Arabia,
- all credit bureaus operating in Saudi Arabia,
- the financial market infrastructure.

**Banks** must meet every domain. **Other member organisations** have these
exceptions:

| Subdomain | For organisations other than banks |
|---|---|
| 3.1.2 Cyber Security Strategy | Alignment with the banking sector's strategy is mandatory where applicable |
| 3.2.3 Industry standards | Excluded, but PCI DSS or the SWIFT framework must be implemented if you handle cardholder data or use SWIFT |
| 3.3.12 Payment Systems | Excluded |
| 3.3.13 Electronic Banking Services | Excluded, but multi-factor authentication is required if you provide online services to customers |

## What it covers

All of the organisation's information assets: electronic and paper
information, applications and databases, computers and machines such as ATMs,
storage devices, and premises, equipment and networks. It also sets direction
for subsidiaries, staff, third parties and customers.

**Business continuity is not in this framework.** SAMA covers it in its
separate Business Continuity Minimum Requirements.

## How the framework is built

Four domains, each split into subdomains, 32 in all. Every subdomain has:

- a **principle**: what SAMA requires, in a sentence,
- an **objective**: why,
- **control considerations**: the numbered controls SAMA mandates.

SAMA numbers every control consideration uniquely, up to four levels deep. In
Offset Irtiqa each numbered consideration is one control with the same number,
so control 3.1.1.4 is consideration 4 of subdomain 3.1.1. The one exception is
3.3.12 Payment Systems, where SAMA refers to the SARIE and Mada documents
instead of numbering; its three controls here follow that subdomain's principle
and references.

## Principle-based, and what to do when you cannot comply

The framework is principle-based: the principles and objectives must be met,
and the control considerations give direction on how. When a control
consideration cannot be met, SAMA expects you to consider compensating
controls, an internal risk acceptance, and a formal waiver request.

**Requesting a waiver** (Appendix D of the framework):

1. Describe why the control cannot be met, and the compensating controls you
   have or propose.
2. The CISO approves the request, then the cyber security committee approves
   it.
3. The CISO and the relevant business owner sign it.
4. The CEO or managing director sends it in writing to SAMA's Deputy Governor
   of Supervision.
5. SAMA IT Risk Supervision evaluates it and replies.

Until a waiver is granted, the framework still applies in full.

## How compliance is judged: the maturity model

SAMA judges each control against a six-level maturity model. To reach a level,
every criterion of the levels below it must also be met.

| Level | Name | What it takes |
|---|---|---|
| 0 | Non-existent | Nothing in place, and no awareness of the need |
| 1 | Ad-hoc | Partly defined, done inconsistently |
| 2 | Repeatable but informal | Done the same way each time, but not written down or approved |
| 3 | Structured and formalised | Defined, approved and implemented; can be shown; compliance with policies, standards and procedures is monitored; key performance indicators are reported |
| 4 | Managed and measurable | Effectiveness is measured and periodically evaluated, using key risk indicators with thresholds and trend reporting |
| 5 | Adaptive | Continuously improved, integrated with enterprise risk management, monitored in real time, and compared with peer and sector data |

**The minimum is level 3.** SAMA expects member organisations to operate at
level 3 or higher.

**Banks: level 4 in four subdomains.** SAMA circular 29814/67 requires banks to
meet level 4 for all components of:

- 3.3.14 Cyber Security Event Management,
- 3.3.15 Cyber Security Incident Management,
- 3.3.16 Threat Management,
- 3.3.17 Vulnerability Management.

### What level 3 means in documents

SAMA describes level 3 through a pyramid of documents:

- **Policy**: *why* cyber security matters, and *what* principles and
  objectives apply. Endorsed and mandated by the board.
- **Standards**: *what* controls must be in place, such as system settings,
  segregation of duties, password rules, monitored events and backup rules.
  These are your baselines.
- **Procedures**: *how* staff, third parties and customers carry out the
  controls, step by step.

And progress, performance and compliance are monitored with key performance
indicators.

## How SAMA checks

The framework is assessed through a **periodic self-assessment**, which the
organisation completes using SAMA's questionnaire. SAMA then reviews and audits
the self-assessment to decide the level of compliance and the maturity level.
SAMA also carries out inspection visits to check that the assessment is
accurate.

For banks, the circular on level 4 also asked for a roadmap approved by the
board, quarterly progress reports to SAMA, and an annual report from internal
audit on compliance against the required maturity level.

## Reading this handbook

1. [Domain 3.1: Leadership and Governance](sama-02-leadership-governance.md)
2. [Domain 3.2: Risk Management and Compliance](sama-03-risk-compliance.md)
3. [Domain 3.3: Operations and Technology](sama-04-operations-technology.md)
4. [Domain 3.4: Third Party Cyber Security](sama-05-third-party.md)
5. [Documents, approvals and reports to SAMA](sama-06-documents-and-approvals.md)
6. [Being ready for SAMA](sama-07-assessment-ready.md)

## In Offset Irtiqa

- **Controls** holds all 136 controls, numbered as SAMA numbers them, each with
  its maturity level, target, owner, evidence and guidance.
- **Get ready** walks the same ground one step at a time.
- The **Maturity assessment** report is the picture SAMA's self-assessment asks
  for.
