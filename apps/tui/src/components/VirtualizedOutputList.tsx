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

import { useMemo, useState, useEffect, useRef, useCallback } from 'react';
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

  // Track actual rendered heights for more accurate virtualization
  const itemHeights = useRef<Map<number, number>>(new Map());
  const measureRefs = useRef<Map<number, HTMLElement>>(new Map());

  // Measure callback for tracking actual heights
  const setMeasureRef = useCallback((index: number, element: HTMLElement | null) => {
    if (element) {
      measureRefs.current.set(index, element);
      const height = element.getBoundingClientRect?.()?.height;
      if (height && height > 0) {
        itemHeights.current.set(index, height);
      }
    } else {
      measureRefs.current.delete(index);
    }
  }, []);

  // Calculate total height from actual measurements
  const getTotalHeight = useCallback(() => {
    let total = 0;
    for (let i = 0; i < lines.length; i++) {
      total += itemHeights.current.get(i) || ESTIMATED_LINE_HEIGHT;
    }
    return total;
  }, [lines.length]);

  // Track scroll position changes
  // Try event listener first, fall back to polling for OpenTUI compatibility
  useEffect(() => {
    const scrollBox = scrollBoxRef.current;
    if (!scrollBox) return;

    // Initial scroll position
    const initialScroll = scrollBox.scrollTop || 0;
    setScrollTop(initialScroll);
    lastScrollTopRef.current = initialScroll;

    const handleScroll = () => {
      const currentScroll = scrollBox.scrollTop || 0;
      if (currentScroll !== lastScrollTopRef.current) {
        lastScrollTopRef.current = currentScroll;
        setScrollTop(currentScroll);
      }
    };

    // Try event listener first (for better performance if supported)
    if (scrollBox.addEventListener) {
      scrollBox.addEventListener('scroll', handleScroll, { passive: true });
      return () => scrollBox.removeEventListener('scroll', handleScroll);
    } else {
      // Fallback: polling for OpenTUI compatibility
      const pollInterval = setInterval(handleScroll, SCROLL_POLL_INTERVAL);
      return () => clearInterval(pollInterval);
    }
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

    // Calculate spacer heights using actual measured heights when available
    // These invisible boxes fill the space of unrendered lines
    let topHeight = 0;
    for (let i = 0; i < start; i++) {
      topHeight += itemHeights.current.get(i) || ESTIMATED_LINE_HEIGHT;
    }

    let bottomHeight = 0;
    for (let i = end; i < totalLines; i++) {
      bottomHeight += itemHeights.current.get(i) || ESTIMATED_LINE_HEIGHT;
    }

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

      {/* Render visible lines + buffer zone with height measurement */}
      {visibleLines.map((line, index) => {
        const actualIndex = startIndex + index;
        return (
          <box key={actualIndex} ref={(el: any) => setMeasureRef(actualIndex, el)}>
            <OutputLine line={line} />
          </box>
        );
      })}

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
