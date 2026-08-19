import {Toggle} from "../../lib/enums";
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
