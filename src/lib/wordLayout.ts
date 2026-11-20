import type { AggregatedWord, CloudTheme } from '../types/session';

export interface PlacedWord {
  key: string;
  text: string;
  count: number;
  x: number;
  y: number;
  fontSize: number;
  rotate: number;
  color: string;
  fontWeight: number;
  width: number;
  height: number;
}

export interface ThemeSpec {
  id: CloudTheme;
  label: string;
  background: string;
  surface: string;
  textPrimary: string;
  textMuted: string;
  isDark: boolean;
  palette: string[];
}

export const CLOUD_THEMES: Record<CloudTheme, ThemeSpec> = {
  editorial: {
    id: 'editorial',
    label: 'Editorial Ink',
    background: '#FFFFFF',
    surface: '#F8FAFC',
    textPrimary: '#0F172A',
    textMuted: '#64748B',
    isDark: false,
    palette: ['#0F172A', '#1D4ED8', '#0369A1', '#334155', '#0F766E', '#4338CA'],
  },
  cobalt: {
    id: 'cobalt',
    label: 'Cobalt Studio',
    background: '#FFFFFF',
    surface: '#EFF6FF',
    textPrimary: '#0F172A',
    textMuted: '#475569',
    isDark: false,
    palette: ['#1E3A8A', '#1D4ED8', '#2563EB', '#0284C7', '#0F172A', '#3B82F6'],
  },
  botanical: {
    id: 'botanical',
    label: 'Sage & Slate',
    background: '#FFFFFF',
    surface: '#F0FDF4',
    textPrimary: '#0F172A',
    textMuted: '#475569',
    isDark: false,
    palette: ['#14532D', '#15803D', '#0F766E', '#3F6212', '#1E293B', '#047857'],
  },
  obsidian: {
    id: 'obsidian',
    label: 'Projector Dark',
    background: '#0B0F17',
    surface: '#111827',
    textPrimary: '#F8FAFC',
    textMuted: '#94A3B8',
    isDark: true,
    palette: ['#F8FAFC', '#60A5FA', '#34D399', '#FBBF24', '#93C5FD', '#E2E8F0'],
  },
};

function hashString(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

interface Box {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

function boxesOverlap(a: Box, b: Box): boolean {
  return !(a.x2 <= b.x1 || a.x1 >= b.x2 || a.y2 <= b.y1 || a.y1 >= b.y2);
}

let measureCtx: CanvasRenderingContext2D | null = null;
function getMeasureCtx(): CanvasRenderingContext2D | null {
  if (typeof document === 'undefined') return null;
  if (!measureCtx) {
    const canvas = document.createElement('canvas');
    measureCtx = canvas.getContext('2d');
  }
  return measureCtx;
}

function measureWord(
  text: string,
  fontSize: number,
  fontWeight: number
): { width: number; height: number } {
  const ctx = getMeasureCtx();
  if (!ctx) {
    return { width: text.length * fontSize * 0.58, height: fontSize * 1.15 };
  }
  ctx.font = `${fontWeight} ${fontSize}px "Bricolage Grotesque", "Plus Jakarta Sans", sans-serif`;
  const metrics = ctx.measureText(text);
  const width = Math.max(metrics.width, fontSize * 0.7);
  const height = fontSize * 1.12;
  return { width, height };
}

export function computeWordCloudLayout(
  words: AggregatedWord[],
  themeId: CloudTheme,
  stageWidth = 960,
  stageHeight = 520,
  allowRotation = true
): PlacedWord[] {
  if (words.length === 0) return [];

  const theme = CLOUD_THEMES[themeId] || CLOUD_THEMES.editorial;
  const maxWords = words.slice(0, 75);
  const counts = maxWords.map((w) => w.count);
  const minCount = Math.min(...counts);
  const maxCount = Math.max(...counts);

  const minFont = maxWords.length > 35 ? 16 : 20;
  const maxFont = maxWords.length === 1 ? 76 : maxWords.length < 8 ? 68 : 62;

  const placed: PlacedWord[] = [];
  const boxes: Box[] = [];
  const cx = stageWidth / 2;
  const cy = stageHeight / 2;

  maxWords.forEach((word, idx) => {
    const t =
      maxCount === minCount
        ? idx === 0
          ? 0.85
          : 0.65
        : (word.count - minCount) / (maxCount - minCount);
    // Non-linear boost so top words stand out clearly
    const fontSize = Math.round(minFont + Math.pow(t, 0.78) * (maxFont - minFont));
    const fontWeight = t > 0.55 ? 700 : 600;
    const h = hashString(word.key);
    const color = theme.palette[idx === 0 ? 0 : h % theme.palette.length];

    // Only rotate occasional short words (<= 9 chars) after top 2 words
    const rotate =
      allowRotation && idx >= 2 && word.text.length <= 9 && h % 5 === 0 ? -90 : 0;

    let currentFontSize = fontSize;
    let placedSuccessfully = false;

    for (let shrinkAttempt = 0; shrinkAttempt < 4 && !placedSuccessfully; shrinkAttempt++) {
      const measured = measureWord(word.text, currentFontSize, fontWeight);
      const padX = Math.max(10, currentFontSize * 0.22);
      const padY = Math.max(6, currentFontSize * 0.14);

      const boxW = (rotate === 0 ? measured.width : measured.height) + padX * 2;
      const boxH = (rotate === 0 ? measured.height : measured.width) + padY * 2;

      const startAngle = (h % 360) * (Math.PI / 180);
      const maxSteps = 900;
      const stepAngle = 0.22;
      const spiralB = 4.2;

      for (let step = 0; step < maxSteps; step++) {
        const theta = startAngle + step * stepAngle;
        const radius = spiralB * (step * stepAngle);
        const x = cx + radius * Math.cos(theta) * 1.35;
        const y = cy + radius * Math.sin(theta) * 0.82;

        const candidate: Box = {
          x1: x - boxW / 2,
          y1: y - boxH / 2,
          x2: x + boxW / 2,
          y2: y + boxH / 2,
        };

        if (
          candidate.x1 < 16 ||
          candidate.x2 > stageWidth - 16 ||
          candidate.y1 < 16 ||
          candidate.y2 > stageHeight - 16
        ) {
          continue;
        }

        let collision = false;
        for (let j = 0; j < boxes.length; j++) {
          if (boxesOverlap(candidate, boxes[j])) {
            collision = true;
            break;
          }
        }

        if (!collision) {
          boxes.push(candidate);
          placed.push({
            key: word.key,
            text: word.text,
            count: word.count,
            x,
            y,
            fontSize: currentFontSize,
            rotate,
            color,
            fontWeight,
            width: measured.width,
            height: measured.height,
          });
          placedSuccessfully = true;
          break;
        }
      }

      currentFontSize = Math.max(13, Math.round(currentFontSize * 0.82));
    }
  });

  return placed;
}

export function exportSvgToPng(
  svgElement: SVGSVGElement,
  filename: string,
  backgroundColor: string
) {
  const serializer = new XMLSerializer();
  const cloned = svgElement.cloneNode(true) as SVGSVGElement;
  cloned.setAttribute('xmlns', 'http://www.w3.org/2000/svg');

  const width = 1920;
  const height = 1040;
  cloned.setAttribute('width', String(width));
  cloned.setAttribute('height', String(height));

  const svgStr = serializer.serializeToString(cloned);
  const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = backgroundColor;
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);
      const pngUrl = canvas.toDataURL('image/png');
      const link = document.createElement('a');
      link.download = filename;
      link.href = pngUrl;
      link.click();
    }
    URL.revokeObjectURL(url);
  };
  img.src = url;
}
