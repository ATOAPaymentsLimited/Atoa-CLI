import {describe, it, expect} from "vitest";
import {openerFor} from "../../src/lib/browser";

// A real grant URL: multiple `&` query separators + a percent-encoded redirect_uri.
// On Windows this is exactly what got truncated at the first `&` and prefixed with `\`.
const GRANT_URL =
  "https://dev.atoa.me/auth/extension-callback?source=CLI&code_challenge=abc123&state=xyz789" +
  "&redirect_uri=http%3A%2F%2F127.0.0.1%3A54407%2Fcallback&device_name=DESKTOP-418JESC";

describe("openerFor", () => {
  // The shell's protocol handler, invoked directly. No command interpreter parses this, so the
  // URL crosses as one argv entry — the `&` separators and quotes need no escaping at all.
  //
  // The opener this replaced (`powershell -EncodedCommand "Start-Process <url>"`) exited 0
  // without launching anything, so success could not be distinguished from silent failure.
  it("win32: hands the whole URL to the protocol handler as a single argument", () => {
    expect(openerFor("win32", GRANT_URL)).toEqual({
      command: "rundll32",
      args: ["url.dll,FileProtocolHandler", GRANT_URL]
    });
  });

  it("win32: passes a URL containing a quote through unaltered", () => {
    const url = "https://x/?a='b";
    expect(openerFor("win32", url).args[1]).toBe(url);
  });

  it("darwin: bare URL via `open`", () => {
    expect(openerFor("darwin", GRANT_URL)).toEqual({command: "open", args: [GRANT_URL]});
  });

  it("linux: bare URL via `xdg-open`", () => {
    expect(openerFor("linux", GRANT_URL)).toEqual({command: "xdg-open", args: [GRANT_URL]});
  });
});
