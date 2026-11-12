# Halqa — go-live checklist

The software is complete and verified for a first release (see `VERIFICATION.md`). Everything below needs people, contracts or outside services, and must be done before real patients are served. Tick a line only when its evidence is on file. Names, dates and contacts are filled in by the operator.

## Clinical

| Done | Item | Evidence to keep | Owner | Date |
|---|---|---|---|---|
| [ ] | Clinical approval of every care pathway in `src/lib/pathways.ts`: the steps, who owns each, the time targets and the urgency rules | Signed approval naming the version of the file | | |
| [ ] | Approval of every promise the product makes to patients (for example how soon a call-back happens) and of the wording of every patient message | Signed approval; matching change in `src/lib/i18n.ts` | | |
| [ ] | Certified medical translation of the Arabic, Hindi and Urdu copy in `src/lib/i18n.ts`, then testing with patients who read each language | Translator's certificate; test notes | | |
| [ ] | Usability test with real staff and real patients, including people with low literacy and people using a phone | Test report and the changes made | | |

## Integrations

| Done | Item | Evidence to keep | Owner | Date |
|---|---|---|---|---|
| [ ] | Choose and contract a message provider (SMS or chat). Set `HALQA_MESSAGE_WEBHOOK_URL` and `HALQA_MESSAGE_WEBHOOK_TOKEN`; issue the delivery key and set `HALQA_DELIVERY_KEY_SHA256` | Signed contract; one test message delivered and reported | | |
| [ ] | Agree the result-intake contract with the laboratory or record system (fields, result codes, who is responsible when a post fails). Issue the intake key and set `HALQA_INTAKE_KEY_SHA256` | Signed agreement; one test result received | | |

## Privacy and legal

| Done | Item | Evidence to keep | Owner | Date |
|---|---|---|---|---|
| [ ] | Privacy and legal review: lawful basis, notice to patients, retention period, cross-border handling of data (including the message provider), rights requests (`docs/data-protection.md`) | Written opinion; retention rule adopted | | |
| [ ] | Breach procedure agreed and the contact table in `docs/security.md` section 10 filled in | Completed table kept off the server | | |

## Hosting and operations

| Done | Item | Evidence to keep | Owner | Date |
|---|---|---|---|---|
| [ ] | Hosting on one durable server with an encrypted disk; domain name; HTTPS through a reverse proxy; `HALQA_ORIGIN` set for both build and run | Server record; certificate renewal plan | | |
| [ ] | Backups on a schedule, stored off the server, with a restore tested end to end (`docs/operations.md`) | Date and result of the restore test | | |
| [ ] | Monitoring of `GET /api/health`, disk space and logs, with an on-call owner and a way to reach them | Monitor configured; on-call rota | | |
| [ ] | First clinic lead created with `npm run setup`; staff accounts created; leaving staff disabled the same day | List of accounts checked by the lead | | |
| [ ] | Load check run on the production hardware (`npm run load-check`) | Output of the run | | |

## Independent checks

| Done | Item | Evidence to keep | Owner | Date |
|---|---|---|---|---|
| [ ] | Independent penetration test, with every finding fixed or accepted in writing | Tester's report and responses | | |
| [ ] | Independent accessibility audit of the staff and patient screens | Auditor's report and responses | | |

## Pilot

| Done | Item | Evidence to keep | Owner | Date |
|---|---|---|---|---|
| [ ] | Pilot agreement with a screening programme, a coordinating clinical team and a receiving service: endpoints, how workload and patient understanding are measured, who may see the results | Signed agreement | | |
