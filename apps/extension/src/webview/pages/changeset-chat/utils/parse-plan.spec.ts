import { describe, it, expect } from 'vitest';
import { parsePlan, hasPlanContent, parsePlanSections } from './parse-plan';

describe('parsePlan', () => {
  describe('hasPlanContent', () => {
    it('should detect YAML frontmatter format with name field', () => {
      const text = `---
name: Test Plan for Authentication
overview: Tests for auth
---`;
      
      expect(hasPlanContent(text)).toBe(true);
    });

    it('should detect YAML frontmatter with any name (not just "Test Plan")', () => {
      const text = `---
name: Authentication Tests
overview: Tests for auth
---`;
      
      expect(hasPlanContent(text)).toBe(true);
    });

    it('should detect YAML frontmatter with short name', () => {
      const text = `---
name: Auth Tests
overview: Testing authentication
---`;
      
      expect(hasPlanContent(text)).toBe(true);
    });

    it('should detect name field without YAML delimiters', () => {
      const text = `name: Test Plan for API Routes

Content here`;
      
      expect(hasPlanContent(text)).toBe(true);
    });

    it('should return false when no name field is present', () => {
      const text = `# Regular Document

This is just regular content without a test plan.`;
      
      expect(hasPlanContent(text)).toBe(false);
    });

    it('should return false for empty string', () => {
      expect(hasPlanContent('')).toBe(false);
    });
  });

  describe('YAML frontmatter parsing', () => {
    it('should extract title and description from YAML frontmatter', () => {
      const markdown = `---
name: Test Plan for Authentication
overview: Comprehensive tests for auth flow
suites:
  - id: unit-auth
    name: Unit Tests for Auth
    testType: unit
    targetFilePath: src/auth/__tests__/auth.test.ts
    sourceFiles: [src/auth/login.ts, src/auth/logout.ts]
---

# Test Plan

Content here`;

      const result = parsePlan(markdown);
      
      expect(result).not.toBeNull();
      if (result) {
        expect(result.title).toBe('Test Plan for Authentication');
        expect(result.description).toBe('Comprehensive tests for auth flow');
        expect(result.suites).toHaveLength(1);
        expect(result.suites?.[0].id).toBe('unit-auth');
        expect(result.suites?.[0].sourceFiles).toEqual(['src/auth/login.ts', 'src/auth/logout.ts']);
      }
    });

    it('should extract title from YAML frontmatter without "Test Plan" prefix', () => {
      const markdown = `---
name: Authentication Tests
overview: Comprehensive tests for auth flow
---

Content here`;

      const result = parsePlan(markdown);
      
      expect(result).not.toBeNull();
      if (result) {
        expect(result.title).toBe('Authentication Tests');
        expect(result.description).toBe('Comprehensive tests for auth flow');
      }
    });

    it('should parse plan with simple name field', () => {
      const markdown = `---
name: API Tests
overview: Testing API endpoints
---

## Problem Summary

Issues identified`;

      const result = parsePlan(markdown);
      
      expect(result).not.toBeNull();
      if (result) {
        expect(result.title).toBe('API Tests');
        expect(result.description).toBe('Testing API endpoints');
        expect(result.body).toContain('## Problem Summary');
      }
    });

    it('should extract body content after frontmatter', () => {
      const markdown = `---
name: Test Plan
overview: Overview text
---

## Problem Summary

Issues here`;

      const result = parsePlan(markdown);
      
      expect(result).not.toBeNull();
      if (result) {
        expect(result.body).toContain('## Problem Summary');
        expect(result.body).toContain('Issues here');
      }
    });

    it('should handle frontmatter without overview', () => {
      const markdown = `---
name: Test Plan for API
---

Content here`;

      const result = parsePlan(markdown);
      
      expect(result).not.toBeNull();
      if (result) {
        expect(result.title).toBe('Test Plan for API');
        expect(result.description).toBe('Test proposal for review');
      }
    });

    it('should use full content as body when body is empty', () => {
      const markdown = `---
name: Test Plan
overview: Overview
---`;

      const result = parsePlan(markdown);
      
      expect(result).not.toBeNull();
      if (result) {
        expect(result.body).toBe(markdown.trim());
        expect(result.fullContent).toBe(markdown.trim());
      }
    });
  });

  describe('Suites extraction from YAML', () => {
    it('should extract suites array from YAML frontmatter', () => {
      const markdown = `---
name: Test Plan for Authentication
overview: Comprehensive auth testing
suites:
  - id: unit-auth
    name: Unit Tests for Auth Logic
    testType: unit
    targetFilePath: src/auth/__tests__/auth.test.ts
    sourceFiles: [src/auth/login.ts, src/auth/logout.ts]
    description: Test authentication functions
  - id: integration-auth
    name: Integration Tests for Auth Flow
    testType: integration
    targetFilePath: src/auth/__tests__/auth-flow.test.ts
    sourceFiles: [src/auth/middleware.ts]
---

Content here`;

      const result = parsePlan(markdown);
      
      expect(result).not.toBeNull();
      if (result) {
        expect(result.suites).toHaveLength(2);
        expect(result.suites?.[0].id).toBe('unit-auth');
        expect(result.suites?.[0].name).toBe('Unit Tests for Auth Logic');
        expect(result.suites?.[0].testType).toBe('unit');
        expect(result.suites?.[0].targetFilePath).toBe('src/auth/__tests__/auth.test.ts');
        expect(result.suites?.[0].sourceFiles).toEqual(['src/auth/login.ts', 'src/auth/logout.ts']);
        expect(result.suites?.[1].testType).toBe('integration');
      }
    });

    it('should handle suites with e2e test type', () => {
      const markdown = `---
name: Test Plan
overview: E2E testing
suites:
  - id: e2e-flow
    name: E2E User Flow Tests
    testType: e2e
    targetFilePath: e2e/user-flow.spec.ts
    sourceFiles: []
---`;

      const result = parsePlan(markdown);
      
      expect(result).not.toBeNull();
      if (result) {
        expect(result.suites).toHaveLength(1);
        expect(result.suites?.[0].testType).toBe('e2e');
      }
    });

    it('should return undefined suites when not present in YAML', () => {
      const markdown = `---
name: Test Plan
overview: Overview without suites
---`;

      const result = parsePlan(markdown);
      
      expect(result).not.toBeNull();
      if (result) {
        expect(result.suites).toBeUndefined();
      }
    });
  });

  describe('Summary extraction', () => {
    it('should extract summary from first paragraph', () => {
      const markdown = `---
name: Test Plan
overview: Overview
---

This is the first paragraph with important summary information.

This is the second paragraph.`;

      const result = parsePlan(markdown);
      
      expect(result).not.toBeNull();
      if (result) {
        expect(result.summary).toContain('first paragraph');
        expect(result.summary).toContain('summary information');
      }
    });

    it('should truncate long summaries at 300 characters', () => {
      const longText = 'A'.repeat(600);
      const markdown = `---
name: Test Plan
overview: Overview
---

${longText}`;

      const result = parsePlan(markdown);
      
      expect(result).not.toBeNull();
      if (result) {
        expect(result.summary.length).toBeLessThan(310); // 300 + "..."
        expect(result.summary).toContain('...');
      }
    });

    it('should extract summary including all lines in body', () => {
      const markdown = `---
name: Test Plan
overview: Overview
---

Line 1
Line 2
Line 3
Line 4
Line 5
Line 6
Line 7`;

      const result = parsePlan(markdown);
      
      expect(result).not.toBeNull();
      if (result) {
        expect(result.summary).toContain('Line 1');
        // Summary includes all lines since they form one continuous paragraph
        expect(result.summary).toContain('Line 7');
      }
    });

    it('should handle empty body gracefully', () => {
      const markdown = `---
name: Test Plan
overview: Overview
---`;

      const result = parsePlan(markdown);
      
      expect(result).not.toBeNull();
      // Summary should be extracted from fullContent since body is empty
      if (result) {
        expect(result.summary).toBeDefined();
      }
    });
  });

  describe('Edge cases', () => {
    it('should return null when no YAML name field is present', () => {
      const markdown = `# Regular Document

This is just regular content.`;

      const result = parsePlan(markdown);
      
      expect(result).toBeNull();
    });

    it('should return null for empty string', () => {
      const result = parsePlan('');
      
      expect(result).toBeNull();
    });

    it('should handle markdown with special characters', () => {
      const markdown = `---
name: Test Plan for Auth & Security (v2.0)
overview: Testing with special chars
---

Content with <tags> and special @characters!`;

      const result = parsePlan(markdown);
      
      expect(result).not.toBeNull();
      if (result) {
        expect(result.title).toContain('Auth & Security');
        expect(result.body).toContain('<tags>');
        expect(result.body).toContain('@characters');
      }
    });

    it('should handle multiline overview in YAML frontmatter', () => {
      const markdown = `---
name: Test Plan
overview: This is a long overview that spans multiple lines and should be captured correctly
---

Content`;

      const result = parsePlan(markdown);
      
      expect(result).not.toBeNull();
      if (result) {
        expect(result.description).toContain('long overview');
      }
    });

    it('should preserve full content', () => {
      const markdown = `---
name: Test Plan
overview: Overview
---

## Section 1

Content 1

## Section 2

Content 2`;

      const result = parsePlan(markdown);
      
      expect(result).not.toBeNull();
      if (result) {
        expect(result.fullContent).toBe(markdown.trim());
        expect(result.fullContent).toContain('Section 1');
        expect(result.fullContent).toContain('Section 2');
      }
    });
  });

  describe('parsePlanSections', () => {
    it('should extract suites from YAML frontmatter', () => {
      const planContent = `---
name: Test Plan
overview: Overview
suites:
  - id: unit-auth
    name: Unit Tests for Auth
    testType: unit
    targetFilePath: src/auth/__tests__/auth.test.ts
    sourceFiles: [src/auth/login.ts, src/auth/logout.ts]
---`;
      
      const sections = parsePlanSections(planContent);
      expect(sections).toHaveLength(1);
      expect(sections[0].id).toBe('unit-auth');
      expect(sections[0].name).toBe('Unit Tests for Auth');
      expect(sections[0].testType).toBe('unit');
      expect(sections[0].sourceFiles).toEqual(['src/auth/login.ts', 'src/auth/logout.ts']);
    });

    it('should return empty array when no suites in YAML', () => {
      const planContent = `---
name: Test Plan
overview: Overview
---`;
      
      const sections = parsePlanSections(planContent);
      expect(sections).toEqual([]);
    });

    it('should return empty array when no YAML frontmatter', () => {
      const planContent = `# Regular content`;
      
      const sections = parsePlanSections(planContent);
      expect(sections).toEqual([]);
    });

    it('should handle multiple suites with all test types', () => {
      const planContent = `---
name: Comprehensive Test Plan
overview: All test types
suites:
  - id: unit-1
    name: Unit Tests
    testType: unit
    targetFilePath: src/__tests__/unit.test.ts
    sourceFiles: [src/file1.ts]
  - id: integration-1
    name: Integration Tests
    testType: integration
    targetFilePath: src/__tests__/integration.test.ts
    sourceFiles: [src/file2.ts]
  - id: e2e-1
    name: E2E Tests
    testType: e2e
    targetFilePath: e2e/flow.spec.ts
    sourceFiles: []
---`;
      
      const sections = parsePlanSections(planContent);
      expect(sections).toHaveLength(3);
      expect(sections[0].testType).toBe('unit');
      expect(sections[1].testType).toBe('integration');
      expect(sections[2].testType).toBe('e2e');
    });

    it('should include sectionNumber for each suite', () => {
      const planContent = `---
name: Test Plan
suites:
  - id: suite-1
    name: Suite 1
    testType: unit
    targetFilePath: test1.ts
    sourceFiles: []
  - id: suite-2
    name: Suite 2
    testType: unit
    targetFilePath: test2.ts
    sourceFiles: []
---`;
      
      const sections = parsePlanSections(planContent);
      expect(sections[0].sectionNumber).toBe(1);
      expect(sections[1].sectionNumber).toBe(2);
    });

    it('should handle multi-line sourceFiles arrays', () => {
      const planContent = `---
name: Test Plan
suites:
  - id: suite-1
    name: Suite One
    testType: unit
    targetFilePath: test.spec.ts
    sourceFiles:
      - src/file1.ts
      - src/file2.ts
    description: Test description
---`;
      
      const sections = parsePlanSections(planContent);
      expect(sections).toHaveLength(1);
      expect(sections[0].sourceFiles).toEqual(['src/file1.ts', 'src/file2.ts']);
      expect(sections[0].description).toBe('Test description');
    });
  });

  describe('Real-world test plan formats', () => {
    it('should parse complete YAML frontmatter test plan with suites', () => {
      const markdown = `---
name: Test Plan for RPC Routers
overview: Comprehensive testing strategy covering RPC layer
suites:
  - id: unit-rpc
    name: Unit Tests for RPC Handlers
    testType: unit
    targetFilePath: src/rpc/__tests__/handlers.test.ts
    sourceFiles: [src/rpc/handlers.ts, src/rpc/utils.ts]
  - id: integration-rpc
    name: Integration Tests for RPC Layer
    testType: integration
    targetFilePath: src/rpc/__tests__/integration.test.ts
    sourceFiles: [src/rpc/router.ts]
---

# Test Plan for RPC Routers

## Problem Summary

3 critical testing gaps identified:

1. **Streaming** - No tests for subscriptions
2. **State** - XState machine untested
3. **Cache** - No validation logic

## Implementation Plan

### 1. Unit Tests

**File**: [\`path/to/file.ts\`](path/to/file.ts)
**Issue**: Missing test coverage
**Solution**: Add unit tests

Lines to cover:
- Lines 10-50: Core logic

## Changes Summary

- **Unit Tests**: 10 tests
- **Integration Tests**: 5 tests
- **Total**: 15 tests`;

      const result = parsePlan(markdown);
      
      expect(result).not.toBeNull();
      if (result) {
        expect(result.title).toBe('Test Plan for RPC Routers');
        expect(result.description).toBe('Comprehensive testing strategy covering RPC layer');
        expect(result.body).toContain('# Test Plan for RPC Routers');
        expect(result.body).toContain('## Problem Summary');
        expect(result.body).toContain('## Implementation Plan');
        expect(result.body).toContain('## Changes Summary');
        expect(result.summary).toContain('# Test Plan for RPC Routers');
        expect(result.fullContent).toContain('name: Test Plan for RPC Routers');
        expect(result.suites).toHaveLength(2);
        expect(result.suites?.[0].id).toBe('unit-rpc');
        expect(result.suites?.[1].id).toBe('integration-rpc');
      }
    });

    it('should parse minimal YAML test plan', () => {
      const markdown = `---
name: Test Plan for Authentication
overview: Auth testing
suites:
  - id: unit-auth
    name: Unit Tests
    testType: unit
    targetFilePath: src/__tests__/auth.test.ts
    sourceFiles: [src/auth.ts]
---

## Problem Summary

Authentication flow needs comprehensive testing.`;

      const result = parsePlan(markdown);
      
      expect(result).not.toBeNull();
      if (result) {
        expect(result.title).toBe('Test Plan for Authentication');
        expect(result.body).toContain('## Problem Summary');
        expect(result.suites).toHaveLength(1);
      }
    });
  });
});
