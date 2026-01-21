import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";

// Simple test component - no imports
function TestApp() {
  return (
    <box alignItems="center" justifyContent="center" flexGrow={1}>
      <text>Test App Loading...</text>
    </box>
  );
}

console.log("About to create renderer...");
const renderer = await createCliRenderer();
console.log("Renderer created!");

console.log("About to create root...");
const root = createRoot(renderer);
console.log("Root created!");

console.log("About to render...");
root.render(<TestApp />);
console.log("Rendered!");
