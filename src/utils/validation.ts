import type {
  ConceptCategory,
  ConceptItem,
  ConceptOverlay,
  MeasurementType,
  OverlayPoint,
  OverlayType,
  ReadingLevel,
  SceneAnalysisResponse,
} from '../types/concepts.ts';

const VALID_OVERLAY_TYPES: ReadonlySet<OverlayType> = new Set([
  'line',
  'ray',
  'angle',
  'triangle',
  'grid',
  'vector',
  'path',
  'region',
]);

const VALID_READING_LEVELS: ReadonlySet<ReadingLevel> = new Set([
  'elementary',
  'middle',
  'high',
  'college',
]);

export const INSUFFICIENT_SCENE_SUGGESTION =
  'We could not spot enough clear visual structure in this frame. Try pointing your camera at buildings, water reflections, moving boats or vehicles, ramps, wheels, shadows, repeating window patterns, or everyday household objects.';

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.min(1, Math.max(0, Number(value.toFixed(4))));
}

export function toSlug(input: string, index: number): string {
  const cleaned = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return cleaned || `concept-${index + 1}`;
}

export function extractJsonString(raw: string): string {
  const trimmed = raw.trim();
  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedMatch && fencedMatch[1]) {
    return fencedMatch[1].trim();
  }
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }
  return trimmed;
}

function normalizeCategory(raw: unknown): ConceptCategory {
  if (typeof raw === 'string' && raw.trim().toLowerCase().includes('phys')) {
    return 'Physics';
  }
  return 'Math';
}

function normalizeMeasurementType(raw: unknown): MeasurementType {
  if (typeof raw === 'string' && raw.trim().toLowerCase() === 'estimated') {
    return 'estimated';
  }
  return 'qualitative';
}

function normalizeOverlayType(raw: unknown): OverlayType {
  if (typeof raw === 'string') {
    const normalized = raw.trim().toLowerCase() as OverlayType;
    if (VALID_OVERLAY_TYPES.has(normalized)) {
      return normalized;
    }
  }
  return 'region';
}

function ensureMinimumOverlayPoints(type: OverlayType, points: OverlayPoint[]): OverlayPoint[] {
  if (points.length >= 3) return points;

  if (points.length === 0) {
    if (type === 'triangle' || type === 'angle') {
      return [
        { x: 0.3, y: 0.65 },
        { x: 0.5, y: 0.35 },
        { x: 0.7, y: 0.65 },
      ];
    }
    return [
      { x: 0.3, y: 0.35 },
      { x: 0.7, y: 0.65 },
    ];
  }

  if (points.length === 1) {
    const p0 = points[0];
    const p1 = {
      x: clamp01(p0.x + 0.18 <= 0.95 ? p0.x + 0.18 : p0.x - 0.18),
      y: clamp01(p0.y + 0.14 <= 0.95 ? p0.y + 0.14 : p0.y - 0.14),
    };
    if (type === 'triangle' || type === 'angle') {
      const p2 = {
        x: clamp01(p0.x - 0.16 >= 0.05 ? p0.x - 0.16 : p0.x + 0.12),
        y: p1.y,
      };
      return [p2, p0, p1];
    }
    return [p0, p1];
  }

  // points.length === 2
  if (type === 'triangle' || type === 'angle') {
    const [a, b] = points;
    const midX = clamp01((a.x + b.x) / 2);
    const offsetY = clamp01(Math.min(a.y, b.y) - 0.15 >= 0.08 ? Math.min(a.y, b.y) - 0.15 : Math.max(a.y, b.y) + 0.15);
    return [a, { x: midX, y: offsetY }, b];
  }

  return points;
}

function normalizeOverlay(rawOverlay: unknown): ConceptOverlay {
  if (!rawOverlay || typeof rawOverlay !== 'object') {
    return {
      type: 'region',
      points: [
        { x: 0.3, y: 0.3 },
        { x: 0.7, y: 0.7 },
      ],
    };
  }

  const obj = rawOverlay as Record<string, unknown>;
  const type = normalizeOverlayType(obj.type);
  const rawPoints = Array.isArray(obj.points) ? obj.points : [];

  const parsedPoints: OverlayPoint[] = [];
  for (const pt of rawPoints.slice(0, 12)) {
    if (pt && typeof pt === 'object') {
      const p = pt as Record<string, unknown>;
      const x = Number(p.x);
      const y = Number(p.y);
      if (Number.isFinite(x) && Number.isFinite(y)) {
        const label =
          typeof p.label === 'string' && p.label.trim().length > 0
            ? p.label.trim().slice(0, 36)
            : undefined;
        parsedPoints.push({
          x: clamp01(x),
          y: clamp01(y),
          ...(label ? { label } : {}),
        });
      }
    }
  }

  return {
    type,
    points: ensureMinimumOverlayPoints(type, parsedPoints),
  };
}

export class AnalysisValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AnalysisValidationError';
  }
}

export function validateAndNormalizeAnalysis(rawText: string): SceneAnalysisResponse {
  if (typeof rawText !== 'string' || rawText.trim().length === 0) {
    throw new AnalysisValidationError('Empty model response');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonString(rawText));
  } catch {
    throw new AnalysisValidationError('Malformed JSON in model response');
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new AnalysisValidationError('Root JSON response must be an object');
  }

  const root = parsed as Record<string, unknown>;
  const sceneSummary =
    typeof root.sceneSummary === 'string' && root.sceneSummary.trim().length > 0
      ? root.sceneSummary.trim().slice(0, 280)
      : '';

  if (!Array.isArray(root.concepts)) {
    throw new AnalysisValidationError('Missing concepts array in model response');
  }

  // Handle explicit insufficient visual evidence case
  if (root.concepts.length === 0) {
    return {
      sceneSummary:
        sceneSummary || 'This frame has limited visual detail for identifying distinct concepts.',
      concepts: [],
      insufficientScene: true,
      guidanceMessage:
        typeof root.guidanceMessage === 'string' && root.guidanceMessage.trim().length > 0
          ? root.guidanceMessage.trim().slice(0, 320)
          : INSUFFICIENT_SCENE_SUGGESTION,
    };
  }

  const seenIds = new Set<string>();
  const validConcepts: ConceptItem[] = [];

  for (let i = 0; i < root.concepts.length && validConcepts.length < 5; i++) {
    const item = root.concepts[i];
    if (!item || typeof item !== 'object') continue;
    const c = item as Record<string, unknown>;

    const title = typeof c.title === 'string' ? c.title.trim() : '';
    const equation = typeof c.equation === 'string' ? c.equation.trim() : '';
    const plainExplanation =
      typeof c.plainExplanation === 'string' ? c.plainExplanation.trim() : '';
    const visibleEvidence =
      typeof c.visibleEvidence === 'string' ? c.visibleEvidence.trim() : '';
    const whyItMatters = typeof c.whyItMatters === 'string' ? c.whyItMatters.trim() : '';

    if (!title || !equation || !plainExplanation || !visibleEvidence || !whyItMatters) {
      continue;
    }

    const baseId = toSlug(typeof c.id === 'string' && c.id.trim() ? c.id : title, i);
    let uniqueId = baseId;
    let suffix = 2;
    while (seenIds.has(uniqueId)) {
      uniqueId = `${baseId}-${suffix++}`;
    }
    seenIds.add(uniqueId);

    const rawConf = Number(c.confidence);
    const confidence = Number.isFinite(rawConf)
      ? Math.min(1, Math.max(0.1, Number(rawConf.toFixed(2))))
      : 0.85;

    validConcepts.push({
      id: uniqueId,
      category: normalizeCategory(c.category),
      title: title.slice(0, 90),
      equation: equation.slice(0, 90),
      plainExplanation: plainExplanation.slice(0, 360),
      visibleEvidence: visibleEvidence.slice(0, 320),
      whyItMatters: whyItMatters.slice(0, 320),
      confidence,
      measurementType: normalizeMeasurementType(c.measurementType),
      overlay: normalizeOverlay(c.overlay),
    });
  }

  if (validConcepts.length === 0) {
    throw new AnalysisValidationError('No valid concept objects found in concepts array');
  }

  return {
    sceneSummary: sceneSummary || 'Real-world scene analyzed for mathematical and physical structure.',
    concepts: validConcepts,
  };
}

export function isValidReadingLevel(value: unknown): value is ReadingLevel {
  return typeof value === 'string' && VALID_READING_LEVELS.has(value as ReadingLevel);
}

export function describeOverlayForScreenReader(concept: ConceptItem): string {
  const { overlay, title, category, visibleEvidence } = concept;
  const pointLabels = overlay.points
    .map((pt) => pt.label)
    .filter((lbl): lbl is string => Boolean(lbl));

  const locationSummary = overlay.points
    .slice(0, 4)
    .map((pt, idx) => {
      const horiz = pt.x < 0.35 ? 'left' : pt.x > 0.65 ? 'right' : 'center';
      const vert = pt.y < 0.35 ? 'upper' : pt.y > 0.65 ? 'lower' : 'middle';
      return pt.label ? `${pt.label} (${vert} ${horiz})` : `point ${idx + 1} (${vert} ${horiz})`;
    })
    .join(', ');

  const labelNote = pointLabels.length > 0 ? ` Labeled markers: ${pointLabels.join(', ')}.` : '';

  return `${category} ${overlay.type} annotation for ${title} positioned across ${locationSummary}. ${visibleEvidence}${labelNote}`;
}
