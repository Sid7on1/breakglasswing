import React from 'react';
import TerminalMonitor from './components/TerminalMonitor';
import TaskPipelineView from './components/TaskPipelineView';

function App() {
  return (
    <div className="dashboard-container">
      <header className="header">
        <h1>Breakglasswing Control Room</h1>
        <div className="status-badge">Agent Autonomous</div>
      </header>
      
      <div className="grid">
        <div className="panel">
          <h2 className="panel-title">🧠 Cognitive Task Pipeline</h2>
          <TaskPipelineView />
        </div>
        
        <div className="panel">
          <h2 className="panel-title">💻 CLI Multiplexer (Live)</h2>
          <TerminalMonitor />
        </div>
      </div>
    </div>
  );
}

export default App;
