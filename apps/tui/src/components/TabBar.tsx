/**
 * TabBar Component
 * Horizontal chat tabs across the top of the main area.
 * Shows one tab per chat with mode color, running indicator, and question badge.
 */

import { useKeyboard } from "@opentui/react";
import { OneDarkPro } from "../styles/theme";

export interface TabInfo {
  id: string;
  label: string;
  mode: "none" | "plan" | "build" | "review";
  isRunning: boolean;
  hasQuestion: boolean;
}

interface TabBarProps {
  width: number;
  tabs: TabInfo[];
  activeTabId: string | null;
  focused: boolean;
  selectedIndex: number;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onNewTab: () => void;
  onNavigate: (index: number) => void;
}

function getModeColor(mode: TabInfo["mode"]): string {
  switch (mode) {
    case "plan":
      return "#3B82F6"; // blue-500
    case "build":
      return "#F59E0B"; // amber-500
    case "review":
      return "#10B981"; // green-500
    default:
      return OneDarkPro.foreground.muted;
  }
}

function getModePrefix(mode: TabInfo["mode"]): string {
  switch (mode) {
    case "plan":
      return "plan";
    case "build":
      return "build";
    case "review":
      return "review";
    default:
      return "";
  }
}

export function TabBar({
  width,
  tabs,
  activeTabId,
  focused,
  selectedIndex,
  onSelectTab,
  onCloseTab,
  onNewTab,
  onNavigate,
}: TabBarProps) {
  // Keyboard handling when tabs zone is focused
  useKeyboard((event) => {
    if (!focused) return;

    if (event.name === "left" || event.sequence === "h") {
      onNavigate(Math.max(0, selectedIndex - 1));
      return;
    }
    if (event.name === "right" || event.sequence === "l") {
      // +1 for the [+] button
      onNavigate(Math.min(tabs.length, selectedIndex + 1));
      return;
    }
    if (event.name === "return") {
      if (selectedIndex === tabs.length) {
        // [+] button selected
        onNewTab();
      } else {
        const tab = tabs[selectedIndex];
        if (tab) onSelectTab(tab.id);
      }
      return;
    }
    if (event.sequence === "t") {
      onNewTab();
      return;
    }
    if (event.sequence === "w") {
      const tab = tabs[selectedIndex];
      if (tab) onCloseTab(tab.id);
      return;
    }
  });

  // Calculate max width per tab
  const newButtonWidth = 5; // " [+] "
  const availableWidth = width - newButtonWidth - 1;
  const maxTabWidth = tabs.length > 0
    ? Math.max(12, Math.floor(availableWidth / tabs.length))
    : availableWidth;

  const truncate = (text: string, maxLen: number) => {
    return text.length > maxLen ? `${text.substring(0, maxLen - 1)}…` : text;
  };

  return (
    <box
      width={width}
      height={1}
      flexDirection="row"
      backgroundColor={OneDarkPro.background.secondary}
    >
      {tabs.map((tab, i) => {
        const isActive = tab.id === activeTabId;
        const isSelectedInFocus = focused && i === selectedIndex;
        const modeColor = getModeColor(tab.mode);
        const prefix = getModePrefix(tab.mode);

        // Build tab label
        let displayLabel = prefix ? `${prefix}: ${tab.label}` : tab.label;
        const indicators = [
          tab.isRunning ? "●" : "",
          tab.hasQuestion ? "!" : "",
        ]
          .filter(Boolean)
          .join("");
        if (indicators) {
          displayLabel = `${indicators} ${displayLabel}`;
        }

        displayLabel = truncate(displayLabel, maxTabWidth - 4); // 4 for "[ " + " ]"

        return (
          <box key={tab.id} flexDirection="row">
            <text
              fg={isActive ? modeColor : OneDarkPro.foreground.muted}
              bg={
                isSelectedInFocus
                  ? OneDarkPro.background.highlight
                  : isActive
                    ? OneDarkPro.background.primary
                    : undefined
              }
              bold={isActive}
              underline={isActive && focused}
            >
              {` ${displayLabel} `}
            </text>
            {i < tabs.length - 1 && (
              <text fg={OneDarkPro.ui.border}>│</text>
            )}
          </box>
        );
      })}

      {/* New tab button */}
      <text
        fg={
          focused && selectedIndex === tabs.length
            ? OneDarkPro.syntax.green
            : OneDarkPro.foreground.muted
        }
        bg={
          focused && selectedIndex === tabs.length
            ? OneDarkPro.background.highlight
            : undefined
        }
      >
        {" [+]"}
      </text>
    </box>
  );
}
