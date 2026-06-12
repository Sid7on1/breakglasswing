export type NodeType = 'PROJECT' | 'DIRECTORY' | 'FILE' | 'CLASS' | 'FUNCTION' | 'INTERFACE' | 'UNKNOWN' | 'FOLDER' | 'BLOCK' | 'STATEMENT' | 'VARIABLE' | 'EVENT' | 'GOAL' | 'TASK' | 'SUBTASK' | 'CAPABILITY';
export type EdgeType = 'CONTAINS' | 'IMPORTS' | 'CALLS' | 'IMPLEMENTS' | 'EXTENDS' | 'USES_VARIABLE' | 'DECLARES_VARIABLE' | 'SUBSCRIBES_TO' | 'PUBLISHES_TO' | 'SPAWNS' | 'SATISFIES' | 'REQUIRES';

export interface GraphNode {
  id: string; // Unique identifier, typically absolute path + symbol name
  name: string;
  type: NodeType;
  filePath?: string; // Where this node lives
  
  // Semantic Metadata (Populated by LLM in Phase 2)
  purpose?: string;
  criticality?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  riskScore?: number; // 0-100
}

export interface GraphEdge {
  sourceId: string;
  targetId: string;
  type: EdgeType;
  metadata?: Record<string, any>;
}

export interface GraphData {
  nodes: Map<string, GraphNode>;
  edges: GraphEdge[]; // Keeping raw edges for serialization
}

export interface IGraphStore {
  setGraph(graph: GraphData): void;
  getGraph(): GraphData;
  getNode(id: string): GraphNode | undefined;
  getEdgesFrom(nodeId: string): GraphEdge[];
  getEdgesTo(nodeId: string): GraphEdge[];
  addNode(node: GraphNode): void;
  removeNode(id: string): void;
  addEdge(edge: GraphEdge): void;
  saveToDisk(): Promise<void>;
  loadFromDisk(): Promise<void>;
  clear(): void;
  setStoragePath(newPath: string): void;
}
