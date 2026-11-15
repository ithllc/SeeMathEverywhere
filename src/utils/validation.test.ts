import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AnalysisValidationError,
  clamp01,
  describeOverlayForScreenReader,
  extractJsonString,
  validateAndNormalizeAnalysis,
} from './validation';
import {
  computeAngleArcPath,
  computeArrowHead,
  computeBoundingBox,
  getCategoryPalette,
} from './overlayGeometry';

test('validateAndNormalizeAnalysis parses valid Gemini multimodal JSON and clamps coordinates', () => {
  const raw = JSON.stringify({
    sceneSummary: 'Manhattan skyline viewed across the Hudson River at night.',
    concepts: [
      {
        id: 'Specular Reflection',
        category: 'Physics',
        title: 'Law of Reflection on Water',
        equation: 'θᵢ = θᵣ',
        plainExplanation:
          'City lights strike the river surface and reflect toward your eyes at equal angles. Small ripples tilt local water facets into vertical light columns.',
        visibleEvidence: 'Bright vertical shimmer columns directly beneath illuminated towers.',
        whyItMatters: 'Used in marine radar, fiber-optic communications, and realistic 3D water rendering.',
        confidence: 1.4, // Should clamp to 1.0
        measurementType: 'qualitative',
        overlay: {
          type: 'angle',
          points: [
            { x: 0.72, y: 0.28, label: 'Tower light' },
            { x: 0.72, y: 0.68, label: 'Water facet' },
            { x: 0.28, y: 1.25, label: 'Observer' }, // y > 1 should clamp to 1
          ],
        },
      },
    ],
  });

  const result = validateAndNormalizeAnalysis(raw);
  assert.equal(result.insufficientScene, undefined);
  assert.equal(result.concepts.length, 1);
  assert.equal(result.concepts[0].id, 'specular-reflection');
  assert.equal(result.concepts[0].category, 'Physics');
  assert.equal(result.concepts[0].confidence, 1);
  assert.equal(result.concepts[0].overlay.points[2].y, 1);
});

test('extractJsonString strips markdown fences around JSON', () => {
  const wrapped = '```json\n{"sceneSummary":"Test","concepts":[]}\n```';
  const result = validateAndNormalizeAnalysis(extractJsonString(wrapped));
  assert.equal(result.insufficientScene, true);
  assert.equal(result.concepts.length, 0);
  assert.ok(result.guidanceMessage && result.guidanceMessage.includes('buildings'));
});

test('validateAndNormalizeAnalysis throws AnalysisValidationError on malformed JSON', () => {
  assert.throws(
    () => validateAndNormalizeAnalysis('{ "sceneSummary": "broken", "concepts": [ '),
    AnalysisValidationError
  );
});

test('validateAndNormalizeAnalysis synthesizes minimum points for sparse triangle overlays', () => {
  const raw = JSON.stringify({
    sceneSummary: 'Perspective scene',
    concepts: [
      {
        id: 'similar-triangles',
        category: 'Math',
        title: 'Similar Triangles',
        equation: 'h₁/d₁ = h₂/d₂',
        plainExplanation: 'Apparent height scales inversely with distance.',
        visibleEvidence: 'Near pier posts appear tall compared to distant skyscrapers.',
        whyItMatters: 'Surveying and camera calibration.',
        confidence: 0.88,
        measurementType: 'estimated',
        overlay: {
          type: 'triangle',
          points: [{ x: 0.5, y: 0.5, label: 'Apex' }],
        },
      },
    ],
  });

  const parsed = validateAndNormalizeAnalysis(raw);
  assert.equal(parsed.concepts[0].overlay.points.length, 3);
  assert.equal(parsed.concepts[0].measurementType, 'estimated');
});

test('describeOverlayForScreenReader produces accessible spatial summary', () => {
  const description = describeOverlayForScreenReader({
    id: 'boat-velocity',
    category: 'Physics',
    title: 'Ferry Velocity',
    equation: 'v = Δx / Δt',
    plainExplanation: 'Velocity measures displacement over time.',
    visibleEvidence: 'Lit ferry crossing from left to right across the river.',
    whyItMatters: 'Maritime navigation and collision avoidance.',
    confidence: 0.84,
    measurementType: 'estimated',
    overlay: {
      type: 'vector',
      points: [
        { x: 0.45, y: 0.58, label: 'x₁' },
        { x: 0.65, y: 0.58, label: 'v vector' },
      ],
    },
  });

  assert.ok(description.includes('Physics vector annotation for Ferry Velocity'));
  assert.ok(description.includes('x₁'));
  assert.ok(description.includes('v vector'));
});

test('overlayGeometry helpers compute valid arrowheads, bounding boxes, and palettes', () => {
  assert.equal(clamp01(-0.4), 0);
  assert.equal(clamp01(1.9), 1);

  const mathPalette = getCategoryPalette('Math');
  const physicsPalette = getCategoryPalette('Physics');
  assert.equal(mathPalette.stroke, '#22D3EE');
  assert.equal(physicsPalette.stroke, '#F59E0B');

  const [h1, h2] = computeArrowHead({ x: 0, y: 0 }, { x: 100, y: 0 }, 12);
  assert.ok(h1.x < 100 && h2.x < 100);

  const bbox = computeBoundingBox([
    { x: 20, y: 40 },
    { x: 120, y: 180 },
  ]);
  assert.equal(bbox.width, 100);
  assert.equal(bbox.height, 140);

  const arc = computeAngleArcPath({ x: 100, y: 20 }, { x: 100, y: 100 }, { x: 40, y: 160 }, 30);
  assert.ok(arc.startsWith('M '));
  assert.ok(arc.includes(' A 30 30 '));
});

test('analyzeSceneWithRetry recovers when first Gemini output is malformed JSON and repair retry succeeds', async () => {
  const { analyzeSceneWithRetry } = await import('../../server');
  let callCount = 0;

  const response = await analyzeSceneWithRetry(async (isRepairRetry) => {
    callCount++;
    if (!isRepairRetry) {
      return '{ "sceneSummary": "truncated json...';
    }
    return JSON.stringify({
      sceneSummary: 'Repaired waterfront skyline scene.',
      concepts: [
        {
          id: 'reflection',
          category: 'Physics',
          title: 'Reflection',
          equation: 'θᵢ = θᵣ',
          plainExplanation: 'Light reflects off water at an equal angle.',
          visibleEvidence: 'Vertical light column on the river.',
          whyItMatters: 'Used in optical mirrors and marine radar.',
          confidence: 0.92,
          measurementType: 'qualitative',
          overlay: {
            type: 'ray',
            points: [
              { x: 0.7, y: 0.3 },
              { x: 0.7, y: 0.75 },
            ],
          },
        },
      ],
    });
  });

  assert.equal(callCount, 2);
  assert.equal(response.concepts.length, 1);
  assert.equal(response.concepts[0].title, 'Reflection');
});

test('isRateLimitError accurately distinguishes real 429 quota errors from words containing "rate"', async () => {
  const { isRateLimitError, mapServerError } = await import('../../server');

  assert.equal(isRateLimitError(new Error('Failed to generate content')), false);
  assert.equal(mapServerError(new Error('Failed to generate content')).errorCode, 'ANALYSIS_FAILED');

  assert.equal(isRateLimitError({ status: 429, message: 'Too Many Requests' }), true);
  assert.equal(isRateLimitError(new Error('RESOURCE_EXHAUSTED: Quota exceeded')), true);
  assert.equal(isRateLimitError(new Error('Rate limit reached')), true);
});

test('executeWithBackoff retries transient 429 errors across primary gemini-4-argon and fallback gemini-4-hydrogen', async () => {
  const { executeWithBackoff, parseRetryDelayMs } = await import('../../server');
  assert.equal(parseRetryDelayMs(new Error('{"retryDelay":"4s"}'), 1000), 4000);

  const visited: string[] = [];
  const result = await executeWithBackoff(
    async (model) => {
      visited.push(model);
      if (visited.length < 3) {
        const err = new Error('429 RESOURCE_EXHAUSTED');
        (err as Error & { status?: number }).status = 429;
        throw err;
      }
      return `ok-${model}-${visited.length}`;
    },
    { models: ['gemini-4-argon', 'gemini-4-hydrogen'], maxAttempts: 3, baseDelayMs: 0 }
  );

  assert.deepEqual(visited, ['gemini-4-argon', 'gemini-4-hydrogen', 'gemini-4-hydrogen']);
  assert.equal(result, 'ok-gemini-4-hydrogen-3');
});

test('executeWithBackoff falls back immediately when primary model is unavailable (400/404)', async () => {
  const { executeWithBackoff } = await import('../../server');
  const visited: string[] = [];

  const result = await executeWithBackoff(
    async (model) => {
      visited.push(model);
      if (model === 'gemini-custom-unavailable') {
        const err = new Error('unexpected model name format');
        (err as Error & { status?: number }).status = 400;
        throw err;
      }
      return `ok-${model}`;
    },
    { models: ['gemini-custom-unavailable', 'gemini-4-hydrogen'], baseDelayMs: 0 }
  );

  assert.deepEqual(visited, ['gemini-custom-unavailable', 'gemini-4-hydrogen']);
  assert.equal(result, 'ok-gemini-4-hydrogen');
});

test('formatMathForSpeech converts equations into natural spoken words', async () => {
  const { formatMathForSpeech } = await import('./voiceFormatting');

  assert.equal(formatMathForSpeech('θᵢ = θᵣ'), 'theta i equals theta r');
  assert.equal(formatMathForSpeech('v = Δx / Δt'), 'v equals delta x over delta t');
  assert.equal(formatMathForSpeech('I ∝ 1/r²'), 'I is proportional to 1 over r squared');
});

test('normalizeAskSceneOutput validates multilingual replies and filters unknown concept IDs', async () => {
  const { normalizeAskSceneOutput } = await import('./voiceFormatting');
  const validIds = new Set(['specular-reflection', 'similar-triangles']);

  const spanishJson = JSON.stringify({
    transcript: '¿Por qué la luz se estira en el agua?',
    reply: 'Las pequeñas olas inclinan el agua y reflejan la luz en una columna brillante.',
    spokenReply: 'Las pequeñas olas inclinan el agua y reflejan la luz en una columna brillante.',
    languageCode: 'es-ES',
    languageName: 'Español',
    relatedConceptId: 'specular-reflection',
  });

  const parsed = normalizeAskSceneOutput(spanishJson, validIds);
  assert.equal(parsed.languageCode, 'es-ES');
  assert.equal(parsed.languageName, 'Español');
  assert.equal(parsed.relatedConceptId, 'specular-reflection');

  const unknownConceptJson = JSON.stringify({
    transcript: 'What about gravity?',
    reply: 'Gravity pulls water waves back toward equilibrium.',
    spokenReply: 'Gravity pulls water waves back toward equilibrium.',
    languageCode: 'en-GB',
    languageName: 'English',
    relatedConceptId: 'non-existent-id',
  });
  const parsedUnknown = normalizeAskSceneOutput(unknownConceptJson, validIds);
  assert.equal(parsedUnknown.relatedConceptId, undefined);
});

test('ensurePlayableWavBase64 strips trailing C2PA chunks from RIFF WAV and wraps raw L16 PCM safely', async () => {
  const { ensurePlayableWavBase64, normalizeAudioMimeType } = await import('../../server');

  assert.equal(normalizeAudioMimeType('audio/webm;codecs=opus'), 'audio/webm');
  assert.equal(normalizeAudioMimeType('video/webm;codecs=opus'), 'audio/webm');
  assert.equal(normalizeAudioMimeType('audio/mp4; codecs="mp4a.40.2"'), 'audio/mp4');
  assert.equal(normalizeAudioMimeType('video/mp4'), 'audio/mp4');
  assert.equal(normalizeAudioMimeType(''), 'audio/webm');
  assert.equal(normalizeAudioMimeType('application/javascript'), null);

  // Build a RIFF WAV with a 16-byte fmt chunk, 20-byte data chunk, AND a 7-byte odd-length C2PA chunk
  const fmtChunk = Buffer.alloc(16, 1);
  const pcmChunk = Buffer.alloc(20, 2);
  const c2paChunk = Buffer.from('c2padata', 'ascii'); // 8 bytes total payload: 7 + 1 pad
  const totalWithC2pa = 4 + (8 + 16) + (8 + 20) + (8 + 8);
  const riffWithC2pa = Buffer.alloc(8 + totalWithC2pa);
  riffWithC2pa.write('RIFF', 0);
  riffWithC2pa.writeUInt32LE(totalWithC2pa, 4);
  riffWithC2pa.write('WAVE', 8);
  riffWithC2pa.write('fmt ', 12);
  riffWithC2pa.writeUInt32LE(16, 16);
  fmtChunk.copy(riffWithC2pa, 20);
  riffWithC2pa.write('data', 36);
  riffWithC2pa.writeUInt32LE(20, 40);
  pcmChunk.copy(riffWithC2pa, 44);
  riffWithC2pa.write('C2PA', 64);
  riffWithC2pa.writeUInt32LE(7, 68);
  c2paChunk.copy(riffWithC2pa, 72);

  const cleaned = ensurePlayableWavBase64(riffWithC2pa.toString('base64'), 'audio/wav');
  const cleanedBuf = Buffer.from(cleaned.audioBase64, 'base64');
  assert.equal(cleanedBuf.subarray(0, 4).toString('ascii'), 'RIFF');
  assert.equal(cleanedBuf.length, 44 + 20);
  assert.equal(cleanedBuf.includes(Buffer.from('C2PA', 'ascii')), false);

  const rawPcm = Buffer.alloc(16, 0).toString('base64');
  const wrapped = ensurePlayableWavBase64(rawPcm, 'audio/L16;rate=24000');
  const decodedWrapped = Buffer.from(wrapped.audioBase64, 'base64');
  assert.equal(decodedWrapped.subarray(0, 4).toString('ascii'), 'RIFF');
  assert.equal(decodedWrapped.length, 44 + 16);
});

test('security audit: client source, public assets, vite config, and .env.example never expose GEMINI_API_KEY or @google/genai', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { sanitizePublicText } = await import('./voiceFormatting');

  // Verify secret scrubber strips Google API key patterns and query parameters
  const fakeKey = 'AIza' + 'SyD9exampleSecretToken1234567890';
  const scrubbed = sanitizePublicText(
    `Error calling https://generativelanguage.googleapis.com/v1?key=${fakeKey} with ${fakeKey}`
  );
  assert.equal(scrubbed.includes(fakeKey), false);
  assert.ok(scrubbed.includes('[REDACTED'));

  const repoRoot = path.resolve(import.meta.dirname, '../..');

  function collectFiles(dir: string): string[] {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...collectFiles(fullPath));
      } else if (/\.(ts|tsx|js|html|css|json|webmanifest)$/i.test(entry.name) && !entry.name.endsWith('.test.ts')) {
        files.push(fullPath);
      }
    }
    return files;
  }

  const clientFiles = [
    ...collectFiles(path.join(repoRoot, 'src')),
    ...collectFiles(path.join(repoRoot, 'public')),
    path.join(repoRoot, 'index.html'),
    path.join(repoRoot, 'vite.config.ts'),
  ];

  for (const file of clientFiles) {
    const content = fs.readFileSync(file, 'utf8');
    // Strip comments when checking vite.config.ts explanatory comment
    const codeOnly = content
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    assert.equal(
      /GEMINI_API_KEY/.test(codeOnly),
      false,
      `Client file ${path.relative(repoRoot, file)} must not reference GEMINI_API_KEY`
    );
    assert.equal(
      /@google\/genai/.test(codeOnly),
      false,
      `Client file ${path.relative(repoRoot, file)} must not import @google/genai`
    );
    assert.equal(
      /AIza[0-9A-Za-z_-]{20,}/.test(content),
      false,
      `Client file ${path.relative(repoRoot, file)} must not contain any hardcoded API key`
    );
  }

  const envExample = fs.readFileSync(path.join(repoRoot, '.env.example'), 'utf8');
  assert.equal(/AIza[0-9A-Za-z_-]{20,}/.test(envExample), false);

  const gitignore = fs.readFileSync(path.join(repoRoot, '.gitignore'), 'utf8');
  assert.ok(gitignore.includes('.env'));
  assert.ok(gitignore.includes('!.env.example'));
  assert.ok(gitignore.includes('.playwright-cli/'));

  const licenseText = fs.readFileSync(path.join(repoRoot, 'LICENSE'), 'utf8');
  assert.ok(licenseText.includes('GNU AFFERO GENERAL PUBLIC LICENSE'));
  assert.ok(licenseText.includes('Version 3, 19 November 2007'));

  const pkgJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as {
    license?: string;
    name?: string;
  };
  assert.equal(pkgJson.license, 'AGPL-3.0-only');
  assert.equal(pkgJson.name, 'seematheverywhere');
});



