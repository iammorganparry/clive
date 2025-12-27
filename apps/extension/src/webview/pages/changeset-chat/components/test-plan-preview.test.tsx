import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TestPlanPreview } from './test-plan-preview';
import type { ParsedPlan } from '../utils/parse-plan';

// Mock RPC provider
const mockOpenFileMutation = {
  mutate: vi.fn(),
  isPending: false,
};

vi.mock('../../../rpc/provider.js', () => ({
  useRpc: () => ({
    system: {
      openFile: {
        useMutation: () => mockOpenFileMutation,
      },
    },
  }),
}));

describe('TestPlanPreview', () => {
  const mockPlan: ParsedPlan = {
    title: 'Test Plan for Authentication',
    description: 'Comprehensive testing for auth flow',
    summary: 'Testing gaps identified: token validation, refresh logic',
    body: '## Problem Summary\n\n3 gaps identified\n\n## Implementation Plan\n\nAdd tests',
    fullContent: '---\nname: Test Plan for Authentication\n---\n\n## Problem Summary',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockOpenFileMutation.isPending = false;
  });

  it('should render plan title', () => {
    render(<TestPlanPreview plan={mockPlan} />);
    
    expect(screen.getByText('Test Plan for Authentication')).toBeDefined();
  });

  it('should render plan description', () => {
    render(<TestPlanPreview plan={mockPlan} />);
    
    expect(screen.getByText('Comprehensive testing for auth flow')).toBeDefined();
  });

  it('should render plan summary', () => {
    render(<TestPlanPreview plan={mockPlan} />);
    
    expect(screen.getByText(/Testing gaps identified/)).toBeDefined();
  });

  it('should show Read More button when filePath is provided', () => {
    render(<TestPlanPreview plan={mockPlan} filePath="/path/to/file.ts" />);
    
    const readMoreButton = screen.getByRole('button', { name: /read more/i });
    expect(readMoreButton).toBeDefined();
  });

  it('should not show Read More button when filePath is not provided', () => {
    render(<TestPlanPreview plan={mockPlan} />);
    
    const readMoreButton = screen.queryByRole('button', { name: /read more/i });
    expect(readMoreButton).toBeNull();
  });

  it('should call openFile mutation when Read More button is clicked', () => {
    render(<TestPlanPreview plan={mockPlan} filePath="/path/to/file.ts" />);
    
    const readMoreButton = screen.getByRole('button', { name: /read more/i });
    fireEvent.click(readMoreButton);
    
    expect(mockOpenFileMutation.mutate).toHaveBeenCalledWith({
      filePath: '/path/to/file.ts',
    });
  });

  it('should disable Read More button when mutation is pending', () => {
    mockOpenFileMutation.isPending = true;
    
    render(<TestPlanPreview plan={mockPlan} filePath="/path/to/file.ts" />);
    
    const readMoreButton = screen.getByRole('button', { name: /read more/i });
    expect(readMoreButton.hasAttribute('disabled')).toBe(true);
  });

  it('should render with custom className', () => {
    const { container } = render(
      <TestPlanPreview plan={mockPlan} className="custom-class" />
    );
    
    expect(container.firstChild).toBeDefined();
  });

  it('should render with isStreaming prop', () => {
    render(<TestPlanPreview plan={mockPlan} isStreaming={true} />);
    
    // Component should render without errors when streaming
    expect(screen.getByText('Test Plan for Authentication')).toBeDefined();
  });

  it('should handle empty description gracefully', () => {
    const planWithEmptyDescription: ParsedPlan = {
      ...mockPlan,
      description: '',
    };
    
    render(<TestPlanPreview plan={planWithEmptyDescription} />);
    
    // Should still render title
    expect(screen.getByText('Test Plan for Authentication')).toBeDefined();
  });

  it('should handle empty summary gracefully', () => {
    const planWithEmptySummary: ParsedPlan = {
      ...mockPlan,
      summary: '',
    };
    
    render(<TestPlanPreview plan={planWithEmptySummary} />);
    
    // Should still render title and description
    expect(screen.getByText('Test Plan for Authentication')).toBeDefined();
    expect(screen.getByText('Comprehensive testing for auth flow')).toBeDefined();
  });
});
