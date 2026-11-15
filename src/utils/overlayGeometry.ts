import type { ConceptCategory, ConceptOverlay, OverlayPoint } from '../types/concepts.ts';

export interface PixelPoint {
  x: number;
  y: number;
  label?: string;
}

export interface OverlayPalette {
  stroke: string;
  fill: string;
  glow: string;
  badgeBg: string;
  badgeText: string;
}

export function getCategoryPalette(category: ConceptCategory): OverlayPalette {
  if (category === 'Physics') {
    return {
      stroke: '#F59E0B', // Warm amber
      fill: 'rgba(245, 158, 11, 0.16)',
      glow: 'rgba(245, 158, 11, 0.45)',
      badgeBg: 'rgba(15, 23, 42, 0.9)',
      badgeText: '#FCD34D',
    };
  }
  return {
    stroke: '#22D3EE', // Electric cyan
    fill: 'rgba(34, 211, 238, 0.15)',
    glow: 'rgba(34, 211, 238, 0.45)',
    badgeBg: 'rgba(15, 23, 42, 0.9)',
    badgeText: '#67E8F9',
  };
}

export function toPixelPoints(
  points: OverlayPoint[],
  width: number,
  height: number
): PixelPoint[] {
  return points.map((pt) => ({
    x: pt.x * width,
    y: pt.y * height,
    label: pt.label,
  }));
}

export function computeArrowHead(
  from: PixelPoint,
  to: PixelPoint,
  headLength = 14,
  headAngleRad = Math.PI / 6
): [PixelPoint, PixelPoint] {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  return [
    {
      x: to.x - headLength * Math.cos(angle - headAngleRad),
      y: to.y - headLength * Math.sin(angle - headAngleRad),
    },
    {
      x: to.x - headLength * Math.cos(angle + headAngleRad),
      y: to.y - headLength * Math.sin(angle + headAngleRad),
    },
  ];
}

export function computeBoundingBox(points: PixelPoint[]): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
} {
  if (points.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
  }
  let minX = points[0].x;
  let minY = points[0].y;
  let maxX = points[0].x;
  let maxY = points[0].y;

  for (const pt of points) {
    if (pt.x < minX) minX = pt.x;
    if (pt.y < minY) minY = pt.y;
    if (pt.x > maxX) maxX = pt.x;
    if (pt.y > maxY) maxY = pt.y;
  }

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: Math.max(24, maxX - minX),
    height: Math.max(24, maxY - minY),
  };
}

export function computeAngleArcPath(
  p1: PixelPoint,
  vertex: PixelPoint,
  p2: PixelPoint,
  radius = 34
): string {
  const a1 = Math.atan2(p1.y - vertex.y, p1.x - vertex.x);
  const a2 = Math.atan2(p2.y - vertex.y, p2.x - vertex.x);

  let diff = a2 - a1;
  while (diff <= -Math.PI) diff += Math.PI * 2;
  while (diff > Math.PI) diff -= Math.PI * 2;

  const sweepFlag = diff >= 0 ? 1 : 0;
  const startX = vertex.x + radius * Math.cos(a1);
  const startY = vertex.y + radius * Math.sin(a1);
  const endX = vertex.x + radius * Math.cos(a2);
  const endY = vertex.y + radius * Math.sin(a2);

  return `M ${startX.toFixed(1)} ${startY.toFixed(1)} A ${radius} ${radius} 0 0 ${sweepFlag} ${endX.toFixed(1)} ${endY.toFixed(1)}`;
}

/**
 * Renders a concept overlay onto a 2D Canvas context (used for generating downloadable Share Cards).
 */
export function drawOverlayOnCanvas(
  ctx: CanvasRenderingContext2D,
  overlay: ConceptOverlay,
  category: ConceptCategory,
  boxX: number,
  boxY: number,
  boxWidth: number,
  boxHeight: number
): void {
  const palette = getCategoryPalette(category);
  const pts = overlay.points.map((p) => ({
    x: boxX + p.x * boxWidth,
    y: boxY + p.y * boxHeight,
    label: p.label,
  }));

  if (pts.length === 0) return;

  ctx.save();
  ctx.strokeStyle = palette.stroke;
  ctx.fillStyle = palette.fill;
  ctx.lineWidth = Math.max(3, boxWidth * 0.0045);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.shadowColor = palette.glow;
  ctx.shadowBlur = 12;

  const drawArrow = (from: PixelPoint, to: PixelPoint) => {
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();

    const [h1, h2] = computeArrowHead(from, to, Math.max(14, boxWidth * 0.022));
    ctx.beginPath();
    ctx.moveTo(h1.x, h1.y);
    ctx.lineTo(to.x, to.y);
    ctx.lineTo(h2.x, h2.y);
    ctx.stroke();
  };

  switch (overlay.type) {
    case 'line':
    case 'path': {
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) {
        ctx.lineTo(pts[i].x, pts[i].y);
      }
      ctx.stroke();
      break;
    }

    case 'ray':
    case 'vector': {
      for (let i = 0; i < pts.length - 1; i++) {
        drawArrow(pts[i], pts[i + 1]);
      }
      break;
    }

    case 'angle': {
      if (pts.length >= 3) {
        const [p1, v, p2] = pts;
        // Normal reference line
        const bisector = Math.atan2(
          (p1.y - v.y) + (p2.y - v.y),
          (p1.x - v.x) + (p2.x - v.x)
        );
        ctx.save();
        ctx.setLineDash([7, 6]);
        ctx.lineWidth = Math.max(2, boxWidth * 0.0028);
        ctx.strokeStyle = 'rgba(226, 232, 240, 0.78)';
        ctx.beginPath();
        ctx.moveTo(v.x, v.y);
        ctx.lineTo(v.x + Math.cos(bisector) * (boxWidth * 0.13), v.y + Math.sin(bisector) * (boxWidth * 0.13));
        ctx.stroke();
        ctx.restore();

        drawArrow(p1, v);
        drawArrow(v, p2);

        const a1 = Math.atan2(p1.y - v.y, p1.x - v.x);
        const a2 = Math.atan2(p2.y - v.y, p2.x - v.x);
        let diff = a2 - a1;
        while (diff <= -Math.PI) diff += Math.PI * 2;
        while (diff > Math.PI) diff -= Math.PI * 2;
        ctx.beginPath();
        ctx.arc(v.x, v.y, Math.max(28, boxWidth * 0.045), a1, a1 + diff, diff < 0);
        ctx.stroke();
      }
      break;
    }

    case 'triangle': {
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) {
        ctx.lineTo(pts[i].x, pts[i].y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
    }

    case 'grid': {
      const bbox = computeBoundingBox(pts);
      ctx.fillRect(bbox.minX, bbox.minY, bbox.width, bbox.height);
      ctx.strokeRect(bbox.minX, bbox.minY, bbox.width, bbox.height);
      ctx.save();
      ctx.lineWidth = Math.max(1.5, boxWidth * 0.002);
      ctx.globalAlpha = 0.72;
      const cols = 4;
      const rows = 4;
      for (let c = 1; c < cols; c++) {
        const gx = bbox.minX + (bbox.width * c) / cols;
        ctx.beginPath();
        ctx.moveTo(gx, bbox.minY);
        ctx.lineTo(gx, bbox.minY + bbox.height);
        ctx.stroke();
      }
      for (let r = 1; r < rows; r++) {
        const gy = bbox.minY + (bbox.height * r) / rows;
        ctx.beginPath();
        ctx.moveTo(bbox.minX, gy);
        ctx.lineTo(bbox.minX + bbox.width, gy);
        ctx.stroke();
      }
      ctx.restore();
      break;
    }

    case 'region':
    default: {
      if (pts.length === 2) {
        const bbox = computeBoundingBox(pts);
        ctx.fillRect(bbox.minX, bbox.minY, bbox.width, bbox.height);
        ctx.strokeRect(bbox.minX, bbox.minY, bbox.width, bbox.height);
      } else {
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) {
          ctx.lineTo(pts[i].x, pts[i].y);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
      break;
    }
  }

  // Vertex anchor points and readable labels
  ctx.shadowBlur = 0;
  const fontSize = Math.max(16, Math.round(boxWidth * 0.022));
  ctx.font = `600 ${fontSize}px "Plus Jakarta Sans", sans-serif`;

  for (const pt of pts) {
    ctx.beginPath();
    ctx.fillStyle = '#060B16';
    ctx.arc(pt.x, pt.y, Math.max(5, boxWidth * 0.007), 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = Math.max(2.5, boxWidth * 0.0035);
    ctx.strokeStyle = palette.stroke;
    ctx.stroke();

    if (pt.label) {
      const paddingX = 10;
      const paddingY = 6;
      const textWidth = ctx.measureText(pt.label).width;
      const badgeW = textWidth + paddingX * 2;
      const badgeH = fontSize + paddingY * 2;
      const lx = Math.min(
        boxX + boxWidth - badgeW - 8,
        Math.max(boxX + 8, pt.x - badgeW / 2)
      );
      const ly =
        pt.y - badgeH - 12 > boxY + 8 ? pt.y - badgeH - 12 : pt.y + 12;

      ctx.fillStyle = palette.badgeBg;
      ctx.beginPath();
      ctx.roundRect(lx, ly, badgeW, badgeH, 8);
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = palette.stroke;
      ctx.stroke();

      ctx.fillStyle = palette.badgeText;
      ctx.textBaseline = 'middle';
      ctx.fillText(pt.label, lx + paddingX, ly + badgeH / 2 + 1);
    }
  }

  ctx.restore();
}
