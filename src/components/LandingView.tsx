import React, { useRef, useState } from 'react';
import { Camera, Compass, Loader2, Square, Upload, ShieldCheck, Volume2 } from 'lucide-react';
import { DEMO_FALLBACK_SVG_DATA_URI, DEMO_SCENE_IMAGE_URL } from '../data/demoScene';

interface LandingViewProps {
  onStartCamera: () => void;
  onTryDemo: () => void;
  onUploadFile: (file: File) => void;
  isSpeakingPreview?: boolean;
  isSynthesizingPreview?: boolean;
  onToggleVoicePreview?: () => void;
}

export const LandingView: React.FC<LandingViewProps> = ({
  onStartCamera,
  onTryDemo,
  onUploadFile,
  isSpeakingPreview = false,
  isSynthesizingPreview = false,
  onToggleVoicePreview,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [previewSrc, setPreviewSrc] = useState<string>(DEMO_SCENE_IMAGE_URL);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onUploadFile(file);
      e.target.value = '';
    }
  };

  return (
    <div id="top" className="mx-auto max-w-6xl px-4 pt-6 pb-16 sm:px-6 sm:pt-12 lg:pt-16">
      {/* Hero Split: Mobile-first thumb ergonomics expanding to balanced 12-col desktop layout */}
      <section className="grid grid-cols-1 items-center gap-8 lg:grid-cols-12 lg:gap-12">
        <div className="lg:col-span-6">
          <p className="text-xs font-medium tracking-wide text-slate-400">
            Real-World Discovery <span aria-hidden="true">·</span> Mathematics &amp; Physics
          </p>

          <h1 className="mt-3 font-display text-3xl font-bold tracking-tight text-white sm:text-5xl [text-wrap:balance]">
            SeeMathEverywhere
          </h1>

          <p className="mt-2 font-display text-xl font-medium text-cyan-300 sm:text-2xl">
            The world is the textbook.
          </p>

          <p className="mt-4 max-w-xl text-base leading-relaxed text-slate-300 sm:text-lg">
            Point your camera at the world. Discover the mathematics and physics happening in front
            of you.
          </p>

          {/* Primary & Secondary CTAs with >=48px touch hitboxes */}
          <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:items-center">
            <button
              type="button"
              onClick={onStartCamera}
              className="inline-flex min-h-[52px] items-center justify-center gap-2.5 rounded-xl bg-cyan-400 px-6 py-3.5 text-base font-semibold text-slate-950 shadow-lg shadow-cyan-950/40 transition-transform duration-150 hover:bg-cyan-300 active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300 whitespace-nowrap shrink-0"
            >
              <Camera className="h-5 w-5 shrink-0" aria-hidden="true" />
              Start Camera
            </button>

            <button
              type="button"
              onClick={onTryDemo}
              className="inline-flex min-h-[52px] items-center justify-center gap-2.5 rounded-xl border border-slate-700 bg-slate-900/80 px-6 py-3.5 text-base font-semibold text-white transition-colors duration-150 hover:border-slate-500 hover:bg-slate-800/90 active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400 whitespace-nowrap shrink-0"
            >
              <Compass className="h-5 w-5 text-amber-400 shrink-0" aria-hidden="true" />
              Try a Demo
            </button>
          </div>

          <div className="mt-4 flex items-center">
            <input
              ref={fileInputRef}
              id="landing-photo-upload"
              type="file"
              accept="image/*"
              tabIndex={-1}
              aria-hidden="true"
              onChange={handleFileChange}
              className="sr-only"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex min-h-[44px] items-center gap-2 text-sm font-medium text-slate-300 underline-offset-4 hover:text-cyan-300 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400"
            >
              <Upload className="h-4 w-4 shrink-0" aria-hidden="true" />
              Or analyze an existing photo from your library
            </button>
          </div>

          <div
            id="privacy-note"
            className="mt-6 flex items-start gap-2.5 text-xs leading-relaxed text-slate-400"
          >
            <ShieldCheck
              className="mt-0.5 h-4 w-4 shrink-0 text-slate-400"
              aria-hidden="true"
            />
            <p>
              Images are analyzed to identify educational concepts and are not intentionally stored.
            </p>
          </div>
        </div>

        {/* Visual Preview Stage: Nighttime Waterfront Skyline with Live Sample Schematic */}
        <div className="lg:col-span-6">
          <div className="relative overflow-hidden rounded-2xl border border-slate-800 bg-slate-950 shadow-2xl">
            <div className="relative aspect-[4/3] w-full overflow-hidden bg-[#070E1E]">
              <img
                src={previewSrc}
                alt="Manhattan skyline at night reflected across the Hudson River with geometric and physical annotations"
                referrerPolicy="no-referrer"
                onError={() => {
                  if (previewSrc !== DEMO_FALLBACK_SVG_DATA_URI) {
                    setPreviewSrc(DEMO_FALLBACK_SVG_DATA_URI);
                  }
                }}
                className="h-full w-full object-cover"
              />

              {/* Measured bottom contrast scrim */}
              <div
                className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#060B16]/95 via-[#060B16]/45 to-transparent"
                aria-hidden="true"
              />

              {/* Subtle sample geometric & reflection overlay preview */}
              <svg
                viewBox="0 0 1000 750"
                className="pointer-events-none absolute inset-0 h-full w-full"
                aria-hidden="true"
              >
                {/* Math similar triangle along waterfront pier */}
                <polygon
                  points="40,505 265,410 40,410"
                  fill="rgba(34, 211, 238, 0.14)"
                  stroke="#22D3EE"
                  strokeWidth="3.5"
                  strokeLinejoin="round"
                />
                {/* Physics reflection angle rays kept above bottom caption */}
                <line
                  x1="725"
                  y1="202"
                  x2="715"
                  y2="485"
                  stroke="#F59E0B"
                  strokeWidth="3.5"
                  strokeLinecap="round"
                />
                <line
                  x1="715"
                  y1="485"
                  x2="475"
                  y2="520"
                  stroke="#F59E0B"
                  strokeWidth="3.5"
                  strokeLinecap="round"
                />
                <line
                  x1="715"
                  y1="395"
                  x2="715"
                  y2="485"
                  stroke="#E2E8F0"
                  strokeWidth="2"
                  strokeDasharray="7 6"
                />
                <circle cx="715" cy="485" r="6" fill="#060B16" stroke="#F59E0B" strokeWidth="3" />
                <circle cx="265" cy="410" r="6" fill="#060B16" stroke="#22D3EE" strokeWidth="3" />
              </svg>

              {/* Bottom caption bar */}
              <div className="absolute inset-x-0 bottom-0 flex flex-wrap items-end justify-between gap-3 p-4 sm:p-5">
                <div>
                  <p className="text-xs font-medium text-slate-300">
                    Waterfront Night Preview <span aria-hidden="true">·</span> Screen-Space
                    Annotations
                  </p>
                  <p className="mt-1 font-equation text-sm font-medium text-white">
                    <span className="text-cyan-300">h₁/d₁ = h₂/d₂</span>
                    <span className="mx-2.5 text-slate-500" aria-hidden="true">
                      ·
                    </span>
                    <span className="text-amber-300">θᵢ = θᵣ</span>
                    <span className="mx-2.5 text-slate-500" aria-hidden="true">
                      ·
                    </span>
                    <span className="text-amber-300">v = Δx/Δt</span>
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {onToggleVoicePreview && (
                    <button
                      type="button"
                      onClick={onToggleVoicePreview}
                      aria-label={
                        isSpeakingPreview || isSynthesizingPreview
                          ? 'Stop voice preview'
                          : 'Hear spoken advisor preview'
                      }
                      className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-cyan-400/55 bg-cyan-950/75 px-3.5 py-2 text-xs font-semibold text-cyan-200 transition-colors hover:border-cyan-300 hover:text-white focus-visible:outline-2 focus-visible:outline-cyan-400 whitespace-nowrap shrink-0"
                    >
                      {isSynthesizingPreview ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" aria-hidden="true" />
                          Voice…
                        </>
                      ) : isSpeakingPreview ? (
                        <>
                          <Square className="h-3 w-3 fill-current shrink-0" aria-hidden="true" />
                          Stop Voice
                        </>
                      ) : (
                        <>
                          <Volume2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                          Hear Voice
                        </>
                      )}
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={onTryDemo}
                    className="inline-flex min-h-[40px] items-center rounded-lg bg-slate-900/90 border border-slate-700 px-3.5 py-2 text-xs font-semibold text-cyan-200 hover:border-cyan-400/60 hover:text-white transition-colors focus-visible:outline-2 focus-visible:outline-cyan-400 whitespace-nowrap shrink-0"
                  >
                    Explore &amp; Speak
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Concise 3-step How It Works section */}
      <section id="how-it-works" className="mt-16 border-t border-slate-800/80 pt-12">
        <div className="max-w-2xl">
          <h2 className="font-display text-xl font-semibold text-white sm:text-2xl">
            From everyday scene to living equation in seconds
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-slate-400 sm:text-base">
            Built for curious walks, waterfront skylines, architecture, and everyday motion—not
            worksheets.
          </p>
        </div>

        <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-3">
          <div className="rounded-2xl border border-slate-800/90 bg-slate-900/50 p-5">
            <p className="font-equation text-xs font-medium text-cyan-300">01. Capture</p>
            <h3 className="mt-2 font-display text-base font-semibold text-white">
              Point at any real-world scene
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-300">
              Frame buildings, reflections on water, moving boats, bridges, shadows, or household
              objects and tap “Find the Math.”
            </p>
          </div>

          <div className="rounded-2xl border border-slate-800/90 bg-slate-900/50 p-5">
            <p className="font-equation text-xs font-medium text-amber-300">02. Visualize</p>
            <h3 className="mt-2 font-display text-base font-semibold text-white">
              See screen-space overlays
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-300">
              Cyan highlights mathematical geometry and proportions; warm amber highlights physical
              forces, waves, optics, and motion.
            </p>
          </div>

          <div className="rounded-2xl border border-slate-800/90 bg-slate-900/50 p-5">
            <p className="font-equation text-xs font-medium text-cyan-300">03. Converse &amp; Share</p>
            <h3 className="mt-2 font-display text-base font-semibold text-white">
              Talk in any language &amp; share
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-300">
              Listen to a spoken field briefing, ask follow-up questions by voice in any language,
              adjust reading depth, and export an annotated share card.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
};
