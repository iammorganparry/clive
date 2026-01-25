/**
 * StreamingIndicator Component
 * Shows animated indicator when agent is actively streaming responses
 * Mimics Claude Code's "* Flowing..." indicator
 */

import { useEffect, useState } from "react";
import { OneDarkPro } from "../styles/theme";

interface StreamingIndicatorProps {
  mode?: "plan" | "build" | "none";
}

export function StreamingIndicator({ mode = "none" }: StreamingIndicatorProps) {
  const [dots, setDots] = useState("");

  // Animate dots: "" -> "." -> ".." -> "..." -> "" (cycle)
  useEffect(() => {
    const interval = setInterval(() => {
      setDots((prev) => {
        if (prev === "") return ".";
        if (prev === ".") return "..";
        if (prev === "..") return "...";
        return "";
      });
    }, 400); // Update every 400ms

    return () => clearInterval(interval);
  }, []);

  // Color based on mode
  const getColor = () => {
    if (mode === "plan") return "#3B82F6"; // blue
    if (mode === "build") return "#F59E0B"; // amber
    return "#10B981"; // green (default)
  };

  return (
    <box marginTop={1} marginBottom={1} flexDirection="row">
      <text fg={getColor()}>* Flowing{dots} </text>
      <text fg={OneDarkPro.foreground.muted}>
        (esc to interrupt · thinking)
      </text>
    </box>
  );
}
