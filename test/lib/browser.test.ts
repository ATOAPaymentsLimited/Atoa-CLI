import {describe, it, expect} from "vitest";
import {openerFor} from "../../src/lib/browser";

// A real grant URL: multiple `&` query separators + a percent-encoded redirect_uri.
// On Windows this is exactly what got truncated at the first `&` and prefixed with `\`.
const GRANT_URL =
  "https://dev.atoa.me/auth/extension-callback?source=CLI&code_challenge=abc123&state=xyz789" +
  "&redirect_uri=http%3A%2F%2F127.0.0.1%3A54407%2Fcallback&device_name=DESKTOP-418JESC";

describe("openerFor", () => {
  it("win32: PowerShell -EncodedCommand carries the whole URL intact (no cmd `&`/quote hazards)", () => {
    const {command, args} = openerFor("win32", GRANT_URL);
    expect(command).toBe("powershell");
    expect(args.slice(0, 5)).toEqual(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand"]);

    // The payload must decode (UTF-16LE) back to a single Start-Process for the full URL —
    // every `&` survives, nothing is truncated or escaped away.
    const decoded = Buffer.from(args[5], "base64").toString("utf16le");
    expect(decoded).toBe(`Start-Process '${GRANT_URL}'`);
    expect(decoded).toContain("&code_challenge=");
    expect(decoded).toContain("&redirect_uri=");
  });

  it("win32: doubles single quotes so a URL with `'` can't break out of the PS string", () => {
    const decoded = Buffer.from(openerFor("win32", "https://x/?a='b").args[5], "base64").toString("utf16le");
    expect(decoded).toBe("Start-Process 'https://x/?a=''b'");
  });

  it("darwin: bare URL via `open`", () => {
    expect(openerFor("darwin", GRANT_URL)).toEqual({command: "open", args: [GRANT_URL]});
  });

  it("linux: bare URL via `xdg-open`", () => {
    expect(openerFor("linux", GRANT_URL)).toEqual({command: "xdg-open", args: [GRANT_URL]});
  });
});
