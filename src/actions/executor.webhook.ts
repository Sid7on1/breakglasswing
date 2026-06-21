import * as http from 'http';
import { Logger } from '../utils';

interface WebhookTask {
  taskId: string;
  payload: any;
}

export class WebhookExecutor {
  private server?: http.Server;
  private registeredTasks: Map<string, WebhookTask> = new Map();

  listen(taskId: string, payload: any) {
    this.registeredTasks.set(taskId, { taskId, payload });
    Logger.info(`[WebhookExecutor] Bound Webhook Task ${taskId}. Listening for payloads...`);
    
    if (!this.server) {
      this.bootServer();
    }
  }

  private bootServer() {
    this.server = http.createServer((req, res) => {
      // Endpoint format: POST /webhook/:taskId
      if (req.method === 'POST' && req.url?.startsWith('/webhook/')) {
        const taskId = req.url.split('/')[2];
        
        // Cap the request body so a malicious/runaway POST can't exhaust memory (was unbounded).
        const MAX_BODY = 1 << 20; // 1 MiB — webhook payloads are tiny triggers
        let body = '';
        let aborted = false;
        req.on('data', chunk => {
          if (aborted) return;
          body += chunk.toString();
          if (body.length > MAX_BODY) {
            aborted = true;
            res.writeHead(413, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Payload too large' }));
            req.destroy();
          }
        });

        req.on('end', () => {
          if (aborted) return;
          if (this.registeredTasks.has(taskId)) {
            Logger.info(`[WebhookExecutor] 📥 Received LIVE external HTTP POST for Task ${taskId}! Executing...`);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'ok', message: `Task ${taskId} triggered` }));
          } else {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: `Webhook for task ${taskId} not found.` }));
          }
        });
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    // Bind to loopback by default so webhooks aren't exposed to the whole network (was 0.0.0.0:8081).
    // Both host and port are overridable for intentional remote setups.
    const port = parseInt(process.env.BIMAX_WEBHOOK_PORT || '', 10) || 8081;
    const host = process.env.BIMAX_WEBHOOK_HOST || '127.0.0.1';
    this.server.listen(port, host, () => {
      Logger.info(`[WebhookExecutor] Native Node.js HTTP Daemon bound to ${host}:${port}.`);
    });

    this.server.on('error', (e: any) => {
      if (e.code === 'EADDRINUSE') {
        Logger.warn(`[WebhookExecutor] Port ${port} is in use, assuming server is already running globally.`);
      } else {
        Logger.error(`[WebhookExecutor] Server error: ${e.message}`);
      }
    });
  }

  stop() {
    if (this.server) {
      this.server.close();
    }
  }
}
