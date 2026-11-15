import 'dotenv/config';
import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import {
  AnalysisValidationError,
  INSUFFICIENT_SCENE_SUGGESTION,
  isValidReadingLevel,
  validateAndNormalizeAnalysis,
} from './src/utils/validation.ts';
import {
  formatMathForSpeech,
  normalizeAskSceneOutput,
  sanitizePublicText,
} from './src/utils/voiceFormatting.ts';
import type { ReadingLevel, SceneAnalysisResponse } from './src/types/concepts.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ALLOWED_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

const ALLOWED_AUDIO_MIME_TYPES = new Set([
  'audio/webm',
  'audio/mp4',
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/x-wav',
  'audio/ogg',
  'audio/aac',
  'audio/x-m4a',
  'audio/flac',
]);

const GEMINI_TIMEOUT_MS = 35_000;
const PRIMARY_ANALYSIS_MODEL = 'gemini-4-argon';
const FAST_TEXT_MODEL = 'gemini-4-hydrogen';
const TTS_MODELS = [
  'gemini-3.8-flash-lite-tts',
  'gemini-3.8-flash-tts',
  'gemini-3.8-flash',
];
const DEDUPE_TTL_MS = 25_000;

export function redactSecrets(input: string): string {
  const configuredKey = process.env.GEMINI_API_KEY?.trim();
  const realSecret =
    configuredKey && configuredKey !== 'MY_GEMINI_API_KEY' ? configuredKey : undefined;
  return sanitizePublicText(input, realSecret);
}

export function normalizeAudioMimeType(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const base = raw.split(';')[0].trim().toLowerCase();
  if (!base) return 'audio/webm';
  if (base === 'audio/x-wav' || base === 'audio/wave') return 'audio/wav';
  if (base === 'audio/x-m4a' || base === 'video/mp4') return 'audio/mp4';
  if (base === 'video/webm') return 'audio/webm';
  return ALLOWED_AUDIO_MIME_TYPES.has(base) ? base : null;
}

/**
 * Ensures TTS output bytes are a clean, universally playable RIFF PCM WAV file:
 * - Strips non-audio trailing chunks (such as odd-length C2PA metadata chunks) from RIFF WAV
 *   so strict Safari/iOS/WebAudio decoders never reject the buffer.
 * - Wraps raw headerless L16 PCM (24kHz, 16-bit mono) in a standard 44-byte RIFF WAV header.
 */
export function ensurePlayableWavBase64(
  base64Audio: string,
  declaredMimeType?: string
): { audioBase64: string; mimeType: string } {
  const buf = Buffer.from(base64Audio, 'base64');
  if (
    buf.length >= 44 &&
    buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buf.subarray(8, 12).toString('ascii') === 'WAVE'
  ) {
    let offset = 12;
    let fmtPayload: Buffer | null = null;
    let dataPayload: Buffer | null = null;

    while (offset + 8 <= buf.length) {
      const chunkId = buf.subarray(offset, offset + 4).toString('ascii');
      const chunkSize = buf.readUInt32LE(offset + 4);
      const dataStart = offset + 8;
      const clampedEnd = Math.min(buf.length, dataStart + chunkSize);
      if (chunkId === 'fmt ' && clampedEnd > dataStart) {
        fmtPayload = buf.subarray(dataStart, clampedEnd);
      } else if (chunkId === 'data' && clampedEnd > dataStart) {
        dataPayload = buf.subarray(dataStart, clampedEnd);
      }
      if (fmtPayload && dataPayload) break;
      offset = dataStart + chunkSize + (chunkSize % 2);
    }

    if (fmtPayload && dataPayload) {
      const totalRiffPayload = 4 + (8 + fmtPayload.length) + (8 + dataPayload.length);
      const cleanWav = Buffer.alloc(8 + totalRiffPayload);
      let pos = 0;
      cleanWav.write('RIFF', pos);
      pos += 4;
      cleanWav.writeUInt32LE(totalRiffPayload, pos);
      pos += 4;
      cleanWav.write('WAVE', pos);
      pos += 4;
      cleanWav.write('fmt ', pos);
      pos += 4;
      cleanWav.writeUInt32LE(fmtPayload.length, pos);
      pos += 4;
      fmtPayload.copy(cleanWav, pos);
      pos += fmtPayload.length;
      cleanWav.write('data', pos);
      pos += 4;
      cleanWav.writeUInt32LE(dataPayload.length, pos);
      pos += 4;
      dataPayload.copy(cleanWav, pos);
      return {
        audioBase64: cleanWav.toString('base64'),
        mimeType: 'audio/wav',
      };
    }

    return { audioBase64: base64Audio, mimeType: 'audio/wav' };
  }

  const mime = (declaredMimeType || '').toLowerCase();
  if (mime && !mime.includes('l16') && !mime.includes('pcm') && !mime.includes('wav')) {
    return { audioBase64: base64Audio, mimeType: declaredMimeType || 'audio/wav' };
  }

  const sampleRate = 24_000;
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = buf.length;
  const header = Buffer.alloc(44);

  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);

  return {
    audioBase64: Buffer.concat([header, buf]).toString('base64'),
    mimeType: 'audio/wav',
  };
}

const transientDedupeCache = new Map<
  string,
  { expiresAt: number; response: SceneAnalysisResponse }
>();
const inFlightAnalyses = new Map<string, Promise<SceneAnalysisResponse>>();

const unsupportedModels = new Set<string>();

function getAnalysisModelChain(): string[] {
  const configured = process.env.GEMINI_MODEL?.trim();
  const rawChain = configured
    ? configured === FAST_TEXT_MODEL
      ? [FAST_TEXT_MODEL, PRIMARY_ANALYSIS_MODEL]
      : [configured, FAST_TEXT_MODEL]
    : [PRIMARY_ANALYSIS_MODEL, FAST_TEXT_MODEL];

  const filtered = rawChain.filter((m) => !unsupportedModels.has(m));
  return filtered.length > 0 ? filtered : [FAST_TEXT_MODEL];
}

function getThinkingConfigForModel(model: string) {
  if (model === FAST_TEXT_MODEL) {
    return { thinkingLevel: ThinkingLevel.LOW };
  }
  return undefined;
}

export function isModelUnavailableError(err: unknown): boolean {
  const anyErr = err as { status?: number; code?: number | string; message?: string };
  if (anyErr?.status === 404 || anyErr?.code === 404 || anyErr?.code === 'NOT_FOUND') {
    return true;
  }
  const msg = String(anyErr?.message || '');
  return /\b404\b|not_found|unexpected model name|model.*not found|not supported for generatecontent/i.test(
    msg
  );
}

export function isRateLimitError(err: unknown): boolean {
  const anyErr = err as { status?: number; code?: number | string; message?: string };
  if (anyErr?.status === 429 || anyErr?.code === 429 || anyErr?.code === 'RESOURCE_EXHAUSTED') {
    return true;
  }
  const msg = String(anyErr?.message || '');
  return /\b429\b|resource_exhausted|quota|rate[-_ ]limit|too many requests/i.test(msg);
}

export function isTransientUpstreamError(err: unknown): boolean {
  const anyErr = err as { status?: number; code?: number | string; message?: string };
  if (
    anyErr?.status === 500 ||
    anyErr?.status === 502 ||
    anyErr?.status === 503 ||
    anyErr?.status === 504
  ) {
    return true;
  }
  const msg = String(anyErr?.message || '');
  return /\b503\b|unavailable|overloaded|internal error|temporarily/i.test(msg);
}

export function parseRetryDelayMs(err: unknown, fallbackMs: number): number {
  const msg = String((err as { message?: string })?.message || '');
  const match =
    msg.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/i) ||
    msg.match(/retry in (\d+(?:\.\d+)?)s/i);
  if (match && match[1]) {
    const parsedMs = Math.ceil(Number(match[1]) * 1000);
    if (Number.isFinite(parsedMs) && parsedMs > 0) {
      return Math.min(8_000, Math.max(fallbackMs, parsedMs));
    }
  }
  return fallbackMs;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function executeWithBackoff<T>(
  operation: (model: string) => Promise<T>,
  options?: { models?: string[]; model?: string; maxAttempts?: number; baseDelayMs?: number }
): Promise<T> {
  const candidateModels =
    options?.models ?? (options?.model ? [options.model] : getAnalysisModelChain());
  const totalAttempts = options?.maxAttempts ?? Math.max(3, candidateModels.length + 1);
  const baseDelayMs = options?.baseDelayMs ?? 1_200;
  let lastError: unknown;

  for (let attempt = 0; attempt < totalAttempts; attempt++) {
    const model = candidateModels[Math.min(attempt, candidateModels.length - 1)];
    const hasDistinctNextModel =
      attempt + 1 < candidateModels.length && candidateModels[attempt + 1] !== model;

    try {
      return await operation(model);
    } catch (err) {
      lastError = err;
      const modelUnavailable = isModelUnavailableError(err);
      const rateLimited = isRateLimitError(err);
      const transient = isTransientUpstreamError(err);

      if (modelUnavailable && hasDistinctNextModel) {
        unsupportedModels.add(model);
        continue;
      }

      if (!rateLimited && !transient && !hasDistinctNextModel) {
        throw err;
      }

      if (attempt < totalAttempts - 1 && baseDelayMs > 0) {
        const jitter = Math.floor(Math.random() * 250);
        const computed = hasDistinctNextModel
          ? 250 + jitter
          : baseDelayMs * Math.pow(1.8, attempt) + jitter;
        const waitMs =
          rateLimited && !hasDistinctNextModel ? parseRetryDelayMs(err, computed) : computed;
        await sleep(waitMs);
      }
    }
  }

  throw lastError;
}

function createGeminiClient(apiVersion?: string): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    const err = new Error('GEMINI_API_KEY is not configured on the server.');
    (err as Error & { code?: string }).code = 'MISSING_API_KEY';
    throw err;
  }
  return new GoogleGenAI({
    apiKey,
    ...(apiVersion ? { apiVersion } : {}),
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

const ANALYSIS_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    sceneSummary: {
      type: Type.STRING,
      description: 'Concise 1-sentence description of what is visible in the scene.',
    },
    guidanceMessage: {
      type: Type.STRING,
      description:
        'Optional helpful suggestion if the photo is too dark, blurry, or lacks discernible structure.',
    },
    concepts: {
      type: Type.ARRAY,
      description:
        '3 to 5 distinct math or physics concepts visibly supported by this image, or an empty array if the image lacks sufficient visual evidence.',
      items: {
        type: Type.OBJECT,
        properties: {
          id: {
            type: Type.STRING,
            description: 'Stable lowercase kebab-case slug, e.g. specular-reflection.',
          },
          category: {
            type: Type.STRING,
            description: 'Either "Math" or "Physics".',
          },
          title: {
            type: Type.STRING,
            description: 'Clear, engaging concept title.',
          },
          equation: {
            type: Type.STRING,
            description: 'Compact readable equation using Unicode math symbols (e.g. θᵢ = θᵣ, h₁/d₁ = h₂/d₂, v = Δx/Δt).',
          },
          plainExplanation: {
            type: Type.STRING,
            description: 'Two short sentences in accessible everyday language.',
          },
          visibleEvidence: {
            type: Type.STRING,
            description: 'Specific object, reflection, pattern, or motion visible in this exact image.',
          },
          whyItMatters: {
            type: Type.STRING,
            description: 'Concrete real-world application (e.g. navigation, architecture, surveying, robotics, graphics, engineering).',
          },
          confidence: {
            type: Type.NUMBER,
            description: 'Confidence score from 0.0 to 1.0.',
          },
          measurementType: {
            type: Type.STRING,
            description: '"qualitative" for structural/geometric relationships, or "estimated" when referencing approximate uncalibrated quantities.',
          },
          overlay: {
            type: Type.OBJECT,
            properties: {
              type: {
                type: Type.STRING,
                description: 'One of: line, ray, angle, triangle, grid, vector, path, region.',
              },
              points: {
                type: Type.ARRAY,
                description: 'Normalized [0.0, 1.0] screen-space coordinates anchored directly onto the visible evidence in the image.',
                items: {
                  type: Type.OBJECT,
                  properties: {
                    x: {
                      type: Type.NUMBER,
                      description: 'Normalized horizontal position from 0.0 (left) to 1.0 (right).',
                    },
                    y: {
                      type: Type.NUMBER,
                      description: 'Normalized vertical position from 0.0 (top) to 1.0 (bottom).',
                    },
                    label: {
                      type: Type.STRING,
                      description: 'Optional concise 1-3 word marker label.',
                    },
                  },
                  required: ['x', 'y'],
                },
              },
            },
            required: ['type', 'points'],
          },
        },
        required: [
          'id',
          'category',
          'title',
          'equation',
          'plainExplanation',
          'visibleEvidence',
          'whyItMatters',
          'confidence',
          'measurementType',
          'overlay',
        ],
      },
    },
  },
  required: ['sceneSummary', 'concepts'],
};

const ANALYSIS_SYSTEM_INSTRUCTION = `You are SeeMathEverywhere, a real-world mathematics and physics discovery engine ("The world is the textbook").
You are NOT a homework solver. When given a real-world photograph—including nighttime city skylines, waterfront reflections, boats, streets, architecture, parks, or indoor objects—identify 3 to 5 genuinely visible, diverse Math and Physics concepts.

Rules:
1. Only identify concepts directly supported by visible evidence in the image. Never hallucinate objects that are not present.
2. Include a balanced mix of "Math" and "Physics" concepts without repeating essentially the same idea.
3. Great low-light / waterfront / urban examples when visible include:
   - Reflection and scattering of lights on water (θᵢ = θᵣ)
   - Perspective projection, vanishing points, and similar triangles (h₁/d₁ = h₂/d₂)
   - Trigonometric triangulation across distances (tan θ = h/d)
   - Surface wave behavior on water (v = fλ)
   - Velocity and displacement vectors of boats, cars, or pedestrians (v = Δx/Δt)
   - Coordinate geometry in skyscraper window grids ((x, y) = (x₀ + c·Δx, y₀ + r·Δy))
   - Structural symmetry, catenary cables, trusses, or arches
   - Light intensity falloff and inverse-square law (I ∝ 1/r²)
4. Never claim exact physical measurements (meters, mph) unless calibrated; set measurementType to "estimated" whenever approximate quantities are discussed, or "qualitative" for pure geometric/physical principles.
5. Anchor overlay.points accurately in normalized [0, 1] image coordinates:
   - "angle": provide 3 points [incidentOrigin, vertexOnSurface, reflectedTarget]
   - "triangle": provide 3 points forming the visible triangle
   - "vector" or "ray": provide 2 points [start, endWithArrow]
   - "grid" or "region": provide 2 corner points [topLeft, bottomRight] or 4 polygon corners
   - "line" or "path": provide 2 to 5 points along the feature
6. Use clean, readable Unicode math notation in "equation" (such as θᵢ = θᵣ, h₁/d₁ = h₂/d₂, v = Δx/Δt, I ∝ 1/r², a² + b² = c²) rather than raw LaTeX backslashes so equations read cleanly on mobile screens.
7. If the image is completely pitch-black, lens-covered, or lacks enough visual structure to support honest concepts, return an empty concepts array [] and a helpful guidanceMessage suggesting pointing at buildings, reflections, moving objects, ramps, wheels, shadows, repeating patterns, or household objects.`;

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error('Analysis timed out');
      (err as Error & { code?: string }).code = 'GEMINI_TIMEOUT';
      reject(err);
    }, ms);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function analyzeSceneWithRetry(
  generateFn: (isRepairRetry: boolean, previousRawOutput?: string) => Promise<string>
): Promise<SceneAnalysisResponse> {
  let firstRaw = '';
  try {
    firstRaw = await generateFn(false);
    return validateAndNormalizeAnalysis(firstRaw);
  } catch (err) {
    if (!(err instanceof AnalysisValidationError)) {
      throw err;
    }
    // Retry once using a JSON-repair instruction
    const repairedRaw = await generateFn(true, firstRaw);
    return validateAndNormalizeAnalysis(repairedRaw);
  }
}

export function mapServerError(err: unknown): {
  status: number;
  userMessage: string;
  errorCode: string;
} {
  if (err instanceof AnalysisValidationError) {
    return {
      status: 502,
      errorCode: 'INVALID_MODEL_JSON',
      userMessage:
        'We could not structure the analysis cleanly on this try. Tap “Analyze Again” or try Guided Demo.',
    };
  }

  const anyErr = err as { status?: number; code?: string; message?: string };
  const msg = (anyErr?.message || '').toLowerCase();

  if (anyErr?.code === 'GEMINI_TIMEOUT' || msg.includes('timed out') || msg.includes('deadline')) {
    return {
      status: 504,
      errorCode: 'GEMINI_TIMEOUT',
      userMessage:
        'Scene analysis took too long over the current connection. Please tap “Analyze Again” or try Guided Demo.',
    };
  }

  if (
    anyErr?.code === 'MISSING_API_KEY' ||
    anyErr?.status === 403 ||
    msg.includes('api_key_invalid') ||
    msg.includes('permission_denied')
  ) {
    return {
      status: 503,
      errorCode: 'API_KEY_CONFIGURATION',
      userMessage:
        'Live scene analysis requires a valid API key in Settings > Secrets. You can explore Guided Demo right now.',
    };
  }

  if (isRateLimitError(err)) {
    return {
      status: 429,
      errorCode: 'RATE_LIMITED',
      userMessage:
        'Gemini API quota is currently busy or exhausted. Wait a moment and tap “Analyze Again,” select a billing-enabled API key in Settings > Secrets for higher quota, or open Guided Demo.',
    };
  }

  return {
    status: 500,
    errorCode: 'ANALYSIS_FAILED',
    userMessage:
      'We ran into a temporary issue analyzing that frame. Please try again or launch Guided Demo.',
  };
}

function pruneDedupeCache() {
  const now = Date.now();
  for (const [key, entry] of transientDedupeCache.entries()) {
    if (entry.expiresAt <= now) {
      transientDedupeCache.delete(key);
    }
  }
}

const ASK_SCENE_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    transcript: {
      type: Type.STRING,
      description:
        'Exact transcription of what the user asked (in the user’s spoken or written language).',
    },
    reply: {
      type: Type.STRING,
      description:
        'Concise 2 to 4 sentence explanation (max 85 words) written in the exact target language of the user, using a composed, articulate, dryly warm British scientific advisor persona.',
    },
    spokenReply: {
      type: Type.STRING,
      description:
        'Natural spoken version of reply in the exact same language, with any mathematical symbols or formulas written out naturally in words for smooth speech synthesis.',
    },
    languageCode: {
      type: Type.STRING,
      description:
        'BCP-47 language tag matching reply (use "en-GB" for English, or e.g. "es-ES", "fr-FR", "zh-CN", "ja-JP", "hi-IN", "pt-BR", "de-DE", "ar-SA", "ko-KR").',
    },
    languageName: {
      type: Type.STRING,
      description: 'Human-readable name of the reply language (e.g. "English", "Español", "Français", "日本語").',
    },
    relatedConceptId: {
      type: Type.STRING,
      description:
        'Exact id of the most relevant concept from the provided scene concepts list if applicable, or empty string "".',
    },
  },
  required: ['transcript', 'reply', 'spokenReply', 'languageCode', 'languageName'],
};

const ADVISOR_VOICE_STYLE =
  'Refined, composed, articulate British scientific and engineering advisor — calm, crisp, warm, and effortlessly clear';

async function synthesizeSpeechWav(
  rawText: string,
  languageCode = 'en-GB'
): Promise<{ audioBase64: string; mimeType: string }> {
  const ai = createGeminiClient('v1beta');
  const spokenText = formatMathForSpeech(rawText).slice(0, 900);
  const safeLang = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/.test(languageCode)
    ? languageCode
    : 'en-GB';

  return executeWithBackoff(
    async (model) => {
      // 1. Try generateContent on v1beta (supports speechConfig & prebuiltVoiceConfig 'Charon')
      try {
        let response;
        try {
          response = await withTimeout(
            ai.models.generateContent({
              model,
              contents: [
                {
                  role: 'user',
                  parts: [
                    {
                      text: spokenText,
                      speechMetadata: {
                        style: ADVISOR_VOICE_STYLE,
                      },
                    },
                  ],
                },
              ],
              config: {
                responseModalities: ['AUDIO'],
                speechConfig: {
                  voiceConfig: {
                    prebuiltVoiceConfig: { voiceName: 'Charon' },
                  },
                },
              },
            }),
            20_000
          );
        } catch {
          response = await withTimeout(
            ai.models.generateContent({
              model,
              contents: [{ role: 'user', parts: [{ text: spokenText }] }],
              config: {
                responseModalities: ['AUDIO'],
                speechConfig: {
                  voiceConfig: {
                    prebuiltVoiceConfig: { voiceName: 'Charon' },
                  },
                },
              },
            }),
            20_000
          );
        }

        const inlineData = response.candidates?.[0]?.content?.parts?.[0]?.inlineData;
        if (inlineData?.data) {
          return ensurePlayableWavBase64(inlineData.data, inlineData.mimeType);
        }
      } catch (genErr) {
        // 2. Fallback to v1beta Interactions API with speech_config
        const interaction = await withTimeout(
          ai.interactions.create({
            model,
            store: false,
            input: [
              {
                type: 'text',
                text: spokenText,
                annotations: [
                  {
                    type: 'speech_metadata',
                    style: ADVISOR_VOICE_STYLE,
                  },
                ],
              },
            ],
            response_format: { type: 'audio' },
            generation_config: {
              speech_config: [
                {
                  language: safeLang,
                  voice: 'Charon',
                },
              ],
            },
          }),
          20_000
        ).catch(() => {
          throw genErr;
        });

        const outAudio = interaction.output_audio;
        if (outAudio?.data) {
          return ensurePlayableWavBase64(outAudio.data, outAudio.mime_type);
        }
        throw genErr;
      }

      throw new Error('Empty audio output from TTS model');
    },
    { models: TTS_MODELS, maxAttempts: TTS_MODELS.length, baseDelayMs: 250 }
  );
}

const BLOCKED_SOURCE_PATH_REGEX =
  /^\/(?:\.env(?:\..+)?|server\.(?:ts|js)|package(?:-lock)?\.json|bun\.lock|tsconfig\.json|vite\.config\.ts|\.git(?:\/|$)|\.playwright-cli(?:\/|$)|\.aistudio(?:\/|$))/i;

async function startServer() {
  const app = express();
  app.disable('x-powered-by');
  const port = Number(process.env.PORT) || 3000;
  const isDevFlag = process.argv.includes('--dev');
  const distPath = path.resolve(__dirname, 'dist');
  const useViteDev =
    isDevFlag ||
    (process.env.NODE_ENV !== 'production' && !fs.existsSync(path.join(distPath, 'index.html')));

  // Security headers & strict block on server/config source files in both dev and production
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (BLOCKED_SOURCE_PATH_REGEX.test(req.path)) {
      res.status(404).type('text/plain').send('Not Found');
      return;
    }
    next();
  });

  // Accept compressed mobile frames & short voice clips in memory only — never persisted to disk
  app.use(express.json({ limit: '8mb' }));

  app.get('/api/health', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      status: 'ok',
      service: 'SeeMathEverywhere',
      geminiConfigured: Boolean(
        process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY'
      ),
    });
  });

  app.post('/api/analyze', async (req, res) => {
    try {
      const { imageBase64, mimeType } = req.body ?? {};

      if (typeof imageBase64 !== 'string' || imageBase64.length < 32) {
        res.status(400).json({
          errorCode: 'INVALID_IMAGE',
          message: 'Please capture or select a valid photo to analyze.',
        });
        return;
      }

      if (typeof mimeType !== 'string' || !ALLOWED_IMAGE_MIME_TYPES.has(mimeType)) {
        res.status(400).json({
          errorCode: 'UNSUPPORTED_IMAGE_TYPE',
          message: 'Unsupported image format. Please use a JPEG, PNG, or WebP photo.',
        });
        return;
      }

      // Short-lived (25s) hash-only deduplication prevents accidental double-tap rate-limit spikes without storing images
      pruneDedupeCache();
      const frameDigest = crypto
        .createHash('sha256')
        .update(mimeType)
        .update(':')
        .update(imageBase64)
        .digest('hex');

      const recentHit = transientDedupeCache.get(frameDigest);
      if (recentHit && recentHit.expiresAt > Date.now()) {
        res.setHeader('Cache-Control', 'no-store');
        res.json(recentHit.response);
        return;
      }

      let pending = inFlightAnalyses.get(frameDigest);
      if (!pending) {
        const ai = createGeminiClient();

        pending = analyzeSceneWithRetry(async (isRepairRetry, previousRawOutput) => {
          const promptText = isRepairRetry
            ? `Your previous output was invalid JSON or missed required schema fields. Repair and return ONLY valid JSON matching the exact schema with 3 to 5 visible Math/Physics concepts (or an empty concepts array if the image has insufficient visual evidence). Previous invalid output snippet: ${(previousRawOutput || '').slice(0, 600)}`
            : 'Analyze this real-world scene and return 3 to 5 visible mathematics and physics concepts with accurate normalized [0,1] screen-space overlay coordinates.';

          return executeWithBackoff(async (model) => {
            const thinkingConfig = getThinkingConfigForModel(model);
            const response = await withTimeout(
              ai.models.generateContent({
                model,
                contents: {
                  parts: [
                    {
                      inlineData: {
                        mimeType,
                        data: imageBase64,
                      },
                    },
                    { text: promptText },
                  ],
                },
                config: {
                  systemInstruction: ANALYSIS_SYSTEM_INSTRUCTION,
                  responseMimeType: 'application/json',
                  responseSchema: ANALYSIS_RESPONSE_SCHEMA,
                  ...(thinkingConfig ? { thinkingConfig } : {}),
                },
              }),
              GEMINI_TIMEOUT_MS
            );

            return response.text ?? '';
          });
        }).finally(() => {
          inFlightAnalyses.delete(frameDigest);
        });

        inFlightAnalyses.set(frameDigest, pending);
      }

      const analysis = await pending;
      if (transientDedupeCache.size >= 8) {
        const oldestKey = transientDedupeCache.keys().next().value;
        if (oldestKey) transientDedupeCache.delete(oldestKey);
      }
      transientDedupeCache.set(frameDigest, {
        expiresAt: Date.now() + DEDUPE_TTL_MS,
        response: analysis,
      });

      res.setHeader('Cache-Control', 'no-store');
      res.json(analysis);
    } catch (err) {
      // Never log raw image payloads or keys; log only handled status codes
      const mapped = mapServerError(err);
      console.info(`[SeeMathEverywhere] /api/analyze handled status ${mapped.status} (${mapped.errorCode})`);
      if (mapped.status === 429) {
        res.setHeader('Retry-After', '8');
      }
      res.status(mapped.status).json({
        errorCode: mapped.errorCode,
        message: mapped.userMessage,
        suggestion: INSUFFICIENT_SCENE_SUGGESTION,
      });
    }
  });

  app.post('/api/simplify', async (req, res) => {
    try {
      const {
        title,
        category,
        equation,
        plainExplanation,
        visibleEvidence,
        whyItMatters,
        level,
      } = req.body ?? {};

      if (!isValidReadingLevel(level) || typeof title !== 'string' || !title.trim()) {
        res.status(400).json({
          errorCode: 'INVALID_SIMPLIFY_REQUEST',
          message: 'Please select a valid reading level.',
        });
        return;
      }

      const audienceDescriptions: Record<ReadingLevel, string> = {
        elementary:
          'an elementary school student (ages 8–10) using vivid everyday comparisons and zero jargon',
        middle:
          'a middle school student (ages 11–13) connecting the visible scene to ratios, angles, or motion',
        high:
          'a high school student (ages 14–18) clearly linking the equation variables to what is visible',
        college:
          'a college student or curious adult using precise mathematical/physical terminology while staying concise',
      };

      const ai = createGeminiClient();

      const responseText = await executeWithBackoff(
        async (model) => {
          const thinkingConfig = getThinkingConfigForModel(model);
          const response = await withTimeout(
            ai.models.generateContent({
              model,
              contents: `Rewrite this concept explanation for ${audienceDescriptions[level]} in at most 2 short, phone-friendly sentences (max 45 words total).

Concept: ${title} (${category || 'Science'})
Equation: ${equation || ''}
Visible in photo: ${visibleEvidence || ''}
Current explanation: ${plainExplanation || ''}
Practical use: ${whyItMatters || ''}`,
              config: {
                systemInstruction:
                  'You write crystal-clear, accurate educational science explanations tailored to a specific reading level. Return JSON with a single "explanation" string field.',
                responseMimeType: 'application/json',
                responseSchema: {
                  type: Type.OBJECT,
                  properties: {
                    explanation: {
                      type: Type.STRING,
                      description: 'Two concise sentences tailored to the requested reading level.',
                    },
                  },
                  required: ['explanation'],
                },
                ...(thinkingConfig ? { thinkingConfig } : {}),
              },
            }),
            18_000
          );
          return response.text ?? '{}';
        },
        { models: [FAST_TEXT_MODEL, PRIMARY_ANALYSIS_MODEL] }
      );

      const parsed = JSON.parse(responseText) as { explanation?: string };
      const explanation =
        typeof parsed.explanation === 'string' && parsed.explanation.trim().length > 0
          ? parsed.explanation.trim().slice(0, 380)
          : String(plainExplanation || '').slice(0, 380);

      res.setHeader('Cache-Control', 'no-store');
      res.json({ level, explanation });
    } catch (err) {
      const mapped = mapServerError(err);
      console.info(`[SeeMathEverywhere] /api/simplify handled status ${mapped.status} (${mapped.errorCode})`);
      res.status(mapped.status).json({
        errorCode: mapped.errorCode,
        message: mapped.userMessage,
      });
    }
  });

  app.post('/api/tts', async (req, res) => {
    try {
      const { text, languageCode } = req.body ?? {};
      if (typeof text !== 'string' || text.trim().length === 0) {
        res.status(400).json({
          errorCode: 'INVALID_TTS_TEXT',
          message: 'Please provide text to speak.',
        });
        return;
      }

      const audio = await synthesizeSpeechWav(
        text.trim(),
        typeof languageCode === 'string' ? languageCode.trim() : 'en-GB'
      );

      res.setHeader('Cache-Control', 'no-store');
      res.json(audio);
    } catch (err) {
      const mapped = mapServerError(err);
      console.info(
        `[SeeMathEverywhere] /api/tts fallback (${mapped.errorCode})`
      );
      // Return 200 with empty audioBase64 so client falls back to Web Speech cleanly without browser 500 noise
      res.setHeader('Cache-Control', 'no-store');
      res.json({
        audioBase64: '',
        mimeType: 'audio/wav',
        fallback: true,
      });
    }
  });

  app.post('/api/ask-scene', async (req, res) => {
    try {
      const {
        questionText,
        audioBase64,
        audioMimeType,
        imageBase64,
        imageMimeType,
        sceneSummary,
        selectedConceptId,
        concepts,
        history,
        includeAudio,
      } = req.body ?? {};

      const cleanQuestion = typeof questionText === 'string' ? questionText.trim().slice(0, 500) : '';
      const hasAudio = typeof audioBase64 === 'string' && audioBase64.length >= 64;

      if (!cleanQuestion && !hasAudio) {
        res.status(400).json({
          errorCode: 'EMPTY_QUESTION',
          message: 'Please speak or type a question about the scene.',
        });
        return;
      }

      let normalizedAudioMime: string | null = null;
      if (hasAudio) {
        normalizedAudioMime = normalizeAudioMimeType(audioMimeType);
        if (!normalizedAudioMime) {
          res.status(400).json({
            errorCode: 'UNSUPPORTED_AUDIO_TYPE',
            message: 'Unsupported audio recording format. Please try again or type your question.',
          });
          return;
        }
      }

      const hasValidImage =
        typeof imageBase64 === 'string' &&
        imageBase64.length >= 64 &&
        typeof imageMimeType === 'string' &&
        ALLOWED_IMAGE_MIME_TYPES.has(imageMimeType);

      const safeConcepts: Array<{
        id: string;
        category: string;
        title: string;
        equation: string;
        plainExplanation: string;
        visibleEvidence: string;
        whyItMatters: string;
      }> = [];
      const validConceptIds = new Set<string>();

      if (Array.isArray(concepts)) {
        for (const item of concepts.slice(0, 6)) {
          if (item && typeof item === 'object') {
            const c = item as Record<string, unknown>;
            const id = typeof c.id === 'string' ? c.id.trim().slice(0, 64) : '';
            const title = typeof c.title === 'string' ? c.title.trim().slice(0, 100) : '';
            if (id && title) {
              validConceptIds.add(id);
              safeConcepts.push({
                id,
                category: typeof c.category === 'string' ? c.category.slice(0, 20) : 'Science',
                title,
                equation: typeof c.equation === 'string' ? c.equation.slice(0, 90) : '',
                plainExplanation:
                  typeof c.plainExplanation === 'string' ? c.plainExplanation.slice(0, 320) : '',
                visibleEvidence:
                  typeof c.visibleEvidence === 'string' ? c.visibleEvidence.slice(0, 260) : '',
                whyItMatters:
                  typeof c.whyItMatters === 'string' ? c.whyItMatters.slice(0, 260) : '',
              });
            }
          }
        }
      }

      const recentHistoryLines: string[] = [];
      if (Array.isArray(history)) {
        for (const h of history.slice(-6)) {
          if (h && typeof h === 'object') {
            const turn = h as Record<string, unknown>;
            const role = turn.role === 'assistant' ? 'Advisor' : 'User';
            const txt = typeof turn.text === 'string' ? turn.text.trim().slice(0, 280) : '';
            if (txt) {
              recentHistoryLines.push(`${role}: ${txt}`);
            }
          }
        }
      }

      const contextBlock = [
        `Scene summary: ${typeof sceneSummary === 'string' ? sceneSummary.slice(0, 300) : 'Real-world scene'}`,
        typeof selectedConceptId === 'string' && selectedConceptId
          ? `Currently focused concept id: ${selectedConceptId.slice(0, 64)}`
          : '',
        safeConcepts.length > 0 ? `Discovered concepts JSON: ${JSON.stringify(safeConcepts)}` : '',
        recentHistoryLines.length > 0
          ? `Recent conversation:\n${recentHistoryLines.join('\n')}`
          : '',
      ]
        .filter(Boolean)
        .join('\n\n');

      const ai = createGeminiClient();

      const parts: Array<
        { inlineData: { mimeType: string; data: string } } | { text: string }
      > = [];

      if (hasValidImage) {
        parts.push({
          inlineData: {
            mimeType: imageMimeType as string,
            data: imageBase64 as string,
          },
        });
      }

      if (hasAudio && normalizedAudioMime) {
        parts.push({
          inlineData: {
            mimeType: normalizedAudioMime,
            data: audioBase64 as string,
          },
        });
      }

      parts.push({
        text: hasAudio
          ? `${contextBlock}\n\nListen to the user's spoken question in the attached audio clip, transcribe it accurately in their language, and answer it using the visible scene context.`
          : `${contextBlock}\n\nUser question: ${cleanQuestion}`,
      });

      const askSystemInstruction = `You are the voice and conversational field advisor of SeeMathEverywhere ("The world is the textbook").
Persona: Adopt the composed, articulate, dryly warm, and effortlessly intelligent demeanor of a refined British scientific and engineering advisor (inspired by J.A.R.V.I.S.), grounded strictly in real-world evidence visible in this scene.

Rules:
1. MULTILINGUAL LANGUAGE MATCHING: Detect the exact language spoken or written by the user (or the target language they explicitly ask for, e.g. "explain in Spanish" -> Spanish) and write "reply" and "spokenReply" in that EXACT SAME LANGUAGE. For English, use refined British English ("en-GB").
2. Keep "reply" concise and mobile-friendly: 2 to 4 crisp sentences (maximum 85 words). Connect mathematical/physical principles directly to what is visible in the scene.
3. Never claim exact physical distances, speeds, or heights unless calibrated; clearly frame approximate values as visual estimates.
4. In "spokenReply", express equations and symbols naturally in spoken words in the target language (never leave raw symbols like θᵢ, Δx/Δt, or ∝ unspoken) so text-to-speech reads every word smoothly.
5. If your answer focuses on one of the provided scene concepts, set "relatedConceptId" to its exact "id"; otherwise set "relatedConceptId" to "".`;

      const rawResponseText = await executeWithBackoff(
        async (model) => {
          const thinkingConfig = getThinkingConfigForModel(model);
          const response = await withTimeout(
            ai.models.generateContent({
              model,
              contents: { parts },
              config: {
                systemInstruction: askSystemInstruction,
                responseMimeType: 'application/json',
                responseSchema: ASK_SCENE_RESPONSE_SCHEMA,
                ...(thinkingConfig ? { thinkingConfig } : {}),
              },
            }),
            25_000
          );
          return response.text ?? '{}';
        },
        { models: [FAST_TEXT_MODEL, PRIMARY_ANALYSIS_MODEL] }
      );

      const normalized = normalizeAskSceneOutput(
        rawResponseText,
        validConceptIds,
        cleanQuestion
      );

      let audioPayload: { audioBase64?: string; audioMimeType?: string } = {};
      if (includeAudio !== false) {
        try {
          const wav = await synthesizeSpeechWav(
            normalized.spokenReply || normalized.reply,
            normalized.languageCode
          );
          audioPayload = {
            audioBase64: wav.audioBase64,
            audioMimeType: wav.mimeType,
          };
        } catch (ttsErr) {
          const ttsMapped = mapServerError(ttsErr);
          console.info(
            `[SeeMathEverywhere] /api/ask-scene optional TTS status ${ttsMapped.status} (${ttsMapped.errorCode})`
          );
        }
      }

      res.setHeader('Cache-Control', 'no-store');
      res.json({
        ...normalized,
        ...audioPayload,
      });
    } catch (err) {
      const mapped = mapServerError(err);
      console.info(`[SeeMathEverywhere] /api/ask-scene handled status ${mapped.status} (${mapped.errorCode})`);
      res.status(mapped.status).json({
        errorCode: mapped.errorCode,
        message: mapped.userMessage,
      });
    }
  });

  if (useViteDev) {
    process.env.DISABLE_HMR = 'true';
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
        watch: null,
      },
      appType: 'spa',
    });
    app.use((req, res, next) => {
      if (req.path.endsWith('.webmanifest')) {
        res.setHeader('Content-Type', 'application/manifest+json');
      } else if (req.path === '/sw.js') {
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Service-Worker-Allowed', '/');
      }
      next();
    });
    app.use(vite.middlewares);
  } else {
    app.use(
      express.static(distPath, {
        setHeaders: (res, filePath) => {
          if (filePath.endsWith('.webmanifest')) {
            res.setHeader('Content-Type', 'application/manifest+json');
          } else if (filePath.endsWith('sw.js')) {
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Service-Worker-Allowed', '/');
          }
        },
      })
    );

    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(
      `[SeeMathEverywhere] Server listening on http://0.0.0.0:${port} (${useViteDev ? 'development' : 'production'})`
    );
  });
}

// Only start HTTP listener when executed directly (allows importing analyzeSceneWithRetry in unit tests)
const isMainModule =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);

if (isMainModule) {
  startServer().catch((err) => {
    console.error(
      '[SeeMathEverywhere] Failed to start server:',
      redactSecrets(err instanceof Error ? err.message : String(err))
    );
    process.exit(1);
  });
}
