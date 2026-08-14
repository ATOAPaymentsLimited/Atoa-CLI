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
 * One topic as "Name [id]" followed by an indented channel per line. Shared by `list` and
 * `set` so a write is confirmed in exactly the shape the read uses.
 *
 * Three states, not two: a channel the backend refuses (`isAvailable: false`) must not render
 * as plain "off", or you can't tell "I turned this off" from "this can never be on".
 */
export function formatTopic(topic: TopicRow): string {
  const perm = topic.hasPermission
    ? ""
    : `  (no permission${topic.noPermissionMessage ? `: ${topic.noPermissionMessage}` : ""})`;

  const lines = [`${topic.displayName} [${topic.topicId}]${perm}`];
  for (const ch of topic.channels ?? []) {
    const state = ch.isAvailable
      ? ch.isEnabled
        ? "on"
        : "off"
      : `unavailable${ch.unavailableReason ? ` (${ch.unavailableReason})` : ""}`;
    lines.push(`  ${ch.channel.padEnd(6)} ${state}`);
  }
  return lines.join("\n");
}
