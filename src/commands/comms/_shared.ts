import {Toggle} from "../../lib/enums";

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
    : `  (no permission${topic.noPermissionMessage ? `: ${topic.noPermissionMessage}` : ""})`;

  const lines = [`${topic.displayName} [${topic.topicId}]${perm}`];
  for (const ch of topic.channels ?? []) {
    const state = ch.isAvailable
      ? ch.isEnabled
        ? Toggle.ON
        : Toggle.OFF
      : `unavailable${ch.unavailableReason ? ` (${ch.unavailableReason})` : ""}`;
    lines.push(`  ${ch.channel.padEnd(6)} ${state}`);
  }
  return lines.join("\n");
}
