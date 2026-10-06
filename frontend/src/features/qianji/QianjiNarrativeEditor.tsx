import { t as tr, useLanguage } from '../../i18n';
import React, { useEffect, useState } from 'react';
import { importQianjiPortraitUrl, qianjiPortraitUrl, renameQianji, updateQianjiNarrative, uploadQianjiPortrait } from '../../api/qianji';
import type { QianjiProfileDto } from '../../api/qianji';

export const QianjiNarrativeEditor: React.FC<{ profile: QianjiProfileDto; onSaved: () => Promise<void> }> = ({ profile, onSaved }) => {
  useLanguage();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => JSON.stringify(profile.narrative, null, 2));
  const [draftRevision, setDraftRevision] = useState(profile.narrativeRevision);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [portraitUrl, setPortraitUrl] = useState('');
  const [displayName, setDisplayName] = useState(profile.narrative.displayName);

  useEffect(() => {
    if (!editing && draftRevision !== profile.narrativeRevision) {
      setDraft(JSON.stringify(profile.narrative, null, 2));
      setDraftRevision(profile.narrativeRevision);
    }
  }, [editing, draftRevision, profile.narrative, profile.narrativeRevision]);
  useEffect(() => { setDisplayName(profile.narrative.displayName); }, [profile.qianjiId, profile.narrative.displayName]);

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
      setError((tr("只支持不超过 2 MiB 的 PNG、JPEG 或 WebP 图片。")));
      event.target.value = '';
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error((tr("图片读取失败"))));
        reader.onerror = () => reject(new Error((tr("图片读取失败"))));
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

  if (profile.birthIdentity) {
    const birth = profile.birthIdentity;
    return <section className="qj-editor">
      <div className="qj-panel-heading"><h3>{tr("出生")}</h3><span>{tr("命核只读")}</span></div>
      <div className="qj-narrative-preview">
        <dl>
          <dt>{tr("出生时间")}</dt><dd>{new Date(profile.createdAt * 1000).toLocaleString()}</dd>
          <dt>{tr("本卦")}</dt><dd>{birth.primaryHexagram}</dd>
          <dt>{tr("动爻")}</dt><dd>{tr("第") + " "}{birth.movingLine} {" " + tr("爻")}</dd>
          <dt>{tr("变卦")}</dt><dd>{birth.changedHexagram}</dd>
          <dt>{tr("命核")}</dt><dd>{birth.birthText}</dd>
          <dt>{tr("姓名")}</dt><dd>{profile.narrative.displayName}</dd>
          <dt>{tr("简介")}</dt><dd>{profile.narrative.shortBio || (tr("未生成"))}</dd>
          <dt>{tr("画像提示词")}</dt><dd>{profile.narrative.appearanceSpec || (tr("未生成"))}</dd>
        </dl>
      </div>
      {profile.narrative.portraitAsset && <img className="org-archive-portrait"
        src={qianjiPortraitUrl(profile.qianjiId)} alt={tr("{0}画像", [profile.narrative.displayName])} />}
      {profile.careerStatus !== 'retired' && <>
        <form onSubmit={async event => {
          event.preventDefault(); setSaving(true); setError(null);
          try { await renameQianji(profile.qianjiId, profile.narrativeRevision, displayName.trim()); await onSaved(); }
          catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
          finally { setSaving(false); }
        }}>
          <label>{tr("姓名")}<input value={displayName} onChange={event => setDisplayName(event.target.value)}
            maxLength={80} required /></label>
          <button className="btn" type="submit" disabled={saving || !displayName.trim() ||
            displayName.trim() === profile.narrative.displayName}>{tr("保存姓名")}</button>
        </form>
        <label className="btn qj-upload-button">{tr("导入本地图片")}<input type="file"
          accept="image/png,image/jpeg,image/webp" onChange={upload} disabled={saving} /></label>
        <form className="gacha-import" onSubmit={importUrl}><label>{tr("网络图片地址")}<input type="url" value={portraitUrl} onChange={event => setPortraitUrl(event.target.value)}
            placeholder="https://…/portrait.png" maxLength={2048} required /></label>
          <button className="btn" disabled={saving || !portraitUrl.trim()}>{tr("导入网络图片")}</button></form>
      </>}
      {error && <p role="alert" className="qj-inline-error">{error}</p>}
    </section>;
  }

  return (
    <section className="qj-editor">
      <div className="qj-panel-heading"><h3>{tr("人设与图片")}</h3><span>{tr("稳定身份 ID · 内容版本") + " "}{profile.narrativeRevision}</span></div>
      {error && <p role="alert" className="qj-inline-error">{error}</p>}
      {editing ? (
        <form onSubmit={save}>
          <label htmlFor="qj-narrative-json">{tr("完整人设 JSON")}</label>
          <textarea id="qj-narrative-json" className="qj-json-editor" value={draft} onChange={event => setDraft(event.target.value)} rows={14} spellCheck={false} />
          <div className="qj-form-footer"><button type="button" className="btn" onClick={() => { setDraft(JSON.stringify(profile.narrative, null, 2)); setEditing(false); setError(null); }}>{tr("取消")}</button><button type="submit" className="btn btn-primary" disabled={saving}>{saving ? (tr("保存中…")) : (tr("保存人设"))}</button></div>
        </form>
      ) : (
        <div className="qj-narrative-preview">
          <dl>
            <dt>{tr("身份 ID")}</dt><dd>{profile.qianjiId}</dd>
            <dt>{tr("称号 / 职位")}</dt><dd>{[profile.narrative.title, profile.narrative.roleLabel].filter(Boolean).join(' · ') || (tr("未设置"))}</dd>
            <dt>{tr("性格特征")}</dt><dd>{Object.keys(profile.narrative.traits).length ? JSON.stringify(profile.narrative.traits) : (tr("未设置"))}</dd>
            <dt>{tr("行为原则")}</dt><dd>{profile.narrative.behaviorProfile.join('；') || (tr("未设置"))}</dd>
            <dt>{tr("缺陷")}</dt><dd>{profile.narrative.flaw || (tr("未设置"))}</dd>
            <dt>{tr("简介")}</dt><dd>{profile.narrative.shortBio || (tr("未设置"))}</dd>
          </dl>
          {profile.careerStatus !== 'retired' && <><div className="qj-form-footer"><button className="btn" type="button" onClick={() => { setDraft(JSON.stringify(profile.narrative, null, 2)); setDraftRevision(profile.narrativeRevision); setEditing(true); }}>{tr("编辑人设")}</button><label className="btn qj-upload-button">{tr("导入本地图片")}<input type="file" accept="image/png,image/jpeg,image/webp" onChange={upload} disabled={saving} /></label></div>
          <form className="gacha-import" onSubmit={importUrl}><label>{tr("网络图片地址")}<input type="url" value={portraitUrl} onChange={event => setPortraitUrl(event.target.value)} placeholder="https://…/portrait.png" maxLength={2048} required /></label><button className="btn" disabled={saving || !portraitUrl.trim()}>{tr("导入网络图片")}</button></form></>}
        </div>
      )}
    </section>
  );
};
