import { OneDarkPro } from "../styles/theme";

export interface CommandSuggestion {
  cmd: string;
  desc: string;
}

interface SuggestionsPanelProps {
  suggestions: CommandSuggestion[];
  selectedIndex: number;
  width: number;
}

export function SuggestionsPanel({
  suggestions,
  selectedIndex,
  width,
}: SuggestionsPanelProps) {
  if (suggestions.length === 0) return null;

  return (
    <box
      width={width}
      backgroundColor={OneDarkPro.background.secondary}
      borderStyle="single"
      borderColor={OneDarkPro.ui.border}
      paddingLeft={1}
      paddingRight={1}
      paddingTop={0}
      paddingBottom={0}
    >
      <text fg={OneDarkPro.foreground.muted}>Commands:</text>
      {suggestions.map((suggestion, i) => {
        const isSelected = i === selectedIndex;
        const prefix = isSelected ? "► " : "  ";
        const line = `${prefix}${suggestion.cmd} - ${suggestion.desc}`;
        return (
          <box
            key={suggestion.cmd}
            backgroundColor={
              isSelected ? OneDarkPro.background.highlight : "transparent"
            }
            paddingLeft={1}
            paddingRight={1}
          >
            <text
              fg={
                isSelected
                  ? OneDarkPro.syntax.blue
                  : OneDarkPro.foreground.primary
              }
            >
              {line}
            </text>
          </box>
        );
      })}
    </box>
  );
}
