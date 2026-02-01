/**
 * LinearConfigFlow Component
 * Interactive flow for configuring Linear integration
 * Collects API key and team ID, validates, and saves to config
 */

import type { InputRenderable } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useEffect, useRef, useState } from "react";
import { usePaste } from "../hooks/usePaste";
import { OneDarkPro } from "../styles/theme";
import { LoadingSpinner } from "./LoadingSpinner";

interface LinearTeam {
  id: string;
  name: string;
  key: string;
}

interface LinearConfigFlowProps {
  width: number;
  height: number;
  onComplete: (config: { apiKey: string; teamID: string }) => void;
  onCancel: () => void;
}

type Step =
  | "api_key"
  | "loading_teams"
  | "team_selection"
  | "validating"
  | "success";

export function LinearConfigFlow({
  width,
  height,
  onComplete,
  onCancel,
}: LinearConfigFlowProps) {
  const [step, setStep] = useState<Step>("api_key");
  const [apiKey, setApiKey] = useState("");
  const [_teamID, setTeamID] = useState("");
  const [error, setError] = useState("");
  const [inputValue, setInputValue] = useState("");
  const [teams, setTeams] = useState<LinearTeam[]>([]);
  const [selectedTeamIndex, setSelectedTeamIndex] = useState(0);
  const inputRef = useRef<InputRenderable>(null);

  // Handle keyboard events
  useKeyboard((event) => {
    if (event.name === "escape") {
      onCancel();
      return;
    }

    // Team selection navigation
    if (step === "team_selection") {
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
        if (team) handleTeamSelect(team);
      } else if (event.sequence && /^[1-9]$/.test(event.sequence)) {
        const index = parseInt(event.sequence, 10) - 1;
        const team = teams[index];
        if (team && index < teams.length) {
          handleTeamSelect(team);
        }
      }
    }
  });

  // Handle paste events
  usePaste((event) => {
    if (step === "api_key" && inputRef.current) {
      // Use InputRenderable's insertText method directly
      if (event.text) {
        inputRef.current.insertText(event.text);
        // Update our state to match
        setInputValue(inputRef.current.value);
      }
    }
  });

  // Fetch teams when API key is submitted
  useEffect(() => {
    if (step === "loading_teams" && apiKey) {
      fetchLinearTeams(apiKey)
        .then((fetchedTeams) => {
          setTeams(fetchedTeams);
          setSelectedTeamIndex(0);
          setStep("team_selection");
        })
        .catch((err) => {
          setError(
            err instanceof Error ? err.message : "Failed to fetch teams",
          );
          setStep("api_key");
        });
    }
  }, [step, apiKey]);

  const handleSubmit = async () => {
    if (!inputValue.trim()) {
      setError("This field is required");
      return;
    }

    setError("");

    if (step === "api_key") {
      setApiKey(inputValue);
      setInputValue("");
      setStep("loading_teams");
    }
  };

  const handleTeamSelect = async (team: LinearTeam) => {
    setTeamID(team.id);
    setStep("validating");

    // Validate and complete
    try {
      await validateLinearConfig(apiKey, team.id);
      setStep("success");
      setTimeout(() => {
        onComplete({ apiKey, teamID: team.id });
      }, 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Validation failed");
      setStep("team_selection");
    }
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
      <box flexDirection="column" alignItems="center" width={60}>
        {/* Header */}
        <box flexDirection="row" marginBottom={2}>
          <text fg={OneDarkPro.syntax.red}>
            <b>CLIVE</b>
          </text>
          <text fg={OneDarkPro.foreground.muted}>{" · Linear Setup"}</text>
        </box>

        {/* Step: API Key */}
        {step === "api_key" && (
          <>
            <text fg={OneDarkPro.foreground.primary} marginTop={2}>
              Enter your Linear API key:
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
                onSubmit={handleSubmit}
                value={inputValue}
                style={{
                  textColor: OneDarkPro.foreground.primary,
                  backgroundColor: OneDarkPro.background.secondary,
                  focusedBackgroundColor: OneDarkPro.background.secondary,
                }}
              />
            </box>

            {error && (
              <text fg={OneDarkPro.syntax.red} marginTop={1}>
                {error}
              </text>
            )}

            <text fg={OneDarkPro.foreground.muted} marginTop={2}>
              Get your API key from:
            </text>
            <text fg={OneDarkPro.syntax.blue} marginTop={1}>
              https://linear.app/settings/api
            </text>
          </>
        )}

        {/* Step: Loading Teams */}
        {step === "loading_teams" && (
          <box marginTop={4}>
            <LoadingSpinner
              text="Loading teams from Linear..."
              color={OneDarkPro.syntax.yellow}
            />
          </box>
        )}

        {/* Step: Team Selection */}
        {step === "team_selection" && (
          <>
            <text fg={OneDarkPro.syntax.green} marginTop={1}>
              ✓ API key verified
            </text>

            <text fg={OneDarkPro.foreground.primary} marginTop={2}>
              Select your Linear team:
            </text>

            {error && (
              <text fg={OneDarkPro.syntax.red} marginTop={1}>
                {error}
              </text>
            )}

            <box marginTop={2} flexDirection="column" width={50}>
              {teams.slice(0, 9).map((team, i) => {
                const isSelected = i === selectedTeamIndex;

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
                        <b>{"▸ "}{i + 1}. {team.name} ({team.key})</b>
                      ) : (
                        <>{"  "}{i + 1}. {team.name} ({team.key})</>
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
          </>
        )}

        {/* Step: Validating */}
        {step === "validating" && (
          <box marginTop={4}>
            <LoadingSpinner
              text="Validating credentials..."
              color={OneDarkPro.syntax.yellow}
            />
          </box>
        )}

        {/* Step: Success */}
        {step === "success" && (
          <box marginTop={4} flexDirection="column" alignItems="center">
            <text fg={OneDarkPro.syntax.green}>
              ✓ Linear configured successfully!
            </text>
            <text fg={OneDarkPro.foreground.muted} marginTop={1}>
              Starting Clive...
            </text>
          </box>
        )}

        {/* Instructions */}
        {step === "api_key" && (
          <box marginTop={4} flexDirection="column" alignItems="center">
            <text fg={OneDarkPro.foreground.secondary}>
              Enter Submit • Esc Cancel
            </text>
          </box>
        )}

        {step === "team_selection" && (
          <box marginTop={4} flexDirection="column" alignItems="center">
            <text fg={OneDarkPro.foreground.secondary}>
              1-9 Select • ↑/↓ Navigate • Enter Confirm • Esc Cancel
            </text>
          </box>
        )}
      </box>
    </box>
  );
}

/**
 * Fetch teams from Linear API
 */
async function fetchLinearTeams(apiKey: string): Promise<LinearTeam[]> {
  const response = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: apiKey,
    },
    body: JSON.stringify({
      query: `
        query {
          teams {
            nodes {
              id
              name
              key
            }
          }
        }
      `,
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch teams: ${response.statusText}`);
  }

  const data = (await response.json()) as any;

  if (data.errors) {
    throw new Error(data.errors[0]?.message || "Failed to fetch teams");
  }

  return data.data.teams.nodes;
}

/**
 * Validate Linear API credentials
 */
async function validateLinearConfig(
  apiKey: string,
  teamID: string,
): Promise<void> {
  // Validate by attempting to fetch the team
  const response = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: apiKey,
    },
    body: JSON.stringify({
      query: `
        query($teamId: String!) {
          team(id: $teamId) {
            id
            name
          }
        }
      `,
      variables: { teamId: teamID },
    }),
  });

  if (!response.ok) {
    throw new Error(`Validation failed: ${response.statusText}`);
  }

  const data = (await response.json()) as any;

  if (data.errors) {
    throw new Error(data.errors[0]?.message || "Invalid team ID");
  }

  if (!data.data.team) {
    throw new Error("Team not found");
  }

  // TODO: Save to config file (~/.clive/config.json)
}
