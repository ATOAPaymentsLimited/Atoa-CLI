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

function openerFor(platform: NodeJS.Platform, url: string): {command: string; args: string[]} {
  switch (platform) {
    case "darwin":
      return {command: "open", args: [url]};
    case "win32":
      // `start` is a cmd.exe builtin, not an executable — it must run via cmd.
      // The empty quoted first argument is the window title; without it, start
      // would treat a quoted URL as the title and open nothing.
      // The URL itself MUST be quoted: cmd treats `&`/`^`/`%` as special even in
      // args, and the grant URL always has multiple `&` query params — unquoted it
      // gets truncated at the first `&` and the login breaks. (PKCE/UUID params
      // never contain a literal `"`, so wrapping in quotes is safe.)
      return {command: "cmd", args: ["/c", "start", '""', `"${url}"`]};
    default:
      return {command: "xdg-open", args: [url]};
  }
}
