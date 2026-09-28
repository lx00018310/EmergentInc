import React, { useEffect, useState } from 'react';
import { importQianjiPortraitUrl, updateQianjiNarrative, uploadQianjiPortrait } from '../../api/qianji';
import type { QianjiProfileDto } from '../../api/qianji';

export const QianjiNarrativeEditor: React.FC<{ profile: QianjiProfileDto; onSaved: () => Promise<void> }> = ({ profile, onSaved }) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => JSON.stringify(profile.narrative, null, 2));
  const [draftRevision, setDraftRevision] = useState(profile.narrativeRevision);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [portraitUrl, setPortraitUrl] = useState('');

  useEffect(() => {
    if (!editing && draftRevision !== profile.narrativeRevision) {
      setDraft(JSON.stringify(profile.narrative, null, 2));
      setDraftRevision(profile.narrativeRevision);
    }
  }, [editing, draftRevision, profile.narrative, profile.narrativeRevision]);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const parsed: unknown = JSON.parse(draft);
      await updateQianjiNarrative(profile.qianjiId, profile.narrativeRevision, parsed as any);
      await onSaved();
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally { setSaving(false); }
  };

  const upload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 2 * 1024 * 1024) {
      setError('只支持不超过 2 MiB 的 PNG、JPEG 或 WebP 图片。');
      event.target.value = '';
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('图片读取失败'));
        reader.onerror = () => reject(new Error('图片读取失败'));
        reader.readAsDataURL(file);
      });
      await uploadQianjiPortrait(profile.qianjiId, profile.narrativeRevision, file.type, dataUrl.split(',')[1] || '');
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally { setSaving(false); event.target.value = ''; }
  };

  const importUrl = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true); setError(null);
    try {
      await importQianjiPortraitUrl(profile.qianjiId, profile.narrativeRevision, portraitUrl.trim());
      await onSaved();
      setPortraitUrl('');
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setSaving(false); }
  };

  return (
    <section className="qj-editor">
      <div className="qj-panel-heading"><h3>人设与图片</h3><span>稳定身份 ID · 内容版本 {profile.narrativeRevision}</span></div>
      {error && <p role="alert" className="qj-inline-error">{error}</p>}
      {editing ? (
        <form onSubmit={save}>
          <label htmlFor="qj-narrative-json">完整人设 JSON</label>
          <textarea id="qj-narrative-json" className="qj-json-editor" value={draft} onChange={event => setDraft(event.target.value)} rows={14} spellCheck={false} />
          <div className="qj-form-footer"><button type="button" className="btn" onClick={() => { setDraft(JSON.stringify(profile.narrative, null, 2)); setEditing(false); setError(null); }}>取消</button><button type="submit" className="btn btn-primary" disabled={saving}>{saving ? '保存中…' : '保存人设'}</button></div>
        </form>
      ) : (
        <div className="qj-narrative-preview">
          <dl>
            <dt>身份 ID</dt><dd>{profile.qianjiId}</dd>
            <dt>称号 / 职位</dt><dd>{[profile.narrative.title, profile.narrative.roleLabel].filter(Boolean).join(' · ') || '未设置'}</dd>
            <dt>性格特征</dt><dd>{Object.keys(profile.narrative.traits).length ? JSON.stringify(profile.narrative.traits) : '未设置'}</dd>
            <dt>行为原则</dt><dd>{profile.narrative.behaviorProfile.join('；') || '未设置'}</dd>
            <dt>缺陷</dt><dd>{profile.narrative.flaw || '未设置'}</dd>
            <dt>简介</dt><dd>{profile.narrative.shortBio || '未设置'}</dd>
          </dl>
          {profile.careerStatus !== 'retired' && <><div className="qj-form-footer"><button className="btn" type="button" onClick={() => { setDraft(JSON.stringify(profile.narrative, null, 2)); setDraftRevision(profile.narrativeRevision); setEditing(true); }}>编辑人设</button><label className="btn qj-upload-button">导入本地图片<input type="file" accept="image/png,image/jpeg,image/webp" onChange={upload} disabled={saving} /></label></div>
          <form className="gacha-import" onSubmit={importUrl}><label>网络图片地址<input type="url" value={portraitUrl} onChange={event => setPortraitUrl(event.target.value)} placeholder="https://…/portrait.png" maxLength={2048} required /></label><button className="btn" disabled={saving || !portraitUrl.trim()}>导入网络图片</button></form></>}
        </div>
      )}
    </section>
  );
};
