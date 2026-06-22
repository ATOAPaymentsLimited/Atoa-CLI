import type {ArgsDef, CommandContext as CittyContext} from "citty";
import {buildContext, buildSdkContext, type CommandContext, type CommonOptions} from "../lib/context";

export type {CommonOptions};
import {exitCodeFor, printError, type AtoaError} from "../lib/errors";

export const COMMON_ARGS = {
  env: {type: "string" as const, description: "sandbox|production"},
  output: {type: "string" as const, description: "json|table|yaml"},
  verbose: {type: "boolean" as const, description: "print redacted request log to stderr"},
  dryRun: {type: "boolean" as const, description: "print resolved request without sending"},
  yes: {type: "boolean" as const, description: "skip confirmation prompts"},
  profile: {type: "string" as const, description: "profile name (defaults to activeProfile in config)"}
} as const;

export function withCommonArgs<A extends ArgsDef>(args: A): ArgsDef {
  return {...COMMON_ARGS, ...args} as ArgsDef;
}

/**
 * Shared `dryRun` arg definition for the admin commands (logout, reset, profile/*)
 * that don't go through `runWithContext`. Single source of truth for the dryRun
 * flag description; future common flags slot in here too so the contract isn't
 * fragmented across six bespoke arg blocks.
 */
export const LOCAL_DRY_RUN_ARG = {
  dryRun: {type: "boolean" as const, description: "preview what would change without touching state"}
} as const;

/**
 * Shared `yes` arg definition for commands that prompt without a server round-trip
 * (logout, reset, profile/{rename,delete,use}). Co-located with LOCAL_DRY_RUN_ARG
 * so the common-args contract has a single home for admin commands.
 */
export const LOCAL_YES_ARG = {
  yes: {type: "boolean" as const, description: "skip confirmation prompts"}
} as const;

export type Handler<Args> = (ctx: CommandContext, args: Args, rawArgs: string[]) => Promise<void>;

export function runWithContext<Args extends CommonOptions>(handler: Handler<Args>) {
  return async ({args: ctxArgs, rawArgs = []}: CittyContext<ArgsDef>): Promise<void> => {
    const args = ctxArgs as unknown as Args;
    try {
      const ourCtx: CommandContext = await buildContext(args);
      await handler(ourCtx, args, rawArgs);
    } catch (err) {
      printError(err, {authMode: "jwt"});
      process.exitCode = exitCodeFor((err as AtoaError).kind);
    }
  };
}

/**
 * Like runWithContext, but for the SDK-key commands: builds an SDK-authenticated context
 * (no JWT login required) and runs the guard that prompts for + stores an API key in
 * ~/atoa/auth/secret_key.json when none exists.
 */
export function runWithSdkKey<Args extends CommonOptions>(handler: Handler<Args>) {
  return async ({args: ctxArgs, rawArgs = []}: CittyContext<ArgsDef>): Promise<void> => {
    const args = ctxArgs as unknown as Args;
    try {
      const ourCtx: CommandContext = await buildSdkContext(args);
      await handler(ourCtx, args, rawArgs);
    } catch (err) {
      printError(err, {authMode: "sdk"});
      process.exitCode = exitCodeFor((err as AtoaError).kind);
    }
  };
}

export function isFlagPassed(rawArgs: string[], flag: string): boolean {
  return rawArgs.some((a) => a === flag || a.startsWith(`${flag}=`));
}
