import {defineCommand} from "citty";
import {withCommonArgs, runWithContext, type CommonOptions} from "../_common";
import {V1_ROUTES} from "../../lib/v1-routes";
import {AtoaError} from "../../lib/errors";
import {isInteractive} from "../../lib/output";
import {formatTopic, type TopicRow} from "./_shared";
import {CommsChannel, Toggle} from "../../lib/enums";
import {t} from "../../lib/i18n";

type CommsSetArgs = CommonOptions & {
  topic: string;
  email?: string;
  sms?: string;
  push?: string;
};

const ON_OFF: readonly string[] = [Toggle.ON, Toggle.OFF];
const ON_OFF_HINT = ON_OFF.join("|");

export default defineCommand({
  meta: {
    name: "set",
    description: t("cmdCommsSet")
  },
  args: withCommonArgs({
    topic: {type: "positional", required: true, description: t("argCommsTopic")},
    email: {type: "string", description: ON_OFF_HINT},
    sms: {type: "string", description: ON_OFF_HINT},
    push: {type: "string", description: ON_OFF_HINT}
  }),
  run: runWithContext<CommsSetArgs>(async (ctx, args) => {
    const topicArg = args.topic?.trim();
    if (!topicArg) throw new AtoaError(t("topicRequired"), "validation");

    const email = parseOnOff(args.email, "--email");
    const sms = parseOnOff(args.sms, "--sms");
    const push = parseOnOff(args.push, "--push");
    if (email === undefined && sms === undefined && push === undefined) {
      throw new AtoaError(t("commsChannelFlagRequired"), "validation");
    }

    const {data} = await ctx.http.request({...V1_ROUTES.communicationPreferences.list});
    const topics = (data as {topics?: TopicRow[]} | null)?.topics ?? [];
    const topic = topics.find(
      (t) =>
        t.topicId.toLowerCase() === topicArg.toLowerCase() || t.displayName.toLowerCase() === topicArg.toLowerCase()
    );
    if (!topic) throw new AtoaError(t("noTopicFound", {topic: topicArg}), "not_found");
    if (!topic.hasPermission) {
      throw new AtoaError(
        topic.noPermissionMessage || t("noPermissionToManageTopic", {topic: topic.displayName}),
        "forbidden"
      );
    }

    assertChannelAvailable(topic, CommsChannel.EMAIL, email);
    assertChannelAvailable(topic, CommsChannel.SMS, sms);
    assertChannelAvailable(topic, CommsChannel.PUSH, push);

    const preference: Record<string, unknown> = {topicId: topic.topicId};
    if (email !== undefined) preference["emailEnabled"] = email;
    if (sms !== undefined) preference["smsEnabled"] = sms;
    if (push !== undefined) preference["pushEnabled"] = push;
    const body = {preferences: [preference]};

    if (ctx.dryRun) {
      ctx.print({...V1_ROUTES.communicationPreferences.update, body});
      return;
    }
    const {data: updated} = await ctx.http.request({...V1_ROUTES.communicationPreferences.update, body});

    // The update echoes back every topic. Confirm only the one that changed — dumping all of
    // them buries the result, and under `--output table` the nested array collapses into a
    // single unreadable cell. Fall back to the pre-update topic if the echo omits it.
    const result = (updated as {topics?: TopicRow[]} | null)?.topics?.find((t) => t.topicId === topic.topicId) ?? topic;

    if (!isInteractive(ctx.formatExplicit)) {
      ctx.print(result);
      return;
    }
    process.stdout.write(formatTopic(result) + "\n");
  })
});

function parseOnOff(value: string | undefined, flag: string): boolean | undefined {
  if (value === undefined) return undefined;
  const v = value.trim().toLowerCase();
  if (!ON_OFF.includes(v)) {
    throw new AtoaError(t("flagMustBeOnOrOff", {flag}), "validation");
  }
  return v === Toggle.ON;
}

/** Refuses with the backend's own unavailability reason rather than a generic error. */
function assertChannelAvailable(topic: TopicRow, channelName: CommsChannel, requested: boolean | undefined): void {
  if (requested === undefined) return;
  const channel = (topic.channels ?? []).find((c) => c.channel === channelName);
  if (channel && !channel.isAvailable) {
    throw new AtoaError(
      channel.unavailableReason || t("channelUnavailableForTopic", {channel: channelName, topic: topic.displayName}),
      "validation"
    );
  }
}
