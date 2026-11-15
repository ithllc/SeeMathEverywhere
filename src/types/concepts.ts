export type ConceptCategory = 'Math' | 'Physics';

export type MeasurementType = 'qualitative' | 'estimated';

export type OverlayType =
  | 'line'
  | 'ray'
  | 'angle'
  | 'triangle'
  | 'grid'
  | 'vector'
  | 'path'
  | 'region';

export type ReadingLevel = 'elementary' | 'middle' | 'high' | 'college';

export interface OverlayPoint {
  x: number;
  y: number;
  label?: string;
}

export interface ConceptOverlay {
  type: OverlayType;
  points: OverlayPoint[];
}

export interface ConceptItem {
  id: string;
  category: ConceptCategory;
  title: string;
  equation: string;
  plainExplanation: string;
  visibleEvidence: string;
  whyItMatters: string;
  confidence: number;
  measurementType: MeasurementType;
  overlay: ConceptOverlay;
  levelExplanations?: Partial<Record<ReadingLevel, string>>;
}

export interface SceneAnalysisResponse {
  sceneSummary: string;
  concepts: ConceptItem[];
  insufficientScene?: boolean;
  guidanceMessage?: string;
  isDemo?: boolean;
}

export interface SimplifyRequest {
  title: string;
  category: ConceptCategory;
  equation: string;
  plainExplanation: string;
  visibleEvidence: string;
  whyItMatters: string;
  level: ReadingLevel;
}

export interface SimplifyResponse {
  level: ReadingLevel;
  explanation: string;
}

export type ActiveCardTab = 'see' | 'explain' | 'care';

export interface SceneChatTurn {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  spokenText?: string;
  languageCode?: string;
  languageName?: string;
  relatedConceptId?: string;
  viaVoice?: boolean;
}

export interface AskSceneResponse {
  transcript: string;
  reply: string;
  spokenReply: string;
  languageCode: string;
  languageName: string;
  relatedConceptId?: string;
  audioBase64?: string;
  audioMimeType?: string;
}

export interface TtsResponse {
  audioBase64: string;
  mimeType: string;
}

