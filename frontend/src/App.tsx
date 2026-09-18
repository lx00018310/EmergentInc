import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useWorldPolling } from './hooks/useWorldPolling';
import { RunStatus } from './features/run/RunStatus';
import { RunControls } from './features/run/RunControls';
import { ConsolePanel, ConsoleMessage } from './features/run/ConsolePanel';
import { PromptEditor } from './features/prompts/PromptEditor';
import { EnvironmentEditor } from './features/environment/EnvironmentEditor';
import { PixelMapCanvas } from './features/pixels/PixelMapCanvas';
import { PixelDetails } from './features/pixels/PixelDetails';
import { PixelOperations, type PixelOperationTab } from './features/pixels/PixelOperations';
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
import { fetchPixelDocument, fetchPixelArtifact, getArtifactDownloadUrl } from './api/files';
import { RecoveryOperations } from './features/run/RecoveryOperations';
import type { PromptDto } from './api/types';

export const App: React.FC = () => {
  const { world, runStatus, audit, error: pollingError, refreshImmediately } = useWorldPolling();

  // 控制台日志
  const [messages, setMessages] = useState<ConsoleMessage[]>([
    {
      id: 'init',
      type: 'system',
      text: '[SYSTEM] V11 商业元胞自动机控制台 (React + TypeScript) 核心就绪。',
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

  useEffect(() => {
    if (!runStatus?.running && runStatus?.run_id && runStatus?.result_status && runStatus.result_status !== 'READY') {
      // RECOVERY_RESOLVED = historical failure whose unknown items were resolved;
      // surface once as info, not as a recurring error on every page load.
      if (runStatus.result_status === 'RECOVERY_RESOLVED') {
        addLogMessage('info',
          `[RUN RESOLVED] ${runStatus.stop_reason ?? ''} ${runStatus.error_code ?? ''} — 未决项已逐项审计处理，可正常启动。历史错误: ${runStatus.error_summary ?? runStatus.last_error ?? ''}`);
      } else {
        addLogMessage(runStatus.result_status === 'FAILED' ? 'error' : 'warn',
          `[RUN ${runStatus.result_status}] ${runStatus.stop_reason ?? ''} ${runStatus.error_code ?? ''} ${runStatus.error_summary ?? runStatus.last_error ?? ''}`);
      }
    }
  }, [runStatus?.run_id, runStatus?.result_status, runStatus?.stop_reason, runStatus?.error_summary, runStatus?.last_error, addLogMessage]);

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

  // Tips 已读状态：仅存 localStorage（Owner UI 显示状态，不属于世界真值）
  const [tipsReadRevision, setTipsReadRevision] = useState(0);
  const tipsReadKey = (pixelId: string) => `emergentinc.tips.read.${pixelId}`;
  const isTipsUnread = useCallback((pixel: { id: string; tips_md?: string; tips_version?: string }) => {
    return Boolean(
      (pixel.tips_md ?? '').trim() &&
      localStorage.getItem(tipsReadKey(pixel.id)) !== String(pixel.tips_version ?? '')
    );
  }, []);
  const markTipsRead = useCallback((pixel: { id: string; tips_version?: string }) => {
    localStorage.setItem(tipsReadKey(pixel.id), String(pixel.tips_version ?? ''));
    setTipsReadRevision((v) => v + 1);
  }, []);
  const unreadTipsPixelIds = useMemo(() => {
    const ids = new Set<string>();
    for (const p of world?.pixels || []) {
      if (isTipsUnread(p)) ids.add(p.id);
    }
    return ids;
  }, [world, isTipsUnread, tipsReadRevision]);

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
  const [pixelOperation, setPixelOperation] = useState<{ pixelId: string; tab: PixelOperationTab } | null>(null);

  // 统一预览弹窗 (支持文本、图片、二进制多模态)
  const [previewTitle, setPreviewTitle] = useState<string>('');
  const [previewContent, setPreviewContent] = useState<string>('');
  const [isPreviewLoading, setIsPreviewLoading] = useState<boolean>(false);
  const [isPreviewOpen, setIsPreviewOpen] = useState<boolean>(false);
  const [previewType, setPreviewType] = useState<'text' | 'image' | 'binary'>('text');
  const [previewDownloadUrl, setPreviewDownloadUrl] = useState<string | undefined>(undefined);
  const [previewFilename, setPreviewFilename] = useState<string | undefined>(undefined);

  const handleOpenDoc = async (docName: string) => {
    if (!selectedPixelId) return;
    setIsPreviewLoading(true);
    setPreviewTitle(`元胞 ${selectedPixelId} - ${docName}`);
    setPreviewType('text');
    setPreviewDownloadUrl(undefined);
    setPreviewFilename(undefined);
    setIsPreviewOpen(true);
    try {
      const res = await fetchPixelDocument(selectedPixelId, docName);
      setPreviewContent(res.content || '');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setPreviewContent(`[FAILED TO LOAD DOCUMENT] ${msg}`);
    } finally {
      setIsPreviewLoading(false);
    }
  };

  const handlePreviewArtifact = async (title: string, filename: string) => {
    if (!selectedPixelId) return;
    const downloadUrl = getArtifactDownloadUrl(selectedPixelId, filename);
    setPreviewTitle(title);
    setPreviewFilename(filename);
    setPreviewDownloadUrl(downloadUrl);
    setIsPreviewOpen(true);

    const isImage = /\.(jpe?g|png|webp|gif|bmp|svg)$/i.test(filename);
    const isBinary = /\.(zip|tar|gz|7z|rar|pdf|exe|bin|iso|wasm|pyc)$/i.test(filename);

    if (isImage) {
      setPreviewType('image');
      setIsPreviewLoading(false);
      setPreviewContent('');
      return;
    }

    if (isBinary) {
      setPreviewType('binary');
      setIsPreviewLoading(false);
      setPreviewContent('');
      return;
    }

    // 默认作为文本文件，通过独立交付物接口获取
    setPreviewType('text');
    setIsPreviewLoading(true);
    try {
      const res = await fetchPixelArtifact(selectedPixelId, filename);
      setPreviewContent(res.content || '');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setPreviewContent(
        `[FAILED TO LOAD ARTIFACT] ${msg}\n\n该交付物可能包含非 UTF-8 编码或为二进制文件，请点击右下角按钮直接下载原始文件查看。`
      );
    } finally {
      setIsPreviewLoading(false);
    }
  };

  const handleSelectPixel = useCallback((id: string) => {
    setSelectedPixelId(id);
  }, []);

  const handleHoverPixel = useCallback((_id: string | null) => {}, []);

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

          <details className="panel-card context-guide">
            <summary>V11 五层上下文说明</summary>
            <ol>
              <li><strong>CONSTITUTION</strong>：系统规则。当前 system 消息还包含工具目录、创世和临时提示词；它们不是 Pixel Self。</li>
              <li><strong>EXTERNAL</strong>：外部来源输入，Human Mandate 独立于 pixel.md。环境、人类指令与资料只有经 runtime 传入才进入此层；当前链路传入 Mandate，并非所有外部文件自动注入。</li>
              <li><strong>PIXEL SELF</strong>：元胞物理 state 与自主心智 pixel.md；删除 Mandate 不重置心智或历史。</li>
              <li><strong>YOUR FILES / PIXEL FILES</strong>：该元胞可用的私有 artifacts 文件列表，不是全局私有资料，也不自动读取全部文件正文。</li>
              <li><strong>LOCAL MESSAGES</strong>：当前投递给元胞的局部消息，不是全局聊天历史。</li>
            </ol>
          </details>

          <ConsolePanel
            messages={messages}
            audit={audit}
            runStatus={runStatus}
          />

          {!isRunning && runStatus?.unfinalized_operations && <RecoveryOperations status={runStatus} onRefresh={refreshImmediately} />}

          <PromptEditor
            cardId="genesis-card"
            title="创世提示词 (临时初速度)"
            hint="当前注入 system 消息的 GENESIS_CONTEXT，作为临时初速度；不是 Pixel Self，也不写入 pixel.md。运行期间不可编辑，清空后后续运行不再注入。"
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
            hint="独立的 TEMPORARY_CONTEXT，当前注入 system 消息，不是单个元胞的 Human Mandate；仅在空闲时编辑，下次运行生效。"
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
            unreadTipsPixelIds={unreadTipsPixelIds}
            onSelectPixel={handleSelectPixel}
            onHoverPixel={handleHoverPixel}
          />

          <PixelDetails
            pixel={selectedPixel}
            isTipsUnread={isTipsUnread}
            onMarkTipsRead={markTipsRead}
            onOpenDoc={handleOpenDoc}
            onOpenArtifacts={() => setIsArtifactsModalOpen(true)}
            onOpenOperation={(tab) => { if (selectedPixelId) setPixelOperation({ pixelId: selectedPixelId, tab }); }}
          />
        </section>
      </main>

      {/* 弹窗群 */}
      {pixelOperation && <PixelOperations
        key={pixelOperation.pixelId}
        pixelId={pixelOperation.pixelId}
        initialTab={pixelOperation.tab}
        onClose={() => setPixelOperation(null)}
        onRefresh={refreshImmediately}
      />}
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
        isOpen={isPreviewOpen}
        title={previewTitle}
        content={previewContent}
        isLoading={isPreviewLoading}
        previewType={previewType}
        downloadUrl={previewDownloadUrl}
        filename={previewFilename}
        onClose={() => setIsPreviewOpen(false)}
      />
    </>
  );
};
