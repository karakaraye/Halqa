# Halqa — design reference

Design source: the Figma file "Halqa — Screening-to-Care UX & UI" (key `D7LVicS3bOSOW1ix0YtOAC`). Exported frames are in `docs/design/`; pictures of the running screens are in `docs/design/compare/`.

## Principles

1. Plain words. A new user should never need training or a glossary.
2. One main action per screen or card. The main button is teal and filled; everything else is quieter.
3. Colour always comes with a word. Never rely on colour alone.
4. Big text. Body 16 px, nothing under 14 px. Touch targets 48 px or more (56 px on phones).
5. Calm layout. Cards with generous padding; no dense tables on the main screens.

## Tokens (already in `tailwind.config.js`)

| Name | Hex | Use |
|---|---|---|
| teal-800 | #0A5C50 | brand dark, text on teal tint |
| teal-700 | #0E7C6B | primary buttons, links, charts |
| teal-100 | #CFEFE8 | avatars, tint |
| teal-50 | #E8F6F3 | active tab, hero cards |
| slate-900 | #111827 | main text |
| slate-700 | #1F2937 | body text |
| slate-500 | #4B5563 | secondary text |
| slate-400 | #6B7280 | placeholders, input borders |
| slate-200 | #DDE5E3 | borders |
| slate-100 | #EEF3F2 | quiet buttons, skeletons |
| slate-50 | #F6FAF9 | page background |
| rose-600 / rose-50 | #BE123C / #FFF1F2 | needs you now, late, danger |
| amber-600 / amber-50 | #B45309 / #FFFBEB | due soon, attention |
| emerald-600 / emerald-50 | #047857 / #ECFDF5 | done, confirm |
| sky-600 / sky-50 | #0369A1 / #F0F9FF | waiting for others, information |
| violet-600 / violet-50 | #6D28D9 / #F5F3FF | programme tag |

Type: Inter if installed, then the system stack. No network fonts (the content-security policy forbids them). Sizes: page title 32 bold, section 24 semibold, card title 18 semibold, body 16, small 14. Radii: buttons 12, cards 16, inputs 12, dialogs 20, chips full.

## Status words (always shown with colour)

| Word | Colour | Meaning |
|---|---|---|
| Needs you now | rose | Act first |
| Late | rose | Past its time; needs a decision |
| Due soon | amber | Coming up today |
| On track | teal | Nothing to do |
| Waiting for others | sky | The next step is with someone else |
| Done | emerald | Finished and recorded |

## Code components (`src/components/design/`)

`Button` (kinds primary, secondary, danger, success, quiet; sizes md, lg), `Chip`, `Card`, `Field`, `Input`, `Textarea`, `Select`, `Avatar`, `Dialog`, `Notice`, `Empty`, `Loading`, `Skeleton`, `Toasts`, `Shell` (top bar and role-based tabs), `SignIn`. Matching Figma components are on the "Components" page (Button set with kind and size, Status set with tone, Card, Top bar).

## Screens and their files

| Screen | File |
|---|---|
| Sign in | `src/components/design/SignIn.tsx` |
| Top bar and tabs | `src/components/design/Shell.tsx` |
| My work | `src/components/staff/MyWork.tsx` |
| Case page and its pop-ups | `src/components/staff/CasePage.tsx`, `caseView.ts` |
| Referrals | `src/components/staff/Referrals.tsx` |
| Accounts, change password | `src/components/staff/AccountsPage.tsx`, `src/components/design/ChangePassword.tsx` |
| Overview | `src/components/staff/Overview.tsx` |
| Approvals | `src/components/staff/Approvals.tsx` |
| Patient portal (result, quick check, all done, steps, booked, help, waiting) | `src/components/patient/*` |
| Copy for patients (en, ar, hi, ur) | `src/lib/i18n.ts` |

## Who sees which tab

| Role | Tabs (in this order) |
|---|---|
| Care navigator, doctor | My work, Overview |
| Specialist | Referrals, Overview |
| Clinic lead | Overview, Approvals, Accounts |
| Patient | No tabs; bottom bar: Your result, Your steps, Help |

The staff top bar also has "Password" (change your password) and "Sign out". Which tab opens first depends on the role: navigator and doctor open My work, specialist opens Referrals, lead opens Overview.

## Decisions that differ from the drawings

- Receiving services are a section of the Accounts screen, not a new tab in the top bar. They are set up rarely and by the same person who manages accounts, and a specialist account must exist first, so the two belong together. A fourth lead tab would also crowd the bar at 390 px. The screen has two segmented tabs, People and Receiving services; the selected one is remembered only while the screen is open.
- The top bar shows only the tabs the signed-in role may use (the drawings show all four for one person), and has Password and Sign out buttons that the drawings do not draw. Staff need both.
- Hand-over lists doctors and matching specialists only; navigators are not offered because the server refuses it. "Hand over this patient" and "Close this case" are shown only to the roles the server allows (hand-over: doctor, specialist, clinic lead; closing: doctor, specialist). The drawing shows the hand-over button for a navigator; it is left out because it would only fail. A navigator sees the line "Only a doctor can close a case." in its place.
- The close-case pop-up shows the real rules from `closureChecks()` and has a plan field and the three exception kinds.
- The case page also has Messages (patient and between clinicians), History, "Something is slowing this down" and "Needs a decision" cards, and an Interpreter row in "About" with a Request / Turn off button. The drawing has only the hero button "Ask for an interpreter", which is also built.
- Next-step card buttons: "Mark as done" where a step is finished with a note, "Call <first name>", "Ask for an interpreter". On the first step (telling the patient) the main button reads "Message <first name>", not "Mark as done", because finishing that step sends the patient a message and the label must say so. Steps that need a different action keep their own label (for example "Send referral", "Mark as attended" with "Did not attend"). A note box shows only where a note is required; the first step has none.
- Hero text is 18 px and the hero buttons are 56 px, to match the drawing and the touch-size rule.
- Referrals: "Questions from doctors" shows a reply box and "Send reply" only when a doctor has written a question; otherwise it reads "No questions from doctors right now." The drawing shows the card with a question.
- Patients sign in with email and password. The one-time-code sign-in (frame 16:2) is not built until an SMS provider exists.
- The patient header is one compact row for the language choice and Sign out under "Halqa" and the greeting; the drawing has neither control. Because controls on patient screens are 56 px high, the header is taller than the 82 px drawing.
- The five confidence buttons in the quick check are 56 px wide where there is room and 48 px at 320 px wide, because five 56 px buttons do not fit a 320 px screen.
- Patients cannot pick an appointment time. No clinic has offered times to Halqa, so the screen says "Your navigator will call you to book a time." Staff enter the real date and time on the case page; there are no quick picks.
- The Overview shows only measured figures. No "before" comparison is shown until real baseline data exists.
- Call-back copy says "as soon as we can" until the exact promise is approved.
- Staff screens use whole words for times ("1 day 6 hours", "2 hours"), never "30h" or "hrs".
- Dates and times use the time zone in `NEXT_PUBLIC_HALQA_TIME_ZONE`, or the browser's own time zone when it is not set (see `src/lib/time.ts`).

## Screens built after the drawings (same style, not drawn in Figma)

Change password (the forced first-time screen and the pop-up from the top bar), Accounts (lead: list, create with a one-time temporary password, disable), Receiving services (lead: a section of Accounts that lists the units that accept referrals, adds one and disables one; `src/components/staff/ServicesSection.tsx`), the interpreter row and request, and the "Something is slowing this down" card on the case page. They follow the same tokens and components.

## Content rules

- Never say "diagnosis" as a finding. Result screens always say "This is not a diagnosis."
- Avoid: SLA, escalation, custody, e-consult, governance, pathway, DNA, MDT. Use: late, needs a decision, accept, message between doctors, programme, care steps, missed appointment.
- Patients' messages (SMS, WhatsApp) never contain a result or diagnosis; they contain a secure link only.
- Hindi and Urdu copy must be reviewed by a certified medical translator before use.
- Dates are shown in the clinic's time zone in a short, friendly format.
