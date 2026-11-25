// Friendly aliases over the types generated from the FastAPI OpenAPI schema (npm run gen:api).
import type { components } from "./api-types";

type S = components["schemas"];

export type Status = S["StatusOut"];
export type ReleaseInfo = S["ReleaseInfo"];
export type Job = S["JobOut"];
export type JobStarted = S["JobStarted"];
export type PaperHit = S["PaperHit"];
export type SearchResult = S["SearchOut"];
export type PaperDetail = S["PaperDetail"];
export type SimilarResult = S["SimilarOut"];
export type TextOut = S["TextOut"];
export type Workspace = S["WorkspaceOut"];
export type Subtopic = S["Subtopic"];
export type WsPaper = S["WsPaper"];
export type ReadingItem = S["ReadingItem"];
export type RecentTopic = S["RecentTopic"];
export type GapCard = S["GapCard"];
export type Evidence = S["Evidence"];
export type GapsResult = S["GapsOut"];
export type PlanDocument = S["PlanDocument"];
export type PlanOptions = S["PlanOptions"];
export type ProjectSummary = S["ProjectSummary"];
export type ProjectDetail = S["ProjectDetail"];
export type ProjectPaper = S["ProjectPaper"];
export type ProjectGap = S["ProjectGap"];
export type ProjectPlan = S["ProjectPlan"];
export type ProjectNote = S["ProjectNote"];
export type AreaSummary = S["AreaSummary"];
export type AreaDetail = S["AreaDetail"];
export type AreaPapers = S["AreaPapersOut"];
export type Trends = S["TrendsOut"];
export type Settings = S["SettingsOut"];
export type ReleaseRow = S["ReleaseRow"];
export type Methodology = S["MethodologyOut"];
export type JudgeQuery = S["JudgeQuery"];
export type JudgePool = S["JudgePool"];

export type GapTypes = Record<string, { label: string; help: string }>;

export interface BriefPoint {
  text: string;
  cites: string[];
}

export interface BriefEvidence {
  eid: string;
  paper_id: string;
  title: string;
  year: number | null;
  date: string;
  url: string;
  in_collection: boolean;
  is_new: boolean;
  cited_by_count: number;
  summary: string;
  snippet: string;
  problems: { statement: string; quote: string; section: string }[];
}

export interface Brief {
  key: string;
  question: string;
  queries: string[];
  answer: string;
  sections: { heading: string; points: BriefPoint[] }[];
  open_questions: BriefPoint[];
  uncertainty: string[];
  evidence: BriefEvidence[];
  trace: { tool: string; args: Record<string, unknown>; n_results: number; ms: number; note: string }[];
  mode: "llm" | "extractive";
  model: string;
  created_at: number;
  coverage: { n_papers: number; n_cited: number; n_collection: number; n_live: number; live_used: boolean };
  markdown: string;
}

export interface MapPaper {
  i: number;
  id: string;
  t: string;
  au: string;
  d: string;
  c: number;
  cat: string;
  x: number;
  y: number;
  ci: number;
  rf: number;
  v: string;
  ab: string;
}

export interface MapArea {
  id: number;
  name: string;
  color: string;
  size: number;
  rc?: number;
  x?: number;
  y?: number;
}

export type MapEdge = [number, number, number] | [number, number, number, number];

export interface MapPayload {
  version: string;
  papers: MapPaper[];
  edges: MapEdge[];
  neighbors: Record<string, [number, number][]>;
  areas: MapArea[];
  areaEdges: [number, number, number][];
  categories: [string, number][];
  sizeBy: "citations" | "links";
  corpusTotal: number;
  renderedTotal: number;
  maxAreaPapers: number;
}

export interface MapHighlight {
  query: string;
  items: [number, number][];
  extra: MapPaper[];
  ambiguous: boolean;
  degraded: boolean;
}
