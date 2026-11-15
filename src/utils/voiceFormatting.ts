import type {
  ActiveCardTab,
  AskSceneResponse,
  ConceptItem,
  SceneAnalysisResponse,
} from '../types/concepts.ts';
import { extractJsonString } from './validation.ts';

/**
 * Strips any accidental API-key-like token (e.g. AIzaSy..., key=..., Bearer ...)
 * before rendering onto public Share Cards, UI surfaces, or server logs.
 */
export function sanitizePublicText(input: string, extraSecret?: string): string {
  if (typeof input !== 'string' || input.length === 0) return '';
  let out = input;
  if (extraSecret && extraSecret.length >= 8) {
    out = out.split(extraSecret).join('[REDACTED]');
  }
  out = out.replace(/AIza[0-9A-Za-z_-]{20,}/g, '[REDACTED_KEY]');
  out = out.replace(/([?&]key=)[^&\s"']+/gi, '$1[REDACTED]');
  out = out.replace(/(Bearer\s+)[0-9A-Za-z._~+/-]{20,}/gi, '$1[REDACTED]');
  return out;
}

const SUBSCRIPT_MAP: Record<string, string> = {
  '₀': ' 0',
  '₁': ' 1',
  '₂': ' 2',
  '₃': ' 3',
  '₄': ' 4',
  '₅': ' 5',
  '₆': ' 6',
  '₇': ' 7',
  '₈': ' 8',
  '₉': ' 9',
  'ᵢ': ' i',
  'ᵣ': ' r',
  'ₓ': ' x',
  'ᵧ': ' y',
  'ₙ': ' n',
};

/**
 * Converts Unicode math formulas (e.g. θᵢ = θᵣ, v = Δx / Δt, I ∝ 1/r²)
 * into natural spoken phrasing so TTS models pronounce equations smoothly.
 */
export function formatMathForSpeech(text: string): string {
  if (!text) return '';
  let spoken = text;

  for (const [sub, word] of Object.entries(SUBSCRIPT_MAP)) {
    spoken = spoken.split(sub).join(word);
  }

  spoken = spoken
    .replace(/²/g, ' squared')
    .replace(/³/g, ' cubed')
    .replace(/θ/g, 'theta')
    .replace(/Δ/g, 'delta ')
    .replace(/λ/g, 'lambda')
    .replace(/π/g, 'pi')
    .replace(/∝/g, ' is proportional to ')
    .replace(/≈/g, ' is approximately ')
    .replace(/≥/g, ' is greater than or equal to ')
    .replace(/≤/g, ' is less than or equal to ')
    .replace(/×/g, ' times ')
    .replace(/·/g, ' times ')
    .replace(/([A-Za-z0-9)])\s*\/\s*([A-Za-z0-9(])/g, '$1 over $2')
    .replace(/\s*=\s*/g, ' equals ')
    .replace(/\s+/g, ' ')
    .trim();

  return spoken;
}

/**
 * Generates a concise, composed J.A.R.V.I.S.-inspired British field briefing
 * summarizing the captured scene and its discovered concepts.
 */
export function buildSceneVoiceBriefing(analysis: SceneAnalysisResponse): string {
  const count = analysis.concepts.length;
  if (count === 0) {
    return (
      analysis.guidanceMessage ||
      'I could not isolate clear geometric or physical structure in this frame. Aim the camera toward buildings, reflections, moving objects, or repeating patterns.'
    );
  }

  const topTitles = analysis.concepts
    .slice(0, 3)
    .map((c) => c.title)
    .join(', ');

  const leadConcept = analysis.concepts[0];
  const summarySentence = analysis.sceneSummary.endsWith('.')
    ? analysis.sceneSummary
    : `${analysis.sceneSummary}.`;

  return `${summarySentence} I have isolated ${count} mathematical and physical principles in view, led by ${topTitles}. Starting with ${leadConcept.title}: ${leadConcept.plainExplanation}`;
}

/**
 * Builds natural spoken narration for an individual Concept Card.
 */
export function buildConceptVoiceNarration(
  concept: ConceptItem,
  activeTab: ActiveCardTab,
  currentExplanation: string
): string {
  const spokenEquation = formatMathForSpeech(concept.equation);
  if (activeTab === 'see') {
    return `${concept.title}. ${spokenEquation}. Visible right here: ${concept.visibleEvidence}`;
  }
  if (activeTab === 'care') {
    return `${concept.title}. Why this matters in practice: ${concept.whyItMatters}`;
  }
  return `${concept.title}. ${spokenEquation}. ${currentExplanation}`;
}

/**
 * Generates 3 scene-specific starter prompts so users can tap or speak immediately.
 */
export function buildStarterQuestions(concepts: ConceptItem[]): string[] {
  if (concepts.length === 0) {
    return [
      'What kinds of math can I find around me?',
      'How do reflections on water work?',
      'Explain perspective in simple terms',
    ];
  }

  const first = concepts[0];
  const second = concepts[1];
  const prompts: string[] = [
    `How do I spot ${first.title.toLowerCase()} right here?`,
  ];

  if (second) {
    prompts.push(`How do engineers use ${second.title.toLowerCase()}?`);
  } else {
    prompts.push(`How could I estimate real measurements from this scene?`);
  }

  prompts.push('¿Puedes explicarme esta escena en español?');
  return prompts;
}

/**
 * Validates and normalizes the JSON returned by Gemini for /api/ask-scene.
 */
export function normalizeAskSceneOutput(
  rawText: string,
  validConceptIds: ReadonlySet<string>,
  fallbackTranscript = ''
): Omit<AskSceneResponse, 'audioBase64' | 'audioMimeType'> {
  const parsed = JSON.parse(extractJsonString(rawText)) as Record<string, unknown>;

  const reply =
    typeof parsed.reply === 'string' && parsed.reply.trim().length > 0
      ? sanitizePublicText(parsed.reply.trim()).slice(0, 700)
      : '';

  if (!reply) {
    throw new Error('Empty reply in scene conversation response');
  }

  const transcript =
    typeof parsed.transcript === 'string' && parsed.transcript.trim().length > 0
      ? sanitizePublicText(parsed.transcript.trim()).slice(0, 320)
      : sanitizePublicText(fallbackTranscript.trim()).slice(0, 320);

  const rawSpoken =
    typeof parsed.spokenReply === 'string' && parsed.spokenReply.trim().length > 0
      ? sanitizePublicText(parsed.spokenReply.trim()).slice(0, 700)
      : formatMathForSpeech(reply);

  const languageCode =
    typeof parsed.languageCode === 'string' && /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/.test(parsed.languageCode.trim())
      ? parsed.languageCode.trim()
      : 'en-GB';

  const languageName =
    typeof parsed.languageName === 'string' && parsed.languageName.trim().length > 0
      ? parsed.languageName.trim().slice(0, 40)
      : 'English';

  const rawConceptId =
    typeof parsed.relatedConceptId === 'string' ? parsed.relatedConceptId.trim() : '';
  const relatedConceptId =
    rawConceptId && validConceptIds.has(rawConceptId) ? rawConceptId : undefined;

  return {
    transcript,
    reply,
    spokenReply: rawSpoken,
    languageCode,
    languageName,
    ...(relatedConceptId ? { relatedConceptId } : {}),
  };
}
