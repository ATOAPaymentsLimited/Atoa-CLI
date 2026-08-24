import {describe, it, expect, vi} from "vitest";
import {withOtp, OTP_REQUIRED_CODE} from "../../src/lib/otp";
import {AtoaError} from "../../src/lib/errors";
import type {HttpClient} from "../../src/lib/http";

const SEND = {method: "POST" as const, path: "/api/v1/bank", auth: "jwt" as const};
const VERIFY = {method: "POST" as const, path: "/api/v1/onboarding/verify-otp", auth: "jwt" as const};

/** Builds a fake HttpClient whose request() replays a scripted queue (resolve data | reject error). */
function fakeHttp(script: Array<{data?: unknown} | {throw: AtoaError}>) {
  const calls: Array<Record<string, unknown>> = [];
  let i = 0;
  const http = {
    request: vi.fn(async (opts: Record<string, unknown>) => {
      calls.push(opts);
      const step = script[i++];
      if (step && "throw" in step) throw step.throw;
      return {data: step?.data, requestId: "req_test"};
    })
  } as unknown as HttpClient;
  return {http, calls};
}

const otpRequired = (status: number) =>
  new AtoaError("otp required", status === 401 ? "auth" : "validation", {status, errorCode: OTP_REQUIRED_CODE});

describe("withOtp", () => {
  it("returns immediately when no OTP is required (otpUsed=false, verify never called)", async () => {
    const {http, calls} = fakeHttp([{data: {id: "ba_1"}}]);
    const res = await withOtp(http, {
      send: SEND,
      verify: VERIFY,
      body: {bankName: "X"},
      promptOtp: async () => "000000"
    });
    expect(res).toEqual({data: {id: "ba_1"}, otpUsed: false});
    expect(calls).toHaveLength(1);
  });

  it("re-prompts on a 401 wrong code (bank surface), not just a 400", async () => {
    // The bank flow rejects a mistyped code with 401. Treating only 400 as retryable gave one
    // attempt instead of five, and reported a typo as an auth failure advising `atoa login`.
    const {http} = fakeHttp([
      {throw: otpRequired(401)},
      {throw: new AtoaError("Incorrect code used.", "auth", {status: 401})},
      {data: {id: "ba_2"}}
    ]);
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const prompt = vi.fn(async () => "123456");

    const res = await withOtp(http, {send: SEND, verify: VERIFY, body: {bankName: "X"}, promptOtp: prompt});

    stderr.mockRestore();
    expect(res).toEqual({data: {id: "ba_2"}, otpUsed: true});
    expect(prompt).toHaveBeenCalledTimes(2); // retried rather than giving up after one go
  });

  it("does not spend OTP attempts on a dead access token", async () => {
    // A 401 carrying INVALID_CREDENTIAL is an expired/invalid token, not a mistyped code. Retrying
    // burns attempts on something no retype can fix.
    const {http} = fakeHttp([
      {throw: otpRequired(401)},
      {
        throw: new AtoaError("Session expired — run `atoa login`", "auth", {
          status: 401,
          errorCode: "INVALID_CREDENTIAL"
        })
      }
    ]);
    const prompt = vi.fn(async () => "123456");

    await expect(
      withOtp(http, {send: SEND, verify: VERIFY, body: {bankName: "X"}, promptOtp: prompt})
    ).rejects.toMatchObject({errorCode: "INVALID_CREDENTIAL"});

    expect(prompt).toHaveBeenCalledTimes(1); // not re-prompted
  });

  it("stops immediately when the OTP throttle trips, even though it arrives as a 401", async () => {
    const {http, calls} = fakeHttp([
      {throw: otpRequired(401)},
      {throw: new AtoaError("You have reached the maximum number of OTP requests", "rate_limit", {status: 401})}
    ]);
    const prompt = vi.fn(async () => "123456");

    await expect(
      withOtp(http, {send: SEND, verify: VERIFY, body: {bankName: "X"}, promptOtp: prompt})
    ).rejects.toMatchObject({kind: "rate_limit"});

    // No further attempts: each one would spend another request against the same allowance.
    expect(calls).toHaveLength(2);
    expect(prompt).toHaveBeenCalledTimes(1);
  });

  it("prompts and verifies when OTP is required — 400 variant (onboarding)", async () => {
    const {http, calls} = fakeHttp([{throw: otpRequired(400)}, {data: {ok: true}}]);
    const prompt = vi.fn(async () => "123456");
    const res = await withOtp(http, {send: SEND, verify: VERIFY, body: {email: "a@b.com"}, promptOtp: prompt});
    expect(res.otpUsed).toBe(true);
    expect(res.data).toEqual({ok: true});
    expect(prompt).toHaveBeenCalledTimes(1);
    // second call hit the verify route with otp folded into the body
    expect(calls[1]).toMatchObject({path: VERIFY.path, body: {email: "a@b.com", otp: "123456"}});
  });

  it("detects the OTP signal on a 401 too (bank variant) and re-sends the same route", async () => {
    const {http, calls} = fakeHttp([{throw: otpRequired(401)}, {data: {id: "ba_9"}}]);
    const res = await withOtp(http, {send: SEND, body: {bankName: "X"}, promptOtp: async () => "654321"});
    expect(res.otpUsed).toBe(true);
    // verify defaulted to send → same route, with otp added
    expect(calls[1]).toMatchObject({path: SEND.path, body: {bankName: "X", otp: "654321"}});
  });

  it("retries on a wrong OTP (400) then succeeds", async () => {
    const {http} = fakeHttp([{throw: otpRequired(400)}, {throw: otpRequired(400)}, {data: {ok: true}}]);
    const prompt = vi.fn(async () => "111111");
    const res = await withOtp(http, {send: SEND, body: {x: 1}, promptOtp: prompt});
    expect(res.otpUsed).toBe(true);
    expect(prompt).toHaveBeenCalledTimes(2); // 1 send-trigger + 2 verify attempts (first wrong, second ok)
  });

  it("rethrows a non-OTP error from the first attempt untouched", async () => {
    const boom = new AtoaError("nope", "validation", {status: 400, errorCode: "SOMETHING_ELSE"});
    const {http} = fakeHttp([{throw: boom}]);
    await expect(withOtp(http, {send: SEND, body: {}, promptOtp: async () => "0"})).rejects.toBe(boom);
  });

  it("maps a 429 during verify to a rate_limit error", async () => {
    const rl = new AtoaError("slow down", "rate_limit", {status: 429});
    const {http} = fakeHttp([{throw: otpRequired(400)}, {throw: rl}]);
    await expect(withOtp(http, {send: SEND, body: {}, promptOtp: async () => "9"})).rejects.toMatchObject({
      kind: "rate_limit"
    });
  });

  it("resolveRetry re-sends the verified request with extra fields (CoP fuzzy, even on a 400)", async () => {
    // After OTP verify, the request raises a CoP fuzzy match (a 400 with its own code) — the reorder
    // means resolveRetry sees it before the wrong-OTP path, supplies confirmFuzzyCheck, and re-sends.
    const fuzzy = new AtoaError("cop fuzzy", "validation", {
      status: 400,
      errorCode: "COP_VERIFIED_WITH_FUZZY_MATCH",
      additionalData: {fuzzyName: "Acme Ltd"}
    });
    const {http, calls} = fakeHttp([{throw: otpRequired(401)}, {throw: fuzzy}, {data: {id: "ba_1"}}]);
    const resolveRetry = vi.fn(async () => ({confirmFuzzyCheck: true}));
    const res = await withOtp(http, {send: SEND, body: {bankName: "X"}, promptOtp: async () => "111111", resolveRetry});

    expect(res).toEqual({data: {id: "ba_1"}, otpUsed: true});
    expect(resolveRetry).toHaveBeenCalledTimes(1);
    expect(calls[2]).toMatchObject({body: {bankName: "X", otp: "111111", confirmFuzzyCheck: true}});
  });

  it("falls through to OTP retry when resolveRetry returns null (genuine wrong OTP)", async () => {
    const {http} = fakeHttp([{throw: otpRequired(401)}, {throw: otpRequired(400)}, {data: {ok: true}}]);
    const resolveRetry = vi.fn(async () => null); // doesn't handle a plain wrong-OTP 400
    const prompt = vi.fn(async () => "222222");
    const res = await withOtp(http, {send: SEND, body: {x: 1}, promptOtp: prompt, resolveRetry});

    expect(res.otpUsed).toBe(true);
    expect(resolveRetry).toHaveBeenCalledTimes(1); // consulted on the 400, declined
    expect(prompt).toHaveBeenCalledTimes(2); // then re-prompted as a wrong OTP
  });
});
