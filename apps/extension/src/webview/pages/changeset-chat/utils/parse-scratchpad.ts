/**
 * Parse scratchpad markdown file to extract TODO items
 */

export interface ScratchpadTodo {
  id: string;
  title: string;
  section: string;
  completed: boolean;
}

/**
 * Parse markdown content to extract checkbox TODO items
 * Handles sections like "Files to Analyze", "Progress", etc.
 */
export function parseScratchpad(content: string): ScratchpadTodo[] {
  const todos: ScratchpadTodo[] = [];
  const lines = content.split("\n");
  
  let currentSection = "";
  let todoIdCounter = 0;

  for (const line of lines) {
    // Detect section headers (## Section Name)
    const sectionMatch = line.match(/^##+\s+(.+)$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1].trim();
      continue;
    }

    // Detect checkbox items (- [ ] or - [x])
    const checkboxMatch = line.match(/^[-*]\s+\[([ xX])\]\s+(.+)$/);
    if (checkboxMatch) {
      const isChecked = checkboxMatch[1].toLowerCase() === "x";
      const title = checkboxMatch[2].trim();
      
      if (title && currentSection) {
        todos.push({
          id: `todo-${todoIdCounter++}`,
          title,
          section: currentSection,
          completed: isChecked,
        });
      }
    }
  }

  return todos;
}

/**
 * Group TODOs by section
 */
export function groupTodosBySection(
  todos: ScratchpadTodo[],
): Record<string, ScratchpadTodo[]> {
  return todos.reduce(
    (acc, todo) => {
      if (!acc[todo.section]) {
        acc[todo.section] = [];
      }
      acc[todo.section].push(todo);
      return acc;
    },
    {} as Record<string, ScratchpadTodo[]>,
  );
}

