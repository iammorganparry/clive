---
title: Knowledge Base Index
updatedAt: 2025-12-26
---

# Knowledge Base Index

This file provides an overview of all knowledge documented for this repository.

## Auth-patterns

### [Authentication and Authorization Flows](.clive/knowledge/auth-patterns/authentication-and-authorization-flows.md)

User authentication using Better Auth with OAuth providers and session management. Authorization controls access to resources based on user roles and ownership. ### Context for Testing


## Code-activity

### [Active Development Areas in Clive Codebase](.clive/knowledge/code-activity/active-development-areas-in-clive-codebase.md)

This document identifies the most actively modified files and areas in the Clive codebase, based on git commit history over the last 3 months. This helps focus testing efforts on hot code paths that a

### [Critical Module Dependencies](.clive/knowledge/code-activity/critical-module-dependencies.md)

This article identifies the most frequently imported modules across the codebase, highlighting core dependencies that are actively used. These represent the foundational libraries and internal package

### [Hot Code Areas - Recent Modifications](.clive/knowledge/code-activity/hot-code-areas-recent-modifications.md)

This knowledge article documents the most actively modified files in the codebase over the last 3 and 1 months, indicating areas of hot code that are currently being developed or maintained. Focusing


## Core-components

### [RPC Communication System](.clive/knowledge/core-components/rpc-communication-system.md)

The RPC system provides type-safe client-server communication using tRPC and Zod validation. It defines contracts for all API interactions between the webview UI and extension backend services. ### Co

### [Webview Application Component](.clive/knowledge/core-components/webview-application-component.md)

The main React application component for the VSCode webview, handling routing, authentication, and lazy loading of page components. This serves as the UI entry point for user interactions with the ext

### [AI Testing Agent](.clive/knowledge/core-components/ai-testing-agent.md)

The AI Testing Agent is a core component that uses large language models to analyze codebases and generate intelligent tests. It orchestrates various tools and maintains context for complex testing sc


## Data-flow

### [Data Flow and State Management Patterns](.clive/knowledge/data-flow/data-flow-and-state-management-patterns.md)

Data flows through the system via RPC calls, with state managed at multiple levels. Understanding these patterns is crucial for testing user journeys and data consistency. ### Context for Testing


## Database-patterns

### [Database Schema and Data Models](.clive/knowledge/database-patterns/database-schema-and-data-models.md)

The database schema defines the core data models for the application, using Drizzle ORM with PostgreSQL. This schema supports user authentication, organizations, AI conversations, codebase indexing wi


## External-services

### [External Service Integrations](.clive/knowledge/external-services/external-service-integrations.md)

Integration with third-party services for AI, authentication, and data persistence. These external dependencies require careful testing to handle failures gracefully. ### Context for Testing


## Infrastructure

### [Test Environment Configuration](.clive/knowledge/infrastructure/test-environment-configuration.md)

Configuration for running integration and E2E tests in a sandbox environment. This ensures tests can safely interact with required services without affecting production data. ### Context for Testing


## Mocks

### [Mock Strategies and Test Utilities](.clive/knowledge/mocks/mock-strategies-and-test-utilities.md)

Comprehensive mocking strategies for external dependencies and test utilities for common testing scenarios. Mocks isolate units under test and provide deterministic behavior. ### Context for Testing


## Module-boundaries

### [Module Boundaries and Responsibilities](.clive/knowledge/module-boundaries/module-boundaries-and-responsibilities.md)

Clear delineation of module responsibilities in the monorepo architecture. Each package has specific concerns, enabling focused development and testing. ### Context for Testing


## System-architecture

### [Overall System Architecture](.clive/knowledge/system-architecture/overall-system-architecture.md)

The system is a VSCode extension with AI-powered testing capabilities, built as a monorepo with multiple packages. It provides intelligent test generation and execution through AI agents, with a web-b


## Test-execution

### [Unit Tests - Extension Package](.clive/knowledge/test-execution/unit-tests-extension-package.md)

Configuration and execution patterns for unit tests in the VSCode extension package. This workspace handles the core extension logic, AI agents, and webview UI. ### Framework

### [Test Coverage Analysis](.clive/knowledge/test-execution/test-coverage-analysis.md)

Analysis of existing test files and their relation to hot code areas. This helps identify coverage gaps where frequently modified code lacks corresponding tests. ### Context for Testing


## Test-frameworks

### [Vitest Testing Framework](.clive/knowledge/test-frameworks/vitest-testing-framework.md)

Vitest serves as the primary testing framework across the monorepo, configured for unit and integration testing with jsdom environment for React components. ### Context for Testing


## Test-gaps

### [Testing Gaps and Recommendations](.clive/knowledge/test-gaps/testing-gaps-and-recommendations.md)

Analysis of current test coverage gaps and prioritized recommendations for improving test quality and coverage. Focus on hot code areas and critical user journeys. ### Context for Testing


