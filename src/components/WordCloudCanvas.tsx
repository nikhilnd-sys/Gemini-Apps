import React, { useMemo, useRef, useState } from 'react';
import { Download, RotateCw } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import type { AggregatedWord, CloudTheme } from '../types/session';
import {
  CLOUD_THEMES,
  computeWordCloudLayout,
  exportSvgToPng,
} from '../lib/wordLayout';

interface WordCloudCanvasProps {
  words: AggregatedWord[];
  totalResponses: number;
  theme: CloudTheme;
  title: string;
  compact?: boolean;
  onWordClick?: (word: AggregatedWord) => void;
  showExport?: boolean;
}

export const WordCloudCanvas: React.FC<WordCloudCanvasProps> = ({
  words,
  totalResponses,
  theme,
  title,
  compact = false,
  onWordClick,
  showExport = true,
}) => {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const [allowRotation, setAllowRotation] = useState<boolean>(true);

  const spec = CLOUD_THEMES[theme] || CLOUD_THEMES.editorial;

  const placedWords = useMemo(
    () => computeWordCloudLayout(words, theme, 960, 520, allowRotation),
    [words, theme, allowRotation]
  );

  const hoveredWord = useMemo(
    () => words.find((w) => w.key === hoveredKey) || null,
    [words, hoveredKey]
  );

  const handleExportPng = () => {
    if (!svgRef.current) return;
    const slug = (title || 'word-cloud')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    exportSvgToPng(svgRef.current, `${slug || 'lexicon-live'}.png`, spec.background);
  };

  return (
    <div
      className="relative flex flex-col justify-between overflow-hidden rounded-xl border transition-colors duration-200"
      style={{
        backgroundColor: spec.background,
        borderColor: spec.isDark ? 'rgba(148, 163, 184, 0.2)' : '#E2E8F0',
      }}
    >
      <div className={compact ? 'p-3' : 'p-4 sm:p-6'}>
        {words.length === 0 ? (
          <div
            className="flex flex-col items-center justify-center text-center"
            style={{ minHeight: compact ? '240px' : '380px' }}
          >
            <svg
              width="56"
              height="56"
              viewBox="0 0 56 56"
              fill="none"
              aria-hidden="true"
              className="mb-4 opacity-40"
            >
              <rect
                x="6"
                y="14"
                width="26"
                height="8"
                rx="4"
                fill={spec.textMuted}
              />
              <rect
                x="14"
                y="26"
                width="36"
                height="9"
                rx="4.5"
                fill={spec.palette[1]}
              />
              <rect
                x="8"
                y="39"
                width="22"
                height="7"
                rx="3.5"
                fill={spec.textMuted}
              />
            </svg>
            <p
              className="font-display text-lg font-semibold"
              style={{ color: spec.textPrimary }}
            >
              Waiting for the first response
            </p>
            <p
              className="mt-1.5 max-w-sm text-sm leading-relaxed"
              style={{ color: spec.textMuted }}
            >
              Participants can scan the QR code with their mobile camera or enter the join code to populate the live word cloud.
            </p>
          </div>
        ) : (
          <div className="w-full overflow-hidden">
            <svg
              ref={svgRef}
              viewBox="0 0 960 520"
              role="img"
              aria-label={`Word cloud for ${title} with ${words.length} unique terms`}
              className="h-auto w-full select-none"
            >
              <AnimatePresence>
                {placedWords.map((item) => {
                  const isHovered = hoveredKey === item.key;
                  const isDimmed = hoveredKey !== null && !isHovered;

                  return (
                    <motion.g
                      key={item.key}
                      initial={{ opacity: 0, scale: 0.72 }}
                      animate={{
                        opacity: isDimmed ? 0.32 : 1,
                        scale: isHovered ? 1.06 : 1,
                      }}
                      exit={{ opacity: 0, scale: 0.72 }}
                      transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                      style={{
                        transformOrigin: `${item.x}px ${item.y}px`,
                        cursor: onWordClick ? 'pointer' : 'default',
                      }}
                      onMouseEnter={() => setHoveredKey(item.key)}
                      onMouseLeave={() => setHoveredKey(null)}
                      onClick={() => {
                        if (onWordClick) {
                          const found = words.find((w) => w.key === item.key);
                          if (found) onWordClick(found);
                        }
                      }}
                    >
                      <text
                        x={item.x}
                        y={item.y}
                        textAnchor="middle"
                        dominantBaseline="central"
                        transform={
                          item.rotate !== 0
                            ? `rotate(${item.rotate}, ${item.x}, ${item.y})`
                            : undefined
                        }
                        fill={item.color}
                        fontSize={item.fontSize}
                        fontWeight={item.fontWeight}
                        fontFamily='"Bricolage Grotesque", "Plus Jakarta Sans", sans-serif'
                      >
                        {item.text}
                      </text>
                    </motion.g>
                  );
                })}
              </AnimatePresence>
            </svg>
          </div>
        )}
      </div>

      {/* Clean unboxed footer bar inside canvas */}
      <div
        className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-2.5 text-xs"
        style={{
          borderColor: spec.isDark ? 'rgba(148, 163, 184, 0.16)' : '#F1F5F9',
          color: spec.textMuted,
        }}
      >
        <div className="flex items-center gap-2 tabular-nums">
          {hoveredWord ? (
            <>
              <span className="font-semibold" style={{ color: spec.textPrimary }}>
                {hoveredWord.text}
              </span>
              <span aria-hidden="true">·</span>
              <span>
                {hoveredWord.count} {hoveredWord.count === 1 ? 'mention' : 'mentions'}
              </span>
              <span aria-hidden="true">·</span>
              <span>
                {totalResponses > 0
                  ? `${Math.round((hoveredWord.count / totalResponses) * 100)}% of total`
                  : '0%'}
              </span>
            </>
          ) : (
            <>
              <span>{totalResponses} responses</span>
              <span aria-hidden="true">·</span>
              <span>{words.length} unique terms</span>
            </>
          )}
        </div>

        {showExport && words.length > 0 && (
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setAllowRotation((v) => !v)}
              className="inline-flex min-h-[32px] items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 hover:opacity-80 focus-visible:outline-2 focus-visible:outline-blue-700"
              style={{ color: spec.textPrimary }}
              title="Toggle vertical word placement"
            >
              <RotateCw className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{allowRotation ? 'Mixed orientation' : 'Horizontal only'}</span>
            </button>
            <button
              type="button"
              onClick={handleExportPng}
              className="inline-flex min-h-[32px] items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 hover:opacity-80 focus-visible:outline-2 focus-visible:outline-blue-700"
              style={{ color: spec.textPrimary }}
            >
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Export PNG</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
