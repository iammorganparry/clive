/**
 * Root App component for Clive TUI
 * Hello world implementation to verify OpenTUI/React setup
 */

import { OneDarkPro } from './styles/theme';

function App() {
  // Note: OpenTUI hooks will be imported when available
  // For now, this is a simple hello world
  const width = 80;
  const height = 24;

  const handleKeyPress = (key: string) => {
    if (key === 'q' || key === 'Escape') {
      process.exit(0);
    }
  };

  // Simulate keyboard listener (will be replaced with OpenTUI useKeyboard hook)
  if (typeof process !== 'undefined') {
    process.stdin.setRawMode?.(true);
    process.stdin.on('data', (data) => {
      const key = data.toString();
      handleKeyPress(key);
    });
  }

  return (
    <box width={width} height={height} backgroundColor={OneDarkPro.background.primary}>
      <text color={OneDarkPro.syntax.blue}>
        Clive TUI - Press 'q' to exit.
      </text>
    </box>
  );
}

export default App;
