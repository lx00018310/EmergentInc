import React, { useState } from 'react';
import { PromptEditor } from './PromptEditor';
import type { PromptDto } from '../../api/types';

export interface PromptTabsProps {
  genesisPrompt: PromptDto | null;
  tempPrompt: PromptDto | null;
  isRunning: boolean;
  onSaveGenesis: (content: string) => Promise<void>;
  onClearGenesis: () => Promise<void>;
  onSaveTemp: (content: string) => Promise<void>;
  onClearTemp: () => Promise<void>;
}

/**
 * 创世 / 临时提示词合并为单卡片内 Tab，复用 PromptEditor，节省左栏纵向空间。
 */
export const PromptTabs: React.FC<PromptTabsProps> = ({
  genesisPrompt,
  tempPrompt,
  isRunning,
  onSaveGenesis,
  onClearGenesis,
  onSaveTemp,
  onClearTemp,
}) => {
  const [tab, setTab] = useState<'genesis' | 'temp'>('genesis');

  return (
    <div className="prompt-tabs">
      <div className="prompt-tabs-bar" role="tablist" aria-label="提示词">
        <button
          role="tab"
          aria-selected={tab === 'genesis'}
          className={`btn btn-sm ${tab === 'genesis' ? 'btn-primary' : ''}`}
          onClick={() => setTab('genesis')}
        >
          创世提示词
        </button>
        <button
          role="tab"
          aria-selected={tab === 'temp'}
          className={`btn btn-sm ${tab === 'temp' ? 'btn-primary' : ''}`}
          onClick={() => setTab('temp')}
        >
          临时提示词
        </button>
      </div>

      {/* 双实例常驻：切换 Tab 不丢失未保存草稿 */}
      <div style={{ display: tab === 'genesis' ? 'block' : 'none' }}>
        <PromptEditor
          cardId="genesis-card"
          title="创世提示词 (临时初速度)"
          hint="当前注入 system 消息的 GENESIS_CONTEXT，作为临时初速度；不是 Pixel Self，也不写入 pixel.md。运行期间不可编辑，清空后后续运行不再注入。"
          placeholder="可输入创世提示词，清空则完全关闭..."
          rows={5}
          promptData={genesisPrompt}
          isRunning={isRunning}
          onSave={onSaveGenesis}
          onClear={onClearGenesis}
        />
      </div>
      <div style={{ display: tab === 'temp' ? 'block' : 'none' }}>
        <PromptEditor
          cardId="temp-prompt-card"
          title="临时提示词 (任务指引)"
          hint="独立的 TEMPORARY_CONTEXT，当前注入 system 消息，不是单个元胞的 Human Mandate；仅在空闲时编辑，下次运行生效。"
          placeholder="可输入当前任务的临时提示词 (如 VPS 运维指令)..."
          rows={5}
          promptData={tempPrompt}
          isRunning={isRunning}
          onSave={onSaveTemp}
          onClear={onClearTemp}
        />
      </div>
    </div>
  );
};
