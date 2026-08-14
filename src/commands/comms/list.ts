import {defineCommand} from "citty";
import {withCommonArgs, runWithContext, type CommonOptions} from "../_common";
import {V1_ROUTES} from "../../lib/v1-routes";
import {isInteractive} from "../../lib/output";
import {formatTopic, type TopicRow} from "./_shared";

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
      process.stdout.write(formatTopic(topic) + "\n");
    }
  })
});
