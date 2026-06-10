import React, { useState, useEffect } from 'react';

const STAGES = ['Decomposer', 'Classifier', 'Mapper', 'Execution'];

export default function TaskPipelineView() {
  const [activeStage, setActiveStage] = useState(null);

  useEffect(() => {
    const eventSource = new EventSource('http://localhost:8080/stream');

    eventSource.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.type === 'PIPELINE_UPDATE' && payload.data && payload.data.stage) {
          const index = STAGES.indexOf(payload.data.stage);
          if (index !== -1) {
            setActiveStage(index);
          }
        }
      } catch (err) {
        // ignore
      }
    };

    return () => eventSource.close();
  }, []);

  return (
    <div>
      <p style={{ color: 'var(--text-muted)', marginBottom: '1rem', fontSize: '0.9rem' }}>
        Live Cognitive Bus Telemetry via Server-Sent Events
      </p>
      
      <div className="pipeline-track">
        {STAGES.map((stage, idx) => {
          const isActive = idx === activeStage;
          const isPassed = activeStage !== null && idx < activeStage;
          
          let nodeClass = '';
          if (isActive) nodeClass = 'active';
          else if (isPassed) nodeClass = 'passed';

          return (
            <div key={stage} className={`pipeline-node ${nodeClass}`} style={isPassed ? { borderColor: 'var(--success)', color: 'var(--success)' } : {}}>
              <span className="pipeline-label">{stage}</span>
              {isPassed ? '✓' : idx + 1}
            </div>
          );
        })}
      </div>

      <div className="task-card" style={{ opacity: activeStage === null ? 0.5 : 1 }}>
        <div>
          <strong style={{ display: 'block', marginBottom: '0.2rem' }}>
            {activeStage === null ? 'Idle / Sleeping' : `Current Operation: ${STAGES[activeStage]}`}
          </strong>
          <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            {activeStage === null && 'Waiting for external event...'}
            {activeStage === 0 && 'Breaking down monolithic prompt...'}
            {activeStage === 1 && 'Assigning environment (Cron/CLI/Webhook)...'}
            {activeStage === 2 && 'Standardizing data structure...'}
            {activeStage === 3 && 'Running in Safe Box...'}
          </span>
        </div>
        {activeStage !== null && <div className="spinner">⚙️</div>}
      </div>
    </div>
  );
}
