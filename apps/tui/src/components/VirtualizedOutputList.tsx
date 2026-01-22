/**
 * VirtualizedOutputList Component
 * Efficiently renders large lists of output lines using windowing/virtualization
 * Only renders visible lines + buffer to maintain performance with 10k+ lines
 *
 * Implementation notes:
 * - Custom solution built for OpenTUI (no existing virtualization libraries)
 * - Uses fixed-height estimation with spacers to maintain scroll position
 * - Polling-based scroll tracking (OpenTUI scrollbox doesn't emit reliable events)
 * - Buffer zone reduces flickering during rapid scrolling
 */

import { useMemo, useState, useEffect, useRef } from 'react';
import { OutputLine } from './OutputLine';
import type { OutputLine as OutputLineType } from '../types';

interface VirtualizedOutputListProps {
  lines: OutputLineType[];
  width: number;
  height: number;
  scrollBoxRef: React.RefObject<any>;
}

// Configuration - tuned for terminal rendering performance
const ESTIMATED_LINE_HEIGHT = 1.5; // Average lines per output (includes multi-line messages)
const BUFFER_SIZE = 100; // Extra lines to render above/below viewport (larger buffer = smoother scroll)
const SCROLL_POLL_INTERVAL = 50; // Poll scroll position every 50ms (20fps)
const VIRTUALIZATION_THRESHOLD = 100; // Only virtualize if more than this many lines

export function VirtualizedOutputList({
  lines,
  width,
  height,
  scrollBoxRef,
}: VirtualizedOutputListProps) {
  const [scrollTop, setScrollTop] = useState(0);
  const lastScrollTopRef = useRef(0);

  // Track scroll position changes via polling
  // OpenTUI's scrollbox doesn't reliably emit scroll events, so we poll
  useEffect(() => {
    const scrollBox = scrollBoxRef.current;
    if (!scrollBox) return;

    // Initial scroll position
    const initialScroll = scrollBox.scrollTop || 0;
    setScrollTop(initialScroll);
    lastScrollTopRef.current = initialScroll;

    // Poll for scroll position changes
    const pollInterval = setInterval(() => {
      const currentScroll = scrollBox.scrollTop || 0;
      if (currentScroll !== lastScrollTopRef.current) {
        lastScrollTopRef.current = currentScroll;
        setScrollTop(currentScroll);
      }
    }, SCROLL_POLL_INTERVAL);

    return () => {
      clearInterval(pollInterval);
    };
  }, [scrollBoxRef]);

  // Calculate visible range with virtualization
  const { startIndex, endIndex, topSpacerHeight, bottomSpacerHeight, visibleLines } = useMemo(() => {
    const totalLines = lines.length;

    // Skip virtualization for small lists (overhead not worth it)
    if (totalLines <= VIRTUALIZATION_THRESHOLD) {
      return {
        startIndex: 0,
        endIndex: totalLines,
        topSpacerHeight: 0,
        bottomSpacerHeight: 0,
        visibleLines: lines,
      };
    }

    // Calculate visible range based on scroll position and viewport
    const viewportLines = Math.ceil(height / ESTIMATED_LINE_HEIGHT);
    const scrolledLines = Math.floor(scrollTop / ESTIMATED_LINE_HEIGHT);

    // Determine render window with buffer
    // Buffer extends both above and below visible area for smooth scrolling
    const start = Math.max(0, scrolledLines - BUFFER_SIZE);
    const end = Math.min(totalLines, scrolledLines + viewportLines + BUFFER_SIZE);

    // Calculate spacer heights to maintain correct scroll position
    // These invisible boxes fill the space of unrendered lines
    const topHeight = Math.floor(start * ESTIMATED_LINE_HEIGHT);
    const bottomHeight = Math.floor((totalLines - end) * ESTIMATED_LINE_HEIGHT);

    return {
      startIndex: start,
      endIndex: end,
      topSpacerHeight: topHeight,
      bottomSpacerHeight: bottomHeight,
      visibleLines: lines.slice(start, end),
    };
  }, [lines, height, scrollTop]);

  return (
    <>
      {/* Top spacer - maintains scroll position for unrendered lines above viewport */}
      {topSpacerHeight > 0 && (
        <box height={topSpacerHeight} width={width} />
      )}

      {/* Render visible lines + buffer zone */}
      {visibleLines.map((line, index) => (
        <OutputLine key={startIndex + index} line={line} />
      ))}

      {/* Bottom spacer - maintains scroll position for unrendered lines below viewport */}
      {bottomSpacerHeight > 0 && (
        <box height={bottomSpacerHeight} width={width} />
      )}

      {/* Debug info (only visible when lots of lines are hidden) */}
      {startIndex > 0 && lines.length > VIRTUALIZATION_THRESHOLD && (
        <box width={width} height={0} />
      )}
    </>
  );
}
