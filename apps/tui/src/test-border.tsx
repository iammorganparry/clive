import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";

function TestBorder() {
  return (
    <box alignItems="center" justifyContent="center" flexGrow={1}>
      <box
        width={40}
        height={10}
        // borderStyle="round"  // CAUSES BUN FFI CRASH!
        // borderColor="#61AFEF"
        backgroundColor="#282C34"
      >
        <text>Testing WITHOUT borderStyle ✅</text>
      </box>
    </box>
  );
}

console.log("Creating renderer...");
const renderer = await createCliRenderer();
const root = createRoot(renderer);
root.render(<TestBorder />);
console.log("Rendered!");
