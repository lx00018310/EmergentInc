import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { EnvironmentEditor } from '../src/features/environment/EnvironmentEditor';
import { ArtifactBrowser } from '../src/features/files/ArtifactBrowser';
import { PrivateFileBrowser } from '../src/features/files/PrivateFileBrowser';
import { ToolCatalog } from '../src/features/tools/ToolCatalog';
import { ToolExecutionHistory } from '../src/features/tools/ToolExecutionHistory';
import * as prompts from '../src/api/prompts';
import * as files from '../src/api/files';
import * as tools from '../src/api/tools';
import { setLanguage } from '../src/i18n';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const props = { isOpen: true, onClose: vi.fn(), onLogMessage: vi.fn() };
describe('read failures remain visible in the open dialog', () => {
  it.each(['en', 'zh-CN'] as const)('blocks environment overwrite until the existing content is loaded in %s', async lang => {
    setLanguage(lang);
    vi.spyOn(prompts, 'fetchEnvironment').mockRejectedValueOnce(new Error('READ_FAILED')).mockResolvedValue({ content: 'Existing environment' } as any);
    const save = vi.spyOn(prompts, 'updateEnvironment');
    const view = render(<EnvironmentEditor {...props} />);
    expect((await screen.findByRole('alert')).textContent).toContain(lang === 'en' ? 'Operation failed: READ_FAILED' : '操作失败：READ_FAILED');
    const button = screen.getByRole('button', { name: lang === 'en' ? 'Save changes' : '保存更新' });
    expect(button).toHaveProperty('disabled', true); fireEvent.click(button); expect(save).not.toHaveBeenCalled();
    view.rerender(<EnvironmentEditor {...props} isOpen={false} />);
    view.rerender(<EnvironmentEditor {...props} />);
    expect(await screen.findByDisplayValue('Existing environment')).toBeTruthy();
    expect(screen.getByRole('button', { name: lang === 'en' ? 'Save changes' : '保存更新' })).toHaveProperty('disabled', false);
  });
  it.each(['en', 'zh-CN'] as const)('distinguishes failed lists from verified empty lists in %s', async lang => {
    setLanguage(lang);
    vi.spyOn(files, 'fetchPixelArtifacts').mockRejectedValue(new Error('ARTIFACT_READ_FAILED'));
    vi.spyOn(files, 'fetchPrivateFiles').mockRejectedValue(new Error('PRIVATE_READ_FAILED'));
    vi.spyOn(tools, 'fetchToolsCatalog').mockRejectedValue(new Error('TOOL_READ_FAILED'));
    vi.spyOn(tools, 'fetchToolExecutions').mockRejectedValue(new Error('HISTORY_READ_FAILED'));
    const cases = [
      [<ArtifactBrowser {...props} pixelId="0_0_0" onPreviewFile={() => {}} />, 'ARTIFACT_READ_FAILED'],
      [<PrivateFileBrowser {...props} />, 'PRIVATE_READ_FAILED'],
      [<ToolCatalog {...props} />, 'TOOL_READ_FAILED'],
      [<ToolExecutionHistory {...props} />, 'HISTORY_READ_FAILED'],
    ] as const;
    for (const [component, error] of cases) {
      const view = render(component);
      expect((await screen.findByRole('alert')).textContent).toContain(error);
      expect(screen.queryByText(/暂无|No .*files|No .*tools|No tool execution/)).toBeNull();
      view.unmount();
    }
  });
});
