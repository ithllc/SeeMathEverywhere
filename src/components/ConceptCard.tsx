import React, { useState } from 'react';
import { Atom, Loader2, Share2, Square, Triangle, Volume2 } from 'lucide-react';
import type { ActiveCardTab, ConceptItem, ReadingLevel } from '../types/concepts';
import { buildConceptVoiceNarration } from '../utils/voiceFormatting';

const READING_LEVELS: { value: ReadingLevel; label: string }[] = [
  { value: 'elementary', label: 'Elementary' },
  { value: 'middle', label: 'Middle' },
  { value: 'high', label: 'High School' },
  { value: 'college', label: 'College' },
];

interface ConceptCardProps {
  concept: ConceptItem;
  isSelected: boolean;
  onSelectSeeIt: (conceptId: string) => void;
  onOpenShare: (concept: ConceptItem, currentExplanation: string) => void;
  simplifiedCache: Record<string, string>;
  simplifyingKey: string | null;
  simplifyError: string | null;
  onRequestSimplify: (concept: ConceptItem, level: ReadingLevel) => void;
  speakingId: string | null;
  synthesizingId: string | null;
  onSpeakConcept: (narrationId: string, spokenText: string) => void;
}

export const ConceptCard: React.FC<ConceptCardProps> = ({
  concept,
  isSelected,
  onSelectSeeIt,
  onOpenShare,
  simplifiedCache,
  simplifyingKey,
  simplifyError,
  onRequestSimplify,
  speakingId,
  synthesizingId,
  onSpeakConcept,
}) => {
  const [activeTab, setActiveTab] = useState<ActiveCardTab>('see');
  const [readingLevel, setReadingLevel] = useState<ReadingLevel>('high');

  const isMath = concept.category === 'Math';
  const confidencePct = Math.round(concept.confidence * 100);

  // Extract first crisp sentence for card summary line
  const oneSentenceSummary =
    concept.plainExplanation.split(/(?<=[.!?])\s+/)[0] || concept.plainExplanation;

  const cacheKey = `${concept.id}:${readingLevel}`;
  const preconfiguredExplanation = concept.levelExplanations?.[readingLevel];
  const currentExplanation =
    preconfiguredExplanation ||
    simplifiedCache[cacheKey] ||
    (readingLevel === 'high' ? concept.plainExplanation : concept.plainExplanation);

  const isLoadingSimplify = simplifyingKey === cacheKey;
  const narrationId = `concept-${concept.id}-${activeTab}-${readingLevel}`;
  const isSpeakingThisCard = speakingId === narrationId;
  const isSynthesizingThisCard = synthesizingId === narrationId;

  const handleLevelClick = (level: ReadingLevel) => {
    setReadingLevel(level);
    onSelectSeeIt(concept.id);
    if (level !== 'high' && !concept.levelExplanations?.[level] && !simplifiedCache[`${concept.id}:${level}`]) {
      onRequestSimplify(concept, level);
    }
  };

  return (
    <article
      aria-label={`${concept.category} concept: ${concept.title}`}
      className={`rounded-2xl border p-4 transition-colors duration-150 sm:p-5 ${
        isSelected
          ? isMath
            ? 'border-cyan-400/70 bg-slate-900/90 shadow-lg shadow-cyan-950/25'
            : 'border-amber-400/70 bg-slate-900/90 shadow-lg shadow-amber-950/25'
          : 'border-slate-800/90 bg-slate-900/55 hover:border-slate-700'
      }`}
    >
      {/* Clean unboxed metadata row — icon + text + tabular confidence */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
        <div className="flex flex-wrap items-center gap-1.5">
          {isMath ? (
            <Triangle className="h-3.5 w-3.5 shrink-0 text-cyan-400" aria-hidden="true" />
          ) : (
            <Atom className="h-3.5 w-3.5 shrink-0 text-amber-400" aria-hidden="true" />
          )}
          <span className={`font-semibold ${isMath ? 'text-cyan-300' : 'text-amber-300'}`}>
            {concept.category}
          </span>
          <span aria-hidden="true">·</span>
          <span className="tabular-nums text-slate-300">{confidencePct}% match</span>
          <span aria-hidden="true">·</span>
          <span>
            {concept.measurementType === 'estimated' ? 'Visual estimate' : 'Qualitative'}
          </span>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => {
              onSelectSeeIt(concept.id);
              const narration = buildConceptVoiceNarration(
                concept,
                activeTab,
                currentExplanation
              );
              onSpeakConcept(narrationId, narration);
            }}
            aria-label={
              isSpeakingThisCard || isSynthesizingThisCard
                ? `Stop audio for ${concept.title}`
                : `Listen to ${concept.title}`
            }
            className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-cyan-300 transition-colors hover:bg-slate-800 hover:text-white focus-visible:outline-2 focus-visible:outline-cyan-400 whitespace-nowrap shrink-0"
          >
            {isSynthesizingThisCard ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" aria-hidden="true" />
                Voice…
              </>
            ) : isSpeakingThisCard ? (
              <>
                <Square className="h-3 w-3 fill-current shrink-0" aria-hidden="true" />
                Stop
              </>
            ) : (
              <>
                <Volume2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                Listen
              </>
            )}
          </button>

          <button
            type="button"
            onClick={() => onOpenShare(concept, currentExplanation)}
            aria-label={`Create shareable card for ${concept.title}`}
            className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-300 transition-colors hover:bg-slate-800 hover:text-white focus-visible:outline-2 focus-visible:outline-cyan-400 whitespace-nowrap shrink-0"
          >
            <Share2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            Share Card
          </button>
        </div>
      </div>

      {/* Title & Equation */}
      <div className="mt-2.5 space-y-1">
        <h3 className="font-display text-lg font-semibold leading-snug text-white">
          {concept.title}
        </h3>
        <p
          className={`font-equation text-sm font-medium sm:text-base break-words ${
            isMath ? 'text-cyan-300' : 'text-amber-300'
          }`}
        >
          {concept.equation}
        </p>
      </div>

      {/* One-sentence concise explanation */}
      <p className="mt-2 text-sm leading-relaxed text-slate-300">{oneSentenceSummary}</p>

      {/* Interactive Action Controls: See It | Explain It | Why Do I Care? */}
      <div
        role="group"
        aria-label={`Explore ${concept.title}`}
        className="mt-4 flex flex-wrap gap-1.5 rounded-xl bg-[#060B16]/80 p-1 border border-slate-800/90"
      >
        <button
          type="button"
          aria-pressed={isSelected && activeTab === 'see'}
          onClick={() => {
            setActiveTab('see');
            onSelectSeeIt(concept.id);
          }}
          className={`min-h-[42px] flex-1 rounded-lg px-2.5 py-2 text-xs font-semibold whitespace-nowrap focus-visible:outline-2 focus-visible:outline-cyan-400 ${
            activeTab === 'see' && isSelected
              ? isMath
                ? 'bg-cyan-400 text-slate-950'
                : 'bg-amber-400 text-slate-950'
              : activeTab === 'see'
                ? 'bg-slate-800 text-white'
                : 'text-slate-300 hover:text-white'
          }`}
        >
          See It
        </button>

        <button
          type="button"
          aria-pressed={activeTab === 'explain'}
          onClick={() => {
            setActiveTab('explain');
            onSelectSeeIt(concept.id);
          }}
          className={`min-h-[42px] flex-1 rounded-lg px-2.5 py-2 text-xs font-semibold whitespace-nowrap focus-visible:outline-2 focus-visible:outline-cyan-400 ${
            activeTab === 'explain'
              ? isMath
                ? 'bg-cyan-400 text-slate-950'
                : 'bg-amber-400 text-slate-950'
              : 'text-slate-300 hover:text-white'
          }`}
        >
          Explain It
        </button>

        <button
          type="button"
          aria-pressed={activeTab === 'care'}
          onClick={() => {
            setActiveTab('care');
            onSelectSeeIt(concept.id);
          }}
          className={`min-h-[42px] flex-1 rounded-lg px-2.5 py-2 text-xs font-semibold whitespace-nowrap focus-visible:outline-2 focus-visible:outline-cyan-400 ${
            activeTab === 'care'
              ? isMath
                ? 'bg-cyan-400 text-slate-950'
                : 'bg-amber-400 text-slate-950'
              : 'text-slate-300 hover:text-white'
          }`}
        >
          Why Do I Care?
        </button>
      </div>

      {/* Contextual Detail Area */}
      <div className="mt-3.5 pt-3 border-t border-slate-800/80 text-sm leading-relaxed text-slate-200">
        {activeTab === 'see' && (
          <div>
            <p className="text-xs font-medium text-slate-400">Visible in this scene</p>
            <p className="mt-1 text-slate-200">{concept.visibleEvidence}</p>
          </div>
        )}

        {activeTab === 'explain' && (
          <div className="space-y-3">
            <div>
              <p className="text-xs font-medium text-slate-400">How the equation connects</p>
              {isLoadingSimplify ? (
                <p className="mt-1.5 text-sm text-slate-400" role="status" aria-live="polite">
                  Adapting explanation for {READING_LEVELS.find((r) => r.value === readingLevel)?.label}…
                </p>
              ) : (
                <p className="mt-1 text-slate-100">{currentExplanation}</p>
              )}
              {simplifyError && !isLoadingSimplify && (
                <p className="mt-1.5 text-xs text-amber-300">{simplifyError}</p>
              )}
            </div>

            {/* Simplify Reading-Level Selector */}
            <div>
              <p className="text-xs font-medium text-slate-400">Simplify for level</p>
              <div
                role="group"
                aria-label="Reading level"
                className="mt-1.5 grid grid-cols-2 gap-1.5 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4"
              >
                {READING_LEVELS.map((lvl) => {
                  const active = readingLevel === lvl.value;
                  return (
                    <button
                      key={lvl.value}
                      type="button"
                      aria-pressed={active}
                      onClick={() => handleLevelClick(lvl.value)}
                      className={`min-h-[40px] rounded-lg border px-2.5 py-1.5 text-xs font-medium whitespace-nowrap focus-visible:outline-2 focus-visible:outline-cyan-400 ${
                        active
                          ? isMath
                            ? 'border-cyan-400/70 bg-cyan-950/60 text-cyan-200'
                            : 'border-amber-400/70 bg-amber-950/60 text-amber-200'
                          : 'border-slate-800 bg-[#060B16]/60 text-slate-300 hover:border-slate-600 hover:text-white'
                      }`}
                    >
                      {lvl.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'care' && (
          <div>
            <p className="text-xs font-medium text-slate-400">Real-world applications</p>
            <p className="mt-1 text-slate-200">{concept.whyItMatters}</p>
          </div>
        )}
      </div>
    </article>
  );
};
