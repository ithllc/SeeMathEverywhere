import React, { useEffect, useRef, useState } from 'react';
import { Check, Download, Share2, X } from 'lucide-react';
import type { ConceptItem } from '../types/concepts';
import { drawOverlayOnCanvas, getCategoryPalette } from '../utils/overlayGeometry';
import { DEMO_FALLBACK_SVG_DATA_URI } from '../data/demoScene';
import { sanitizePublicText } from '../utils/voiceFormatting';

interface ShareCardModalProps {
  imageSrc: string;
  concept: ConceptItem;
  explanationText: string;
  onClose: () => void;
}

function wrapCanvasText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number
): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      current = word;
      if (lines.length >= maxLines - 1) {
        break;
      }
    }
  }

  if (current && lines.length < maxLines) {
    // Append any remaining words and truncate cleanly if needed
    const usedWordCount = lines.join(' ').split(/\s+/).filter(Boolean).length;
    const remainder = words.slice(usedWordCount).join(' ');
    let finalLine = remainder;
    while (ctx.measureText(finalLine).width > maxWidth && finalLine.length > 4) {
      finalLine = `${finalLine.slice(0, -5).trimEnd()}…`;
    }
    lines.push(finalLine);
  }

  return lines;
}

export const ShareCardModal: React.FC<ShareCardModalProps> = ({
  imageSrc,
  concept,
  explanationText,
  onClose,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isRendered, setIsRendered] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [canWebShare, setCanWebShare] = useState<boolean>(false);

  useEffect(() => {
    setCanWebShare(typeof navigator !== 'undefined' && typeof navigator.share === 'function');
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;

    const loadAndRender = (src: string, usedFallback = false) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        if (cancelled || !canvasRef.current) return;
        const canvas = canvasRef.current;
        const CARD_W = 1080;
        const CARD_H = 1350;
        canvas.width = CARD_W;
        canvas.height = CARD_H;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const palette = getCategoryPalette(concept.category);

        // 1. Background Deep Navy Canvas
        ctx.fillStyle = '#060B16';
        ctx.fillRect(0, 0, CARD_W, CARD_H);

        // Outer subtle frame
        ctx.strokeStyle = '#1E293B';
        ctx.lineWidth = 2;
        ctx.strokeRect(28, 28, CARD_W - 56, CARD_H - 56);

        // 2. Photo + Overlay Box
        const margin = 56;
        const imgBoxW = CARD_W - margin * 2;
        const imgBoxH = 720;
        const imgBoxX = margin;
        const imgBoxY = 64;

        ctx.save();
        ctx.beginPath();
        ctx.roundRect(imgBoxX, imgBoxY, imgBoxW, imgBoxH, 24);
        ctx.clip();

        ctx.fillStyle = '#0B1222';
        ctx.fillRect(imgBoxX, imgBoxY, imgBoxW, imgBoxH);

        // Fit image preserving aspect ratio inside box so normalized overlay aligns accurately
        const srcAspect = img.naturalWidth / Math.max(1, img.naturalHeight);
        const boxAspect = imgBoxW / imgBoxH;
        let drawW = imgBoxW;
        let drawH = imgBoxH;
        let drawX = imgBoxX;
        let drawY = imgBoxY;

        if (srcAspect > boxAspect) {
          drawW = imgBoxW;
          drawH = imgBoxW / srcAspect;
          drawY = imgBoxY + (imgBoxH - drawH) / 2;
        } else {
          drawH = imgBoxH;
          drawW = imgBoxH * srcAspect;
          drawX = imgBoxX + (imgBoxW - drawW) / 2;
        }

        ctx.drawImage(img, drawX, drawY, drawW, drawH);

        // Render selected concept overlay onto exact drawn image bounds
        drawOverlayOnCanvas(
          ctx,
          concept.overlay,
          concept.category,
          drawX,
          drawY,
          drawW,
          drawH
        );
        ctx.restore();

        // Border around image frame
        ctx.strokeStyle = '#1E293B';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(imgBoxX, imgBoxY, imgBoxW, imgBoxH, 24);
        ctx.stroke();

        // 3. Typography Section
        let cursorY = imgBoxY + imgBoxH + 62;

        // Category + Estimate Metadata
        ctx.font = '600 24px "Plus Jakarta Sans", sans-serif';
        ctx.fillStyle = palette.stroke;
        const metaLabel =
          concept.measurementType === 'estimated'
            ? `${concept.category}  ·  Visual Estimate`
            : `${concept.category}  ·  Real-World Principle`;
        ctx.fillText(metaLabel, margin, cursorY);

        // Concept Title
        const safeTitle = sanitizePublicText(concept.title);
        const safeEquation = sanitizePublicText(concept.equation);
        const safeExplanation = sanitizePublicText(explanationText);

        cursorY += 54;
        ctx.font = '700 44px "Outfit", sans-serif';
        ctx.fillStyle = '#FFFFFF';
        const titleLines = wrapCanvasText(ctx, safeTitle, imgBoxW, 2);
        for (const line of titleLines) {
          ctx.fillText(line, margin, cursorY);
          cursorY += 52;
        }

        // Equation
        cursorY += 8;
        ctx.font = '500 34px "IBM Plex Mono", monospace';
        ctx.fillStyle = palette.badgeText;
        ctx.fillText(safeEquation, margin, cursorY);

        // Short Explanation
        cursorY += 56;
        ctx.font = '400 28px "Plus Jakarta Sans", sans-serif';
        ctx.fillStyle = '#CBD5E1';
        const expLines = wrapCanvasText(ctx, safeExplanation, imgBoxW, 4);
        for (const line of expLines) {
          ctx.fillText(line, margin, cursorY);
          cursorY += 40;
        }

        // Footer Divider & Attribution
        const footerY = CARD_H - 76;
        ctx.strokeStyle = '#1E293B';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(margin, footerY - 34);
        ctx.lineTo(CARD_W - margin, footerY - 34);
        ctx.stroke();

        ctx.font = '600 24px "Outfit", sans-serif';
        ctx.fillStyle = '#F8FAFC';
        ctx.fillText('Discovered with SeeMathEverywhere', margin, footerY);

        ctx.font = '400 22px "Plus Jakarta Sans", sans-serif';
        ctx.fillStyle = '#94A3B8';
        const tagline = 'The world is the textbook.';
        const tagW = ctx.measureText(tagline).width;
        ctx.fillText(tagline, CARD_W - margin - tagW, footerY);

        setIsRendered(true);
      };

      img.onerror = () => {
        if (!usedFallback) {
          loadAndRender(DEMO_FALLBACK_SVG_DATA_URI, true);
        }
      };

      img.src = src;
    };

    loadAndRender(imageSrc);

    return () => {
      cancelled = true;
    };
  }, [concept, explanationText, imageSrc]);

  const handleDownload = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dataUrl = canvas.toDataURL('image/png');
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = `seemath-${concept.id}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setStatusMessage('Share card saved as PNG.');
  };

  const handleWebShare = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    try {
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob((b) => resolve(b), 'image/png')
      );
      if (!blob) {
        handleDownload();
        return;
      }

      const file = new File([blob], `seemath-${concept.id}.png`, { type: 'image/png' });
      const safeTitle = sanitizePublicText(concept.title);
      const safeEquation = sanitizePublicText(concept.equation);
      const safeExplanation = sanitizePublicText(explanationText);
      const shareData: ShareData = {
        title: `${safeTitle} — SeeMathEverywhere`,
        text: `${safeTitle} (${safeEquation}): ${safeExplanation} — Discovered with SeeMathEverywhere`,
      };

      if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
        await navigator.share({ ...shareData, files: [file] });
        setStatusMessage('Shared successfully.');
      } else if (typeof navigator.share === 'function') {
        await navigator.share(shareData);
        setStatusMessage('Shared link details. Tap Download PNG to save the image card.');
      } else {
        handleDownload();
      }
    } catch (err) {
      const domErr = err as DOMException | undefined;
      if (domErr?.name === 'AbortError') return;
      handleDownload();
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="share-card-heading"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm overflow-y-auto"
    >
      <div className="my-auto w-full max-w-md rounded-2xl border border-slate-800 bg-[#0B1222] p-5 shadow-2xl">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2
              id="share-card-heading"
              className="font-display text-lg font-semibold text-white"
            >
              Shareable Discovery Card
            </h2>
            <p className="text-xs text-slate-400">Generated locally in your browser</p>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close share card dialog"
            className="flex min-h-[44px] min-w-[44px] -mr-2 items-center justify-center rounded-xl text-slate-400 transition-colors hover:bg-slate-800 hover:text-white focus-visible:outline-2 focus-visible:outline-cyan-400"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        {/* Canvas Preview */}
        <div className="mt-4 overflow-hidden rounded-xl border border-slate-800 bg-[#060B16]">
          <canvas
            ref={canvasRef}
            data-testid="share-card-canvas"
            aria-label={`Shareable result card preview for ${concept.title}`}
            className="block h-auto w-full"
          />
        </div>

        {statusMessage && (
          <p
            role="status"
            aria-live="polite"
            className="mt-3 flex items-center gap-1.5 text-xs font-medium text-cyan-300"
          >
            <Check className="h-4 w-4 shrink-0" aria-hidden="true" />
            {statusMessage}
          </p>
        )}

        <div className="mt-4 flex flex-col gap-2.5 sm:flex-row">
          {canWebShare && (
            <button
              type="button"
              disabled={!isRendered}
              onClick={() => void handleWebShare()}
              className="inline-flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-xl bg-cyan-400 px-4 py-2.5 text-sm font-semibold text-slate-950 transition-colors hover:bg-cyan-300 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300 whitespace-nowrap shrink-0"
            >
              <Share2 className="h-4 w-4 shrink-0" aria-hidden="true" />
              Share Card
            </button>
          )}

          <button
            type="button"
            disabled={!isRendered}
            onClick={handleDownload}
            className={`inline-flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400 whitespace-nowrap shrink-0 ${
              canWebShare
                ? 'border border-slate-700 bg-slate-900 text-white hover:border-slate-500 hover:bg-slate-800'
                : 'bg-cyan-400 text-slate-950 hover:bg-cyan-300'
            }`}
          >
            <Download className="h-4 w-4 shrink-0" aria-hidden="true" />
            Download PNG
          </button>
        </div>
      </div>
    </div>
  );
};
