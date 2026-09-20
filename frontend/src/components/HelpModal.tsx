import React from 'react';
import { Modal } from './Modal';

export interface HelpModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/** V11 五层上下文说明（从左栏迁入，按需查看） */
export const HelpModal: React.FC<HelpModalProps> = ({ isOpen, onClose }) => (
  <Modal
    isOpen={isOpen}
    title="V11 五层上下文说明"
    onClose={onClose}
    contentClassName="doc-modal-content"
    footer={
      <button className="btn btn-secondary" onClick={onClose}>
        关闭
      </button>
    }
  >
    <ol className="help-list">
      <li><strong>CONSTITUTION</strong>：系统规则。当前 system 消息还包含工具目录、创世和临时提示词；它们不是 Pixel Self。</li>
      <li><strong>EXTERNAL</strong>：外部来源输入，Human Mandate 独立于 pixel.md。环境、人类指令与资料只有经 runtime 传入才进入此层；当前链路传入 Mandate，并非所有外部文件自动注入。</li>
      <li><strong>PIXEL SELF</strong>：元胞物理 state 与自主心智 pixel.md；删除 Mandate 不重置心智或历史。</li>
      <li><strong>YOUR FILES / PIXEL FILES</strong>：该元胞可用的私有 artifacts 文件列表，不是全局私有资料，也不自动读取全部文件正文。</li>
      <li><strong>LOCAL MESSAGES</strong>：当前投递给元胞的局部消息，不是全局聊天历史。</li>
    </ol>
  </Modal>
);
