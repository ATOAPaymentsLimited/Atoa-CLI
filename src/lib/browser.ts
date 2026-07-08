import {spawn} from "node:child_process";

/**
 * Opens `url` in the user's default browser without adding any dependency.
 *
 * Resolves `true` once the opener process spawned, `false` on any failure —
 * it NEVER throws and never blocks on the browser itself (the child is
 * detached and unref'd). Callers must treat `false` as "show the URL and let
 * the user open it manually", not as a fatal error.
 */
export async function openBrowser(url: string): Promise<boolean> {
  const {command, args} = openerFor(process.platform, url);

  return new Promise<boolean>((resolve) => {
    try {
      const child = spawn(command, args, {stdio: "ignore", detached: true});
      child.once("error", () => resolve(false));
      child.once("spawn", () => {
        child.unref();
        resolve(true);
      });
    } catch {
      resolve(false);
    }
  });
}

export function openerFor(platform: NodeJS.Platform, url: string): {command: string; args: string[]} {
  switch (platform) {
    case "darwin":
      return {command: "open", args: [url]};
    case "win32":
      // Open via PowerShell with a Base64-encoded command — the approach the `open`
      // package settled on. It sidesteps EVERY Windows quoting hazard at once, because the
      // only thing on the command line is `-EncodedCommand <base64>`, which contains no shell
      // metacharacters:
      //   - cmd's `&` command-separator (the grant URL has several `&` query params),
      //   - the `cmd /c "…"` quote-stripping rule (4 quotes in `start "" "url"` → cmd strips
      //     the outer pair and re-breaks it — why a plain `cmd /c start` kept failing),
      //   - Node's own re-escaping of embedded quotes into `\"…\"`.
      // -EncodedCommand wants the script as UTF-16LE then Base64. Start-Process opens the URL
      // in the default browser; single-quoting (with `''` doubling) keeps PowerShell from
      // touching anything inside the URL.
      return {
        command: "powershell",
        args: [
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-EncodedCommand",
          encodePowerShellCommand(`Start-Process '${url.replace(/'/g, "''")}'`)
        ]
      };
    default:
      return {command: "xdg-open", args: [url]};
  }
}

/** PowerShell `-EncodedCommand` payload: the script as UTF-16LE bytes, Base64-encoded. */
function encodePowerShellCommand(script: string): string {
  return Buffer.from(script, "utf16le").toString("base64");
}
