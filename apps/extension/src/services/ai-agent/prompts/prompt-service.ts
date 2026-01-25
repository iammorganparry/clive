/**
 * PromptService - Main Effect Service for building prompts
 * Orchestrates section composition, user rules loading, and template resolution
 */

import { Effect } from "effect";
import { RulesService } from "./rules-service.js";
import { sectionRegistry, testAgentSectionOrder } from "./sections/index.js";
import { resolveTemplate } from "./template-resolver.js";
import { testAgentTemplate } from "./templates/test-agent-template.js";
import type { BuildConfig, SectionId } from "./types.js";

/**
 * Service for building complete prompts from sections
 */
export class PromptService extends Effect.Service<PromptService>()(
  "PromptService",
  {
    effect: Effect.gen(function* () {
      const rulesService = yield* RulesService;

      /**
       * Build the complete test agent prompt
       * Loads user rules, builds all sections, and resolves template
       */
      const buildTestAgentPrompt = (config?: Partial<BuildConfig>) =>
        Effect.gen(function* () {
          const buildConfig: BuildConfig = {
            includeUserRules: true,
            ...config,
          };

          // Load user rules if requested and workspace root is available
          let userRules = "";
          if (buildConfig.includeUserRules && buildConfig.workspaceRoot) {
            userRules = yield* rulesService.loadUserRules();
          }

          // Extend config with user rules for sections to access
          const extendedConfig = {
            ...buildConfig,
            userRules,
          } as BuildConfig & { userRules?: string };

          // Build all sections in order
          const sectionContents: Record<string, string> = {};
          for (const sectionId of testAgentSectionOrder) {
            const sectionFn = sectionRegistry[sectionId];
            if (sectionFn) {
              const content = yield* sectionFn(extendedConfig);
              sectionContents[sectionId] = content;
            }
          }

          // Resolve template placeholders
          const resolvedPrompt = resolveTemplate(
            testAgentTemplate,
            sectionContents,
          );

          return resolvedPrompt;
        });

      /**
       * Build a custom prompt with specific sections
       * Useful for creating specialized prompts
       */
      const buildCustomPrompt = (
        sections: (typeof SectionId)[keyof typeof SectionId][],
        template: string,
        config?: Partial<BuildConfig>,
      ) =>
        Effect.gen(function* () {
          const buildConfig: BuildConfig = {
            includeUserRules: true,
            ...config,
          };

          // Load user rules if requested
          let userRules = "";
          if (buildConfig.includeUserRules && buildConfig.workspaceRoot) {
            userRules = yield* rulesService.loadUserRules();
          }

          const extendedConfig = {
            ...buildConfig,
            userRules,
          } as BuildConfig & { userRules?: string };

          // Build specified sections
          const sectionContents: Record<string, string> = {};
          for (const sectionId of sections) {
            const sectionFn = sectionRegistry[sectionId];
            if (sectionFn) {
              const content = yield* sectionFn(extendedConfig);
              sectionContents[sectionId] = content;
            }
          }

          // Resolve template
          return resolveTemplate(template, sectionContents);
        });

      return {
        buildTestAgentPrompt,
        buildCustomPrompt,
      };
    }),
  },
) {}

/**
 * Default live layer for PromptService
 */
export const PromptServiceLive = PromptService.Default;
