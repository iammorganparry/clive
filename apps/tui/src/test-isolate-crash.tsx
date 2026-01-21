/**
 * Crash Isolation Test
 * Gradually add imports to find what causes Bun FFI crash
 */

import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";

// Step 1: Just React (baseline - should work)
import { useEffect } from 'react';

// Step 2: Add theme
import { OneDarkPro } from './styles/theme';

// Step 3: Add React Query
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Step 4: Add XState
import { setup, assign } from 'xstate';
import { useMachine } from '@xstate/react';

// Step 5a: Test Header inline (no border)
// import { Header } from './components/Header';
// import { OutputPanel } from './components/OutputPanel';
// import { InputBar } from './components/InputBar';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { refetchOnWindowFocus: false, retry: 1 },
  },
});

// Simple test machine
const testMachine = setup({
  types: {
    context: {} as { count: number },
    events: {} as { type: 'INCREMENT' },
  },
}).createMachine({
  id: 'test',
  initial: 'idle',
  context: { count: 0 },
  states: {
    idle: {
      on: {
        INCREMENT: {
          actions: assign({ count: ({ context }) => context.count + 1 }),
        },
      },
    },
  },
});

function TestApp() {
  console.log("✅ React imported successfully");
  console.log("✅ Theme imported:", OneDarkPro.syntax.blue);
  console.log("✅ QueryClient created");

  const [state, send] = useMachine(testMachine);
  console.log("✅ XState machine initialized:", state.context.count);

  useEffect(() => {
    console.log("✅ useEffect ran");
  }, []);

  return (
    <box
      width={120}
      height={40}
      flexDirection="column"
      backgroundColor={OneDarkPro.background.primary}
    >
      {/* Inline header without border */}
      <box
        width={120}
        height={3}
        backgroundColor={OneDarkPro.background.secondary}
        flexDirection="row"
        justifyContent="space-between"
        padding={1}
      >
        <text color={OneDarkPro.syntax.blue}>Clive TUI</text>
        <text color={OneDarkPro.foreground.muted}>Press ? for help</text>
      </box>
      <text>Step 5a: Header inline (no border) ✅</text>
    </box>
  );
}

console.log("About to create renderer...");
const renderer = await createCliRenderer();
console.log("✅ Renderer created");

const root = createRoot(renderer);
console.log("✅ Root created");

root.render(
  <QueryClientProvider client={queryClient}>
    <TestApp />
  </QueryClientProvider>
);
console.log("✅ App rendered");
