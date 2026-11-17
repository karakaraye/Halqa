// AI-drafted patient explanation. The draft is never shown to a patient
// directly: a licensed clinician must review, edit and approve it in the
// case drawer first. No patient identifiers are sent — only the result,
// pathway, language, age and sex.
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MODEL = 'claude-opus-5-5';

const Body = z.object({
  pathway: z.string().min(1).max(120),
  finding: z.string().min(1).max(400),
  resultCode: z.string().max(60),
  urgency: z.enum(['CRITICAL', 'ELEVATED', 'ROUTINE']),
  diagnosticTest: z.string().min(1).max(80),
  withinDays: z.number().int().min(1).max(365),
  lang: z.enum(['en', 'ar', 'hi', 'ur']),
  age: z.number().int().min(0).max(120),
  sex: z.enum(['F', 'M']),
  standardExplanation: z.string().max(1200),
});

const Draft = z.object({
  body: z.string().describe('The explanation for the patient, in the patient’s language. 60–110 words.'),
  next: z.string().describe('The name of the next step in the patient’s language, 1–4 words, e.g. the test name.'),
  backTranslation: z.string().describe('A faithful English back-translation of body, for the reviewing clinician. Same text as body if the language is English.'),
  reviewNotes: z.array(z.string()).describe('0–3 short English notes for the clinician: anything in the result you were unsure how to explain, or that the clinician should verify before approving.'),
});
export type ExplanationDraft = z.infer<typeof Draft>;

const LANG_NAME = { en: 'English', ar: 'Modern Standard Arabic', hi: 'Hindi', ur: 'Urdu' } as const;

const SYSTEM = `You draft plain-language explanations of screening results for patients in a public screening programme. A licensed clinician reviews and edits every draft before a patient sees it, so write the best first draft you can and flag anything you are unsure about for that reviewer.

The patient has just been told they have a result and is likely anxious. They may have limited health literacy and may be listening to this read aloud rather than reading it. The explanation is shown beside a banner that already says "This is not a diagnosis", and a separate panel that already states the next step and its deadline, so the explanation's job is to help the patient understand what was found and why the next test matters.

Write for this specific result, not the pathway in general: say what this finding means in everyday words, how common it is to have a benign cause, and what the next test will show. Use short sentences and everyday words at about a sixth-grade reading level, and explain any medical term in a few words the first time it appears. Be honest and calm: do not state or imply a diagnosis, do not give probabilities or statistics you were not given, do not minimise a result marked CRITICAL, and do not give treatment or medication advice. Address the patient directly and warmly, without their name.

Write in the requested language as a fluent native speaker would, not as a translation from English, using the terms a patient in the Gulf region would recognise. You are given the programme's standard explanation for this pathway as a reference for tone and for what the programme considers safe to say; stay consistent with it.`;

export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    return NextResponse.json({ error: 'not_configured', message: 'AI drafting is not configured on this deployment. Set ANTHROPIC_API_KEY on the server to enable it. The standard explanation stays in use.' }, { status: 503 });
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'bad_request', message: 'Invalid request body.' }, { status: 400 });
  const b = parsed.data;

  const client = new Anthropic();
  try {
    const res = await client.beta.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      // If a safety classifier declines the request, retry on Anthropic's recommended fallback model.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: zodOutputFormat(Draft) },
      system: SYSTEM,
      messages: [{
        role: 'user',
        content: `Draft the explanation in ${LANG_NAME[b.lang]}.

<result>
Screening pathway: ${b.pathway}
Finding: ${b.finding}
Result code: ${b.resultCode}
Urgency assigned by the programme: ${b.urgency}
Next step: ${b.diagnosticTest}, recommended within ${b.withinDays} days
Patient: ${b.age || 'age unknown'}${b.age ? ' years old' : ''}, ${b.sex === 'F' ? 'female' : 'male'}
</result>

<standard_explanation>
${b.standardExplanation}
</standard_explanation>`,
      }],
    });

    if (res.stop_reason === 'refusal') return NextResponse.json({ error: 'declined', message: 'The model declined to draft this explanation. Use the standard explanation.' }, { status: 422 });
    if (!res.parsed_output) return NextResponse.json({ error: 'bad_output', message: 'The model returned an incomplete draft. Try again.' }, { status: 502 });
    return NextResponse.json({ draft: res.parsed_output, model: res.model });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) return NextResponse.json({ error: 'not_configured', message: 'The server’s Anthropic API key was rejected. Check ANTHROPIC_API_KEY.' }, { status: 503 });
    if (e instanceof Anthropic.RateLimitError) return NextResponse.json({ error: 'busy', message: 'The AI service is busy. Try again in a moment.' }, { status: 429 });
    if (e instanceof Anthropic.APIError) { console.error('draft-explanation', e.status, e.message); return NextResponse.json({ error: 'upstream', message: 'The AI service returned an error. Try again, or use the standard explanation.' }, { status: 502 }); }
    console.error('draft-explanation', e);
    return NextResponse.json({ error: 'upstream', message: 'Could not reach the AI service.' }, { status: 502 });
  }
}
