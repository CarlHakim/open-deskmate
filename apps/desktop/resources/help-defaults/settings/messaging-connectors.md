# Settings: Messaging Connector Extensions

Configure messaging channels (Telegram, Discord, and other supported connectors).

## When To Use It

Use this section when you want users to send messages to an agent through a bot, channel, or messaging service.

## Quick Steps

1. Open **Settings > Messaging Connector Extensions**.
2. Create a connector instance.
3. Add the connector token or secret.
4. Choose the agent that should receive messages.
5. Configure allowlists and command prefix if needed.
6. Enable the connector.
7. Send a test message from the messaging app.

## Step-By-Step: Secure A Messaging Bot

1. Create or select the connector instance.
2. Add the bot token or secret.
3. Set a command prefix if the bot shares a channel with normal chat.
4. Add allowed users, channels, or servers where supported.
5. Bind the connector to the intended agent.
6. Enable the connector and send a test command.

## Key Settings

- **Create instance**
  - You can create multiple instances per connector type (for example, multiple Telegram bots).
- **Enable/disable**
  - Turns connector instance runtime on/off.
- **Routing/binding**
  - Controls which agent receives messages from that connector instance.
- **Secrets**
  - Connector token/secret is stored securely.
- **Command prefix**
  - Optional prefix for messages to the agent (for example `!desk`).
- **Allowlist controls**
  - Restrict who can interact with the bot where supported.
- **Metadata (`key=value` lines)**
  - Advanced per-connector overrides.

## Runtime Labels

- Native runtime
- First-party runtime
- External bridge

Runtime mode depends on connector type and deployment.

## Thinking Models

Agents that use thinking/reasoning models can receive connector messages the same way as normal Chat Mode tasks.

Reasoning text should be separated from the final reply when the provider exposes it. Messaging replies should send the final answer, not raw thinking tags.

If a connector says a task is already running or queued, wait for the current connector task to finish before sending another command to the same agent/thread.

## Bridge-Required Connectors

Some connectors require public HTTPS webhook accessibility and bridge endpoints. Use the settings badges/tooltips and per-connector instructions to configure these correctly.

## Troubleshooting

- If messages do not arrive, check whether the connector is enabled and bound to an agent.
- If the service requires webhooks, confirm the app has a reachable HTTPS/public endpoint.
- If unknown users can message the bot, tighten allowlist controls.
- If commands are ignored, check the command prefix and connector metadata.
- If a thinking model does not reply, check whether the connector task is still running or queued and whether the selected agent/provider supports the model's response format.

## Related Sections

- [Automations](./automations.md)
- [Agents](./agents.md)
- [Activity Timeline And Recovery](../activity-timeline-and-recovery.md)
