// Slack Web API credentials. Bot token (Authorization: Bearer) plus the
// signing secret used to verify inbound Events API/interactivity webhooks.
export interface SlackCredentials {
  botToken: string;
  signingSecret: string;
}

export interface SlackApiResponse {
  ok: boolean;
  error?: string;
}

export interface SlackPostMessageResponse extends SlackApiResponse {
  ts: string;
  channel: string;
}
