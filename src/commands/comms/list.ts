import {defineCommand} from "citty";
import {withCommonArgs, runWithContext, type CommonOptions} from "../_common";
import {V1_ROUTES} from "../../lib/v1-routes";
import {isInteractive} from "../../lib/output";
import type {TopicRow} from "./_shared";

export default defineCommand({
  meta: {name: "list", description: "List notification topics and their channel preferences"},
  args: withCommonArgs({}),
  run: runWithContext<CommonOptions>(async (ctx) => {
    if (ctx.dryRun) {
      ctx.print({...V1_ROUTES.communicationPreferences.list});
      return;
    }
    const {data} = await ctx.http.request({...V1_ROUTES.communicationPreferences.list});
    const topics = (data as {topics?: TopicRow[]} | null)?.topics ?? [];

    if (!isInteractive(ctx.formatExplicit)) {
      ctx.print(topics);
      return;
    }

    for (const topic of topics) {
      const perm = topic.hasPermission
        ? ""
        : `  (no permission${topic.noPermissionMessage ? `: ${topic.noPermissionMessage}` : ""})`;
      process.stdout.write(`${topic.displayName} [${topic.topicId}]${perm}\n`);
      for (const ch of topic.channels ?? []) {
        const state = ch.isAvailable
          ? ch.isEnabled
            ? "on"
            : "off"
          : `unavailable${ch.unavailableReason ? ` (${ch.unavailableReason})` : ""}`;
        process.stdout.write(`  ${ch.channel.padEnd(6)} ${state}\n`);
      }
    }
  })
});
