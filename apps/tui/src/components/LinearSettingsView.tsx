/**
 * LinearSettingsView Component
 * Settings view for editing Linear API key and team after initial setup
 */

import type { InputRenderable } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useEffect, useRef, useState } from "react";
import { usePaste } from "../hooks/usePaste";
import { OneDarkPro } from "../styles/theme";
import {
  type LinearTeam,
  fetchLinearTeams,
  getLinearTeam,
  maskApiKey,
  validateLinearConfig,
} from "../utils/linear-api";
import { LoadingSpinner } from "./LoadingSpinner";

interface LinearSettingsViewProps {
  width: number;
  height: number;
  currentConfig: {
    apiKey: string;
    teamID: string;
  };
  onSave: (config: { apiKey: string; teamID: string }) => void;
  onCancel: () => void;
}

type ViewState =
  | "form"
  | "editing_key"
  | "loading_teams"
  | "selecting_team"
  | "validating"
  | "error";

type FocusedField = "api_key" | "team";

export function LinearSettingsView({
  width,
  height,
  currentConfig,
  onSave,
  onCancel,
}: LinearSettingsViewProps) {
  const [viewState, setViewState] = useState<ViewState>("form");
  const [focusedField, setFocusedField] = useState<FocusedField>("api_key");
  const [apiKey, setApiKey] = useState(currentConfig.apiKey);
  const [teamID, setTeamID] = useState(currentConfig.teamID);
  const [currentTeam, setCurrentTeam] = useState<LinearTeam | null>(null);
  const [teams, setTeams] = useState<LinearTeam[]>([]);
  const [selectedTeamIndex, setSelectedTeamIndex] = useState(0);
  const [inputValue, setInputValue] = useState("");
  const [error, setError] = useState("");
  const inputRef = useRef<InputRenderable>(null);

  // Load current team name on mount
  useEffect(() => {
    if (currentConfig.apiKey && currentConfig.teamID) {
      getLinearTeam(currentConfig.apiKey, currentConfig.teamID)
        .then((team) => {
          if (team) {
            setCurrentTeam(team);
          }
        })
        .catch(() => {
          // Ignore errors - will just show team ID
        });
    }
  }, [currentConfig.apiKey, currentConfig.teamID]);

  // Handle keyboard events
  useKeyboard((event) => {
    // Global escape to cancel
    if (event.name === "escape") {
      if (viewState === "editing_key" || viewState === "selecting_team") {
        setViewState("form");
        setError("");
      } else {
        onCancel();
      }
      return;
    }

    // Form navigation
    if (viewState === "form") {
      if (event.name === "tab" || event.name === "down" || event.sequence === "j") {
        setFocusedField((prev) => (prev === "api_key" ? "team" : "api_key"));
        return;
      }
      if (event.name === "up" || event.sequence === "k") {
        setFocusedField((prev) => (prev === "api_key" ? "team" : "api_key"));
        return;
      }
      if (event.name === "return") {
        if (focusedField === "api_key") {
          setViewState("editing_key");
          setInputValue("");
        } else if (focusedField === "team") {
          setViewState("loading_teams");
        }
        return;
      }
    }

    // Team selection navigation
    if (viewState === "selecting_team") {
      if (event.name === "up" || event.sequence === "k") {
        setSelectedTeamIndex((prev) =>
          prev > 0 ? prev - 1 : teams.length - 1,
        );
      } else if (event.name === "down" || event.sequence === "j") {
        setSelectedTeamIndex((prev) =>
          prev < teams.length - 1 ? prev + 1 : 0,
        );
      } else if (event.name === "return") {
        const team = teams[selectedTeamIndex];
        if (team) {
          handleTeamSelect(team);
        }
      } else if (event.sequence && /^[1-9]$/.test(event.sequence)) {
        const index = parseInt(event.sequence, 10) - 1;
        if (index < teams.length) {
          const team = teams[index];
          if (team) {
            handleTeamSelect(team);
          }
        }
      }
    }
  });

  // Handle paste events for API key editing
  usePaste((event) => {
    if (viewState === "editing_key" && inputRef.current && event.text) {
      inputRef.current.insertText(event.text);
      setInputValue(inputRef.current.value);
    }
  });

  // Fetch teams when entering loading_teams state
  useEffect(() => {
    if (viewState === "loading_teams") {
      fetchLinearTeams(apiKey)
        .then((fetchedTeams) => {
          setTeams(fetchedTeams);
          // Pre-select current team if found
          const currentIndex = fetchedTeams.findIndex((t) => t.id === teamID);
          setSelectedTeamIndex(currentIndex >= 0 ? currentIndex : 0);
          setViewState("selecting_team");
        })
        .catch((err) => {
          setError(
            err instanceof Error ? err.message : "Failed to fetch teams",
          );
          setViewState("form");
        });
    }
  }, [viewState, apiKey, teamID]);

  const handleApiKeySubmit = async () => {
    if (!inputValue.trim()) {
      setError("API key is required");
      return;
    }

    setError("");
    setViewState("validating");

    try {
      // Validate the new API key by fetching teams
      await fetchLinearTeams(inputValue);
      setApiKey(inputValue);
      setViewState("form");
      // Clear current team since we changed the API key
      setCurrentTeam(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid API key");
      setViewState("editing_key");
    }
  };

  const handleTeamSelect = async (team: LinearTeam) => {
    setViewState("validating");
    setError("");

    try {
      await validateLinearConfig(apiKey, team.id);
      setTeamID(team.id);
      setCurrentTeam(team);
      // Auto-save after team selection
      onSave({ apiKey, teamID: team.id });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Validation failed");
      setViewState("selecting_team");
    }
  };

  const handleSave = () => {
    if (!apiKey || !teamID) {
      setError("Both API key and team are required");
      return;
    }
    onSave({ apiKey, teamID });
  };

  return (
    <box
      width={width}
      height={height}
      backgroundColor={OneDarkPro.background.primary}
      alignItems="center"
      justifyContent="center"
      flexDirection="column"
    >
      <box flexDirection="column" alignItems="center" width={70}>
        {/* Header */}
        <box flexDirection="row" marginBottom={2}>
          <text fg={OneDarkPro.syntax.red}>
            <b>CLIVE</b>
          </text>
          <text fg={OneDarkPro.foreground.muted}>{" · Linear Settings"}</text>
        </box>

        {/* Error message */}
        {error && (
          <box
            marginBottom={2}
            padding={1}
            backgroundColor={OneDarkPro.background.secondary}
          >
            <text fg={OneDarkPro.syntax.red}>{error}</text>
          </box>
        )}

        {/* Form View */}
        {viewState === "form" && (
          <>
            {/* API Key Field */}
            <box width={60} marginTop={2}>
              <text fg={OneDarkPro.foreground.muted}>API Key</text>
            </box>
            <box
              width={60}
              padding={1}
              marginTop={1}
              backgroundColor={
                focusedField === "api_key"
                  ? OneDarkPro.background.highlight
                  : OneDarkPro.background.secondary
              }
              borderStyle={focusedField === "api_key" ? "rounded" : undefined}
              borderColor={
                focusedField === "api_key" ? OneDarkPro.syntax.blue : undefined
              }
            >
              <box flexDirection="row" justifyContent="space-between">
                <text fg={OneDarkPro.foreground.primary}>
                  {maskApiKey(apiKey)}
                </text>
                <text fg={OneDarkPro.foreground.muted}>
                  {focusedField === "api_key" ? "[Enter to change]" : ""}
                </text>
              </box>
            </box>

            {/* Team Field */}
            <box width={60} marginTop={3}>
              <text fg={OneDarkPro.foreground.muted}>Team</text>
            </box>
            <box
              width={60}
              padding={1}
              marginTop={1}
              backgroundColor={
                focusedField === "team"
                  ? OneDarkPro.background.highlight
                  : OneDarkPro.background.secondary
              }
              borderStyle={focusedField === "team" ? "rounded" : undefined}
              borderColor={
                focusedField === "team" ? OneDarkPro.syntax.blue : undefined
              }
            >
              <box flexDirection="row" justifyContent="space-between">
                <text fg={OneDarkPro.foreground.primary}>
                  {currentTeam
                    ? `${currentTeam.name} (${currentTeam.key})`
                    : teamID || "Not selected"}
                </text>
                <text fg={OneDarkPro.foreground.muted}>
                  {focusedField === "team" ? "[Enter to select]" : ""}
                </text>
              </box>
            </box>

            {/* Instructions */}
            <box marginTop={4} flexDirection="column" alignItems="center">
              <text fg={OneDarkPro.foreground.secondary}>
                Tab Navigate · Enter Edit · Esc Cancel
              </text>
            </box>
          </>
        )}

        {/* Editing API Key */}
        {viewState === "editing_key" && (
          <>
            <text fg={OneDarkPro.foreground.primary} marginTop={2}>
              Enter new Linear API key:
            </text>

            <box
              marginTop={2}
              width={50}
              padding={1}
              backgroundColor={OneDarkPro.background.secondary}
            >
              <input
                ref={inputRef}
                placeholder="lin_api_..."
                focused={true}
                onInput={setInputValue}
                onSubmit={handleApiKeySubmit}
                value={inputValue}
                style={{
                  textColor: OneDarkPro.foreground.primary,
                  backgroundColor: OneDarkPro.background.secondary,
                  focusedBackgroundColor: OneDarkPro.background.secondary,
                }}
              />
            </box>

            <text fg={OneDarkPro.foreground.muted} marginTop={2}>
              Get your API key from:
            </text>
            <text fg={OneDarkPro.syntax.blue} marginTop={1}>
              https://linear.app/settings/api
            </text>

            <box marginTop={4} flexDirection="column" alignItems="center">
              <text fg={OneDarkPro.foreground.secondary}>
                Enter Submit · Esc Cancel
              </text>
            </box>
          </>
        )}

        {/* Loading Teams */}
        {viewState === "loading_teams" && (
          <box marginTop={4}>
            <LoadingSpinner
              text="Loading teams from Linear..."
              color={OneDarkPro.syntax.yellow}
            />
          </box>
        )}

        {/* Selecting Team */}
        {viewState === "selecting_team" && (
          <>
            <text fg={OneDarkPro.foreground.primary} marginTop={2}>
              Select your Linear team:
            </text>

            <box marginTop={2} flexDirection="column" width={50}>
              {teams.slice(0, 9).map((team, i) => {
                const isSelected = i === selectedTeamIndex;
                const isCurrent = team.id === teamID;

                return (
                  <box
                    key={team.id}
                    backgroundColor={
                      isSelected
                        ? OneDarkPro.background.highlight
                        : "transparent"
                    }
                    padding={1}
                    marginBottom={1}
                  >
                    <text
                      fg={
                        isSelected
                          ? OneDarkPro.syntax.blue
                          : OneDarkPro.foreground.primary
                      }
                    >
                      {isSelected ? (
                        <b>{"▸ "}{i + 1}. {team.name} ({team.key}){isCurrent ? " ✓" : ""}</b>
                      ) : (
                        <>{"  "}{i + 1}. {team.name} ({team.key}){isCurrent ? " ✓" : ""}</>
                      )}
                    </text>
                  </box>
                );
              })}
            </box>

            {teams.length > 9 && (
              <text fg={OneDarkPro.foreground.muted} marginTop={1}>
                Showing first 9 teams
              </text>
            )}

            <box marginTop={4} flexDirection="column" alignItems="center">
              <text fg={OneDarkPro.foreground.secondary}>
                1-9 Select · ↑/↓ Navigate · Enter Confirm · Esc Cancel
              </text>
            </box>
          </>
        )}

        {/* Validating */}
        {viewState === "validating" && (
          <box marginTop={4}>
            <LoadingSpinner
              text="Validating credentials..."
              color={OneDarkPro.syntax.yellow}
            />
          </box>
        )}
      </box>
    </box>
  );
}
