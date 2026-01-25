import { scrapeTool, searchTool } from "firecrawl-aisdk";

export interface WebToolsConfig {
  enableSearch?: boolean;
  enableScrape?: boolean;
}

/**
 * Creates web search and scraping tools using Firecrawl
 * Provider-agnostic - works with any AI SDK provider
 */
export const createWebTools = (config?: WebToolsConfig) => {
  const tools: Record<string, typeof searchTool | typeof scrapeTool> = {};

  if (config?.enableSearch !== false) {
    tools.webSearch = searchTool;
  }

  if (config?.enableScrape !== false) {
    tools.webScrape = scrapeTool;
  }

  return tools;
};

// Re-export individual tools for direct use
export { scrapeTool, searchTool };
