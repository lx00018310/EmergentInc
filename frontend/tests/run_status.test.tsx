import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { RunStatus } from '../src/features/run/RunStatus';
import type { WorldDto } from '../src/api/types';

afterEach(cleanup);
const world: WorldDto = { round: 1, pixels: [], environment_md: '', metrics: { total_spent_tokens: 1000000 }, latest_message_flow: [] };

describe('V11 RunStatus costs', () => {
  it('shows unknown without inventing a conversion from tokens', () => {
    render(<RunStatus world={world} runStatus={null} audit={null} />);
    expect(screen.getByText('EmergentInc V11 商业元胞自动机')).toBeDefined();
    expect(screen.getByText('未知')).toBeDefined();
    expect(screen.queryByText('¥15.00')).toBeNull();
  });

  it('distinguishes null costs from a reported zero', () => {
    const { rerender } = render(<RunStatus world={{ ...world, metrics: { total_spent_cny: null } }} runStatus={null} audit={null} />);
    expect(screen.getByText('未知')).toBeDefined();
    rerender(<RunStatus world={{ ...world, metrics: { total_spent_cny: 0 } }} runStatus={null} audit={null} />);
    expect(screen.getByText('¥0.00')).toBeDefined();
    expect(screen.queryByText('未知')).toBeNull();
  });
});
