import {promises as fs} from "node:fs";
import {join} from "node:path";

import type {SecretsStore, SecretsEnv} from "../../src/lib/secrets-store";

// File-backed SecretsStore for tests — used by vi.mock to override the real
// createSecretsStore so tests don't hit the OS keychain on dev machines.
export function buildFileSecretsStore(secretsFilePath: () => string): SecretsStore {
  const read = async (): Promise<Record<string, string>> => {
    try {
      return JSON.parse(await fs.readFile(secretsFilePath(), "utf8")) as Record<string, string>;
    } catch {
      return {};
    }
  };
  const write = async (data: Record<string, string>): Promise<void> => {
    const fp = secretsFilePath();
    await fs.mkdir(join(fp, ".."), {recursive: true, mode: 0o700});
    await fs.writeFile(fp, JSON.stringify(data), {mode: 0o600});
  };
  const key = (profile: string, env: SecretsEnv): string => `${profile}:${env}`;

  return {
    backend: () => "file",
    async get(profile, env) {
      const data = await read();
      return data[key(profile, env)] || undefined;
    },
    async set(profile, env, token) {
      const data = await read();
      data[key(profile, env)] = token;
      await write(data);
    },
    async delete(profile, env) {
      const data = await read();
      delete data[key(profile, env)];
      await write(data);
    },
    async deleteProfile(profile) {
      const data = await read();
      delete data[key(profile, "sandbox")];
      delete data[key(profile, "production")];
      await write(data);
    }
  };
}
