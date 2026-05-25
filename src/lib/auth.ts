export function buildAuthHeader(token: string): string {
  if (!token) throw new Error("token is required");
  return `Bearer ${token}`;
}

export function redactAuthHeader(value: string | undefined): string {
  if (!value) return "<absent>";
  return `Bearer [REDACTED…${value.slice(-4)}]`;
}

export function fingerprintToken(token: string): string {
  return token.slice(-4);
}
