// Pre-import gate. Runs from `bin/atoa.js` BEFORE any other CLI module loads,
// so the NODE_TLS_REJECT_UNAUTHORIZED check happens before `undici` constructs
// any TLS context. Only `./env` is allowed as a dep here — it has no side
// effects and pulls in no network/runtime modules.
import {assertSecureBaseUrl} from "./env";

export function assertTlsHardenedEnv(): void {
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0") {
    throw new Error(
      "NODE_TLS_REJECT_UNAUTHORIZED=0 disables certificate validation and is not permitted. " +
        "Unset the variable and re-run."
    );
  }
  assertSecureBaseUrl();
}
