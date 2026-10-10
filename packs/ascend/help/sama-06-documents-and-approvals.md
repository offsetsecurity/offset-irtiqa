# Documents, approvals and reports to SAMA

Three lists an assessor works from: the documents the framework's controls call
for, the things SAMA must approve before you act, and what you must report to
SAMA. Each item carries the control number it comes from.

Part of [the SAMA handbook](sama-01-how-assessment-works.md). Previous:
[Domain 3.4](sama-05-third-party.md). Next: [Being ready for SAMA](sama-07-assessment-ready.md).

## Why documents decide the level

SAMA's level 3 is "defined, approved and implemented, and compliance
monitored". In practice that means a document for each area, approved by the
right people, and records showing it is followed. A control that is done well
but not written down stays at level 2.

SAMA's own structure is a pyramid: the **policy** says why, the **standards**
say what, and the **procedures** say how.

## 1. Documents the controls call for

### Governance and leadership (3.1)

| Document | Controls | Approved by |
|---|---|---|
| Board resolution mandating the cyber security committee | 3.1.1.1 | Board |
| Committee charter: objectives, roles, quorum, meeting at least quarterly | 3.1.1.4 | Board approves (3.1.4.1) |
| Organisation chart showing cyber security separate from IT, with its reporting line | 3.1.1.6, 3.1.1.7 | Management |
| CISO appointment | 3.1.1.8 | Management, after SAMA's no-objection |
| Cyber security budget | 3.1.1.10 | Board |
| Cyber security governance | 3.1.1, 3.1.4.1 | Committee approves, board endorses |
| Cyber security strategy, with a roadmap | 3.1.2.1 to 3.1.2.3 | Committee approves, board endorses |
| Cyber security policy, and its review process | 3.1.3.1 to 3.1.3.4 | Committee approves, board endorses |
| Supporting standards and procedures | 3.1.3.3, 3.1.4.4 | As your governance sets out |
| Job descriptions with security responsibilities | 3.1.4.3 | Management |
| Project methodology with security steps | 3.1.5.1, 3.1.5.2 | As your governance sets out |
| Awareness programme | 3.1.6.1 | Committee (3.1.4.2) |
| Training plan by role | 3.1.7.1 | Management |

### Risk management and compliance (3.2)

| Document | Controls |
|---|---|
| Cyber security risk management process, covering identification, analysis, response and monitoring | 3.2.1.1, 3.2.1.4 |
| Risk appetite and risk tolerance, formally approved | 3.2.1.11 |
| Risk assessments, accepted and endorsed by each risk owner | 3.2.1.9, 3.2.1.10 |
| Regulatory compliance process and register | 3.2.2.1 |
| PCI DSS, EMV and SWIFT compliance evidence, where they apply | 3.2.3.1 |
| Security review reports, and annual penetration tests of customer-facing and internet-facing services | 3.2.4.1 to 3.2.4.5 |
| Audit plan and audit manual covering cyber security | 3.2.5.2 |

### Operations and technology (3.3)

| Document | Controls |
|---|---|
| Security requirements in the HR process | 3.3.1.1 |
| Physical security process | 3.3.2.1 |
| Asset management process, and one unified asset register | 3.3.3.1, 3.3.3.3 |
| Cyber security architecture | 3.3.4.1 |
| Identity and access management policy | 3.3.5.1 |
| Application security standard, and the secure SDLC | 3.3.6.1, 3.3.6.4 |
| Change management process | 3.3.7.1 |
| Infrastructure security standards | 3.3.8.1 |
| Cryptographic security standard | 3.3.9.1 |
| BYOD security standard, if personal devices are allowed | 3.3.10.1 |
| Secure disposal standard and procedure | 3.3.11.1 |
| Payment systems security standard (banks) | 3.3.12.1 |
| Electronic banking security standard (banks) | 3.3.13.1 |
| Security event management process, and the event monitoring standard | 3.3.14.1, 3.3.14.3 |
| Cyber security incident management process | 3.3.15.1 |
| Threat intelligence management process | 3.3.16.1 |
| Vulnerability management process | 3.3.17.1 |

### Third parties (3.4)

| Document | Controls |
|---|---|
| Security requirements in contract and vendor management | 3.4.1.1 |
| Outsourcing policy and process with security requirements | 3.4.2.1 |
| Cloud computing policy for hybrid and public cloud | 3.4.3.1 |

## 2. What SAMA must approve before you act

| Before you... | You need | Control |
|---|---|---|
| Appoint a CISO | SAMA's no-objection | 3.1.1.9 |
| Outsource anything material | SAMA's approval | 3.4.2.3 |
| Use a cloud service, or sign with a cloud provider | SAMA's approval | 3.4.3.4 |
| Use a cloud service located outside Saudi Arabia | SAMA's explicit approval | 3.4.3.4 |
| Launch a new electronic banking service | SAMA's approval | 3.3.13.4 |
| Speak to the media about a cyber security incident | SAMA IT Risk Supervision's no-objection | 3.3.15.6 |
| Depart from a control | A waiver granted by SAMA; until then the control applies | Appendix D |

Keep every request and every reply. An approval you cannot produce counts as
one you never obtained.

## 3. What you must report to SAMA

| What | When | Control |
|---|---|---|
| A security incident classified medium or high | Immediately, to SAMA IT Risk Supervision | 3.3.15.5 |
| A formal incident report | After operations resume | 3.3.15.7 |
| Scheduled downtime of electronic banking services | In good time, to SAMA and to customers | 3.3.13.4 |
| Relevant threat intelligence | Shared with SAMA and BCIS members, as relevant | 3.3.16.3 |
| The framework self-assessment | When SAMA asks, on SAMA's questionnaire | Section 2.3 |

**The formal incident report** must include: the title; the classification
(medium or high); when the incident happened and when it was detected; the
information assets involved; technical details; the root-cause analysis;
corrective actions done and planned; the impact (for example data lost,
services disrupted, data changed or leaked, customers affected); the total
estimated cost of the incident; and the estimated cost of corrective actions.

**Banks** were also required, under the circular on level 4, to give SAMA a
board-approved roadmap, quarterly progress reports, and an annual report from
internal audit on compliance against the required maturity level.

## In Offset Irtiqa

- **Policies** holds each document with its version, owner, approver, approval
  date, review date and version history.
- **Evidence** holds approvals, SAMA's replies, reports sent to SAMA, and
  records, each linked to its control.
- **Incidents** records each incident, its classification and its dates.
