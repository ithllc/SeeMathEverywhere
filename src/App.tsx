import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Atom,
  Compass,
  Loader2,
  Mic,
  RefreshCw,
  Square,
  Triangle,
  Upload,
  Volume2,
  WifiOff,
} from 'lucide-react';
import { TopBar, type AppScreen } from './components/TopBar';
import { LandingView } from './components/LandingView';
import { CameraView } from './components/CameraView';
import { SceneOverlayStage } from './components/SceneOverlayStage';
import { ConceptCard } from './components/ConceptCard';
import { SceneVoiceCompanion } from './components/SceneVoiceCompanion';
import { ShareCardModal } from './components/ShareCardModal';
import { DEMO_SCENE_IMAGE_URL, GUIDED_DEMO_RESPONSE } from './data/demoScene';
import { compressUploadedImage, type CapturedImagePayload } from './utils/imageProcessing';
import { buildSceneVoiceBriefing } from './utils/voiceFormatting';
import { useOnlineStatus } from './hooks/usePWA';
import { useVoicePlayer } from './hooks/useVoicePlayer';
import type {
  ConceptItem,
  ReadingLevel,
  SceneAnalysisResponse,
  SimplifyResponse,
} from './types/concepts';

export default function App() {
  const isOnline = useOnlineStatus();
  const {
    speakingId,
    synthesizingId,
    voiceError,
    primeAudio,
    speak,
    stop: stopSpeaking,
  } = useVoicePlayer();

  const [screen, setScreen] = useState<AppScreen>('landing');
  const [sceneSessionId, setSceneSessionId] = useState<number>(1);
  const [capturedImage, setCapturedImage] = useState<CapturedImagePayload | null>(null);
  const [sceneImageUrl, setSceneImageUrl] = useState<string>(DEMO_SCENE_IMAGE_URL);
  const [analysis, setAnalysis] = useState<SceneAnalysisResponse | null>(null);
  const [selectedConceptId, setSelectedConceptId] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  // Reading-level rewrites cached only in transient browser memory (never persisted indefinitely)
  const [simplifiedCache, setSimplifiedCache] = useState<Record<string, string>>({});
  const [simplifyingKey, setSimplifyingKey] = useState<string | null>(null);
  const [simplifyErrorByConcept, setSimplifyErrorByConcept] = useState<Record<string, string>>({});

  // Share card modal state
  const [shareTarget, setShareTarget] = useState<{
    concept: ConceptItem;
    explanation: string;
  } | null>(null);

  const stageContainerRef = useRef<HTMLDivElement | null>(null);
  const companionSectionRef = useRef<HTMLDivElement | null>(null);
  const resultsUploadInputRef = useRef<HTMLInputElement | null>(null);

  const startGuidedDemo = useCallback(() => {
    primeAudio();
    stopSpeaking();
    setSceneSessionId((n) => n + 1);
    setCapturedImage(null);
    setSceneImageUrl(DEMO_SCENE_IMAGE_URL);
    setAnalysis(GUIDED_DEMO_RESPONSE);
    setSelectedConceptId(GUIDED_DEMO_RESPONSE.concepts[0]?.id ?? null);
    setAnalysisError(null);
    setIsAnalyzing(false);
    setScreen('results');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [primeAudio, stopSpeaking]);

  // Support ?autostart=1 or ?demo=1 query shortcuts
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('demo') === '1' || params.get('autostart') === '1') {
      startGuidedDemo();
    }
  }, [startGuidedDemo]);

  const analyzingRef = useRef<boolean>(false);

  const runLiveAnalysis = useCallback(
    async (payload: CapturedImagePayload) => {
      if (analyzingRef.current) return;
      analyzingRef.current = true;

      stopSpeaking();
      setSceneSessionId((n) => n + 1);
      setCapturedImage(payload);
      setSceneImageUrl(payload.dataUrl);
      setAnalysis(null);
      setSelectedConceptId(null);
      setAnalysisError(null);
      setSimplifiedCache({});
      setSimplifyErrorByConcept({});
      setScreen('results');
      setIsAnalyzing(true);
      window.scrollTo({ top: 0, behavior: 'smooth' });

      if (!navigator.onLine) {
        analyzingRef.current = false;
        setIsAnalyzing(false);
        setAnalysisError(
          'You appear to be offline. Reconnect to analyze live photos with Gemini, or explore Guided Demo offline right now.'
        );
        return;
      }

      try {
        const res = await fetch('/api/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            imageBase64: payload.base64Data,
            mimeType: payload.mimeType,
          }),
        });

        const data = (await res.json().catch(() => null)) as
          | (SceneAnalysisResponse & { message?: string })
          | null;

        if (!res.ok || !data) {
          throw new Error(
            data?.message ||
              'We could not complete the analysis right now. Tap “Analyze Again” or try Guided Demo.'
          );
        }

        setAnalysis(data);
        setSelectedConceptId(data.concepts[0]?.id ?? null);
      } catch (err) {
        const msg =
          err instanceof Error && err.message
            ? err.message
            : 'Network connection interrupted during analysis. Tap “Analyze Again” or open Guided Demo.';
        setAnalysisError(msg);
      } finally {
        analyzingRef.current = false;
        setIsAnalyzing(false);
      }
    },
    [stopSpeaking]
  );

  const handleUploadFile = useCallback(
    async (file: File) => {
      try {
        setAnalysisError(null);
        const compressed = await compressUploadedImage(file);
        await runLiveAnalysis(compressed);
      } catch (err) {
        const msg =
          err instanceof Error && err.message
            ? err.message
            : 'Could not read that photo. Please try another JPEG, PNG, or WebP image.';
        setAnalysis(null);
        setAnalysisError(msg);
        setScreen('results');
      }
    },
    [runLiveAnalysis]
  );

  const handleAnalyzeAgain = useCallback(() => {
    if (capturedImage) {
      void runLiveAnalysis(capturedImage);
    }
  }, [capturedImage, runLiveAnalysis]);

  const handleSelectSeeIt = useCallback((conceptId: string) => {
    setSelectedConceptId(conceptId);
    if (window.innerWidth < 1024 && stageContainerRef.current) {
      const rect = stageContainerRef.current.getBoundingClientRect();
      if (rect.top < -120) {
        stageContainerRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  }, []);

  const handleRequestSimplify = useCallback(
    async (concept: ConceptItem, level: ReadingLevel) => {
      const cacheKey = `${concept.id}:${level}`;
      if (concept.levelExplanations?.[level] || simplifiedCache[cacheKey]) {
        return;
      }

      if (!navigator.onLine) {
        setSimplifyErrorByConcept((prev) => ({
          ...prev,
          [concept.id]: 'Reconnect to the internet to rewrite live explanations for other grade levels.',
        }));
        return;
      }

      setSimplifyingKey(cacheKey);
      setSimplifyErrorByConcept((prev) => {
        const next = { ...prev };
        delete next[concept.id];
        return next;
      });

      try {
        const res = await fetch('/api/simplify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: concept.title,
            category: concept.category,
            equation: concept.equation,
            plainExplanation: concept.plainExplanation,
            visibleEvidence: concept.visibleEvidence,
            whyItMatters: concept.whyItMatters,
            level,
          }),
        });

        const data = (await res.json().catch(() => null)) as
          | (SimplifyResponse & { message?: string })
          | null;

        if (!res.ok || !data?.explanation) {
          throw new Error(
            data?.message || 'Could not rewrite explanation right now. Showing standard explanation.'
          );
        }

        setSimplifiedCache((prev) => ({
          ...prev,
          [cacheKey]: data.explanation,
        }));
      } catch (err) {
        const msg =
          err instanceof Error && err.message
            ? err.message
            : 'Could not simplify right now. Showing standard explanation.';
        setSimplifyErrorByConcept((prev) => ({
          ...prev,
          [concept.id]: msg,
        }));
      } finally {
        setSimplifyingKey(null);
      }
    },
    [simplifiedCache]
  );

  const concepts = analysis?.concepts ?? [];
  const briefingId = `scene-briefing-${sceneSessionId}`;
  const isSpeakingBriefing = speakingId === briefingId;
  const isSynthesizingBriefing = synthesizingId === briefingId;
  const landingPreviewId = 'landing-voice-preview';

  const scrollToCompanion = useCallback(() => {
    primeAudio();
    companionSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    window.setTimeout(() => {
      document.getElementById('scene-companion-input')?.focus();
    }, 220);
  }, [primeAudio]);

  return (
    <div className="min-h-dvh flex flex-col bg-[#060B16] text-slate-100">
      <TopBar
        currentScreen={screen}
        onGoHome={() => {
          stopSpeaking();
          setScreen('landing');
        }}
        onStartCamera={() => {
          stopSpeaking();
          setScreen('camera');
        }}
        onStartDemo={startGuidedDemo}
      />

      {!isOnline && (
        <div
          role="status"
          aria-live="polite"
          className="border-b border-amber-500/30 bg-amber-950/50 px-4 py-2 text-xs text-amber-200"
        >
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
            <span className="flex items-center gap-2">
              <WifiOff className="h-3.5 w-3.5 shrink-0 text-amber-400" aria-hidden="true" />
              Offline mode — Landing page and Guided Demo remain fully available.
            </span>
            {screen !== 'results' && (
              <button
                type="button"
                onClick={startGuidedDemo}
                className="font-semibold text-amber-300 underline underline-offset-2 hover:text-white whitespace-nowrap shrink-0"
              >
                Open Guided Demo
              </button>
            )}
          </div>
        </div>
      )}

      <main className="flex-1">
        {screen === 'landing' && (
          <>
            {voiceError && (
              <div className="mx-auto max-w-6xl px-4 pt-4 sm:px-6">
                <p role="status" className="text-xs text-amber-300">
                  {voiceError}
                </p>
              </div>
            )}
            <LandingView
              onStartCamera={() => {
                primeAudio();
                stopSpeaking();
                setScreen('camera');
              }}
              onTryDemo={startGuidedDemo}
              onUploadFile={(file) => {
                primeAudio();
                void handleUploadFile(file);
              }}
              isSpeakingPreview={speakingId === landingPreviewId}
              isSynthesizingPreview={synthesizingId === landingPreviewId}
              onToggleVoicePreview={() =>
                void speak(
                  landingPreviewId,
                  buildSceneVoiceBriefing(GUIDED_DEMO_RESPONSE),
                  { languageCode: 'en-GB' }
                )
              }
            />
          </>
        )}

        {screen === 'camera' && (
          <CameraView
            onCapture={(payload) => void runLiveAnalysis(payload)}
            onUploadFile={(file) => void handleUploadFile(file)}
            onTryDemo={startGuidedDemo}
            onBack={() => setScreen('landing')}
          />
        )}

        {screen === 'results' && (
          <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:py-10">
            <input
              ref={resultsUploadInputRef}
              type="file"
              accept="image/*"
              tabIndex={-1}
              aria-hidden="true"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  void handleUploadFile(file);
                  e.target.value = '';
                }
              }}
              className="sr-only"
            />

            {/* Scene Summary Header */}
            <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-xs font-medium text-slate-400">
                  {analysis?.isDemo ? (
                    <>
                      <span className="text-amber-300 font-semibold">Guided Demo</span>
                      <span aria-hidden="true"> · </span>
                      <span>Sample Nighttime Waterfront Scene</span>
                    </>
                  ) : (
                    <>
                      <span>Scene Analysis</span>
                      <span aria-hidden="true"> · </span>
                      <span>Screen-Space Annotations</span>
                    </>
                  )}
                </p>
                <h1 className="mt-1 font-display text-2xl font-bold text-white sm:text-3xl">
                  {isAnalyzing
                    ? 'Analyzing your scene…'
                    : concepts.length > 0
                      ? `${concepts.length} Concepts Discovered`
                      : 'Scene Feedback'}
                </h1>
                {analysis?.sceneSummary && !isAnalyzing && (
                  <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-slate-300">
                    {analysis.sceneSummary}
                  </p>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-3 shrink-0">
                {analysis && !isAnalyzing && concepts.length > 0 && (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        void speak(briefingId, buildSceneVoiceBriefing(analysis), {
                          languageCode: 'en-GB',
                        })
                      }
                      aria-label={
                        isSpeakingBriefing || isSynthesizingBriefing
                          ? 'Stop spoken scene briefing'
                          : 'Play spoken scene briefing'
                      }
                      className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-cyan-400/50 bg-cyan-950/45 px-3.5 py-2 text-xs font-semibold text-cyan-200 transition-colors hover:border-cyan-300 hover:bg-cyan-900/55 hover:text-white focus-visible:outline-2 focus-visible:outline-cyan-400 whitespace-nowrap shrink-0"
                    >
                      {isSynthesizingBriefing ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" aria-hidden="true" />
                          Briefing…
                        </>
                      ) : isSpeakingBriefing ? (
                        <>
                          <Square className="h-3 w-3 fill-current shrink-0" aria-hidden="true" />
                          Stop Briefing
                        </>
                      ) : (
                        <>
                          <Volume2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                          Voice Briefing
                        </>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={scrollToCompanion}
                      className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-900/90 px-3.5 py-2 text-xs font-semibold text-slate-200 transition-colors hover:border-slate-500 hover:text-white focus-visible:outline-2 focus-visible:outline-cyan-400 whitespace-nowrap shrink-0"
                    >
                      <Mic className="h-3.5 w-3.5 text-cyan-300 shrink-0" aria-hidden="true" />
                      Ask Scene
                    </button>
                  </div>
                )}

                <div className="flex items-center gap-3.5 text-xs text-slate-300">
                  <span className="flex items-center gap-1.5">
                    <Triangle className="h-3.5 w-3.5 text-cyan-400" aria-hidden="true" />
                    Math
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Atom className="h-3.5 w-3.5 text-amber-400" aria-hidden="true" />
                    Physics
                  </span>
                </div>
              </div>
            </div>

            {voiceError && (
              <p role="status" className="mb-4 text-xs text-amber-300">
                {voiceError}
              </p>
            )}

            {/* Responsive 2-Zone Sandbox Layout: Annotated Image Stage + Concept Cards */}
            <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-12 lg:gap-8">
              <div
                ref={stageContainerRef}
                className="lg:col-span-7 lg:sticky lg:top-20"
              >
                <SceneOverlayStage
                  imageSrc={sceneImageUrl}
                  isDemo={Boolean(analysis?.isDemo)}
                  isAnalyzing={isAnalyzing}
                  concepts={concepts}
                  selectedConceptId={selectedConceptId}
                  onSelectConcept={(id) => setSelectedConceptId(id)}
                  onRetake={() => {
                    stopSpeaking();
                    setScreen('camera');
                  }}
                  onAnalyzeAgain={handleAnalyzeAgain}
                />
              </div>

              <div className="lg:col-span-5 space-y-4">
                {/* Error State */}
                {analysisError && !isAnalyzing && (
                  <div
                    role="alert"
                    className="rounded-2xl border border-amber-500/40 bg-slate-900/90 p-5"
                  >
                    <div className="flex items-start gap-3">
                      <AlertCircle
                        className="mt-0.5 h-5 w-5 shrink-0 text-amber-400"
                        aria-hidden="true"
                      />
                      <div>
                        <h2 className="font-display text-base font-semibold text-white">
                          Could not complete live analysis
                        </h2>
                        <p className="mt-1.5 text-sm leading-relaxed text-slate-300">
                          {analysisError}
                        </p>
                      </div>
                    </div>

                    <div className="mt-4 flex flex-wrap gap-2.5">
                      {capturedImage && (
                        <button
                          type="button"
                          onClick={handleAnalyzeAgain}
                          className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-cyan-400 px-4 py-2 text-xs font-semibold text-slate-950 transition-colors hover:bg-cyan-300 focus-visible:outline-2 focus-visible:outline-cyan-300 whitespace-nowrap shrink-0"
                        >
                          <RefreshCw className="h-4 w-4 shrink-0" aria-hidden="true" />
                          Analyze Again
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => resultsUploadInputRef.current?.click()}
                        className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-semibold text-white transition-colors hover:border-slate-500 focus-visible:outline-2 focus-visible:outline-cyan-400 whitespace-nowrap shrink-0"
                      >
                        <Upload className="h-4 w-4 shrink-0" aria-hidden="true" />
                        Upload Another Photo
                      </button>
                      <button
                        type="button"
                        onClick={startGuidedDemo}
                        className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-4 py-2 text-xs font-semibold text-amber-300 transition-colors hover:border-slate-500 focus-visible:outline-2 focus-visible:outline-cyan-400 whitespace-nowrap shrink-0"
                      >
                        <Compass className="h-4 w-4 shrink-0" aria-hidden="true" />
                        Try Guided Demo
                      </button>
                    </div>
                  </div>
                )}

                {/* Insufficient Visual Information State */}
                {analysis?.insufficientScene && !isAnalyzing && !analysisError && (
                  <div
                    role="status"
                    className="rounded-2xl border border-slate-800 bg-slate-900/90 p-5"
                  >
                    <h2 className="font-display text-lg font-semibold text-white">
                      Try pointing at clearer structure
                    </h2>
                    <p className="mt-2 text-sm leading-relaxed text-slate-300">
                      {analysis.guidanceMessage}
                    </p>
                    <div className="mt-4 flex flex-wrap gap-2.5">
                      <button
                        type="button"
                        onClick={() => {
                          stopSpeaking();
                          setScreen('camera');
                        }}
                        className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-cyan-400 px-4 py-2 text-xs font-semibold text-slate-950 transition-colors hover:bg-cyan-300 focus-visible:outline-2 focus-visible:outline-cyan-300 whitespace-nowrap shrink-0"
                      >
                        Retake Photo
                      </button>
                      <button
                        type="button"
                        onClick={startGuidedDemo}
                        className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-semibold text-white transition-colors hover:border-slate-500 focus-visible:outline-2 focus-visible:outline-cyan-400 whitespace-nowrap shrink-0"
                      >
                        Try Guided Demo
                      </button>
                    </div>
                  </div>
                )}

                {/* Skeleton Cards While Analyzing */}
                {isAnalyzing && (
                  <div className="space-y-3" aria-hidden="true">
                    {[0, 1, 2].map((idx) => (
                      <div
                        key={idx}
                        className="rounded-2xl border border-slate-800/80 bg-slate-900/40 p-5 animate-pulse"
                      >
                        <div className="h-3 w-32 rounded bg-slate-800" />
                        <div className="mt-3 h-5 w-56 rounded bg-slate-800" />
                        <div className="mt-3 h-4 w-full rounded bg-slate-800/70" />
                        <div className="mt-4 h-10 w-full rounded-xl bg-slate-800/60" />
                      </div>
                    ))}
                  </div>
                )}

                {/* Multilingual Voice & Text Field Companion — positioned above Concept Cards for instant access */}
                {!isAnalyzing && analysis && (
                  <div ref={companionSectionRef}>
                    <SceneVoiceCompanion
                      sceneKey={String(sceneSessionId)}
                      sceneSummary={analysis.sceneSummary}
                      concepts={concepts}
                      selectedConceptId={selectedConceptId}
                      capturedImage={capturedImage}
                      onSelectConcept={handleSelectSeeIt}
                      speakingId={speakingId}
                      synthesizingId={synthesizingId}
                      onPrimeAudio={primeAudio}
                      onSpeak={(id, text, opts) => void speak(id, text, opts)}
                      onStopSpeaking={stopSpeaking}
                    />
                  </div>
                )}

                {/* Discovered Concept Cards */}
                {!isAnalyzing &&
                  concepts.map((concept) => (
                    <ConceptCard
                      key={concept.id}
                      concept={concept}
                      isSelected={
                        selectedConceptId === concept.id ||
                        (!selectedConceptId && concepts[0]?.id === concept.id)
                      }
                      onSelectSeeIt={handleSelectSeeIt}
                      onOpenShare={(c, exp) =>
                        setShareTarget({ concept: c, explanation: exp })
                      }
                      simplifiedCache={simplifiedCache}
                      simplifyingKey={simplifyingKey}
                      simplifyError={simplifyErrorByConcept[concept.id] ?? null}
                      onRequestSimplify={(c, lvl) => void handleRequestSimplify(c, lvl)}
                      speakingId={speakingId}
                      synthesizingId={synthesizingId}
                      onSpeakConcept={(id, narration) =>
                        void speak(id, narration, {
                          languageCode: 'en-GB',
                          alreadyFormattedForSpeech: true,
                        })
                      }
                    />
                  ))}
              </div>
            </div>
          </div>
        )}
      </main>

      {screen !== 'camera' && (
        <footer className="border-t border-slate-900 px-4 py-6 text-xs text-slate-500 sm:px-6">
          <div className="mx-auto flex max-w-6xl flex-col justify-between gap-2 sm:flex-row sm:items-center">
            <p>SeeMathEverywhere — The world is the textbook.</p>
            <p>
              Images are processed transiently for educational scene analysis and are not stored.
            </p>
          </div>
        </footer>
      )}

      {shareTarget && (
        <ShareCardModal
          imageSrc={sceneImageUrl}
          concept={shareTarget.concept}
          explanationText={shareTarget.explanation}
          onClose={() => setShareTarget(null)}
        />
      )}
    </div>
  );
}
