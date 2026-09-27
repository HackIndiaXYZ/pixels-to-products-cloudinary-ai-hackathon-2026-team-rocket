'use client';

import { useState } from 'react';
import { DEMO_CLOUD, ENV_SETTINGS, isValidCloudName, isValidTag } from '@/lib/cloudinary/config';
import type { CloudSettings } from '@/lib/types';
import { Dialog } from '@/components/ui/Dialog';
import { useConsoleActions, useConsoleData, useConsoleUi } from './store';

export function SettingsDialog() {
  const { settingsOpen, setSettingsOpen } = useConsoleUi();
  const { backend } = useConsoleData();
  return (
    <Dialog
      open={settingsOpen}
      onClose={() => setSettingsOpen(false)}
      title="Cloudinary connection"
      description="Where uploads go and what the library reads. The browser only ever holds public values — an API secret stays on the server."
      className="max-w-[560px]"
    >
      {backend?.configured ? <ServerConnection /> : <SettingsForm />}
    </Dialog>
  );
}

function SettingsForm() {
  const { settings, setSettings, resetSettings, settingsOverridden } = useConsoleData();
  const { setSettingsOpen } = useConsoleActions();
  const [draft, setDraft] = useState<CloudSettings>(settings);
  const cloudOk = isValidCloudName(draft.cloudName);
  const tagOk = isValidTag(draft.tag);
  const presetOk = draft.uploadPreset === '' || /^[\w-]{1,80}$/.test(draft.uploadPreset);

  return (
    <form
      className="space-y-4 px-5 py-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (!cloudOk || !tagOk || !presetOk) return;
        setSettings({ cloudName: draft.cloudName.trim(), uploadPreset: draft.uploadPreset.trim(), tag: draft.tag.trim() });
        setSettingsOpen(false);
      }}
    >
      <label className="block space-y-1">
        <span className="text-[12.5px] text-ink-2">Cloud name</span>
        <input name="cloudName" className="input font-mono" value={draft.cloudName} onChange={(e) => setDraft({ ...draft, cloudName: e.target.value })} autoComplete="off" autoCapitalize="none" spellCheck={false} />
        {!cloudOk && <span className="text-[11.5px] text-critical">Letters, numbers, dashes and underscores.</span>}
      </label>
      <label className="block space-y-1">
        <span className="text-[12.5px] text-ink-2">Unsigned upload preset</span>
        <input name="uploadPreset"
          className="input font-mono"
          value={draft.uploadPreset}
          placeholder="e.g. visualops_unsigned"
          onChange={(e) => setDraft({ ...draft, uploadPreset: e.target.value })}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
        />
        <span className="block text-[11.5px] leading-relaxed text-ink-3">
          Create it in the Cloudinary console: Settings → Upload → Upload presets → Add → Signing mode “Unsigned”. Add AI auto-tagging there if your plan includes it.
        </span>
        {!presetOk && <span className="text-[11.5px] text-critical">Preset names use letters, numbers, dashes and underscores.</span>}
      </label>
      <label className="block space-y-1">
        <span className="text-[12.5px] text-ink-2">VisualOps tag</span>
        <input name="tag" className="input font-mono" value={draft.tag} onChange={(e) => setDraft({ ...draft, tag: e.target.value })} autoComplete="off" autoCapitalize="none" spellCheck={false} />
        <span className="block text-[11.5px] text-ink-3">Added to every upload; Sync reads assets carrying it.</span>
      </label>

      <div className="rounded-[9px] border border-line bg-raised px-3 py-2.5 text-[12px] leading-relaxed text-ink-3">
        The bundled sample dataset always renders from Cloudinary’s public <span className="font-mono text-ink-2">{DEMO_CLOUD}</span> cloud. These settings affect uploads and sync.
        Build defaults come from <span className="font-mono text-ink-2">.env.local</span> (cloud: <span className="font-mono text-ink-2">{ENV_SETTINGS.cloudName}</span>
        {ENV_SETTINGS.uploadPreset ? ', preset set' : ', no preset'}); changes here are saved in this browser only.
      </div>

      <div className="flex items-center justify-between gap-2 pt-1">
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={!settingsOverridden}
          onClick={() => {
            resetSettings();
            setDraft(ENV_SETTINGS);
          }}
        >
          Reset to .env defaults
        </button>
        <button type="submit" className="btn btn-primary btn-sm" disabled={!cloudOk || !tagOk || !presetOk}>
          Save
        </button>
      </div>
    </form>
  );
}

/** The server holds the Cloudinary credentials: show the connection, nothing to edit in the browser. */
function ServerConnection() {
  const { backend, cloud } = useConsoleData();
  const { setSettingsOpen } = useConsoleActions();
  const rows: Array<[string, string]> = [
    ['Cloud name', backend?.cloudName ?? '—'],
    ['Uploads', backend?.uploadPreset ? `signed by the server · preset ${backend.uploadPreset}` : 'signed by the server'],
    ['VisualOps tag', backend?.tag ?? '—'],
    ['Records in the cloud', cloud.status === 'ready' ? String(cloud.count) : cloud.status === 'loading' ? 'reading…' : cloud.status === 'error' ? 'unavailable' : '—'],
  ];
  return (
    <div className="space-y-4 px-5 py-5">
      <dl className="divide-y divide-line rounded-[9px] border border-line">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-baseline justify-between gap-4 px-3 py-2.5">
            <dt className="text-[12.5px] text-ink-3">{k}</dt>
            <dd className="min-w-0 break-words text-right font-mono text-[12px] text-ink sm:truncate">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="rounded-[9px] border border-line bg-raised px-3 py-2.5 text-[12px] leading-relaxed text-ink-3">
        Configured on the server with <span className="font-mono text-ink-2">CLOUDINARY_CLOUD_NAME</span>,{' '}
        <span className="font-mono text-ink-2">CLOUDINARY_API_KEY</span>, <span className="font-mono text-ink-2">CLOUDINARY_API_SECRET</span> and{' '}
        <span className="font-mono text-ink-2">CLOUDINARY_UPLOAD_PRESET</span>. The secret never reaches this browser. The console runs on the records in
        this cloud; only when it has none yet does it show the bundled sample dataset from Cloudinary’s public{' '}
        <span className="font-mono text-ink-2">{DEMO_CLOUD}</span> cloud.
      </p>
      <div className="flex justify-end">
        <button type="button" data-autofocus className="btn btn-primary btn-sm" onClick={() => setSettingsOpen(false)}>
          Done
        </button>
      </div>
    </div>
  );
}
