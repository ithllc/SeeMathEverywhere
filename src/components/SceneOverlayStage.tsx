import React, { useEffect, useState } from 'react';
import { Camera, Eye, EyeOff, RefreshCw } from 'lucide-react';
import type { ConceptItem } from '../types/concepts';
import {
  computeAngleArcPath,
  computeArrowHead,
  computeBoundingBox,
  getCategoryPalette,
  toPixelPoints,
} from '../utils/overlayGeometry';
import { describeOverlayForScreenReader } from '../utils/validation';
import { DEMO_FALLBACK_SVG_DATA_URI } from '../data/demoScene';

const LOADING_MESSAGES = [
  'Looking for geometry…',
  'Finding forces and motion…',
  'Connecting equations to the scene…',
];

interface SceneOverlayStageProps {
  imageSrc: string;
  isDemo?: boolean;
  isAnalyzing: boolean;
  concepts: ConceptItem[];
  selectedConceptId: string | null;
  onSelectConcept: (id: string) => void;
  onRetake: () => void;
  onAnalyzeAgain: () => void;
}

export const SceneOverlayStage: React.FC<SceneOverlayStageProps> = ({
  imageSrc,
  isDemo = false,
  isAnalyzing,
  concepts,
  selectedConceptId,
  onSelectConcept,
  onRetake,
  onAnalyzeAgain,
}) => {
  const [displaySrc, setDisplaySrc] = useState<string>(imageSrc);
  const [imgDimensions, setImgDimensions] = useState<{ w: number; h: number }>({
    w: 1200,
    h: 900,
  });
  const [showOverlay, setShowOverlay] = useState<boolean>(true);
  const [loadingStep, setLoadingStep] = useState<number>(0);

  useEffect(() => {
    setDisplaySrc(imageSrc);
  }, [imageSrc]);

  useEffect(() => {
    if (!isAnalyzing) {
      setLoadingStep(0);
      return;
    }
    const interval = window.setInterval(() => {
      setLoadingStep((prev) => (prev + 1) % LOADING_MESSAGES.length);
    }, 1800);
    return () => window.clearInterval(interval);
  }, [isAnalyzing]);

  const activeConcept =
    concepts.find((c) => c.id === selectedConceptId) || concepts[0] || null;

  const { w, h } = imgDimensions;
  const strokeBase = Math.max(3.5, Math.round(w * 0.0042));
  const labelFontSize = Math.max(16, Math.round(w * 0.021));

  const renderConceptShape = (concept: ConceptItem, isActive: boolean) => {
    const palette = getCategoryPalette(concept.category);
    const pts = toPixelPoints(concept.overlay.points, w, h);
    if (pts.length === 0) return null;

    const strokeWidth = isActive ? strokeBase * 1.15 : strokeBase * 0.7;
    const opacity = isActive ? 1 : 0.35;

    const renderArrow = (fromIdx: number, toIdx: number, key: string) => {
      const from = pts[fromIdx];
      const to = pts[toIdx];
      const [h1, h2] = computeArrowHead(from, to, Math.max(14, w * 0.02));
      return (
        <g key={key}>
          <line
            x1={from.x}
            y1={from.y}
            x2={to.x}
            y2={to.y}
            stroke={palette.stroke}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
          />
          <polyline
            points={`${h1.x},${h1.y} ${to.x},${to.y} ${h2.x},${h2.y}`}
            fill="none"
            stroke={palette.stroke}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>
      );
    };

    return (
      <g
        key={concept.id}
        role="button"
        tabIndex={0}
        aria-label={`Select ${concept.category} overlay: ${concept.title}`}
        onClick={() => onSelectConcept(concept.id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelectConcept(concept.id);
          }
        }}
        opacity={opacity}
        className="cursor-pointer transition-opacity duration-150 focus:outline-none"
      >
        {concept.overlay.type === 'line' || concept.overlay.type === 'path' ? (
          <polyline
            points={pts.map((p) => `${p.x},${p.y}`).join(' ')}
            fill="none"
            stroke={palette.stroke}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : concept.overlay.type === 'ray' || concept.overlay.type === 'vector' ? (
          pts.slice(0, -1).map((_, idx) => renderArrow(idx, idx + 1, `arr-${idx}`))
        ) : concept.overlay.type === 'angle' && pts.length >= 3 ? (
          <g>
            {/* Surface normal bisector */}
            {(() => {
              const [p1, v, p2] = pts;
              const bisector = Math.atan2(
                p1.y - v.y + (p2.y - v.y),
                p1.x - v.x + (p2.x - v.x)
              );
              const nx = v.x + Math.cos(bisector) * (w * 0.13);
              const ny = v.y + Math.sin(bisector) * (w * 0.13);
              return (
                <line
                  x1={v.x}
                  y1={v.y}
                  x2={nx}
                  y2={ny}
                  stroke="#E2E8F0"
                  strokeWidth={Math.max(2, strokeBase * 0.65)}
                  strokeDasharray="8 7"
                  strokeLinecap="round"
                />
              );
            })()}
            {renderArrow(0, 1, 'inc')}
            {renderArrow(1, 2, 'ref')}
            <path
              d={computeAngleArcPath(pts[0], pts[1], pts[2], Math.max(28, w * 0.045))}
              fill="none"
              stroke={palette.stroke}
              strokeWidth={strokeWidth * 0.9}
              strokeLinecap="round"
            />
          </g>
        ) : concept.overlay.type === 'triangle' ? (
          <polygon
            points={pts.map((p) => `${p.x},${p.y}`).join(' ')}
            fill={isActive ? palette.fill : 'transparent'}
            stroke={palette.stroke}
            strokeWidth={strokeWidth}
            strokeLinejoin="round"
          />
        ) : concept.overlay.type === 'grid' ? (
          (() => {
            const bbox = computeBoundingBox(pts);
            const cols = 4;
            const rows = 4;
            return (
              <g>
                <rect
                  x={bbox.minX}
                  y={bbox.minY}
                  width={bbox.width}
                  height={bbox.height}
                  fill={isActive ? palette.fill : 'transparent'}
                  stroke={palette.stroke}
                  strokeWidth={strokeWidth}
                />
                {Array.from({ length: cols - 1 }, (_, i) => {
                  const gx = bbox.minX + (bbox.width * (i + 1)) / cols;
                  return (
                    <line
                      key={`col-${i}`}
                      x1={gx}
                      y1={bbox.minY}
                      x2={gx}
                      y2={bbox.minY + bbox.height}
                      stroke={palette.stroke}
                      strokeOpacity={0.72}
                      strokeWidth={Math.max(1.5, strokeWidth * 0.45)}
                    />
                  );
                })}
                {Array.from({ length: rows - 1 }, (_, i) => {
                  const gy = bbox.minY + (bbox.height * (i + 1)) / rows;
                  return (
                    <line
                      key={`row-${i}`}
                      x1={bbox.minX}
                      y1={gy}
                      x2={bbox.minX + bbox.width}
                      y2={gy}
                      stroke={palette.stroke}
                      strokeOpacity={0.72}
                      strokeWidth={Math.max(1.5, strokeWidth * 0.45)}
                    />
                  );
                })}
              </g>
            );
          })()
        ) : pts.length === 2 ? (
          (() => {
            const bbox = computeBoundingBox(pts);
            return (
              <rect
                x={bbox.minX}
                y={bbox.minY}
                width={bbox.width}
                height={bbox.height}
                rx={8}
                fill={isActive ? palette.fill : 'transparent'}
                stroke={palette.stroke}
                strokeWidth={strokeWidth}
              />
            );
          })()
        ) : (
          <polygon
            points={pts.map((p) => `${p.x},${p.y}`).join(' ')}
            fill={isActive ? palette.fill : 'transparent'}
            stroke={palette.stroke}
            strokeWidth={strokeWidth}
            strokeLinejoin="round"
          />
        )}

        {/* Anchor vertices and active labels */}
        {pts.map((pt, idx) => {
          const badgeWidth = pt.label
            ? Math.max(76, pt.label.length * (labelFontSize * 0.58) + 22)
            : 0;
          const badgeHeight = labelFontSize + 14;
          const clampedX = Math.min(w - badgeWidth - 10, Math.max(10, pt.x - badgeWidth / 2));
          const clampedY = pt.y - badgeHeight - 14 > 10 ? pt.y - badgeHeight - 14 : pt.y + 14;

          return (
            <g key={`pt-${idx}`}>
              <circle
                cx={pt.x}
                cy={pt.y}
                r={Math.max(6, w * 0.0075)}
                fill="#060B16"
                stroke={palette.stroke}
                strokeWidth={Math.max(2.5, strokeWidth * 0.7)}
              />
              {isActive && pt.label && (
                <g>
                  <rect
                    x={clampedX}
                    y={clampedY}
                    width={badgeWidth}
                    height={badgeHeight}
                    rx={8}
                    fill="rgba(6, 11, 22, 0.9)"
                    stroke={palette.stroke}
                    strokeWidth={1.5}
                  />
                  <text
                    x={clampedX + badgeWidth / 2}
                    y={clampedY + badgeHeight / 2 + labelFontSize * 0.34}
                    textAnchor="middle"
                    fill={palette.badgeText}
                    fontSize={labelFontSize}
                    fontWeight="600"
                    fontFamily="Plus Jakarta Sans, sans-serif"
                  >
                    {pt.label}
                  </text>
                </g>
              )}
            </g>
          );
        })}
      </g>
    );
  };

  return (
    <div className="space-y-3">
      {/* Stage Annotation & Calibration Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-300">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-slate-300">
            {activeConcept && !isAnalyzing
              ? `Active overlay: ${activeConcept.title}`
              : 'Frozen scene frame'}
          </span>
          {activeConcept?.measurementType === 'estimated' && !isAnalyzing && (
            <>
              <span aria-hidden="true" className="text-slate-600">
                ·
              </span>
              <span className="text-amber-200/90">Visual estimate (uncalibrated)</span>
            </>
          )}
        </div>

        {!isAnalyzing && concepts.length > 0 && (
          <button
            type="button"
            onClick={() => setShowOverlay((prev) => !prev)}
            aria-pressed={showOverlay}
            aria-label={showOverlay ? 'Hide visual overlay annotations' : 'Show visual overlay annotations'}
            className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900/80 px-3 py-1.5 text-xs font-medium text-slate-200 transition-colors hover:border-slate-600 hover:text-white focus-visible:outline-2 focus-visible:outline-cyan-400 whitespace-nowrap shrink-0"
          >
            {showOverlay ? (
              <>
                <EyeOff className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                Hide Overlay
              </>
            ) : (
              <>
                <Eye className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                Show Overlay
              </>
            )}
          </button>
        )}
      </div>

      {/* Annotated Frozen Frame Container */}
      <div
        data-testid="annotated-scene-stage"
        className="relative overflow-hidden rounded-2xl border border-slate-800 bg-[#050914] shadow-2xl"
      >
        <div className="relative w-full">
          <img
            src={displaySrc}
            alt={
              activeConcept
                ? `Captured scene highlighting ${activeConcept.title}`
                : 'Captured real-world scene being analyzed for math and physics'
            }
            referrerPolicy="no-referrer"
            onLoad={(e) => {
              const target = e.currentTarget;
              if (target.naturalWidth > 0 && target.naturalHeight > 0) {
                setImgDimensions({
                  w: target.naturalWidth,
                  h: target.naturalHeight,
                });
              }
            }}
            onError={() => {
              if (displaySrc !== DEMO_FALLBACK_SVG_DATA_URI) {
                setDisplaySrc(DEMO_FALLBACK_SVG_DATA_URI);
              }
            }}
            className="block h-auto w-full select-none"
          />

          {/* Screen-space SVG Overlay Layer */}
          {!isAnalyzing && showOverlay && concepts.length > 0 && (
            <svg
              viewBox={`0 0 ${w} ${h}`}
              aria-label={
                activeConcept
                  ? `Visual annotation for ${activeConcept.title}`
                  : 'Scene concept overlays'
              }
              className="absolute inset-0 h-full w-full"
            >
              {/* Render inactive overlays first, then active overlay on top */}
              {concepts
                .filter((c) => c.id !== activeConcept?.id)
                .map((c) => renderConceptShape(c, false))}
              {activeConcept && renderConceptShape(activeConcept, true)}
            </svg>
          )}

          {/* Processing / Educational Analysis Indicator */}
          {isAnalyzing && (
            <div
              role="status"
              aria-live="polite"
              className="absolute inset-0 flex flex-col items-center justify-center bg-[#060B16]/72 p-6 text-center backdrop-blur-[2px]"
            >
              <div className="h-10 w-10 animate-spin rounded-full border-2 border-slate-700 border-t-cyan-400" />
              <p className="mt-4 font-display text-lg font-semibold text-white">
                {LOADING_MESSAGES[loadingStep]}
              </p>
              <p className="mt-1.5 max-w-xs text-xs leading-relaxed text-slate-300">
                Inspecting geometry, reflections, perspective, and physical motion in this frame.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Screen-reader accessible text description of active visual overlay */}
      {activeConcept && !isAnalyzing && (
        <p className="sr-only" aria-live="polite">
          {describeOverlayForScreenReader(activeConcept)}
        </p>
      )}

      {/* Retake & Analyze Again Action Row */}
      <div className="flex flex-wrap items-center gap-2.5 pt-1">
        <button
          type="button"
          onClick={onRetake}
          disabled={isAnalyzing}
          className="inline-flex min-h-[46px] flex-1 items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-900/90 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:border-slate-500 hover:bg-slate-800 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-cyan-400 whitespace-nowrap shrink-0"
        >
          <Camera className="h-4 w-4 shrink-0 text-cyan-300" aria-hidden="true" />
          {isDemo ? 'Use Live Camera' : 'Retake'}
        </button>

        {!isDemo && (
          <button
            type="button"
            onClick={onAnalyzeAgain}
            disabled={isAnalyzing}
            className="inline-flex min-h-[46px] flex-1 items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-900/90 px-4 py-2.5 text-sm font-semibold text-slate-200 transition-colors hover:border-slate-500 hover:bg-slate-800 hover:text-white disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-cyan-400 whitespace-nowrap shrink-0"
          >
            <RefreshCw className="h-4 w-4 shrink-0" aria-hidden="true" />
            Analyze Again
          </button>
        )}
      </div>
    </div>
  );
};
