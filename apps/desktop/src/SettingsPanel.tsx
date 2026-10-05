import { useEffect, useState } from "react";
import { SettingsError, isVaultProofHost, type Settings } from "@deck/settings";
import { loadSettings, saveSettings } from "./bridge";
import { ModelKeys } from "./ModelKeys";
import { EmbeddingsCard, TelegramCard } from "./ChatAndMemory";
import { ModelRoles } from "./ModelRoles";
import { RecoveryCard } from "./Recovery";
import { LearningCard } from "./Learning";
import { CrewCard } from "./Crew";
import { NotificationsCard, VoiceCard } from "./Voice";
import { CameraCard } from "./Camera";
import { BackupCard } from "./Backup";
import { LabsCard } from "./Labs";
import { ThinkingCard } from "./Thinking";
import { CustomCrewCard, HelpersCard } from "./CustomCrew";
import { SecurityCard } from "./Security";
import { OpenClawCard, SkillsHubCard } from "./SkillsHub";

export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const [s, setS] = useState<Settings | null>(null);
  const [url, setUrl] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    loadSettings().then((x) => {
      setS(x);
      setUrl(x.vaultproof.mcpUrl);
      setEnabled(x.vaultproof.enabled);
    });
  }, []);

  if (!s) return null;

  const save = async () => {
    setError(null);
    setSaved(false);
    try {
      const next = await saveSettings({ vaultproof: { mcpUrl: url, enabled } });
      setS(next);
      setUrl(next.vaultproof.mcpUrl);
      setSaved(true);
    } catch (e) {
      setError(e instanceof SettingsError ? e.message : "Could not save settings.");
    }
  };

  const otherHost = url.trim() !== "" && !error && !isVaultProofHost(url) && !/localhost|127\.0\.0\.1/.test(url);

  return (
    <section className="settings" aria-label="Settings">
      <div className="settings-head">
        <h2>Systems panel</h2>
        <button className="btn" type="button" onClick={onClose}>
          Close
        </button>
      </div>
      <ModelKeys />
      <ModelRoles s={s} onSaved={setS} />
      <EmbeddingsCard s={s} onSaved={setS} />
      <TelegramCard s={s} onSaved={setS} />
      <CrewCard />
      <SecurityCard s={s} onSaved={setS} />
      <CustomCrewCard />
      <HelpersCard s={s} onSaved={setS} />
      <VoiceCard s={s} onSaved={setS} />
      <NotificationsCard s={s} onSaved={setS} />
      <CameraCard s={s} onSaved={setS} />
      <ThinkingCard s={s} onSaved={setS} />
      <BackupCard />
      <LabsCard s={s} onSaved={setS} />
      <LearningCard />
      <SkillsHubCard s={s} onSaved={setS} />
      <OpenClawCard />
      <RecoveryCard />
      <div className="card">
        <h3>VaultProof</h3>
        <p className="muted">Connects the crew to the VaultProof MCP server so credentials are brokered by VaultProof instead of stored here. The server is almost ready; leave this off until it is live.</p>
        <label className="field">
          VaultProof MCP server URL
          <input value={url} onChange={(e) => (setUrl(e.target.value), setSaved(false))} placeholder="https://…vaultproof.dev/…" spellCheck={false} autoComplete="off" />
        </label>
        {otherHost && <p className="warn">This URL is not on vaultproof.dev. Only use it if you trust the server.</p>}
        <label className="check">
          <input type="checkbox" checked={enabled} onChange={(e) => (setEnabled(e.target.checked), setSaved(false))} />
          Connect to VaultProof
        </label>
        <p className="muted">Sign-in opens in your browser once the server is live. Your session is kept in the system keychain, never in this file.</p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="row">
          <button className="primary" type="button" onClick={save}>
            Save
          </button>
          <button className="btn" type="button" disabled title="Runs in the agent engine, the next build step">
            Test connection
          </button>
          {saved && <span className="ok">Saved. Takes effect on the next power-up.</span>}
        </div>
      </div>
    </section>
  );
}
