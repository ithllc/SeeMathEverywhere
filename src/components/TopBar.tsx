import React, { useState } from 'react';
import { Download, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWA';

export type AppScreen = 'landing' | 'camera' | 'results';

interface TopBarProps {
  currentScreen: AppScreen;
  onGoHome: () => void;
  onStartCamera: () => void;
  onStartDemo: () => void;
}

export const TopBar: React.FC<TopBarProps> = ({
  currentScreen,
  onGoHome,
  onStartCamera,
  onStartDemo,
}) => {
  const { isInstallable, isInstalled, isIOS, promptInstall } = usePWAInstall();
  const [showIOSModal, setShowIOSModal] = useState(false);

  return (
    <>
      <header className="sticky top-0 z-30 h-14 border-b border-slate-800/80 bg-[#060B16]/90 backdrop-blur-md">
        <div className="mx-auto flex h-full max-w-6xl items-center justify-between gap-4 px-4 sm:gap-8 sm:px-6">
          {/* Zone 1: Single wordmark */}
          <button
            type="button"
            onClick={onGoHome}
            className="font-display text-base font-semibold tracking-tight text-white transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-cyan-400 whitespace-nowrap shrink-0 sm:text-lg min-h-[44px] flex items-center"
          >
            SeeMathEverywhere
          </button>

          {/* Zone 2: Clean single-line navigation links */}
          <nav
            aria-label="Primary navigation"
            className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-300"
          >
            <button
              type="button"
              onClick={onStartCamera}
              className="hover:text-white hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0 min-h-[44px] flex items-center focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400"
            >
              Camera
            </button>
            <button
              type="button"
              onClick={onStartDemo}
              className="hover:text-white hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0 min-h-[44px] flex items-center focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400"
            >
              Guided Demo
            </button>
            <a
              href="#how-it-works"
              onClick={(e) => {
                if (currentScreen !== 'landing') {
                  e.preventDefault();
                  onGoHome();
                  setTimeout(() => {
                    document.getElementById('how-it-works')?.scrollIntoView({ behavior: 'smooth' });
                  }, 60);
                }
              }}
              className="hover:text-white hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0 min-h-[44px] flex items-center focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400"
            >
              How It Works
            </a>
            <a
              href="#privacy-note"
              onClick={(e) => {
                if (currentScreen !== 'landing') {
                  e.preventDefault();
                  onGoHome();
                  setTimeout(() => {
                    document.getElementById('privacy-note')?.scrollIntoView({ behavior: 'smooth' });
                  }, 60);
                }
              }}
              className="hover:text-white hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0 min-h-[44px] flex items-center focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400"
            >
              Privacy
            </a>
          </nav>

          {/* Zone 3: Single contextual action */}
          <div className="flex items-center shrink-0">
            {!isInstalled && isInstallable ? (
              <button
                type="button"
                onClick={() => void promptInstall()}
                className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-cyan-400/40 bg-cyan-400/10 px-3.5 py-2 text-xs font-semibold text-cyan-200 transition-colors hover:bg-cyan-400/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400 whitespace-nowrap shrink-0"
              >
                <Download className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                Install App
              </button>
            ) : !isInstalled && isIOS ? (
              <button
                type="button"
                onClick={() => setShowIOSModal(true)}
                className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900/80 px-3.5 py-2 text-xs font-medium text-slate-200 transition-colors hover:border-slate-600 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400 whitespace-nowrap shrink-0"
              >
                <Download className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                Install
              </button>
            ) : currentScreen === 'landing' ? (
              <button
                type="button"
                onClick={onStartDemo}
                className="inline-flex min-h-[40px] items-center rounded-lg border border-slate-700 bg-slate-900/80 px-3.5 py-2 text-xs font-semibold text-slate-100 transition-colors hover:border-slate-500 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400 whitespace-nowrap shrink-0"
              >
                Try a Demo
              </button>
            ) : (
              <button
                type="button"
                onClick={onStartCamera}
                className="inline-flex min-h-[40px] items-center rounded-lg bg-cyan-400 px-3.5 py-2 text-xs font-semibold text-slate-950 transition-colors hover:bg-cyan-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400 whitespace-nowrap shrink-0"
              >
                Open Camera
              </button>
            )}
          </div>
        </div>
      </header>

      {showIOSModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="ios-install-heading"
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/75 p-4 backdrop-blur-sm sm:items-center"
        >
          <div className="w-full max-w-sm rounded-2xl border border-slate-800 bg-[#0B1222] p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <h2
                id="ios-install-heading"
                className="font-display text-lg font-semibold text-white"
              >
                Install on iPhone or iPad
              </h2>
              <button
                type="button"
                onClick={() => setShowIOSModal(false)}
                aria-label="Close installation guide"
                className="flex min-h-[44px] min-w-[44px] -mr-2 -mt-2 items-center justify-center rounded-lg text-slate-400 hover:text-white focus-visible:outline-2 focus-visible:outline-cyan-400"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
            <ol className="mt-3 space-y-2.5 text-sm leading-relaxed text-slate-300 list-decimal list-inside">
              <li>
                Tap the <strong className="text-white">Share</strong> icon in your Safari toolbar.
              </li>
              <li>
                Scroll down and select <strong className="text-white">Add to Home Screen</strong>.
              </li>
              <li>
                Tap <strong className="text-white">Add</strong> to launch SeeMathEverywhere full screen.
              </li>
            </ol>
            <button
              type="button"
              onClick={() => setShowIOSModal(false)}
              className="mt-5 w-full min-h-[46px] rounded-xl bg-slate-800 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-slate-700 focus-visible:outline-2 focus-visible:outline-cyan-400"
            >
              Got It
            </button>
          </div>
        </div>
      )}
    </>
  );
};
