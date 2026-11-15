import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ExternalLink, Eye, Loader2, Mic, Send, Square, Volume2, VolumeX, X } from 'lucide-react';
import type {
  AskSceneResponse,
  ConceptItem,
  SceneChatTurn,
} from '../types/concepts';
import type { CapturedImagePayload } from '../utils/imageProcessing';
import { buildStarterQuestions } from '../utils/voiceFormatting';

interface SceneVoiceCompanionProps {
  sceneKey: string;
  sceneSummary: string;
  concepts: ConceptItem[];
  selectedConceptId: string | null;
  capturedImage: CapturedImagePayload | null;
  onSelectConcept: (conceptId: string) => void;
  speakingId: string | null;
  synthesizingId: string | null;
  onPrimeAudio: () => void;
  onSpeak: (
    id: string,
    text: string,
    options?: {
      languageCode?: string;
      preloadedAudioBase64?: string;
      preloadedMimeType?: string;
      alreadyFormattedForSpeech?: boolean;
    }
  ) => void;
  onStopSpeaking: () => void;
}

interface BrowserSpeechRecognitionInstance {
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

type SpeechWindow = Window & {
  SpeechRecognition?: new () => BrowserSpeechRecognitionInstance;
  webkitSpeechRecognition?: new () => BrowserSpeechRecognitionInstance;
  webkitAudioContext?: typeof AudioContext;
};

function getPreferredRecorderMimeType(): string {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
    return '';
  }
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
    'audio/ogg',
  ];
  for (const mime of candidates) {
    if (MediaRecorder.isTypeSupported(mime)) {
      return mime;
    }
  }
  return '';
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const commaIdx = result.indexOf(',');
      resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result);
    };
    reader.onerror = () => reject(new Error('Could not read recorded audio.'));
    reader.readAsDataURL(blob);
  });
}

const METER_THRESHOLDS = [8, 20, 36, 54, 74];

export const SceneVoiceCompanion: React.FC<SceneVoiceCompanionProps> = ({
  sceneKey,
  sceneSummary,
  concepts,
  selectedConceptId,
  capturedImage,
  onSelectConcept,
  speakingId,
  synthesizingId,
  onPrimeAudio,
  onSpeak,
  onStopSpeaking,
}) => {
  const [turns, setTurns] = useState<SceneChatTurn[]>([]);
  const [inputText, setInputText] = useState<string>('');
  const [isSending, setIsSending] = useState<boolean>(false);
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [recordingSeconds, setRecordingSeconds] = useState<number>(0);
  const [micLevel, setMicLevel] = useState<number>(0);
  const [livePreviewTranscript, setLivePreviewTranscript] = useState<string>('');
  const [autoSpeak, setAutoSpeak] = useState<boolean>(true);
  const [companionError, setCompanionError] = useState<string | null>(null);
  const [micBlockedInIframe, setMicBlockedInIframe] = useState<boolean>(false);

  const logContainerRef = useRef<HTMLDivElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const meterAudioCtxRef = useRef<AudioContext | null>(null);
  const meterIntervalRef = useRef<number | null>(null);
  const speechRecRef = useRef<BrowserSpeechRecognitionInstance | null>(null);
  const liveTranscriptRef = useRef<string>('');
  const audioChunksRef = useRef<Blob[]>([]);
  const discardRecordingRef = useRef<boolean>(false);
  const timerRef = useRef<number | null>(null);

  const cleanupRecordingResources = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (meterIntervalRef.current !== null) {
      window.clearInterval(meterIntervalRef.current);
      meterIntervalRef.current = null;
    }
    if (speechRecRef.current) {
      try {
        speechRecRef.current.onresult = null;
        speechRecRef.current.onerror = null;
        speechRecRef.current.abort();
      } catch {
        // Ignore
      }
      speechRecRef.current = null;
    }
    if (meterAudioCtxRef.current) {
      const ctx = meterAudioCtxRef.current;
      meterAudioCtxRef.current = null;
      void ctx.close().catch(() => undefined);
    }
    if (mediaStreamRef.current) {
      for (const track of mediaStreamRef.current.getTracks()) {
        track.stop();
      }
      mediaStreamRef.current = null;
    }
    mediaRecorderRef.current = null;
    setIsRecording(false);
    setRecordingSeconds(0);
    setMicLevel(0);
    setLivePreviewTranscript('');
  }, []);

  // Reset conversation thread cleanly when switching to a newly captured scene
  useEffect(() => {
    discardRecordingRef.current = true;
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    cleanupRecordingResources();
    setTurns([]);
    setInputText('');
    setCompanionError(null);
    setMicBlockedInIframe(false);
  }, [sceneKey, cleanupRecordingResources]);

  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [turns, isSending]);

  useEffect(() => {
    return () => {
      discardRecordingRef.current = true;
      cleanupRecordingResources();
    };
  }, [cleanupRecordingResources]);

  const submitQuestion = useCallback(
    async (params: {
      questionText?: string;
      audioBase64?: string;
      audioMimeType?: string;
      viaVoice?: boolean;
    }) => {
      if (isSending) return;
      if (!navigator.onLine) {
        setCompanionError(
          'Reconnect to the internet to ask live voice or text questions about this scene.'
        );
        return;
      }

      const trimmedText = params.questionText?.trim() || '';
      const hasAudio = Boolean(params.audioBase64);
      if (!trimmedText && !hasAudio) return;

      onStopSpeaking();
      setCompanionError(null);
      setIsSending(true);

      const pendingUserTurnId = `user-${Date.now()}`;
      if (trimmedText && !hasAudio) {
        setTurns((prev) => [
          ...prev,
          {
            id: pendingUserTurnId,
            role: 'user',
            text: trimmedText,
            viaVoice: Boolean(params.viaVoice),
          },
        ]);
        setInputText('');
      }

      try {
        const recentHistory = turns.slice(-6).map((t) => ({
          role: t.role,
          text: t.text,
        }));

        const res = await fetch('/api/ask-scene', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...(trimmedText ? { questionText: trimmedText } : {}),
            ...(hasAudio
              ? {
                  audioBase64: params.audioBase64,
                  audioMimeType: params.audioMimeType || 'audio/webm',
                }
              : {}),
            ...(capturedImage
              ? {
                  imageBase64: capturedImage.base64Data,
                  imageMimeType: capturedImage.mimeType,
                }
              : {}),
            sceneSummary,
            selectedConceptId,
            concepts: concepts.map((c) => ({
              id: c.id,
              category: c.category,
              title: c.title,
              equation: c.equation,
              plainExplanation: c.plainExplanation,
              visibleEvidence: c.visibleEvidence,
              whyItMatters: c.whyItMatters,
            })),
            history: recentHistory,
            includeAudio: autoSpeak,
          }),
        });

        const data = (await res.json().catch(() => null)) as
          | (AskSceneResponse & { message?: string })
          | null;

        if (!res.ok || !data?.reply) {
          throw new Error(
            data?.message || 'Could not process that question right now. Please try again.'
          );
        }

        const assistantTurnId = `assistant-${Date.now()}`;

        setTurns((prev) => {
          const next = [...prev];
          if (hasAudio) {
            next.push({
              id: pendingUserTurnId,
              role: 'user',
              text: data.transcript || trimmedText || 'Spoken question',
              languageCode: data.languageCode,
              languageName: data.languageName,
              viaVoice: true,
            });
          } else {
            const idx = next.findIndex((t) => t.id === pendingUserTurnId);
            if (idx !== -1 && data.languageName) {
              next[idx] = {
                ...next[idx],
                languageCode: data.languageCode,
                languageName: data.languageName,
              };
            }
          }

          next.push({
            id: assistantTurnId,
            role: 'assistant',
            text: data.reply,
            spokenText: data.spokenReply || data.reply,
            languageCode: data.languageCode,
            languageName: data.languageName,
            relatedConceptId: data.relatedConceptId,
          });
          return next;
        });

        if (data.relatedConceptId) {
          onSelectConcept(data.relatedConceptId);
        }

        if (autoSpeak) {
          onSpeak(assistantTurnId, data.spokenReply || data.reply, {
            languageCode: data.languageCode,
            preloadedAudioBase64: data.audioBase64,
            preloadedMimeType: data.audioMimeType,
            alreadyFormattedForSpeech: true,
          });
        }
      } catch (err) {
        const msg =
          err instanceof Error && err.message
            ? err.message
            : 'Could not reach the scene advisor right now. Please try again.';
        setCompanionError(msg);
      } finally {
        setIsSending(false);
      }
    },
    [
      autoSpeak,
      capturedImage,
      concepts,
      isSending,
      onSelectConcept,
      onSpeak,
      onStopSpeaking,
      sceneSummary,
      selectedConceptId,
      turns,
    ]
  );

  const startVoiceRecording = async () => {
    if (isSending || isRecording) return;

    // Unlock Web Audio playback synchronously inside this click gesture
    onPrimeAudio();
    setCompanionError(null);
    setMicBlockedInIframe(false);
    onStopSpeaking();

    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices ||
      typeof navigator.mediaDevices.getUserMedia !== 'function'
    ) {
      setCompanionError(
        'Microphone access requires HTTPS or a supported browser. You can type your question in any language below.'
      );
      return;
    }

    try {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
      } catch (constraintErr) {
        const cDom = constraintErr as DOMException | undefined;
        if (
          cDom?.name === 'NotAllowedError' ||
          cDom?.name === 'PermissionDeniedError' ||
          cDom?.name === 'SecurityError'
        ) {
          throw constraintErr;
        }
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      }

      mediaStreamRef.current = stream;
      audioChunksRef.current = [];
      liveTranscriptRef.current = '';
      setLivePreviewTranscript('');
      discardRecordingRef.current = false;

      // Start live microphone input level meter so user sees real-time confirmation their mic works
      const AudioCtx =
        window.AudioContext || (window as SpeechWindow).webkitAudioContext;
      if (AudioCtx) {
        try {
          const meterCtx = new AudioCtx();
          meterAudioCtxRef.current = meterCtx;
          if (meterCtx.state === 'suspended') {
            void meterCtx.resume().catch(() => undefined);
          }
          const micSource = meterCtx.createMediaStreamSource(stream);
          const analyser = meterCtx.createAnalyser();
          analyser.fftSize = 256;
          micSource.connect(analyser);
          const sampleBuf = new Uint8Array(analyser.fftSize);

          meterIntervalRef.current = window.setInterval(() => {
            analyser.getByteTimeDomainData(sampleBuf);
            let sumSquares = 0;
            for (let i = 0; i < sampleBuf.length; i++) {
              const centered = (sampleBuf[i] - 128) / 128;
              sumSquares += centered * centered;
            }
            const rms = Math.sqrt(sumSquares / sampleBuf.length);
            const scaled = Math.min(100, Math.round(rms * 360));
            setMicLevel(scaled);
          }, 90);
        } catch {
          // Non-blocking if audio meter cannot attach
        }
      }

      // Optional parallel browser SpeechRecognition for live word preview + fallback transcript
      const SpeechRec =
        (window as SpeechWindow).SpeechRecognition ||
        (window as SpeechWindow).webkitSpeechRecognition;
      if (SpeechRec) {
        try {
          const rec = new SpeechRec();
          rec.continuous = true;
          rec.interimResults = true;
          rec.maxAlternatives = 1;
          rec.onresult = (event) => {
            const parts: string[] = [];
            for (let i = 0; i < event.results.length; i++) {
              const item = event.results[i]?.[0]?.transcript;
              if (item) parts.push(item);
            }
            const combined = parts.join(' ').trim();
            if (combined) {
              liveTranscriptRef.current = combined;
              setLivePreviewTranscript(combined);
            }
          };
          rec.onerror = () => undefined;
          rec.start();
          speechRecRef.current = rec;
        } catch {
          // Non-blocking; server-side Gemini multimodal audio handles transcription in all languages
        }
      }

      if (typeof MediaRecorder === 'undefined') {
        cleanupRecordingResources();
        setCompanionError(
          'Audio recording is unavailable in this browser. Please type your question below.'
        );
        return;
      }

      const preferredMime = getPreferredRecorderMimeType();
      const recorder = preferredMime
        ? new MediaRecorder(stream, { mimeType: preferredMime })
        : new MediaRecorder(stream);

      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = async () => {
        const wasDiscarded = discardRecordingRef.current;
        const actualMime = recorder.mimeType || preferredMime || 'audio/webm';
        const chunks = [...audioChunksRef.current];
        const fallbackRecognized = liveTranscriptRef.current.trim();
        audioChunksRef.current = [];
        liveTranscriptRef.current = '';
        cleanupRecordingResources();

        if (wasDiscarded) return;

        const blob = new Blob(chunks, { type: actualMime });

        if (blob.size >= 128) {
          try {
            const base64Audio = await blobToBase64(blob);
            await submitQuestion({
              audioBase64: base64Audio,
              audioMimeType: actualMime,
              ...(fallbackRecognized ? { questionText: fallbackRecognized } : {}),
              viaVoice: true,
            });
            return;
          } catch {
            // Fall through to recognized text fallback if base64 conversion failed
          }
        }

        if (fallbackRecognized) {
          await submitQuestion({
            questionText: fallbackRecognized,
            viaVoice: true,
          });
          return;
        }

        setCompanionError(
          'No speech audio was captured. Make sure your microphone is unmuted, speak your question, and tap Send Voice.'
        );
      };

      // Emit data chunks every 200ms so even brief 1-second questions never produce empty buffers
      recorder.start(200);
      setIsRecording(true);
      setRecordingSeconds(0);

      timerRef.current = window.setInterval(() => {
        setRecordingSeconds((prev) => {
          if (prev >= 24) {
            if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
              try {
                mediaRecorderRef.current.requestData();
              } catch {
                // Ignore
              }
              mediaRecorderRef.current.stop();
            }
            return prev;
          }
          return prev + 1;
        });
      }, 1000);
    } catch (err) {
      cleanupRecordingResources();
      const domErr = err as DOMException | undefined;
      const isEmbedded = typeof window !== 'undefined' && window.self !== window.top;
      if (
        domErr?.name === 'NotAllowedError' ||
        domErr?.name === 'PermissionDeniedError' ||
        domErr?.name === 'SecurityError'
      ) {
        setMicBlockedInIframe(isEmbedded);
        setCompanionError(
          isEmbedded
            ? 'Microphone access was blocked by the browser or preview frame. Allow microphone permission in your browser address bar, open the app in a full tab, or type in any language below.'
            : 'Microphone permission is blocked. Allow microphone access in your browser address bar, or type your question in any language below.'
        );
      } else {
        setCompanionError(
          'No active microphone was detected on this device. Check your audio input device, or type your question in any language below.'
        );
      }
    }
  };

  const finishAndSendRecording = () => {
    onPrimeAudio();
    discardRecordingRef.current = false;
    if (speechRecRef.current) {
      try {
        speechRecRef.current.stop();
      } catch {
        // Ignore
      }
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try {
        if (mediaRecorderRef.current.state === 'recording') {
          mediaRecorderRef.current.requestData();
        }
      } catch {
        // Ignore
      }
      mediaRecorderRef.current.stop();
    } else {
      cleanupRecordingResources();
    }
  };

  const cancelVoiceRecording = () => {
    discardRecordingRef.current = true;
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    } else {
      cleanupRecordingResources();
    }
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || isSending || isRecording) return;
    onPrimeAudio();
    void submitQuestion({ questionText: inputText });
  };

  const starterQuestions = buildStarterQuestions(concepts);
  const formattedSeconds = `0:${String(recordingSeconds).padStart(2, '0')}`;
  const currentHref = typeof window !== 'undefined' ? window.location.href : '/';

  return (
    <section
      aria-label="Ask about this scene by voice or text"
      className="rounded-2xl border border-cyan-500/30 bg-slate-900/80 p-4 shadow-lg shadow-cyan-950/15 sm:p-5"
    >
      {/* Header Row */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-display text-base font-semibold text-white sm:text-lg">
            Ask About This Scene
          </h2>
          <p className="mt-0.5 text-xs leading-relaxed text-slate-400">
            Speak or type in any language <span aria-hidden="true">·</span> Spoken replies in your
            language
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            onPrimeAudio();
            setAutoSpeak((prev) => {
              if (prev) onStopSpeaking();
              return !prev;
            });
          }}
          aria-pressed={autoSpeak}
          aria-label={autoSpeak ? 'Mute automatic spoken replies' : 'Enable automatic spoken replies'}
          className={`inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-cyan-400 whitespace-nowrap shrink-0 ${
            autoSpeak
              ? 'border-cyan-400/50 bg-cyan-950/45 text-cyan-200'
              : 'border-slate-700 bg-[#060B16]/70 text-slate-400 hover:text-white'
          }`}
        >
          {autoSpeak ? (
            <>
              <Volume2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              Voice On
            </>
          ) : (
            <>
              <VolumeX className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              Voice Muted
            </>
          )}
        </button>
      </div>

      {/* Starter Questions when thread is empty */}
      {turns.length === 0 && !isRecording && (
        <div className="mt-3.5 flex flex-wrap gap-2">
          {starterQuestions.map((prompt) => (
            <button
              key={prompt}
              type="button"
              disabled={isSending}
              onClick={() => {
                onPrimeAudio();
                void submitQuestion({ questionText: prompt });
              }}
              className="min-h-[38px] max-w-full truncate rounded-lg border border-slate-800 bg-[#060B16]/75 px-3 py-1.5 text-left text-xs text-slate-300 transition-colors hover:border-slate-600 hover:text-white disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-cyan-400"
            >
              {prompt}
            </button>
          ))}
        </div>
      )}

      {/* Conversation History */}
      {turns.length > 0 && (
        <div
          ref={logContainerRef}
          role="log"
          aria-live="polite"
          className="mt-4 max-h-80 space-y-3 overflow-y-auto pr-1"
        >
          {turns.map((turn) => {
            const matchedConcept = turn.relatedConceptId
              ? concepts.find((c) => c.id === turn.relatedConceptId)
              : undefined;
            const isTurnSpeaking = speakingId === turn.id;
            const isTurnSynthesizing = synthesizingId === turn.id;

            if (turn.role === 'user') {
              return (
                <div key={turn.id} className="flex flex-col items-end">
                  <p className="text-[11px] text-slate-400">
                    You
                    {turn.viaVoice ? ' · Spoken' : ''}
                    {turn.languageName ? ` · ${turn.languageName}` : ''}
                  </p>
                  <div className="mt-1 max-w-[88%] rounded-2xl bg-slate-800/90 px-3.5 py-2.5 text-sm text-slate-100">
                    {turn.text}
                  </div>
                </div>
              );
            }

            return (
              <div
                key={turn.id}
                className="rounded-xl border border-slate-800/90 bg-[#060B16]/85 p-3.5"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
                  <span>
                    Field Advisor
                    {turn.languageName ? ` · ${turn.languageName}` : ''}
                  </span>

                  <button
                    type="button"
                    onClick={() =>
                      onSpeak(turn.id, turn.spokenText || turn.text, {
                        languageCode: turn.languageCode,
                        alreadyFormattedForSpeech: Boolean(turn.spokenText),
                      })
                    }
                    aria-label={
                      isTurnSpeaking || isTurnSynthesizing
                        ? 'Stop spoken reply'
                        : 'Listen to advisor reply'
                    }
                    className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium text-cyan-300 transition-colors hover:bg-slate-800 hover:text-white focus-visible:outline-2 focus-visible:outline-cyan-400 whitespace-nowrap shrink-0"
                  >
                    {isTurnSynthesizing ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" aria-hidden="true" />
                        Preparing…
                      </>
                    ) : isTurnSpeaking ? (
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
                </div>

                <p className="mt-1.5 text-sm leading-relaxed text-slate-100">{turn.text}</p>

                {matchedConcept && (
                  <div className="mt-2.5 pt-2 border-t border-slate-800/80">
                    <button
                      type="button"
                      onClick={() => onSelectConcept(matchedConcept.id)}
                      className="inline-flex min-h-[36px] items-center gap-1.5 text-xs font-medium text-amber-300 hover:text-white hover:underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-cyan-400"
                    >
                      <Eye className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      Highlighted on photo: {matchedConcept.title}
                    </button>
                  </div>
                )}
              </div>
            );
          })}

          {isSending && (
            <div
              role="status"
              className="flex items-center gap-2 text-xs text-slate-400 py-1"
            >
              <Loader2 className="h-3.5 w-3.5 animate-spin text-cyan-400 shrink-0" aria-hidden="true" />
              Inspecting scene and synthesizing spoken reply…
            </div>
          )}
        </div>
      )}

      {turns.length === 0 && isSending && (
        <div
          role="status"
          className="mt-3.5 flex items-center gap-2 text-xs text-slate-300"
        >
          <Loader2 className="h-4 w-4 animate-spin text-cyan-400 shrink-0" aria-hidden="true" />
          Inspecting scene and synthesizing spoken reply…
        </div>
      )}

      {companionError && (
        <div role="alert" className="mt-3 space-y-2 rounded-xl border border-amber-500/35 bg-amber-950/30 p-3">
          <p className="text-xs leading-relaxed text-amber-200">{companionError}</p>
          {micBlockedInIframe && (
            <a
              href={currentHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-amber-400/50 bg-slate-900/90 px-3 py-1.5 text-xs font-semibold text-amber-200 hover:border-amber-300 hover:text-white focus-visible:outline-2 focus-visible:outline-cyan-400"
            >
              <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              Open App in Full Tab for Microphone
            </a>
          )}
        </div>
      )}

      {/* Voice Recording Active Bar OR Multimodal Input Form */}
      {isRecording ? (
        <div className="mt-4 space-y-2.5 rounded-xl border border-cyan-400/60 bg-[#060B16] p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2.5 text-xs font-medium text-cyan-200">
              <Mic className="h-4 w-4 shrink-0 text-cyan-400" aria-hidden="true" />
              {/* Live 5-bar voice input meter */}
              <div
                aria-label="Live microphone input level"
                className="flex h-4 items-end gap-0.5"
              >
                {METER_THRESHOLDS.map((threshold, idx) => {
                  const active = micLevel >= threshold;
                  const heightClass =
                    idx === 0
                      ? 'h-1.5'
                      : idx === 1
                        ? 'h-2'
                        : idx === 2
                          ? 'h-2.5'
                          : idx === 3
                            ? 'h-3.5'
                            : 'h-4';
                  return (
                    <span
                      key={threshold}
                      className={`w-1 rounded-sm transition-colors duration-75 ${heightClass} ${
                        active ? 'bg-cyan-400' : 'bg-slate-700'
                      }`}
                    />
                  );
                })}
              </div>
              <span className="tabular-nums">{formattedSeconds}</span>
              <span aria-hidden="true">·</span>
              <span>Speak now, then tap Send Voice</span>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={cancelVoiceRecording}
                aria-label="Cancel voice recording"
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-medium text-slate-300 hover:border-slate-500 hover:text-white focus-visible:outline-2 focus-visible:outline-cyan-400 whitespace-nowrap shrink-0"
              >
                <X className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                Cancel
              </button>

              <button
                type="button"
                onClick={finishAndSendRecording}
                aria-label="Stop recording and send spoken question"
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg bg-cyan-400 px-3.5 py-2 text-xs font-semibold text-slate-950 hover:bg-cyan-300 focus-visible:outline-2 focus-visible:outline-cyan-300 whitespace-nowrap shrink-0"
              >
                <Send className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                Send Voice
              </button>
            </div>
          </div>

          {livePreviewTranscript && (
            <p className="text-xs italic text-slate-300">
              “{livePreviewTranscript}”
            </p>
          )}
        </div>
      ) : (
        <form onSubmit={handleFormSubmit} className="mt-4 flex items-center gap-2">
          <button
            type="button"
            disabled={isSending}
            onClick={() => void startVoiceRecording()}
            aria-label="Speak a question in any language"
            className="inline-flex min-h-[46px] items-center justify-center gap-1.5 rounded-xl border border-cyan-400/55 bg-cyan-950/55 px-3.5 py-2.5 text-xs font-semibold text-cyan-200 transition-colors hover:border-cyan-300 hover:bg-cyan-900/65 hover:text-white disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-cyan-400 whitespace-nowrap shrink-0"
          >
            <Mic className="h-4 w-4 shrink-0 text-cyan-300" aria-hidden="true" />
            Speak
          </button>

          <label htmlFor="scene-companion-input" className="sr-only">
            Ask a question about this scene in any language
          </label>
          <input
            id="scene-companion-input"
            type="text"
            value={inputText}
            disabled={isSending}
            onChange={(e) => setInputText(e.target.value)}
            placeholder="Ask in any language about what you see…"
            className="min-h-[46px] min-w-0 flex-1 rounded-xl border border-slate-800 bg-[#060B16]/90 px-3.5 py-2.5 text-sm text-white placeholder:text-slate-500 focus:border-cyan-400/70 focus:outline-none disabled:opacity-50"
          />

          <button
            type="submit"
            disabled={isSending || !inputText.trim()}
            aria-label="Send question"
            className="inline-flex min-h-[46px] items-center justify-center gap-1.5 rounded-xl bg-cyan-400 px-4 py-2.5 text-xs font-semibold text-slate-950 transition-colors hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline-2 focus-visible:outline-cyan-300 whitespace-nowrap shrink-0"
          >
            <Send className="h-4 w-4 shrink-0" aria-hidden="true" />
            Ask
          </button>
        </form>
      )}
    </section>
  );
};
