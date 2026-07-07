import {randomBytes, createHash} from "crypto";

/**
 * Generates a PKCE verifier+challenge pair using the S256 method (RFC 7636).
 *
 * - verifier: base64url of 32 random bytes (43 chars, base64url charset)
 * - challenge: base64url(SHA-256(verifier))
 *
 * The verifier is 43 URL-safe characters, within the RFC 7636 allowed range
 * of 43–128 characters and using only the unreserved charset [A-Za-z0-9-._~].
 */
export function generatePkcePair(): {verifier: string; challenge: string} {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return {verifier, challenge};
}

/**
 * Generates a random OAuth state parameter (base64url of 32 bytes).
 * Used to protect against CSRF attacks in the authorization code flow.
 */
export function generateState(): string {
  return randomBytes(32).toString("base64url");
}
