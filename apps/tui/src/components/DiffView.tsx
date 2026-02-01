/**
 * DiffView Component
 * Renders structured file diffs with line numbers, colored hunks, and stats.
 *
 * Visual layout (edit):
 *   ● Edit(filename.ts)          +3/-2    234ms
 *   @@ -10,7 +10,8 @@
 *    10 │  10 │   const foo = "bar";
 *    11 │     │ - const old = true;
 *       │  11 │ + const new = false;
 *    12 │  13 │   return foo;
 *   ... 3 more hunks (15 lines)
 *
 * Visual layout (create):
 *   ● Create(newfile.ts)         +42 lines  96ms
 *     1 │ + import { foo } from "bar";
 *     2 │ + export function hello() {
 *   ... 12 more lines
 */

import { MetadataCalculator } from "../services/MetadataCalculator";
import { OneDarkPro } from "../styles/theme";
import type { DiffHunk, DiffLine, FileDiffData } from "../types";

interface DiffViewProps {
  diffData: FileDiffData;
  duration?: number;
  maxHunks?: number;
}

/** Pad a number to a given width, right-aligned */
function pad(n: number | undefined, width: number): string {
  if (n === undefined) return " ".repeat(width);
  const s = String(n);
  return s.length >= width ? s : " ".repeat(width - s.length) + s;
}

/** Compute the gutter width needed for a set of hunks */
function gutterWidth(hunks: DiffHunk[]): number {
  let maxLine = 0;
  for (const hunk of hunks) {
    maxLine = Math.max(
      maxLine,
      hunk.oldStart + hunk.oldLines,
      hunk.newStart + hunk.newLines,
    );
  }
  return Math.max(String(maxLine).length, 2);
}

function DiffLineRow({
  line,
  gw,
}: {
  line: DiffLine;
  gw: number;
}) {
  const { diff } = OneDarkPro;
  const oldNum = pad(line.oldLineNumber, gw);
  const newNum = pad(line.newLineNumber, gw);
  const sep = "\u2502"; // │

  let prefix: string;
  let fg: string;
  let bg: string | undefined;

  switch (line.type) {
    case "add":
      prefix = "+";
      fg = diff.addedFg;
      bg = diff.addedBg;
      break;
    case "remove":
      prefix = "-";
      fg = diff.removedFg;
      bg = diff.removedBg;
      break;
    default:
      prefix = " ";
      fg = diff.contextFg;
      bg = undefined;
      break;
  }

  return (
    <box flexDirection="row" backgroundColor={bg}>
      <text fg={diff.gutterFg}>
        {oldNum} {sep} {newNum} {sep}{" "}
      </text>
      <text fg={fg}>
        {prefix} {line.content}
      </text>
    </box>
  );
}

function HunkHeader({ hunk }: { hunk: DiffHunk }) {
  const { diff } = OneDarkPro;
  return (
    <text fg={diff.hunkSeparatorFg}>
      @@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@
    </text>
  );
}

function CreateLineRow({
  lineNumber,
  content,
  gw,
}: {
  lineNumber: number;
  content: string;
  gw: number;
}) {
  const { diff } = OneDarkPro;
  const num = pad(lineNumber, gw);
  const sep = "\u2502"; // │

  return (
    <box flexDirection="row" backgroundColor={diff.addedBg}>
      <text fg={diff.gutterFg}>
        {num} {sep}{" "}
      </text>
      <text fg={diff.addedFg}>
        + {content}
      </text>
    </box>
  );
}

export function DiffView({
  diffData,
  duration,
  maxHunks = 4,
}: DiffViewProps) {
  const { diff } = OneDarkPro;
  const { operation, fileName, stats, hunks, newFilePreview, previewTruncated } =
    diffData;

  // --- Header ---
  const opLabel = operation === "create" ? "Create" : "Edit";
  const durationStr = duration
    ? `  ${MetadataCalculator.formatDuration(duration)}`
    : "";

  let statsStr: string;
  if (operation === "create") {
    statsStr = `+${stats.additions} lines`;
  } else {
    statsStr = `+${stats.additions}/-${stats.deletions}`;
  }

  // --- Create mode ---
  if (operation === "create" && newFilePreview) {
    const gw = Math.max(String(newFilePreview.length).length, 2);
    const totalLines = stats.totalLines ?? newFilePreview.length;
    const remaining = totalLines - newFilePreview.length;

    return (
      <box flexDirection="column" marginTop={1}>
        <box flexDirection="row">
          <text fg={diff.headerFg}>
            {"● "}
            {opLabel}({fileName})
          </text>
          <text fg={diff.statsAddFg}>{"  "}{statsStr}</text>
          <text fg={diff.gutterFg}>{durationStr}</text>
        </box>

        {newFilePreview.map((content, i) => (
          <CreateLineRow
            key={i}
            lineNumber={i + 1}
            content={content}
            gw={gw}
          />
        ))}

        {(previewTruncated || remaining > 0) && (
          <text fg={diff.truncationFg}>
            {"  "}... {remaining} more lines
          </text>
        )}
      </box>
    );
  }

  // --- Edit mode ---
  // Summary-only for very large files (empty hunks)
  if (hunks.length === 0) {
    return (
      <box flexDirection="column" marginTop={1}>
        <box flexDirection="row">
          <text fg={diff.headerFg}>
            {"● "}
            {opLabel}({fileName})
          </text>
          <text fg={diff.statsAddFg}>{"  "}{statsStr}</text>
          <text fg={diff.gutterFg}>{durationStr}</text>
        </box>
        <text fg={diff.truncationFg}>
          {"  "}(file too large for inline diff)
        </text>
      </box>
    );
  }

  const displayHunks = hunks.slice(0, maxHunks);
  const hiddenHunks = hunks.length - displayHunks.length;
  const hiddenLines = hunks
    .slice(maxHunks)
    .reduce((sum, h) => sum + h.lines.length, 0);
  const gw = gutterWidth(displayHunks);

  return (
    <box flexDirection="column" marginTop={1}>
      <box flexDirection="row">
        <text fg={diff.headerFg}>
          {"● "}
          {opLabel}({fileName})
        </text>
        <text fg={diff.statsAddFg}>{"  "}{statsStr}</text>
        <text fg={diff.gutterFg}>{durationStr}</text>
      </box>

      {displayHunks.map((hunk, hi) => (
        <box key={hi} flexDirection="column">
          <HunkHeader hunk={hunk} />
          {hunk.lines.map((line, li) => (
            <DiffLineRow key={li} line={line} gw={gw} />
          ))}
        </box>
      ))}

      {hiddenHunks > 0 && (
        <text fg={diff.truncationFg}>
          {"  "}... {hiddenHunks} more {hiddenHunks === 1 ? "hunk" : "hunks"} ({hiddenLines} lines)
        </text>
      )}
    </box>
  );
}
