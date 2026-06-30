import {createServer, type IncomingMessage, type ServerResponse} from "node:http";
import {URL} from "node:url";
import {ATOA_LOGO_SVG} from "./atoa-logo";

export interface LoopbackCallbackResult {
  code: string;
}

export interface LoopbackServer {
  /** OS-assigned port (from binding to port 0). */
  port: number;
  /**
   * Resolves with {code} on a successful callback, rejects on state mismatch,
   * user denial, or timeout. The server is always closed before settling.
   */
  result: Promise<LoopbackCallbackResult>;
  /**
   * Idempotent close — safe to call after the result has already settled.
   * Use this in a finally block to ensure cleanup when the caller abandons
   * the flow before the browser redirects.
   */
  close(): void;
}

const DEFAULT_TIMEOUT_MS = 180_000;


// Branded callback page shown in the browser after the OAuth grant. FULLY self-contained:
// the Atoa brand mark above is an inlined SVG and there are NO remote assets (no fonts, no external
// images) — so it renders offline and never beacons the user's IP + login event to a third party
// (Google Fonts / WordPress CDN). Atoa's palette is inlined: brand #e42646, ink #0d1011,
// muted #475664, bg #fbfcfc, border #eaeef0; the font falls back to the system stack.
const callbackPage = (opts: {title: string; heading: string; message: string; ok: boolean}): string => `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${opts.title}</title>
<style>
  :root { --brand:#e42646; --ink:#0d1011; --muted:#475664; --bg:#fbfcfc; --card:#ffffff; --border:#eaeef0; }
  * { box-sizing:border-box; }
  html, body { height:100%; margin:0; }
  body { display:flex; align-items:center; justify-content:center; padding:24px; background:var(--bg);
    color:var(--ink); -webkit-font-smoothing:antialiased;
    font-family:"Figtree",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif; }
  .card { width:100%; max-width:420px; background:var(--card); border:1px solid var(--border);
    border-radius:16px; padding:40px 32px; text-align:center;
    box-shadow:0 1px 2px rgba(13,16,17,.04), 0 8px 24px rgba(13,16,17,.06); }
  .brand { display:block; height:32px; width:auto; margin:0 auto 28px; }
  .icon { width:56px; height:56px; border-radius:50%; display:flex; align-items:center; justify-content:center; margin:0 auto 20px; }
  .icon.ok { background:#ecfdf3; } .icon.err { background:#fef3f2; }
  h1 { font-size:20px; font-weight:700; margin:0 0 8px; letter-spacing:-.01em; }
  p { font-size:14px; line-height:1.5; color:var(--muted); margin:0; }
</style>
</head>
<body>
  <main class="card">
    ${ATOA_LOGO_SVG}
    <div class="icon ${opts.ok ? "ok" : "err"}">
      ${
        opts.ok
          ? `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#12b76a" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`
          : `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#d92d20" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>`
      }
    </div>
    <h1>${opts.heading}</h1>
    <p>${opts.message}</p>
  </main>
  <script>setTimeout(function(){try{window.close();}catch(e){}},2500);</script>
</body>
</html>
`;

const SUCCESS_HTML = callbackPage({
  title: "Atoa CLI — Login complete",
  heading: "Login complete",
  message: "You're signed in. You can close this tab and return to your terminal.",
  ok: true
});

const ERROR_HTML = callbackPage({
  title: "Atoa CLI — Login failed",
  heading: "Login failed",
  message: "Something went wrong during sign-in. You can close this tab and return to your terminal.",
  ok: false
});

/**
 * Starts an HTTP server on 127.0.0.1 with an OS-assigned port. It waits for
 * a single GET /callback from the browser with code + state params, then
 * closes itself and settles the result promise.
 *
 * The result promise:
 *   - resolves with {code} on a valid callback (state matches)
 *   - rejects with a typed error on state mismatch (CSRF), access_denied, or timeout
 *
 * The server is always closed before the promise settles.
 */
export async function startLoopbackServer(opts: {expectedState: string; timeoutMs?: number}): Promise<LoopbackServer> {
  const {expectedState, timeoutMs = DEFAULT_TIMEOUT_MS} = opts;

  let settled = false;
  let resolve!: (value: LoopbackCallbackResult) => void;
  let reject!: (reason: Error) => void;

  const result = new Promise<LoopbackCallbackResult>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const baseUrl = `http://127.0.0.1`;
    const url = new URL(req.url ?? "/", baseUrl);

    if (url.pathname !== "/callback") {
      res.writeHead(404).end("Not Found");
      return;
    }

    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const error = url.searchParams.get("error");

    if (settled) {
      // First callback already won — ignore duplicates.
      res.writeHead(200, {"Content-Type": "text/html"}).end(SUCCESS_HTML);
      return;
    }

    // Validate `state` FIRST, for EVERY branch (success and error alike). A callback that
    // doesn't carry our exact state isn't from this login attempt — it could be any local
    // process trying to settle (and thereby DENY) the real login by hitting e.g.
    // `/callback?error=access_denied`. Ignore it WITHOUT settling: 404 and keep waiting for
    // the genuine callback (the 180s timeout still bounds the wait). Settling here — even as
    // a rejection — would turn the CSRF gate into a denial primitive.
    // NOTE: the dashboard echoes `state` on the denial redirect too (OAuth 2.0 §4.1.2.1), so
    // a genuine "user denied" still matches and rejects below.
    if (state !== expectedState) {
      res.writeHead(404).end("Not Found");
      return;
    }

    if (error) {
      res.writeHead(200, {"Content-Type": "text/html"}).end(ERROR_HTML);
      settle(() => reject(new Error(`OAuth error: ${error} (user denied or provider error)`)));
      return;
    }

    if (!code) {
      res.writeHead(200, {"Content-Type": "text/html"}).end(ERROR_HTML);
      settle(() => reject(new Error("OAuth callback missing code parameter")));
      return;
    }

    res.writeHead(200, {"Content-Type": "text/html"}).end(SUCCESS_HTML);
    settle(() => resolve({code}));
  });

  function settle(fn: () => void): void {
    if (settled) return;
    settled = true;
    // Resolve/reject IMMEDIATELY. Do NOT wait on server.close() — it blocks until
    // the browser's keep-alive socket drains, a delay that routinely exceeds the
    // 30s auth-code TTL and expires the code (401 at exchange). Closing is then
    // fire-and-forget; closeAllConnections() drops the lingering keep-alive socket
    // so the listener releases the port and the CLI can exit cleanly.
    fn();
    server.closeAllConnections?.();
    server.close();
  }

  const timeoutHandle = setTimeout(() => {
    settle(() => reject(new Error(`OAuth login timeout after ${timeoutMs}ms — no browser callback received`)));
  }, timeoutMs);

  // Ensure the timeout timer doesn't keep the process alive if everything else
  // is done (e.g., tests complete before timeout fires).
  timeoutHandle.unref();

  // Bind to port 0 so the OS assigns a free port; listen only on loopback.
  await new Promise<void>((res, rej) => {
    server.listen(0, "127.0.0.1", () => res());
    server.once("error", rej);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Failed to determine loopback server port");
  }

  const port = address.port;

  return {
    port,
    result: result.finally(() => clearTimeout(timeoutHandle)),
    close() {
      settle(() => {
        // Already settling via close — the reject here is a no-op if the promise
        // already resolved, but we need to call settle() to flip the settled flag
        // and close the server cleanly.
        reject(new Error("Loopback server closed by caller"));
      });
    }
  };
}
