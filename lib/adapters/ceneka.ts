import type {
  CenekaSettings,
  EventSink,
  Platform,
  SourceAdapter,
  StatusSink,
} from "../types";

/**
 * Ceneka (ceneka.net) is a donations platform rather than a streaming one — the
 * Streamlabs/Ko-fi slot in this lineup, and the one source whose events would be
 * pure tips.
 *
 * It is not implemented because there is no public developer documentation for
 * it: no webhook spec, no socket endpoint, no event schema. Rather than invent
 * one, this adapter holds the seam open and says so in the UI.
 *
 * To finish it, we most likely need an alert-box / widget URL from the Ceneka
 * dashboard (these usually embed a per-user socket token). With one in hand,
 * this becomes a socket connection mapping their payload to a StreamEvent with
 * `kind: "tip"` and an ARS/USD Amount — the rest of the app needs no changes.
 */
export class CenekaAdapter implements SourceAdapter<CenekaSettings> {
  platform: Platform = "ceneka";

  async connect(_config: CenekaSettings, _onEvent: EventSink, onStatus: StatusSink) {
    onStatus({
      state: "unavailable",
      detailKey: "cenekaUnavailable",
    });
  }

  disconnect() {
    // Nothing to tear down.
  }
}
