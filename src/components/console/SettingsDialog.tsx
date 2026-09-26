'use client';

import { useState } from 'react';
import { DEMO_CLOUD, ENV_SETTINGS, isValidCloudName, isValidTag } from '@/lib/cloudinary/config';
import type { CloudSettings } from '@/lib/types';
import { Dialog } from '@/components/ui/Dialog';
import { useConsole } from './store';

export function SettingsDialog() {
  const { settingsOpen, setSettingsOpen } = useConsole();
  return (
    <Dialog
      open={settingsOpen}
      onClose={() => setSettingsOpen(false)}
      title="Cloudinary"
      description="Where uploads go and what Sync reads. Only public values — VisualOps never asks for an API secret."
      className="max-w-[560px]"
    >
      <SettingsForm />
    </Dialog>
  );
}

function SettingsForm() {
  const { settings, setSettings, resetSettings, settingsOverridden, setSettingsOpen } = useConsole();
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
        <input className="input font-mono" value={draft.cloudName} onChange={(e) => setDraft({ ...draft, cloudName: e.target.value })} autoComplete="off" spellCheck={false} />
        {!cloudOk && <span className="text-[11.5px] text-critical">Letters, numbers, dashes and underscores.</span>}
      </label>
      <label className="block space-y-1">
        <span className="text-[12.5px] text-ink-2">Unsigned upload preset</span>
        <input
          className="input font-mono"
          value={draft.uploadPreset}
          placeholder="e.g. visualops_unsigned"
          onChange={(e) => setDraft({ ...draft, uploadPreset: e.target.value })}
          autoComplete="off"
          spellCheck={false}
        />
        <span className="block text-[11.5px] leading-relaxed text-ink-3">
          Create it in the Cloudinary console: Settings → Upload → Upload presets → Add → Signing mode “Unsigned”. Add AI auto-tagging there if your plan includes it.
        </span>
        {!presetOk && <span className="text-[11.5px] text-critical">Preset names use letters, numbers, dashes and underscores.</span>}
      </label>
      <label className="block space-y-1">
        <span className="text-[12.5px] text-ink-2">VisualOps tag</span>
        <input className="input font-mono" value={draft.tag} onChange={(e) => setDraft({ ...draft, tag: e.target.value })} autoComplete="off" spellCheck={false} />
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
