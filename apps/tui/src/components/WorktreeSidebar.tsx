/**
 * WorktreeSidebar Component
 * Tree view showing worktrees with nested Linear tasks.
 * Replaces the old task-only Sidebar for the Conductor-like layout.
 */

import { useKeyboard } from "@opentui/react";
import { OneDarkPro } from "../styles/theme";
import type { Task } from "../types";
import type { WorktreeInfo } from "../services/WorktreeService";
import { getTaskStatus } from "../utils/taskHelpers";

interface WorktreeSidebarProps {
  width: number;
  height: number;
  worktrees: WorktreeInfo[];
  tasksPerWorktree: Map<string, Task[]>;
  activeWorktreePath: string | null;
  focused: boolean;
  selectedIndex: number;
  expandedPaths: Set<string>;
  onSelect: (worktreePath: string) => void;
  onCreateNew: () => void;
  onNavigate: (index: number) => void;
  onToggleExpand: (worktreePath: string) => void;
}

interface FlatItem {
  type: "worktree" | "task" | "new-button";
  worktreePath?: string;
  task?: Task;
  label: string;
  indent: number;
}

function buildFlatList(
  worktrees: WorktreeInfo[],
  expandedPaths: Set<string>,
  tasksPerWorktree: Map<string, Task[]>,
): FlatItem[] {
  const items: FlatItem[] = [];

  for (const wt of worktrees) {
    const displayName = wt.isMain
      ? `main (${wt.branch})`
      : wt.epicIdentifier || wt.branch.replace("clive/", "");

    items.push({
      type: "worktree",
      worktreePath: wt.path,
      label: displayName,
      indent: 0,
    });

    if (expandedPaths.has(wt.path)) {
      const tasks = tasksPerWorktree.get(wt.path) ?? [];
      for (const task of tasks) {
        items.push({
          type: "task",
          worktreePath: wt.path,
          task,
          label: task.title,
          indent: 1,
        });
      }
    }
  }

  items.push({
    type: "new-button",
    label: "New worktree",
    indent: 0,
  });

  return items;
}

function getStatusIcon(task: Task): string {
  const status = getTaskStatus(task);
  if (status === "in_progress") return "⚡";
  if (status === "blocked") return "⊗";
  if (status === "completed") return "✓";
  return "○";
}

function getStatusColor(task: Task): string {
  const status = getTaskStatus(task);
  if (status === "in_progress") return OneDarkPro.syntax.yellow;
  if (status === "blocked") return OneDarkPro.syntax.red;
  if (status === "completed") return OneDarkPro.syntax.green;
  return OneDarkPro.syntax.cyan;
}

export function WorktreeSidebar({
  width,
  height,
  worktrees,
  tasksPerWorktree,
  activeWorktreePath,
  focused,
  selectedIndex,
  expandedPaths,
  onSelect,
  onCreateNew,
  onNavigate,
  onToggleExpand,
}: WorktreeSidebarProps) {
  const flatItems = buildFlatList(worktrees, expandedPaths, tasksPerWorktree);

  const truncate = (text: string, maxLen: number) => {
    return text.length > maxLen ? `${text.substring(0, maxLen - 1)}…` : text;
  };

  // Keyboard handling when sidebar is focused
  useKeyboard((event) => {
    if (!focused) return;

    if (event.name === "up" || event.sequence === "k") {
      onNavigate(Math.max(0, selectedIndex - 1));
      return;
    }
    if (event.name === "down" || event.sequence === "j") {
      onNavigate(Math.min(flatItems.length - 1, selectedIndex + 1));
      return;
    }
    if (event.name === "return") {
      const item = flatItems[selectedIndex];
      if (!item) return;
      if (item.type === "worktree" && item.worktreePath) {
        onSelect(item.worktreePath);
      } else if (item.type === "new-button") {
        onCreateNew();
      }
      return;
    }
    if (event.sequence === " ") {
      const item = flatItems[selectedIndex];
      if (item?.type === "worktree" && item.worktreePath) {
        onToggleExpand(item.worktreePath);
      }
      return;
    }
    if (event.sequence === "n") {
      onCreateNew();
      return;
    }
  });

  // Calculate visible items based on height (logo takes ~5 rows)
  const headerHeight = 5;
  const maxVisibleItems = Math.max(height - headerHeight, 1);

  // Scroll window around selectedIndex
  let scrollOffset = 0;
  if (selectedIndex >= scrollOffset + maxVisibleItems) {
    scrollOffset = selectedIndex - maxVisibleItems + 1;
  }
  if (selectedIndex < scrollOffset) {
    scrollOffset = selectedIndex;
  }

  const visibleItems = flatItems.slice(
    scrollOffset,
    scrollOffset + maxVisibleItems,
  );

  return (
    <box
      width={width}
      height={height}
      backgroundColor={OneDarkPro.background.secondary}
      paddingLeft={1}
      paddingTop={1}
      paddingRight={1}
      flexDirection="column"
      borderStyle="single"
      borderColor={focused ? OneDarkPro.syntax.blue : OneDarkPro.ui.border}
    >
      {/* Header */}
      <box flexDirection="column" marginBottom={1}>
        <text fg={OneDarkPro.syntax.red}>{"█▀▀ █   █ █ █ █▀▀"}</text>
        <text fg={OneDarkPro.syntax.red}>{"█   █   █ ▀▄▀ █▀▀"}</text>
        <text fg={OneDarkPro.syntax.red}>{"▀▀▀ ▀▀▀ ▀  ▀  ▀▀▀"}</text>
      </box>

      {/* Worktree list */}
      {visibleItems.map((item, i) => {
        const globalIndex = scrollOffset + i;
        const isSelected = focused && globalIndex === selectedIndex;
        const isActive =
          item.type === "worktree" && item.worktreePath === activeWorktreePath;

        if (item.type === "worktree") {
          const isExpanded = item.worktreePath
            ? expandedPaths.has(item.worktreePath)
            : false;
          const taskCount = item.worktreePath
            ? (tasksPerWorktree.get(item.worktreePath)?.length ?? 0)
            : 0;
          const chevron = taskCount > 0 ? (isExpanded ? "▾" : "▸") : " ";

          return (
            <box
              key={`wt-${globalIndex}`}
              flexDirection="row"
              backgroundColor={
                isSelected ? OneDarkPro.background.highlight : undefined
              }
            >
              <text fg={isActive ? OneDarkPro.syntax.green : OneDarkPro.foreground.muted}>
                {chevron}{" "}
              </text>
              <text
                fg={
                  isActive
                    ? OneDarkPro.syntax.green
                    : OneDarkPro.foreground.primary
                }
                bold={isActive}
              >
                {truncate(item.label, width - 5)}
              </text>
            </box>
          );
        }

        if (item.type === "task" && item.task) {
          return (
            <box
              key={`task-${globalIndex}`}
              flexDirection="row"
              paddingLeft={2}
              backgroundColor={
                isSelected ? OneDarkPro.background.highlight : undefined
              }
            >
              <text fg={getStatusColor(item.task)}>
                {getStatusIcon(item.task)}{" "}
              </text>
              <text fg={OneDarkPro.foreground.muted}>
                {truncate(item.label, width - 7)}
              </text>
            </box>
          );
        }

        if (item.type === "new-button") {
          return (
            <box
              key="new-button"
              flexDirection="row"
              marginTop={1}
              backgroundColor={
                isSelected ? OneDarkPro.background.highlight : undefined
              }
            >
              <text fg={OneDarkPro.syntax.green}>[+] </text>
              <text fg={OneDarkPro.foreground.muted}>{item.label}</text>
            </box>
          );
        }

        return null;
      })}

      {/* Scroll indicator */}
      {flatItems.length > maxVisibleItems && (
        <text fg={OneDarkPro.foreground.comment} marginTop={0}>
          {scrollOffset > 0 ? "↑ " : "  "}
          {scrollOffset + maxVisibleItems < flatItems.length ? "↓" : " "}
        </text>
      )}
    </box>
  );
}
