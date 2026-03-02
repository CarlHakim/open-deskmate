import Store from 'electron-store';
import type { GatewayConfig, GatewayAuthMode, GatewayTailscaleMode } from '@accomplish/shared';

interface GatewayConfigSchema {
  authMode: GatewayAuthMode;
  allowTailscale: boolean;
  tailscaleMode: GatewayTailscaleMode;
  tailscaleResetOnExit: boolean;
  enableTaskGrouping: boolean;
  recordConnectorDiscovery: boolean;
}

const gatewayConfigStore = new Store<GatewayConfigSchema>({
  name: 'gateway-config',
  defaults: {
    authMode: 'none',
    allowTailscale: true,
    tailscaleMode: 'off',
    tailscaleResetOnExit: false,
    enableTaskGrouping: true,
    recordConnectorDiscovery: true,
  },
});

export function getGatewayConfig(): GatewayConfig {
  return {
    authMode: gatewayConfigStore.get('authMode'),
    allowTailscale: gatewayConfigStore.get('allowTailscale'),
    tailscaleMode: gatewayConfigStore.get('tailscaleMode'),
    tailscaleResetOnExit: gatewayConfigStore.get('tailscaleResetOnExit'),
    enableTaskGrouping: gatewayConfigStore.get('enableTaskGrouping'),
    recordConnectorDiscovery: gatewayConfigStore.get('recordConnectorDiscovery'),
  };
}

export function setGatewayConfig(config: GatewayConfig): GatewayConfig {
  gatewayConfigStore.set('authMode', config.authMode);
  gatewayConfigStore.set('allowTailscale', config.allowTailscale);
  gatewayConfigStore.set('tailscaleMode', config.tailscaleMode);
  gatewayConfigStore.set('tailscaleResetOnExit', config.tailscaleResetOnExit);
  if (config.enableTaskGrouping !== undefined) {
    gatewayConfigStore.set('enableTaskGrouping', config.enableTaskGrouping);
  }
  if (config.recordConnectorDiscovery !== undefined) {
    gatewayConfigStore.set('recordConnectorDiscovery', config.recordConnectorDiscovery);
  }
  return getGatewayConfig();
}
