/**
 * Test /build command execution
 * Simulates: Execute /build command → Verify implementation flow
 */

import { CliManager } from './services/CliManager';

async function testBuildCommand() {
  console.log('=== Testing /build Command ===\n');
  console.log('Creating CliManager...');

  const manager = new CliManager();
  const outputs: any[] = [];

  // Collect all output
  manager.on('output', (line) => {
    outputs.push(line);

    // Log different output types with visual distinction
    switch (line.type) {
      case 'tool_call':
        console.log(`\n🔧 [TOOL] ${line.toolName}`);
        break;
      case 'tool_result':
        const metadata = [];
        if (line.duration) metadata.push(`${line.duration}ms`);
        if (line.inputTokens || line.outputTokens) {
          metadata.push(`↓${line.inputTokens}/↑${line.outputTokens}`);
        }
        if (line.costUSD) metadata.push(`$${line.costUSD.toFixed(4)}`);

        console.log(`  ↳ Result${metadata.length ? ' [' + metadata.join(', ') + ']' : ''}`);
        if (line.text.length < 200) {
          console.log(`    ${line.text.substring(0, 100)}`);
        }
        break;
      case 'assistant':
        console.log(`\n💬 [ASSISTANT] ${line.text.substring(0, 100)}${line.text.length > 100 ? '...' : ''}`);
        break;
      case 'system':
        console.log(`\n💭 [SYSTEM] ${line.text}`);
        break;
      case 'file_diff':
        console.log(`\n📝 [DIFF]`);
        // Show first few lines of diff
        const diffLines = line.text.split('\n').slice(0, 5);
        diffLines.forEach(l => console.log(`  ${l}`));
        break;
      case 'exit':
        console.log(`\n✅ [EXIT] Code: ${line.exitCode ?? 0}`);
        break;
      default:
        console.log(`[${line.type.toUpperCase()}] ${line.text.substring(0, 80)}`);
    }
  });

  manager.on('complete', () => {
    console.log('\n=== Execution Complete ===');
    console.log(`\nTotal outputs: ${outputs.length}`);

    // Analyze output types
    const types = outputs.reduce((acc, line) => {
      acc[line.type] = (acc[line.type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    console.log('\nOutput breakdown:');
    Object.entries(types).forEach(([type, count]) => {
      console.log(`  ${type}: ${count}`);
    });

    // Check for expected elements
    console.log('\n✅ Test Results:');
    console.log(`  - Tool calls: ${types.tool_call || 0}`);
    console.log(`  - Assistant messages: ${types.assistant || 0}`);
    console.log(`  - File operations: ${types.file_diff || 0}`);
    console.log(`  - Exit event: ${types.exit ? 'YES' : 'NO'}`);

    process.exit(0);
  });

  console.log('\nExecuting: "/build Write a function that adds two numbers and create a test for it"\n');
  console.log('---\n');

  try {
    await manager.execute('Write a function that adds two numbers and create a test for it. Use TypeScript. Keep it simple.', {
      workspaceRoot: process.cwd(),
      model: 'sonnet',
    });
  } catch (error) {
    console.error('[ERROR]', error);
    process.exit(1);
  }
}

// Run with timeout
const timeoutId = setTimeout(() => {
  console.error('\n❌ Test timed out after 90 seconds');
  process.exit(1);
}, 90000);

testBuildCommand().catch(error => {
  clearTimeout(timeoutId);
  console.error('Test failed:', error);
  process.exit(1);
});
