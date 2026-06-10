import { EnvValidator } from '../config';
import { Logger } from '../utils';
import { TelemetryEngine } from '../telemetry';
import { WebhookReceiver } from '../api';
import { AuthAutomator } from '../auth';
import { IDatabase, IShutdownCoordinator } from './interfaces';

export interface BootloaderDeps {
  validator: EnvValidator;
  telemetry: TelemetryEngine;
  db: IDatabase;
  api: WebhookReceiver;
  auth: AuthAutomator;
  shutdown: IShutdownCoordinator;
}

export class Bootloader {
  private telemetryInterval?: NodeJS.Timeout;

  constructor(private deps: BootloaderDeps) {}

  async ignite(): Promise<void> {
    Logger.info('--- BREAKGLASSWING BOOT SEQUENCE ---');
    
    // 1. Validate Env (Zod Physical Loading)
    const envValid = this.deps.validator.loadAndValidate();
    if (!envValid) {
      Logger.error('Boot Failed: Invalid Environment configuration.');
      process.exit(1);
    }

    // 2. Connect Boundary Services physically
    await this.deps.db.connect(process.env.DATABASE_URL || 'sqlite://local');
    this.deps.api.startListening(parseInt(process.env.AGENT_PORT || '8080'));
    await this.deps.auth.ensureAuthenticated('Global-Agent');

    // 3. Start Telemetry Physical Sync (Every 60s)
    this.telemetryInterval = setInterval(() => {
      this.deps.telemetry.flushTelemetry(
        process.memoryUsage().rss / 1024 / 1024,
        [] // Pass API key health here in a full app
      );
    }, 60000);

    // 4. Register Physical Shutdown Hooks
    this.deps.shutdown.registerTeardownHook(async () => this.deps.api.stop());
    this.deps.shutdown.registerTeardownHook(async () => {
      if (this.telemetryInterval) clearInterval(this.telemetryInterval);
    });

    Logger.info('Infrastructure modules initialized successfully.');
  }
}
