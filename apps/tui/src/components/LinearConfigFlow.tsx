/**
 * LinearConfigFlow Component
 * Interactive flow for configuring Linear integration
 * Collects API key and team ID, validates, and saves to config
 */

import { useState } from 'react';
import { useKeyboard } from '@opentui/react';
import { OneDarkPro } from '../styles/theme';
import { LoadingSpinner } from './LoadingSpinner';
import { usePaste } from '../hooks/usePaste';

interface LinearConfigFlowProps {
  width: number;
  height: number;
  onComplete: (config: { apiKey: string; teamID: string }) => void;
  onCancel: () => void;
}

type Step = 'api_key' | 'team_id' | 'validating' | 'success';

export function LinearConfigFlow({
  width,
  height,
  onComplete,
  onCancel,
}: LinearConfigFlowProps) {
  const [step, setStep] = useState<Step>('api_key');
  const [apiKey, setApiKey] = useState('');
  const [teamID, setTeamID] = useState('');
  const [error, setError] = useState('');
  const [inputValue, setInputValue] = useState('');

  // Handle keyboard events
  useKeyboard((event) => {
    if (event.name === 'escape') {
      onCancel();
    }
  });

  // Handle paste events
  usePaste((event) => {
    if (step === 'api_key' || step === 'team_id') {
      setInputValue((prev) => prev + event.text);
    }
  });

  const handleSubmit = async () => {
    if (!inputValue.trim()) {
      setError('This field is required');
      return;
    }

    setError('');

    if (step === 'api_key') {
      setApiKey(inputValue);
      setInputValue('');
      setStep('team_id');
    } else if (step === 'team_id') {
      setTeamID(inputValue);
      setStep('validating');

      // Validate credentials
      try {
        await validateLinearConfig(apiKey, inputValue);
        setStep('success');
        setTimeout(() => {
          onComplete({ apiKey, teamID: inputValue });
        }, 1000);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Validation failed');
        setStep('team_id');
      }
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
          <text fg={OneDarkPro.syntax.red} fontWeight="bold">
            CLIVE
          </text>
          <text fg={OneDarkPro.foreground.muted}>
            {' · Linear Setup'}
          </text>
        </box>

        {/* Step: API Key */}
        {step === 'api_key' && (
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
                placeholder="lin_api_..."
                focused={true}
                onInput={setInputValue}
                onSubmit={handleSubmit}
                value={inputValue}
                style={{
                  fg: OneDarkPro.foreground.primary,
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

        {/* Step: Team ID */}
        {step === 'team_id' && (
          <>
            <text fg={OneDarkPro.syntax.green} marginTop={1}>
              ✓ API key saved
            </text>

            <text fg={OneDarkPro.foreground.primary} marginTop={2}>
              Enter your Linear team ID:
            </text>

            <box
              marginTop={2}
              width={50}
              padding={1}
              backgroundColor={OneDarkPro.background.secondary}
            >
              <input
                placeholder="TEAM"
                focused={true}
                onInput={setInputValue}
                onSubmit={handleSubmit}
                value={inputValue}
                style={{
                  fg: OneDarkPro.foreground.primary,
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
              Find your team ID in Linear settings
            </text>
          </>
        )}

        {/* Step: Validating */}
        {step === 'validating' && (
          <box marginTop={4}>
            <LoadingSpinner
              text="Validating credentials..."
              color={OneDarkPro.syntax.yellow}
            />
          </box>
        )}

        {/* Step: Success */}
        {step === 'success' && (
          <box marginTop={4} flexDirection="column" alignItems="center">
            <text fg={OneDarkPro.syntax.green} fontSize={1.5}>
              ✓ Linear configured successfully!
            </text>
            <text fg={OneDarkPro.foreground.muted} marginTop={1}>
              Starting Clive...
            </text>
          </box>
        )}

        {/* Instructions */}
        {(step === 'api_key' || step === 'team_id') && (
          <box marginTop={4} flexDirection="column" alignItems="center">
            <text fg={OneDarkPro.foreground.secondary}>
              Enter Submit  •  Esc Cancel
            </text>
          </box>
        )}
      </box>
    </box>
  );
}

/**
 * Validate Linear API credentials
 */
async function validateLinearConfig(
  apiKey: string,
  teamID: string
): Promise<void> {
  // TODO: Implement actual validation using LinearService
  // For now, just check if values are non-empty
  if (!apiKey || !teamID) {
    throw new Error('API key and team ID are required');
  }

  // Simulate API call delay
  await new Promise((resolve) => setTimeout(resolve, 1000));

  // In real implementation:
  // 1. Use LinearService to test the API key
  // 2. Verify team ID exists
  // 3. Save to config file (~/.clive/config.json)
}
