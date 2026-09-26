import React from 'react';
import type { QianjiListItemDto } from '../../api/qianji';
import { qianjiPortraitUrl } from '../../api/qianji';

const careerLabels: Record<string, string> = {
  candidate: '候选', trial: '试炼', active: '正式成员', retired: '已退役',
};

export interface QianjiCardProps {
  item: QianjiListItemDto;
  selected: boolean;
  onSelect: (qianjiId: string) => void;
}

export const QianjiCard: React.FC<QianjiCardProps> = ({ item, selected, onSelect }) => {
  const { profile, currentBinding, physical } = item;
  const [imageFailed, setImageFailed] = React.useState(false);
  return (
    <button
      className={`qj-card${selected ? ' selected' : ''}`}
      type="button"
      aria-pressed={selected}
      onClick={() => onSelect(profile.qianjiId)}
    >
      <div className="qj-card-portrait">
        {profile.narrative.portraitAsset && !imageFailed
          ? <img src={qianjiPortraitUrl(profile.qianjiId)} alt={`${profile.narrative.displayName} 角色画像`} onError={() => setImageFailed(true)} />
          : <span aria-label="暂无角色图片">未设画像</span>}
      </div>
      <div className="qj-card-copy">
        <strong>{profile.narrative.displayName}</strong>
        <span>{profile.narrative.title || profile.narrative.roleLabel || '未设置称号'}</span>
        <div className="qj-card-badges">
          <span>{careerLabels[profile.careerStatus] || profile.careerStatus}</span>
          <span>{physical?.active ? '载体活跃' : currentBinding ? '载体失活' : '未绑定 Pixel'}</span>
        </div>
        <small>{currentBinding ? `${currentBinding.pixelId} · 第 ${currentBinding.incarnation} 代` : profile.qianjiId}</small>
      </div>
    </button>
  );
};
