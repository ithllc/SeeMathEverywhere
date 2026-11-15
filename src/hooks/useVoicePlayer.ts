import { useCallback, useEffect, useRef, useState } from 'react';
import type { TtsResponse } from '../types/concepts';
import { formatMathForSpeech } from '../utils/voiceFormatting';

interface SpeakOptions {
  languageCode?: string;
  preloadedAudioBase64?: string;
  preloadedMimeType?: string;
  alreadyFormattedForSpeech?: boolean;
}

interface CachedAudioBuffer {
  bytes: Uint8Array;
  mimeType: string;
}

type WebkitWindow = Window & {
  webkitAudioContext?: typeof AudioContext;
};

let sharedAudioContext: AudioContext | null = null;
let audioUnlocked = false;

function getSharedAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (sharedAudioContext && sharedAudioContext.state !== 'closed') {
    return sharedAudioContext;
  }
  const AudioCtx = window.AudioContext || (window as WebkitWindow).webkitAudioContext;
  if (!AudioCtx) return null;
  try {
    sharedAudioContext = new AudioCtx();
    return sharedAudioContext;
  } catch {
    return null;
  }
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Selects a refined British voice for English or a matching native voice
 * for any spoken language when falling back to offline Web Speech synthesis.
 */
function pickFallbackBrowserVoice(languageCode: string): SpeechSynthesisVoice | null {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return null;
  const voices = window.speechSynthesis.getVoices();
  if (!voices || voices.length === 0) return null;

  const normalizedLang = (languageCode || 'en-GB').toLowerCase();
  const baseLang = normalizedLang.split('-')[0];

  if (baseLang === 'en') {
    const britishPreferred = voices.find(
      (v) =>
        v.lang.toLowerCase().startsWith('en-gb') &&
        /daniel|arthur|oliver|george|ryan|male|uk/i.test(v.name)
    );
    if (britishPreferred) return britishPreferred;
    const anyBritish = voices.find((v) => v.lang.toLowerCase().startsWith('en-gb'));
    if (anyBritish) return anyBritish;
  }

  return (
    voices.find((v) => v.lang.toLowerCase() === normalizedLang) ||
    voices.find((v) => v.lang.toLowerCase().startsWith(`${baseLang}-`)) ||
    voices.find((v) => v.lang.toLowerCase().startsWith(baseLang)) ||
    null
  );
}

export function useVoicePlayer() {
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [synthesizingId, setSynthesizingId] = useState<string | null>(null);
  const [voiceError, setVoiceError] = useState<string | null>(null);

  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  const activeBlobUrlRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const playbackTokenRef = useRef<number>(0);

  // Transient in-memory session cache of decoded WAV byte buffers (cleared on unmount)
  const audioCacheRef = useRef<Map<string, CachedAudioBuffer>>(new Map());

  /**
   * Synchronously unlocks Web Audio API during a user click/tap gesture so
   * audio arriving seconds later from /api/tts or /api/ask-scene is never
   * blocked by Safari or cross-origin iframe autoplay policies.
   */
  const primeAudio = useCallback(() => {
    const ctx = getSharedAudioContext();
    if (!ctx) return;

    if (ctx.state === 'suspended') {
      void ctx.resume().catch(() => undefined);
    }

    if (!audioUnlocked) {
      try {
        const silentBuffer = ctx.createBuffer(1, 1, 22_050);
        const silentSource = ctx.createBufferSource();
        silentSource.buffer = silentBuffer;
        silentSource.connect(ctx.destination);
        silentSource.start(0);
        audioUnlocked = true;
      } catch {
        // Ignore if browser delays unlock until resume resolves
      }
    }
  }, []);

  const stop = useCallback(() => {
    playbackTokenRef.current += 1;

    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }

    if (sourceNodeRef.current) {
      const node = sourceNodeRef.current;
      sourceNodeRef.current = null;
      node.onended = null;
      try {
        node.stop(0);
      } catch {
        // Already stopped
      }
      try {
        node.disconnect();
      } catch {
        // Ignore
      }
    }

    if (audioElementRef.current) {
      const el = audioElementRef.current;
      audioElementRef.current = null;
      el.onended = null;
      el.onerror = null;
      el.pause();
      el.currentTime = 0;
    }

    if (activeBlobUrlRef.current) {
      URL.revokeObjectURL(activeBlobUrlRef.current);
      activeBlobUrlRef.current = null;
    }

    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        if (window.speechSynthesis.speaking || window.speechSynthesis.pending) {
          window.speechSynthesis.cancel();
        }
      } catch {
        // Ignore
      }
    }

    setSynthesizingId(null);
    setSpeakingId(null);
  }, []);

  useEffect(() => {
    const cache = audioCacheRef.current;
    return () => {
      stop();
      cache.clear();
    };
  }, [stop]);

  const playWithBrowserFallback = useCallback(
    async (
      id: string,
      spokenText: string,
      languageCode: string,
      token: number
    ): Promise<boolean> => {
      if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
        return false;
      }
      try {
        if (window.speechSynthesis.speaking || window.speechSynthesis.pending) {
          window.speechSynthesis.cancel();
          // Brief pause avoids Chromium bug where cancel() aborts the immediately-following speak()
          await new Promise((resolve) => setTimeout(resolve, 60));
        }
        if (playbackTokenRef.current !== token) return true;

        const utterance = new SpeechSynthesisUtterance(spokenText);
        utterance.lang = languageCode.startsWith('en') ? 'en-GB' : languageCode;
        utterance.rate = 0.98;
        utterance.pitch = 0.95;
        const selectedVoice = pickFallbackBrowserVoice(utterance.lang);
        if (selectedVoice) {
          utterance.voice = selectedVoice;
        }
        utterance.onend = () => {
          if (playbackTokenRef.current === token) {
            setSpeakingId((prev) => (prev === id ? null : prev));
          }
        };
        utterance.onerror = () => {
          if (playbackTokenRef.current === token) {
            setSpeakingId((prev) => (prev === id ? null : prev));
          }
        };
        setSynthesizingId(null);
        setSpeakingId(id);
        window.speechSynthesis.speak(utterance);
        return true;
      } catch {
        return false;
      }
    },
    []
  );

  const playBytes = useCallback(
    async (
      id: string,
      bytes: Uint8Array,
      mimeType: string,
      spokenFallback: string,
      languageCode: string,
      token: number
    ) => {
      if (playbackTokenRef.current !== token) return;

      // Primary path: Web Audio API (plays reliably across async fetches once unlocked on click)
      const ctx = getSharedAudioContext();
      if (ctx) {
        try {
          if (ctx.state === 'suspended') {
            await ctx.resume();
          }
          const copyBuffer = new ArrayBuffer(bytes.byteLength);
          new Uint8Array(copyBuffer).set(bytes);
          const decoded = await ctx.decodeAudioData(copyBuffer);

          if (playbackTokenRef.current !== token) return;

          const source = ctx.createBufferSource();
          source.buffer = decoded;
          const gain = ctx.createGain();
          gain.gain.value = 1.0;
          source.connect(gain);
          gain.connect(ctx.destination);

          sourceNodeRef.current = source;
          source.onended = () => {
            if (sourceNodeRef.current === source) {
              sourceNodeRef.current = null;
            }
            try {
              source.disconnect();
              gain.disconnect();
            } catch {
              // Ignore
            }
            if (playbackTokenRef.current === token) {
              setSpeakingId((prev) => (prev === id ? null : prev));
            }
          };

          setSynthesizingId(null);
          setSpeakingId(id);
          source.start(0);
          return;
        } catch {
          // Fall through to HTMLAudioElement if decodeAudioData fails
        }
      }

      if (playbackTokenRef.current !== token) return;

      // Secondary path: HTMLAudioElement Blob URL
      try {
        const copyBytes = new Uint8Array(bytes.byteLength);
        copyBytes.set(bytes);
        const blob = new Blob([copyBytes], { type: mimeType || 'audio/wav' });
        const blobUrl = URL.createObjectURL(blob);
        activeBlobUrlRef.current = blobUrl;

        const audio = new Audio(blobUrl);
        audioElementRef.current = audio;
        audio.onended = () => {
          if (audioElementRef.current === audio) {
            audioElementRef.current = null;
          }
          if (activeBlobUrlRef.current === blobUrl) {
            URL.revokeObjectURL(blobUrl);
            activeBlobUrlRef.current = null;
          }
          if (playbackTokenRef.current === token) {
            setSpeakingId((prev) => (prev === id ? null : prev));
          }
        };
        audio.onerror = () => {
          if (audioElementRef.current === audio) {
            audioElementRef.current = null;
          }
          if (activeBlobUrlRef.current === blobUrl) {
            URL.revokeObjectURL(blobUrl);
            activeBlobUrlRef.current = null;
          }
          void playWithBrowserFallback(id, spokenFallback, languageCode, token).then((ok) => {
            if (!ok && playbackTokenRef.current === token) {
              setSpeakingId(null);
              setVoiceError('Audio playback could not start on this device. Check device volume or mute switch.');
            }
          });
        };

        setSynthesizingId(null);
        setSpeakingId(id);
        await audio.play();
        return;
      } catch {
        if (activeBlobUrlRef.current) {
          URL.revokeObjectURL(activeBlobUrlRef.current);
          activeBlobUrlRef.current = null;
        }
      }

      // Tertiary path: Browser SpeechSynthesis
      const ok = await playWithBrowserFallback(id, spokenFallback, languageCode, token);
      if (!ok && playbackTokenRef.current === token) {
        setSynthesizingId(null);
        setSpeakingId(null);
        setVoiceError(
          'Browser blocked automatic audio playback. Tap Listen to play the spoken response.'
        );
      }
    },
    [playWithBrowserFallback]
  );

  const speak = useCallback(
    async (id: string, rawText: string, options?: SpeakOptions) => {
      // Toggle off if already speaking or synthesizing this exact item
      if (speakingId === id || synthesizingId === id) {
        stop();
        return;
      }

      // Unlock AudioContext immediately during the synchronous user click
      primeAudio();
      stop();
      setVoiceError(null);

      const currentToken = playbackTokenRef.current;
      const languageCode = options?.languageCode || 'en-GB';
      const spokenText = options?.alreadyFormattedForSpeech
        ? rawText.trim()
        : formatMathForSpeech(rawText);

      if (!spokenText) return;

      const cacheKey = `${languageCode}::${spokenText}`;

      // 1. If preloaded server audio was returned alongside /api/ask-scene, cache & play immediately
      if (options?.preloadedAudioBase64) {
        try {
          let cached = audioCacheRef.current.get(cacheKey);
          if (!cached) {
            cached = {
              bytes: base64ToBytes(options.preloadedAudioBase64),
              mimeType: options.preloadedMimeType || 'audio/wav',
            };
            audioCacheRef.current.set(cacheKey, cached);
          }
          await playBytes(
            id,
            cached.bytes,
            cached.mimeType,
            spokenText,
            languageCode,
            currentToken
          );
          return;
        } catch {
          // Fall through to synthesis/fallback if base64 was malformed
        }
      }

      // 2. Replay instantaneously from transient in-memory cache if already synthesized
      const existing = audioCacheRef.current.get(cacheKey);
      if (existing) {
        await playBytes(
          id,
          existing.bytes,
          existing.mimeType,
          spokenText,
          languageCode,
          currentToken
        );
        return;
      }

      // 3. Offline PWA fallback
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        const ok = await playWithBrowserFallback(id, spokenText, languageCode, currentToken);
        if (!ok) {
          setVoiceError('Reconnect to hear neural voice narration.');
        }
        return;
      }

      // 4. Synthesize via server-side Gemini TTS (/api/tts)
      const controller = new AbortController();
      abortRef.current = controller;
      setSynthesizingId(id);

      try {
        const res = await fetch('/api/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: spokenText,
            languageCode,
          }),
          signal: controller.signal,
        });

        const data = (await res.json().catch(() => null)) as
          | (TtsResponse & { message?: string })
          | null;

        if (controller.signal.aborted || playbackTokenRef.current !== currentToken) return;

        if (!res.ok || !data?.audioBase64) {
          const ok = await playWithBrowserFallback(id, spokenText, languageCode, currentToken);
          if (!ok && playbackTokenRef.current === currentToken) {
            setSynthesizingId(null);
            setVoiceError(data?.message || 'Voice synthesis is temporarily unavailable.');
          }
          return;
        }

        if (audioCacheRef.current.size >= 12) {
          const firstKey = audioCacheRef.current.keys().next().value;
          if (firstKey) {
            audioCacheRef.current.delete(firstKey);
          }
        }

        const cachedItem: CachedAudioBuffer = {
          bytes: base64ToBytes(data.audioBase64),
          mimeType: data.mimeType || 'audio/wav',
        };
        audioCacheRef.current.set(cacheKey, cachedItem);

        await playBytes(
          id,
          cachedItem.bytes,
          cachedItem.mimeType,
          spokenText,
          languageCode,
          currentToken
        );
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') return;
        const ok = await playWithBrowserFallback(id, spokenText, languageCode, currentToken);
        if (!ok && playbackTokenRef.current === currentToken) {
          setSynthesizingId(null);
          setVoiceError('Could not connect to voice synthesis right now.');
        }
      }
    },
    [playBytes, playWithBrowserFallback, primeAudio, speakingId, stop, synthesizingId]
  );

  return {
    speakingId,
    synthesizingId,
    voiceError,
    primeAudio,
    speak,
    stop,
  };
}
