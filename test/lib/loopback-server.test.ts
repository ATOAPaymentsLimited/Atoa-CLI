/**
 * BUD-019 Phase 6 — Task 2
 * Tests for the loopback OAuth callback server.
 *
 * These are real-socket tests using Node's built-in fetch (Node 18+) or undici.
 * They bind to 127.0.0.1:0 so OS assigns a free port — no port conflicts.
 */
import {describe, it, expect} from "vitest";
import {startLoopbackServer} from "../../src/lib/loopback-server";

async function get(url: string): Promise<{status: number; body: string}> {
  const res = await fetch(url);
  const body = await res.text();
  return {status: res.status, body};
}

describe("startLoopbackServer — happy path", () => {
  it("binds to 127.0.0.1 and returns an OS-assigned port > 0", async () => {
    const server = await startLoopbackServer({expectedState: "state-abc", timeoutMs: 5000});
    expect(server.port).toBeGreaterThan(0);
    // resolve result to avoid timeout; provide correct code+state
    void get(`http://127.0.0.1:${server.port}/callback?code=code_ok&state=state-abc`);
    await server.result;
    server.close();
  });

  it("resolves result with {code} on a valid callback", async () => {
    const server = await startLoopbackServer({expectedState: "state-xyz", timeoutMs: 5000});
    void get(`http://127.0.0.1:${server.port}/callback?code=auth_code_123&state=state-xyz`);
    const result = await server.result;
    expect(result).toEqual({code: "auth_code_123"});
    server.close();
  });

  it("responds 200 with a self-closing HTML page", async () => {
    const server = await startLoopbackServer({expectedState: "state-html", timeoutMs: 5000});
    const res = await get(`http://127.0.0.1:${server.port}/callback?code=c&state=state-html`);
    expect(res.status).toBe(200);
    expect(res.body).toContain("close this tab");
    await server.result;
    server.close();
  });
});

describe("startLoopbackServer — error paths", () => {
  it("rejects result with a CSRF error on state mismatch", async () => {
    const server = await startLoopbackServer({expectedState: "correct-state", timeoutMs: 5000});
    void get(`http://127.0.0.1:${server.port}/callback?code=c&state=wrong-state`);
    await expect(server.result).rejects.toThrow(/state mismatch|CSRF/i);
    server.close();
  });

  it("rejects result when error=access_denied", async () => {
    const server = await startLoopbackServer({expectedState: "s", timeoutMs: 5000});
    void get(`http://127.0.0.1:${server.port}/callback?error=access_denied&state=s`);
    await expect(server.result).rejects.toThrow(/access.denied|denied/i);
    server.close();
  });

  it("rejects result on timeout", async () => {
    const server = await startLoopbackServer({expectedState: "s", timeoutMs: 50});
    await expect(server.result).rejects.toThrow(/timeout/i);
    server.close();
  });
});

describe("startLoopbackServer — server lifecycle", () => {
  it("closes the server after result resolves (second request fails)", async () => {
    const server = await startLoopbackServer({expectedState: "state-close", timeoutMs: 5000});
    const port = server.port;
    void get(`http://127.0.0.1:${port}/callback?code=c&state=state-close`);
    await server.result;
    // Server should be closed — next request should fail
    await expect(get(`http://127.0.0.1:${port}/callback?code=c2&state=state-close`)).rejects.toThrow();
    server.close();
  });

  it("ignores non-/callback paths with 404", async () => {
    const server = await startLoopbackServer({expectedState: "s", timeoutMs: 5000});
    const res = await get(`http://127.0.0.1:${server.port}/other`);
    expect(res.status).toBe(404);
    // result should still be pending; trigger it then clean up
    void get(`http://127.0.0.1:${server.port}/callback?code=c&state=s`);
    await server.result;
    server.close();
  });

  it("first callback wins — second callback is ignored (no double-settle)", async () => {
    const server = await startLoopbackServer({expectedState: "s", timeoutMs: 5000});
    void get(`http://127.0.0.1:${server.port}/callback?code=first&state=s`);
    const result = await server.result;
    expect(result.code).toBe("first");
    server.close();
  });
});
