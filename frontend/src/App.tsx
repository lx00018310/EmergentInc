import React, { useState, useEffect, useCallback } from 'react';
import { useWorldPolling } from './hooks/useWorldPolling';
import { RunStatus } from './features/run/RunStatus';
import { RunControls } from './features/run/RunControls';
import { ConsolePanel, ConsoleMessage } from './features/run/ConsolePanel';
import { PromptEditor } from './features/prompts/PromptEditor';
import { EnvironmentEditor } from './features/environment/EnvironmentEditor';
import { PixelMapCanvas } from './features/pixels/PixelMapCanvas';
import { PixelDetails } from './features/pixels/PixelDetails';
import { FilePreview } from './features/files/FilePreview';
import { ArtifactBrowser } from './features/files/ArtifactBrowser';
import { PrivateFileBrowser } from './features/files/PrivateFileBrowser';
import { ToolCatalog } from './features/tools/ToolCatalog';
import { ToolExecutionHistory } from './features/tools/ToolExecutionHistory';

import {
  fetchGenesisPrompt,
  updateGenesisPrompt,
  fetchTemporaryPrompt,
  updateTemporaryPrompt,
} from './api/prompts';
import { fetchPixelDocument } from './api/files';
import type { PromptDto } from './api/types';

export const App: React.FC = () => {
  const { world, runStatus, audit, error: pollingError, refreshImmediately } = useWorldPolling();

  // 控制台日志
  const [messages, setMessages] = useState<ConsoleMessage[]>([
    {
      id: 'init',
      type: 'system',
      text: '[SYSTEM] V9 商业元胞自动机控制台 (React + TypeScript) 核心就绪。',
      time: new Date().toLocaleTimeString(),
    },
  ]);

  const addLogMessage = useCallback((type: 'system' | 'info' | 'success' | 'warn' | 'error', text: string) => {
    setMessages((prev) => [
      ...prev.slice(-300), // 保留最近 300 条
      {
        id: `${Date.now()}_${Math.random()}`,
        type,
        text,
        time: new Date().toLocaleTimeString(),
      },
    ]);
  }, []);

  // 轮询异常记录
  useEffect(() => {
    if (pollingError) {
      addLogMessage('error', `[POLL ERROR] ${pollingError}`);
    }
  }, [pollingError, addLogMessage]);

  // 元胞选择状态
  const [selectedPixelId, setSelectedPixelId] = useState<string | null>(null);

  // 默认选中首个活跃元胞
  useEffect(() => {
    if (!selectedPixelId && world?.pixels && world.pixels.length > 0) {
      const activeOne = world.pixels.find((p) => p.active) || world.pixels[0];
      if (activeOne) {
        setSelectedPixelId(activeOne.id);
      }
    }
  }, [world, selectedPixelId]);

  const selectedPixel = world?.pixels.find((p) => p.id === selectedPixelId) || null;

  // 提示词状态 (独立实例)
  const [genesisPrompt, setGenesisPrompt] = useState<PromptDto | null>(null);
  const [tempPrompt, setTempPrompt] = useState<PromptDto | null>(null);

  const loadPrompts = useCallback(async () => {
    try {
      const [gen, temp] = await Promise.all([fetchGenesisPrompt(), fetchTemporaryPrompt()]);
      setGenesisPrompt(gen);
      setTempPrompt(temp);
    } catch {
      // 容错处理
    }
  }, []);

  useEffect(() => {
    loadPrompts();
  }, [loadPrompts]);

  const isRunning = Boolean(runStatus?.running);

  // 弹窗状态管理
  const [isEnvModalOpen, setIsEnvModalOpen] = useState<boolean>(false);
  const [isToolsModalOpen, setIsToolsModalOpen] = useState<boolean>(false);
  const [isPrivateFilesModalOpen, setIsPrivateFilesModalOpen] = useState<boolean>(false);
  const [isToolExecutionsModalOpen, setIsToolExecutionsModalOpen] = useState<boolean>(false);
  const [isArtifactsModalOpen, setIsArtifactsModalOpen] = useState<boolean>(false);

  // 文档预览弹窗
  const [previewDocTitle, setPreviewDocTitle] = useState<string>('');
  const [previewDocContent, setPreviewDocContent] = useState<string>('');
  const [isPreviewDocLoading, setIsPreviewDocLoading] = useState<boolean>(false);
  const [isPreviewDocOpen, setIsPreviewDocOpen] = useState<boolean>(false);

  const handleOpenDoc = async (docName: string) => {
    if (!selectedPixelId) return;
    setIsPreviewDocLoading(true);
    setPreviewDocTitle(`元胞 ${selectedPixelId} - ${docName}`);
    setIsPreviewDocOpen(true);
    try {
      const res = await fetchPixelDocument(selectedPixelId, docName);
      setPreviewDocContent(res.content || '');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setPreviewDocContent(`[FAILED TO LOAD DOCUMENT] ${msg}`);
    } finally {
      setIsPreviewDocLoading(false);
    }
  };

  const handlePreviewArtifact = async (title: string, filename: string) => {
    if (!selectedPixelId) return;
    setIsPreviewDocLoading(true);
    setPreviewDocTitle(title);
    setIsPreviewDocOpen(true);
    try {
      const res = await fetchPixelDocument(selectedPixelId, `artifacts/${filename}`);
      setPreviewDocContent(res.content || '');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setPreviewDocContent(`[FAILED TO LOAD ARTIFACT] ${msg}`);
    } finally {
      setIsPreviewDocLoading(false);
    }
  };

  return (
    <>
      <RunStatus world={world} runStatus={runStatus} audit={audit} />

      <main className="main-layout">
        {/* 左侧控制区 */}
        <section className="left-panel">
          <RunControls
            runStatus={runStatus}
            onOpenEnvironment={() => setIsEnvModalOpen(true)}
            onOpenTools={() => setIsToolsModalOpen(true)}
            onOpenPrivateFiles={() => setIsPrivateFilesModalOpen(true)}
            onOpenToolExecutions={() => setIsToolExecutionsModalOpen(true)}
            onLogMessage={addLogMessage}
            onRefresh={refreshImmediately}
          />

          <ConsolePanel messages={messages} audit={audit} runStatus={runStatus} />

          <PromptEditor
            cardId="genesis-card"
            title="创世提示词 (临时初速度)"
            hint="该提示词仅作为系统提示词的临时初速度，影响后续所有元胞调用；不进入三输入 payload，清空后不再注入。"
            placeholder="可输入创世提示词，清空则完全关闭..."
            rows={5}
            promptData={genesisPrompt}
            isRunning={isRunning}
            onSave={async (content) => {
              const res = await updateGenesisPrompt(content);
              setGenesisPrompt(res);
              addLogMessage('success', `[GENESIS PROMPT] 创世提示词已保存 (Rev ${res.revision})。`);
            }}
            onClear={async () => {
              const res = await updateGenesisPrompt('');
              setGenesisPrompt(res);
              addLogMessage('info', '[GENESIS PROMPT] 创世提示词已清空并关闭。');
            }}
          />

          <PromptEditor
            cardId="temp-prompt-card"
            title="临时提示词 (任务指引)"
            hint="独立于创世提示词，随时可保存、修改、清空；仅在下次运行生效，补充当前任务指引。"
            placeholder="可输入当前任务的临时提示词 (如 VPS 运维指令)..."
            rows={4}
            promptData={tempPrompt}
            isRunning={isRunning}
            onSave={async (content) => {
              const res = await updateTemporaryPrompt(content);
              setTempPrompt(res);
              addLogMessage('success', `[TEMPORARY PROMPT] 临时提示词已保存 (Rev ${res.revision})。`);
            }}
            onClear={async () => {
              const res = await updateTemporaryPrompt('');
              setTempPrompt(res);
              addLogMessage('info', '[TEMPORARY PROMPT] 临时提示词已清空并关闭。');
            }}
          />
        </section>

        {/* 右侧地图与详情 */}
        <section style={{ flex: 1, display: 'flex', position: 'relative', overflow: 'hidden' }}>
          <PixelMapCanvas
            pixels={world?.pixels || []}
            messageFlow={world?.latest_message_flow || []}
            selectedPixelId={selectedPixelId}
            onSelectPixel={(id) => setSelectedPixelId(id)}
            onHoverPixel={() => {}}
          />

          <PixelDetails
            pixel={selectedPixel}
            onOpenDoc={handleOpenDoc}
            onOpenArtifacts={() => setIsArtifactsModalOpen(true)}
          />
        </section>
      </main>

      {/* 弹窗群 */}
      <EnvironmentEditor
        isOpen={isEnvModalOpen}
        onClose={() => setIsEnvModalOpen(false)}
        onLogMessage={addLogMessage}
      />

      <ToolCatalog
        isOpen={isToolsModalOpen}
        onClose={() => setIsToolsModalOpen(false)}
        onLogMessage={addLogMessage}
      />

      <PrivateFileBrowser
        isOpen={isPrivateFilesModalOpen}
        onClose={() => setIsPrivateFilesModalOpen(false)}
        onLogMessage={addLogMessage}
      />

      <ToolExecutionHistory
        isOpen={isToolExecutionsModalOpen}
        onClose={() => setIsToolExecutionsModalOpen(false)}
        onLogMessage={addLogMessage}
      />

      <ArtifactBrowser
        isOpen={isArtifactsModalOpen}
        pixelId={selectedPixelId}
        onClose={() => setIsArtifactsModalOpen(false)}
        onPreviewFile={handlePreviewArtifact}
        onLogMessage={addLogMessage}
      />

      <FilePreview
        isOpen={isPreviewDocOpen}
        title={previewDocTitle}
        content={previewDocContent}
        isLoading={isPreviewDocLoading}
        onClose={() => setIsPreviewDocOpen(false)}
      />
    </>
  );
};
