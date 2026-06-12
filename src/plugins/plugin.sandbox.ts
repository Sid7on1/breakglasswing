import Docker from 'dockerode';
import { Logger } from '../utils';
import * as path from 'path';
import * as fs from 'fs/promises';
import { SafetyPolicy } from '../governor/policy.engine';

export class PluginSandbox {
  private docker = new Docker();

  async testPlugin(dirPath: string): Promise<boolean> {
    Logger.info(`[PluginSandbox] Running isolated test suite on ${dirPath}`);
    
    try {
      // 1. Ensure directory is absolute for volume binding
      const absolutePath = await fs.realpath(dirPath);

      // 2. Create an isolated Docker container
      const container = await this.docker.createContainer({
        Image: 'node:18-alpine',
        Cmd: ['sh', '-c', 'npm install --ignore-scripts && npm test'],
        WorkingDir: '/plugin',
        HostConfig: {
          Binds: [`${absolutePath}:/plugin:rw`],
          // NetworkMode: 'none', // Disabled: npm install requires network to fetch packages
          Memory: 512 * 1024 * 1024, // 512MB RAM Limit
          CpuQuota: 50000 // 50% CPU limit
        }
      });
      
      Logger.info(`[PluginSandbox] Started Docker container...`);
      await container.start();
      
      // Wait for it to finish
      const result = await container.wait();
      
      // Fetch logs for debugging
      const logs = await container.logs({ stdout: true, stderr: true });
      if (result.StatusCode !== 0) {
        Logger.error(`[PluginSandbox] ❌ Tests failed or timed out. Exit code: ${result.StatusCode}\n${logs.toString('utf8')}`);
      } else {
        Logger.info(`[PluginSandbox] ✅ Tests passed successfully inside Sandbox.`);
      }

      await container.remove();
      return result.StatusCode === 0;
    } catch (e: any) {
      Logger.error(`[PluginSandbox] ❌ Sandbox execution failed: ${e.message}`);
      return false;
    }
  }

  /**
   * Safely uninstall a plugin by removing its directory and cleaning up
   * any orphaned Docker containers/images tagged with the plugin ID. (PLUG-004)
   */
  async uninstallPlugin(pluginId: string, pluginDir: string): Promise<boolean> {
    Logger.info(`[PluginSandbox] Uninstalling plugin: ${pluginId}`);
    
    try {
      // 1. Clean up any containers labeled with this plugin
      const containers = await this.docker.listContainers({ all: true, filters: { label: [`plugin=${pluginId}`] } });
      for (const containerInfo of containers) {
        const container = this.docker.getContainer(containerInfo.Id);
        try {
          await container.stop().catch(() => {}); // may already be stopped
          await container.remove();
          Logger.info(`[PluginSandbox] Removed container ${containerInfo.Id.substring(0, 12)} for plugin ${pluginId}`);
        } catch (e: any) {
          Logger.warn(`[PluginSandbox] Failed to clean container ${containerInfo.Id.substring(0, 12)}: ${e.message}`);
        }
      }

      // 2. Remove the plugin directory from disk
      const absolutePath = path.resolve(pluginDir);
      const canonicalWorkspace = path.resolve(SafetyPolicy.allowedWorkspace);
      
      if (!absolutePath.toLowerCase().startsWith(canonicalWorkspace.toLowerCase())) {
         Logger.error(`[PluginSandbox] CRITICAL SECURITY ALERT: Prevented path traversal attack during plugin uninstallation. Attempted to wipe: ${absolutePath}`);
         return false;
      }

      await fs.rm(absolutePath, { recursive: true, force: true });
      Logger.info(`[PluginSandbox] Removed plugin directory: ${absolutePath}`);

      Logger.info(`[PluginSandbox] ✅ Plugin '${pluginId}' uninstalled successfully.`);
      return true;
    } catch (e: any) {
      Logger.error(`[PluginSandbox] ❌ Failed to uninstall plugin '${pluginId}': ${e.message}`);
      return false;
    }
  }
}

