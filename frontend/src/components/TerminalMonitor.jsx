import React, { useState, useEffect, useRef } from 'react';

export default function TerminalMonitor() {
  const [logs, setLogs] = useState([]);
  const terminalEndRef = useRef(null);

  useEffect(() => {
    // Connect to Backend Server-Sent Events stream
    const eventSource = new EventSource('http://localhost:8080/stream');

    eventSource.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.type === 'SYSTEM_LOG') {
          setLogs(prev => {
            const newLogs = [...prev, payload.data];
            // Keep only the last 100 lines to prevent DOM bloat
            return newLogs.slice(-100);
          });
        }
      } catch (err) {
        console.error("Failed to parse SSE event:", err);
      }
    };

    eventSource.onerror = (err) => {
      console.warn('SSE Connection Lost. Waiting to reconnect...');
    };

    return () => eventSource.close();
  }, []);

  // Auto-scroll to bottom
  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  return (
    <div className="terminal">
      <div className="terminal-line">breakglasswing-agent:~ $ tail -f .breakglass_logs/agent.log</div>
      <br/>
      {logs.length === 0 && <div className="terminal-line" style={{color: 'var(--text-muted)'}}>Waiting for live connection to orchestrator...</div>}
      
      {logs.map((log, i) => (
        <div key={i} className="terminal-line">{log}</div>
      ))}
      
      <div className="terminal-cursor" ref={terminalEndRef}></div>
    </div>
  );
}
