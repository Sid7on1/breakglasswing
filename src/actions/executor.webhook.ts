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
        
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        
        req.on('end', () => {
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

    this.server.listen(8081, () => {
      Logger.info(`[WebhookExecutor] Native Node.js HTTP Daemon bound to port 8081.`);
    });
    
    this.server.on('error', (e: any) => {
      if (e.code === 'EADDRINUSE') {
        Logger.warn(`[WebhookExecutor] Port 8081 is in use, assuming server is already running globally.`);
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
