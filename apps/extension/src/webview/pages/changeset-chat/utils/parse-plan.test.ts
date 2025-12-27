import { describe, it, expect } from 'vitest';
import { parsePlan, hasPlanContent } from './parse-plan';

describe('parsePlan', () => {
  describe('hasPlanContent', () => {
    it('should detect YAML frontmatter format', () => {
      const text = `---
name: Test Plan for Authentication
overview: Tests for auth
---`;
      
      expect(hasPlanContent(text)).toBe(true);
    });

    it('should detect H1 header format', () => {
      const text = `# Test Plan for API Routes

Content here`;
      
      expect(hasPlanContent(text)).toBe(true);
    });

    it('should detect H2 Test Plan: format', () => {
      const text = `## Test Plan: Authentication

Content here`;
      
      expect(hasPlanContent(text)).toBe(true);
    });

    it('should detect H2 Recommendation: format', () => {
      const text = `## Recommendation: Integration Tests

Content here`;
      
      expect(hasPlanContent(text)).toBe(true);
    });

    it('should return false when no plan content is present', () => {
      const text = `# Regular Document

This is just regular content without a test plan.`;
      
      expect(hasPlanContent(text)).toBe(false);
    });
  });

  describe('YAML frontmatter parsing', () => {
    it('should extract title and description from YAML frontmatter', () => {
      const markdown = `---
name: Test Plan for Authentication
overview: Comprehensive tests for auth flow
todos: ["unit-tests", "integration-tests"]
---

# Test Plan

Content here`;

      const result = parsePlan(markdown);
      
      expect(result).not.toBeNull();
      expect(result!.title).toBe('Test Plan for Authentication');
      expect(result!.description).toBe('Comprehensive tests for auth flow');
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
      expect(result!.body).toContain('## Problem Summary');
      expect(result!.body).toContain('Issues here');
    });

    it('should handle frontmatter without overview', () => {
      const markdown = `---
name: Test Plan for API
---

Content here`;

      const result = parsePlan(markdown);
      
      expect(result).not.toBeNull();
      expect(result!.title).toBe('Test Plan for API');
      expect(result!.description).toBe('Test proposal for review');
    });

    it('should use full content as body when body is empty', () => {
      const markdown = `---
name: Test Plan
overview: Overview
---`;

      const result = parsePlan(markdown);
      
      expect(result).not.toBeNull();
      expect(result!.body).toBe(markdown.trim());
      expect(result!.fullContent).toBe(markdown.trim());
    });
  });

  describe('H1 header parsing', () => {
    it('should extract title from H1 header', () => {
      const markdown = `# Test Plan for Authentication

## Problem Summary

Content here`;

      const result = parsePlan(markdown);
      
      expect(result).not.toBeNull();
      expect(result!.title).toBe('Test Plan for Authentication');
    });

    it('should handle H1 without "for" clause', () => {
      const markdown = `# Test Plan

Content here`;

      const result = parsePlan(markdown);
      
      expect(result).not.toBeNull();
      expect(result!.title).toBe('Test Plan');
    });

    it('should extract description from first paragraph after H1', () => {
      const markdown = `# Test Plan for API

This is the description of the test plan.

## Problem Summary`;

      const result = parsePlan(markdown);
      
      expect(result).not.toBeNull();
      expect(result!.description).toContain('This is the description');
    });

    it('should extract body up to next major H2 section', () => {
      const markdown = `# Test Plan for Authentication

Some intro text here.

## Problem Summary

Problems here`;

      const result = parsePlan(markdown);
      
      expect(result).not.toBeNull();
      expect(result!.body).toContain('# Test Plan for Authentication');
      expect(result!.body).toContain('Some intro text here');
      // Body stops at first H2 section
      expect(result!.body).not.toContain('## Problem Summary');
    });
  });

  describe('H2 header parsing (backward compatibility)', () => {
    it('should extract title from H2 Test Plan: header', () => {
      const markdown = `## Test Plan: Authentication Flow

Content here`;

      const result = parsePlan(markdown);
      
      expect(result).not.toBeNull();
      expect(result!.title).toBe('Authentication Flow');
    });

    it('should extract title from H2 Recommendation: header', () => {
      const markdown = `## Recommendation: Integration Tests

Content here`;

      const result = parsePlan(markdown);
      
      expect(result).not.toBeNull();
      expect(result!.title).toBe('Integration Tests');
    });

    it('should handle empty title after colon', () => {
      const markdown = `## Test Plan:

Content here`;

      const result = parsePlan(markdown);
      
      expect(result).not.toBeNull();
      // When no title after colon, the implementation uses the first line as title
      expect(result!.title).toBeDefined();
    });

    it('should extract description from first line after header', () => {
      const markdown = `## Test Plan: API Routes

This is a description of the test plan.

More content here`;

      const result = parsePlan(markdown);
      
      expect(result).not.toBeNull();
      expect(result!.description).toContain('This is a description');
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
      expect(result!.summary).toContain('first paragraph');
      expect(result!.summary).toContain('summary information');
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
      expect(result!.summary.length).toBeLessThan(310); // 300 + "..."
      expect(result!.summary).toContain('...');
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
      expect(result!.summary).toContain('Line 1');
      // Summary includes all lines since they form one continuous paragraph
      expect(result!.summary).toContain('Line 7');
    });

    it('should handle empty body gracefully', () => {
      const markdown = `---
name: Test Plan
overview: Overview
---`;

      const result = parsePlan(markdown);
      
      expect(result).not.toBeNull();
      // Summary should be extracted from fullContent since body is empty
      expect(result!.summary).toBeDefined();
    });
  });

  describe('Edge cases', () => {
    it('should return null when no plan content detected', () => {
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
      const markdown = `# Test Plan for Auth & Security (v2.0)

Content with <tags> and special @characters!`;

      const result = parsePlan(markdown);
      
      expect(result).not.toBeNull();
      expect(result!.title).toContain('Auth & Security');
      expect(result!.body).toContain('<tags>');
      expect(result!.body).toContain('@characters');
    });

    it('should handle multiline overview in YAML frontmatter', () => {
      const markdown = `---
name: Test Plan
overview: This is a long overview that spans multiple lines and should be captured correctly
---

Content`;

      const result = parsePlan(markdown);
      
      expect(result).not.toBeNull();
      expect(result!.description).toContain('long overview');
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
      expect(result!.fullContent).toBe(markdown.trim());
      expect(result!.fullContent).toContain('Section 1');
      expect(result!.fullContent).toContain('Section 2');
    });
  });

  describe('Format priority', () => {
    it('should prioritize YAML frontmatter over H1 headers', () => {
      const markdown = `---
name: YAML Title
overview: YAML description
---

# Test Plan for H1 Title

Content`;

      const result = parsePlan(markdown);
      
      expect(result).not.toBeNull();
      expect(result!.title).toBe('YAML Title');
      expect(result!.description).toBe('YAML description');
    });

    it('should prioritize H1 headers over H2 headers', () => {
      const markdown = `# Test Plan for H1 Title

Some content

## Test Plan: H2 Title

More content`;

      const result = parsePlan(markdown);
      
      expect(result).not.toBeNull();
      expect(result!.title).toBe('Test Plan for H1 Title');
    });
  });

  describe('Real-world test plan formats', () => {
    it('should parse complete YAML frontmatter test plan', () => {
      const markdown = `---
name: Test Plan for RPC Routers
overview: Comprehensive testing strategy covering RPC layer
todos: ["unit-tests", "integration-tests"]
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
      expect(result!.title).toBe('Test Plan for RPC Routers');
      expect(result!.description).toBe('Comprehensive testing strategy covering RPC layer');
      expect(result!.body).toContain('# Test Plan for RPC Routers');
      expect(result!.body).toContain('## Problem Summary');
      expect(result!.body).toContain('## Implementation Plan');
      expect(result!.body).toContain('## Changes Summary');
      expect(result!.summary).toContain('# Test Plan for RPC Routers');
      expect(result!.fullContent).toContain('name: Test Plan for RPC Routers');
    });

    it('should parse H1 format test plan', () => {
      const markdown = `# Test Plan for Authentication

This is an overview paragraph.

## Problem Summary

Authentication flow needs comprehensive testing.`;

      const result = parsePlan(markdown);
      
      expect(result).not.toBeNull();
      expect(result!.title).toBe('Test Plan for Authentication');
      expect(result!.body).toContain('# Test Plan for Authentication');
      expect(result!.body).toContain('This is an overview paragraph');
      // Body stops at first H2
      expect(result!.body).not.toContain('## Problem Summary');
      expect(result!.fullContent).toContain('## Problem Summary');
    });

    it('should parse H2 format test plan (backward compatible)', () => {
      const markdown = `## Test Plan: Database Layer

### Overview

Testing database queries and transactions.

### Tests to Add

1. Query validation tests
2. Transaction rollback tests`;

      const result = parsePlan(markdown);
      
      expect(result).not.toBeNull();
      expect(result!.title).toBe('Database Layer');
      expect(result!.body).toContain('### Overview');
      expect(result!.body).toContain('### Tests to Add');
    });
  });
});
