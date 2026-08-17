import {spawn, type ChildProcess} from "node:child_process";

/** How long to wait for the opener to finish before assuming it is holding the browser open. */
const OPENER_TIMEOUT_MS = 4000;

/**
 * Opens `url` in the user's default browser without adding any dependency.
 *
 * Resolves `true` only when the opener actually succeeded, `false` on any failure — it NEVER
 * throws. Callers must treat `false` as "show the URL and let the user open it manually", not
 * as a fatal error.
 *
 * The outcome is read from the opener's exit code, not from the spawn succeeding. `spawn` only
 * reports that the shell started; `Start-Process`/`xdg-open` can still fail after that (no
 * browser association, a blocked execution policy), and reporting those as success meant the
 * "open it manually" fallback never printed and the user was left staring at nothing.
 *
 * An opener still running after OPENER_TIMEOUT_MS is treated as success: some hold the
 * browser process for its whole lifetime, and waiting on that would hang the CLI.
 */
export async function openBrowser(url: string): Promise<boolean> {
  const {command, args} = openerFor(process.platform, url);

  return new Promise<boolean>((resolve) => {
    let settled = false;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(ok);
    };

    const timer = setTimeout(() => {
      child?.unref();
      done(true);
    }, OPENER_TIMEOUT_MS);

    let child: ChildProcess | undefined;
    try {
      child = spawn(command, args, {stdio: "ignore", detached: true});
    } catch {
      done(false);
      return;
    }
    child.once("error", () => done(false));
    child.once("exit", (code) => done(code === 0));
  });
}

export function openerFor(platform: NodeJS.Platform, url: string): {command: string; args: string[]} {
  switch (platform) {
    case "darwin":
      return {command: "open", args: [url]};
    case "win32":
      // Hand the URL to the shell's protocol handler directly. No command interpreter is
      // involved, so none of the Windows quoting hazards apply — spawn passes the URL as a
      // single argv entry, leaving `&` query params and quotes untouched.
      //
      // This replaced a `powershell -EncodedCommand "Start-Process <url>"` opener that exited
      // 0 without ever launching a browser: PowerShell reported success for a hand-off that
      // silently went nowhere, so the CLI had no way to tell and the user saw nothing happen.
      return {command: "rundll32", args: ["url.dll,FileProtocolHandler", url]};
    default:
      return {command: "xdg-open", args: [url]};
  }
}
