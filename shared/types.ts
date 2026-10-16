// Wire types shared by server/ and client/.

export type ModelTier = 'opus' | 'sonnet' | 'haiku' | 'fable' | 'unknown';
export type NodeStatus = 'idle' | 'running' | 'waiting' | 'done' | 'failed' | 'offline';
export type NodeKind = 'user' | 'session' | 'agent' | 'virtual';
export type RunResult = 'PASS' | 'FAIL' | 'BLOCKED' | null;
export type EdgeLabel =
  | 'Task'
  | 'Spec'
  | 'Code review'
  | 'Feedback Loop'
  | 'Permission request'
  | 'Result'
  | 'Message';

export interface SwarmNode {
  id: string;
  kind: NodeKind;
  role: string;
  label: string;
  avatar: string;
  model: ModelTier;
  title: string;
  status: NodeStatus;
  result: RunResult;
  parent: string | null;
  sessionId: string | null;
  paneId: string | null;
  cwd: string | null;
  tokens: number;
  activeRuns: number;
  runs: number;
  passes: number;
  fails: number;
  unread: number;
  /** Tokens in the current context window (last request's input + cache), and the window size. */
  context: number;
  contextMax: number;
  /** Belongs to the dashboard's project (false for unrelated sessions on this machine). */
  inProject: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface SwarmEdge {
  id: string;
  source: string;
  target: string;
  label: EdgeLabel;
  count: number;
  lastAt: number;
}

export interface Pulse {
  id: string;
  edgeId: string;
  source: string;
  target: string;
  label: EdgeLabel;
  at: number;
}

export type FeedLevel = 'info' | 'ok' | 'warn' | 'err';
export interface FeedItem {
  id: string;
  at: number;
  icon: string;
  text: string;
  level: FeedLevel;
  nodeId: string | null;
}

export type PaneStatus = 'starting' | 'running' | 'waiting' | 'idle' | 'exited';
export interface PaneInfo {
  id: string;
  /** pty: a terminal the hub owns. transcript: a read-only live mirror of a session in your own terminal. */
  kind: 'pty' | 'transcript';
  /** What the pane shows: a whole session, or one subagent run (mirrors only). */
  scope: 'session' | 'agent';
  /** Session/run belongs to the dashboard's project. */
  inProject: boolean;
  /** For agent mirrors: the session that spawned it. */
  parentLabel: string | null;
  role: string;
  agentId: string;
  label: string;
  avatar: string;
  model: ModelTier;
  cwd: string;
  command: string;
  status: PaneStatus;
  sessionId: string | null;
  nodeId: string | null;
  title: string;
  autoWake: boolean;
  exitCode: number | null;
  createdAt: number;
}

export interface PlanTask {
  id: string;
  title: string;
  role: string;
  status: 'pending' | 'in_progress' | 'review' | 'done' | 'blocked';
  assignee: string | null;
  sprint: string;
}
export interface PlanSprint {
  id: string;
  name: string;
  total: number;
  done: number;
  active: number;
  blocked: number;
}
export interface PlanSummary {
  root: string;
  epic: string;
  goal: string;
  sprints: PlanSprint[];
  tasks: PlanTask[];
  error: string | null;
}

export interface TokenTotals {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
}

export interface Metrics {
  ceo: number;
  specialists: number;
  sessions: number;
  activeAgents: number;
  peakConcurrency: number;
  capacity: number;
  sprints: number;
  parallelSprints: number;
  tokens: TokenTotals;
  tokensPerMin: number;
  history: { t: number; tokens: number; active: number }[];
  progress: { source: 'plan' | 'runs'; done: number; active: number; review: number; blocked: number; total: number };
  unreadMail: number;
  events: number;
}

export interface RoleInfo {
  name: string;
  label: string;
  avatar: string;
  model: ModelTier;
  description: string;
}

export interface TimelineSegment {
  start: number;
  end: number | null;
  result: RunResult;
  title: string;
}
/** One row in the timeline: a session's turns, or one subagent run with its tool-call ticks. */
export interface TimelineLane {
  id: string;
  nodeId: string;
  parentNodeId: string | null;
  kind: 'session' | 'agent';
  label: string;
  model: ModelTier;
  segments: TimelineSegment[];
  ticks: number[];
  tokens: number;
  /** Pro: a finished lane from an earlier hub run, loaded from the history archive. */
  archived?: boolean;
}

export interface LicenceInfo {
  plan: 'free' | 'pro';
  email: string | null;
  issuedAt: string | null;
  /** dodo: bought through Dodo Payments (activated online). signed: issued offline by the seller. */
  source: 'dodo' | 'signed' | null;
  keyHint: string | null;
}

export interface ReceiptSummary {
  id: string;
  createdAt: number;
  project: string;
  epic: string;
  tokens: number;
  runs: number;
  fails: number;
  avgRunMs: number;
  tasksDone: number;
  tasksTotal: number;
}

export interface ReceiptCompare {
  a: ReceiptSummary;
  b: ReceiptSummary;
  rows: { metric: string; a: number; b: number }[];
}

export interface SetupStatus {
  hooks: boolean;
  agents: boolean;
  claude: boolean;
  project: string;
}

export interface Snapshot {
  nodes: SwarmNode[];
  edges: SwarmEdge[];
  panes: PaneInfo[];
  plans: PlanSummary[];
  metrics: Metrics;
  feed: FeedItem[];
  roles: RoleInfo[];
  timeline: TimelineLane[];
  defaultProject: string;
  projects: { root: string; sessions: number; current: boolean }[];
  licence: LicenceInfo;
  serverStartedAt: number;
}

export type ServerMsg =
  | { t: 'snapshot'; s: Snapshot }
  | { t: 'pulse'; p: Pulse }
  | { t: 'pty'; id: string; d: string }
  | { t: 'pty-replay'; id: string; d: string };

export type ClientMsg =
  | { t: 'in'; id: string; d: string }
  | { t: 'resize'; id: string; cols: number; rows: number }
  | { t: 'redraw'; id: string };
