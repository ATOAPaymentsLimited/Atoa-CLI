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
