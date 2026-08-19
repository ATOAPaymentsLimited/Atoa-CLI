import {Toggle, CommsChannel} from "../../lib/enums";
import {t} from "../../lib/i18n";

export interface ChannelRow {
  channel: string;
  isEnabled: boolean;
  isAvailable: boolean;
  unavailableReason?: string;
}

export interface TopicRow {
  topicId: string;
  displayName: string;
  description: string;
  hasPermission: boolean;
  noPermissionMessage?: string;
  channels?: ChannelRow[];
}

/** A channel's state as one cell: on, off, or unavailable with the backend's reason. */
function channelState(topic: TopicRow, channel: CommsChannel): string | undefined {
  const row = topic.channels?.find((c) => c.channel === channel);
  if (!row) return undefined;
  if (row.isAvailable) return row.isEnabled ? Toggle.ON : Toggle.OFF;
  return t("channelUnavailable", {
    reason: row.unavailableReason ? t("channelUnavailableReason", {reason: row.unavailableReason}) : ""
  });
}

/**
 * Flattens the nested `channels` array into one column per channel. Without this the piped
 * view renders the whole array as a JSON blob in a single cell.
 */
export function projectTopic(topic: TopicRow): Record<string, unknown> {
  return {
    topicId: topic.topicId,
    displayName: topic.displayName,
    description: topic.description,
    hasPermission: topic.hasPermission,
    email: channelState(topic, CommsChannel.EMAIL),
    sms: channelState(topic, CommsChannel.SMS),
    push: channelState(topic, CommsChannel.PUSH)
  };
}

/**
 * One topic as "Name [id]" plus an indented channel per line, shared by `list` and `set`.
 * Three states, not two: an unavailable channel must not read as plain "off".
 */
export function formatTopic(topic: TopicRow): string {
  const perm = topic.hasPermission
    ? ""
    : t("noPermissionSuffix", {
        reason: topic.noPermissionMessage ? t("noPermissionReason", {reason: topic.noPermissionMessage}) : ""
      });

  const lines = [t("topicHeading", {name: topic.displayName, id: topic.topicId, permission: perm})];
  for (const ch of topic.channels ?? []) {
    const state = ch.isAvailable
      ? ch.isEnabled
        ? Toggle.ON
        : Toggle.OFF
      : t("channelUnavailable", {
          reason: ch.unavailableReason ? t("channelUnavailableReason", {reason: ch.unavailableReason}) : ""
        });
    lines.push(t("channelLine", {channel: ch.channel.padEnd(6), state}));
  }
  return lines.join("\n");
}
