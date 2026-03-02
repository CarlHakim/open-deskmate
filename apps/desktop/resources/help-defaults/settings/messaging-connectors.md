# Settings: Messaging Connector Extensions

Configure messaging channels (Telegram, Discord, and other supported connectors).

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

## Bridge-Required Connectors

Some connectors require public HTTPS webhook accessibility and bridge endpoints. Use the settings badges/tooltips and per-connector instructions to configure these correctly.

## Related Sections

- [Automations](./automations.md)
- [Agents](./agents.md)
