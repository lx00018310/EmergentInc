import React, { useEffect, useRef, useState } from 'react';
import type { QianjiListItemDto } from '../../api/qianji';
import { qianjiPortraitUrl } from '../../api/qianji';

const careerLabels: Record<string, string> = {
  candidate: '候选', trial: '试炼', active: '正式成员', retired: '已退役',
};

export type QianjiMenuAction = 'history' | 'narrative' | 'retire' | 'meeting';

export interface QianjiCardProps {
  item: QianjiListItemDto;
  selected: boolean;
  onSelect: (qianjiId: string) => void;
  onMenuAction?: (qianjiId: string, action: QianjiMenuAction) => void;
  showMeetingAction?: boolean;
}

import { TechGoggleAvatar } from './TechGoggleAvatar';


export const QianjiCard: React.FC<QianjiCardProps> = ({ item, selected, onSelect, onMenuAction, showMeetingAction }) => {
  const { profile, currentBinding, physical } = item;
  const [imageFailed, setImageFailed] = React.useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen]);

  const fire = (action: QianjiMenuAction) => {
    setMenuOpen(false);
    onSelect(profile.qianjiId);
    onMenuAction?.(profile.qianjiId, action);
  };

  return (
    <div className={`qj-card-row${selected ? ' selected' : ''}`}>
      <button
        className="qj-card"
        type="button"
        aria-pressed={selected}
        onClick={() => onSelect(profile.qianjiId)}
      >
        <div className="qj-card-portrait">
          {profile.narrative.portraitAsset && !imageFailed
            ? <img src={qianjiPortraitUrl(profile.qianjiId)} alt={`${profile.narrative.displayName} 角色画像`} onError={() => setImageFailed(true)} />
            : <>
                <TechGoggleAvatar />
                <span className="sr-only">未设画像</span>
              </>}
        </div>
        <div className="qj-card-copy">
          <strong>{profile.narrative.displayName}</strong>
          <span className="qj-hexagram-tag">
            <span style={{ color: 'var(--tj-gold)', marginRight: 2 }}>☰</span>
            {profile.birthIdentity
              ? `${profile.birthIdentity.primaryHexagram} → ${profile.birthIdentity.changedHexagram}`
              : '极地机巧推演中'}
          </span>
          <div className="qj-card-badges">
            <span>{careerLabels[profile.careerStatus] || profile.careerStatus}</span>
            <span style={{ color: physical?.active ? 'var(--tj-accent)' : 'var(--tj-text-dim)' }}>
              {physical?.active ? '● 载体活跃' : currentBinding ? '○ 载体失活' : '未绑定 Pixel'}
            </span>
          </div>
          <small>{new Date(profile.createdAt * 1000).toLocaleDateString()}</small>
        </div>
      </button>
      <div className="qj-card-menu" ref={menuRef}>
        <button
          className="qj-card-more"
          type="button"
          aria-label={`${profile.narrative.displayName}更多操作`}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen(open => !open)}
        >…</button>
        {menuOpen && (
          <div className="qj-menu-popover" role="menu" aria-label={`${profile.narrative.displayName}操作菜单`}>
            <button type="button" role="menuitem" onClick={() => fire('history')}>经历</button>
            <button type="button" role="menuitem" onClick={() => fire('narrative')}>出生</button>
            {showMeetingAction && <button type="button" role="menuitem" onClick={() => fire('meeting')}>发起会议</button>}
            {profile.careerStatus !== 'retired' && <button type="button" role="menuitem" onClick={() => fire('retire')}>办理退役</button>}
          </div>
        )}
      </div>
    </div>
  );
};
