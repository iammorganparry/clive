import * as fs from 'fs';
import * as path from 'path';
import matter from 'gray-matter';

export interface CommandMetadata {
  description?: string;
  model?: string;
  allowedTools?: string[];
  deniedTools?: string[];
}

export interface Command {
  metadata: CommandMetadata;
  content: string;
}

/**
 * Load a command file from the commands directory
 * Supports both local workspace commands and fallback to TUI commands
 */
export function loadCommand(commandName: string, workspaceRoot?: string): Command | null {
  const commandFileName = `${commandName}.md`;

  // Try workspace-local commands first
  if (workspaceRoot) {
    const workspaceCommandPath = path.join(workspaceRoot, '.claude', 'commands', commandFileName);
    if (fs.existsSync(workspaceCommandPath)) {
      return parseCommandFile(workspaceCommandPath);
    }
  }

  // Fallback to TUI's built-in commands
  const tuiCommandPath = path.join(__dirname, '../../commands', commandFileName);
  if (fs.existsSync(tuiCommandPath)) {
    return parseCommandFile(tuiCommandPath);
  }

  return null;
}

/**
 * Parse a command markdown file with frontmatter
 */
function parseCommandFile(filePath: string): Command {
  const fileContent = fs.readFileSync(filePath, 'utf-8');
  const { data, content } = matter(fileContent);

  return {
    metadata: {
      description: data.description,
      model: data.model,
      allowedTools: Array.isArray(data['allowed-tools'])
        ? data['allowed-tools']
        : typeof data['allowed-tools'] === 'string'
        ? data['allowed-tools'].split(',').map((s: string) => s.trim())
        : undefined,
      deniedTools: Array.isArray(data['denied-tools'])
        ? data['denied-tools']
        : typeof data['denied-tools'] === 'string'
        ? data['denied-tools'].split(',').map((s: string) => s.trim())
        : undefined,
    },
    content: content.trim(),
  };
}
