import type { Dispatch, SetStateAction } from "react";
import type { HostMediaSettings } from "../media/hostSettings.js";

interface QualityPanelProps {
  captureActive: boolean;
  hostSettings: HostMediaSettings;
  setAutomaticBitrate: (automatic: boolean) => void;
  setHostSettings: Dispatch<SetStateAction<HostMediaSettings>>;
}

export function QualityPanel(props: QualityPanelProps) {
  const { captureActive, hostSettings, setAutomaticBitrate, setHostSettings } = props;
  return (
    <section className="quality-panel" aria-labelledby="quality-heading">
      <div className="quality-heading">
        <div>
          <p className="eyebrow">Live controls</p>
          <h2 id="quality-heading">Sharing quality</h2>
        </div>
        <p>{captureActive ? "Changes apply while sharing." : "Set preferences before sharing."}</p>
      </div>
      <div className="quality-grid">
        <label>
          Bitrate control
          <select
            onChange={(event) => setAutomaticBitrate(event.target.value === "automatic")}
            value={hostSettings.bitrateUserEdited ? "manual" : "automatic"}
          >
            <option value="automatic">Automatic ceiling</option>
            <option value="manual">Manual ceiling</option>
          </select>
        </label>
        <label>
          Maximum bitrate
          <div className="input-with-unit">
            <input
              disabled={!hostSettings.bitrateUserEdited}
              max={100}
              min={0.25}
              onChange={(event) =>
                setHostSettings((current) => ({
                  ...current,
                  maxBitrateBps: Math.max(250_000, Number(event.target.value) * 1_000_000),
                  bitrateUserEdited: true,
                }))
              }
              step={0.25}
              type="number"
              value={hostSettings.maxBitrateBps / 1_000_000}
            />
            <span>Mbps</span>
          </div>
        </label>
        <label>
          Maximum frame rate
          <div className="input-with-unit">
            <input
              disabled={captureActive}
              max={240}
              min={1}
              onChange={(event) =>
                setHostSettings((current) => ({
                  ...current,
                  maxFps: Math.max(1, Number(event.target.value)),
                  fpsUserEdited: true,
                }))
              }
              type="number"
              value={hostSettings.maxFps}
            />
            <span>FPS</span>
          </div>
        </label>
        <div className="quality-mode">
          <span>Video optimization</span>
          <strong>Balanced</strong>
          <small>Protects smooth motion, then restores detail as headroom returns.</small>
        </div>
        <label className="checkbox-label quality-checkbox">
          <input
            checked={hostSettings.hdrEnabled}
            disabled={captureActive}
            onChange={(event) =>
              setHostSettings((current) => ({ ...current, hdrEnabled: event.target.checked }))
            }
            type="checkbox"
          />
          HDR if supported
        </label>
      </div>
      <p className="control-note">
        Automatic adapts the quality ceiling to the live path. Resolution yields before frame
        cadence, then recovers gradually. HDR is preserved only when the complete path supports it.
      </p>
    </section>
  );
}
