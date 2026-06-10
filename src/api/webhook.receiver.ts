import express from 'express';
import rateLimit from 'express-rate-limit';
import { Logger } from '../utils/logger';
import { IEventBus } from '../core/interfaces';
import * as http from 'http';
import jwt from 'jsonwebtoken';
import { z } from 'zod';

export class WebhookReceiver {
  private server?: http.Server;

  constructor(private eventBus: IEventBus) {}

  startListening(port: number) {
    const app = express();
    
    // 1. Rate Limiting (API-001)
    const limiter = rateLimit({
      windowMs: 60 * 1000, // 1 minute
      max: 100, // limit each IP to 100 requests per windowMs
      message: 'Too many requests'
    });
    
    // 2. Body Size Limit (API-004)
    app.use(express.json({ limit: '1mb' }));
    
    app.use('/events', limiter);
    
    app.post('/events', (req, res) => {
      try {
        const payload = req.body;
        
        // Zod Runtime Validation (API-002)
        const WebhookPayloadSchema = z.object({
          id: z.string().optional(),
          type: z.string().optional(),
          triggerOn: z.string().optional(),
          data: z.any().optional()
        }).passthrough();
        
        const validatedPayload = WebhookPayloadSchema.parse(payload);
        
        Logger.info(`\n[API Receiver] 📥 Received LIVE external HTTP POST to /events`);
        Logger.info(`[API Receiver] Broadcasting payload to internal Event Bus...`);
        
        this.eventBus.emit('EXTERNAL_WEBHOOK_RECEIVED', validatedPayload);
        res.json({ status: 'ok', received: true });
      } catch (e: any) {
        res.status(400).json({ error: 'Invalid payload schema', details: e.message });
      }
    });

    app.get('/stream', (req, res) => {
      // 3. SSE Authentication (API-003)
      const token = (req.query.token as string) || req.headers.authorization?.split(' ')[1];
      
      if (!token) {
        res.status(401).json({ error: 'Authentication required for SSE stream' });
        return;
      }
      
      try {
        const secret = process.env.JWT_SECRET || 'super-secret-offline-key';
        jwt.verify(token, secret);
      } catch (e) {
        res.status(403).json({ error: 'Invalid token' });
        return;
      }

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*'
      });

      const systemLogListener = (msg: string) => res.write(`data: ${JSON.stringify({ type: 'SYSTEM_LOG', data: msg })}\n\n`);
      const pipelineListener = (data: any) => res.write(`data: ${JSON.stringify({ type: 'PIPELINE_UPDATE', data })}\n\n`);

      this.eventBus.on('SYSTEM_LOG', systemLogListener);
      this.eventBus.on('PIPELINE_UPDATE', pipelineListener);

      // 4. Clean up SSE Connections Properly (API-005)
      req.on('close', () => {
        this.eventBus.off('SYSTEM_LOG', systemLogListener);
        this.eventBus.off('PIPELINE_UPDATE', pipelineListener);
        res.end();
      });
    });

    this.server = app.listen(port, () => {
      Logger.info(`[API Receiver] Live Daemon listening on Port ${port} for incoming webhooks...`);
    });
    
    this.server.on('error', (e: any) => {
      if (e.code === 'EADDRINUSE') {
        Logger.error(`[API Receiver] 💀 FATAL: Port ${port} is occupied. Aborting boot sequence to prevent conflict.`);
        process.exit(1);
      } else {
        Logger.error(`[API Receiver] Server error: ${e.message}`);
      }
    });
  }

  stop() {
    if (this.server) {
      this.server.close();
      this.server = undefined;
    }
  }
}
