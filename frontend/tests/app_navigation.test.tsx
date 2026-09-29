import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

vi.mock('../src/features/hall/TianJiHall', async () => {
  const ReactModule = await import('react');
  return { TianJiHall: (props: any) => ReactModule.createElement('div', { 'data-testid': 'hall' },
    ReactModule.createElement('button', { onClick: () => props.onSelectedPixel('0_0_0') }, '选中绑定载体'),
    ReactModule.createElement('button', { onClick: props.onOpenEngine }, '打开 Engine'),
    ReactModule.createElement('button', { onClick: props.onOpenGacha }, '招募人物'),
    ReactModule.createElement('button', { onClick: props.onOpenMeeting }, '发起会议')) };
});

vi.mock('../src/features/engine/EngineView', async () => {
  const ReactModule = await import('react');
  return { EngineView: (props: any) => ReactModule.createElement('div', { 'data-testid': 'engine' },
    ReactModule.createElement('span', null, props.initialPixelId || '未选中载体'),
    ReactModule.createElement('button', { onClick: props.onBack }, '返回天机阁')) };
});

vi.mock('../src/features/gacha/GachaView', async () => {
  const ReactModule = await import('react');
  return { GachaView: (props: any) => ReactModule.createElement('div', { 'data-testid': 'gacha' },
    ReactModule.createElement('button', { onClick: props.onBack }, '返回天机阁')) };
});

vi.mock('../src/features/meetings/MeetingView', async () => {
  const ReactModule = await import('react');
  return { MeetingView: (props: any) => ReactModule.createElement('div', { 'data-testid': 'meeting' },
    ReactModule.createElement('button', { onClick: props.onBack }, '返回天机阁')) };
});

import { App } from '../src/App';

describe('App view navigation', () => {
  it('starts at the hall and carries the selected bound Pixel into Engine', () => {
    render(<App />);
    expect(screen.getByTestId('hall')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '选中绑定载体' }));
    fireEvent.click(screen.getByRole('button', { name: '打开 Engine' }));
    expect(screen.getByTestId('engine')).toBeTruthy();
    expect(screen.getByText('0_0_0')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '返回天机阁' }));
    expect(screen.getByTestId('hall')).toBeTruthy();
  });

  it('opens the recruit view and returns to the hall', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: '招募人物' }));
    expect(screen.getByTestId('gacha')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '返回天机阁' }));
    expect(screen.getByTestId('hall')).toBeTruthy();
  });

  it('opens the meeting view and returns to the hall', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: '发起会议' }));
    expect(screen.getByTestId('meeting')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '返回天机阁' }));
    expect(screen.getByTestId('hall')).toBeTruthy();
  });

  it('no longer exposes the removed organization desk', () => {
    render(<App />);
    expect(screen.queryByRole('button', { name: '打开组织控制台' })).toBeNull();
    expect(screen.queryByRole('button', { name: '组织控制台' })).toBeNull();
  });
});
