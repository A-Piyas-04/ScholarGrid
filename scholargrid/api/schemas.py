"""Typed request/response models for the HTTP API.

These are the contract with the frontend: ``web/`` generates its TypeScript types from the OpenAPI schema
FastAPI builds from them (``npm run gen:api``). Gap cards and plan documents reuse the library's own pydantic
models, so the shape stored in caches and projects is exactly what the client receives.
"""
from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel as _PydanticBase
from pydantic import ConfigDict, Field

from ..gaps.model import GapCard
from ..plan.schemas import PlanDocument

__all__ = ["GapCard", "PlanDocument"]


class BaseModel(_PydanticBase):
    """Response fields with defaults are always present, so mark them required in the output schema."""
    model_config = ConfigDict(json_schema_serialization_defaults_required=True)


# ---------------------------------------------------------------------------
# System
# ---------------------------------------------------------------------------
class ReleaseInfo(BaseModel):
    id: str = ""
    generated_at: str = ""
    n_papers: int = 0
    date_from: str = ""
    date_to: str = ""
    n_categories: int = 0
    source: str = ""
    synthetic: bool = False
    embedding_model: str = ""
    semantic_search: bool = True
    index: str = ""
    data_age_days: Optional[int] = None
    stale: bool = False
    n_areas: int = 0
    n_extracted: int = 0
    n_problems: int = 0


class LLMStatus(BaseModel):
    provider: str
    available: bool
    byok_active: bool = False
    allow_byok: bool = False
    providers: List[str] = Field(default_factory=list)


class StatusOut(BaseModel):
    ready: bool
    loading: bool
    error: Optional[str] = None
    release: Optional[ReleaseInfo] = None
    live_search: bool = False
    live_sources: List[str] = Field(default_factory=list)
    llm: LLMStatus
    persistence: bool = False
    persistence_error: Optional[str] = None
    uptime_s: float = 0.0
    version: str = ""


class JobOut(BaseModel):
    id: str
    kind: str
    status: Literal["queued", "running", "done", "error"]
    progress: float
    message: str
    error: Optional[str] = None
    error_kind: Optional[str] = None
    created_at: float
    updated_at: float
    meta: Dict[str, Any] = Field(default_factory=dict)
    result: Any = None


class JobStarted(BaseModel):
    """Either the finished resource is already available (``ready``), or a job is building it."""
    ready: bool
    key: Optional[str] = None
    job: Optional[JobOut] = None


# ---------------------------------------------------------------------------
# Papers and search
# ---------------------------------------------------------------------------
class PaperHit(BaseModel):
    rank: int = 0
    paper_id: str
    arxiv_id: str = ""
    doi: str = ""
    url: str = ""
    title: str
    abstract: str = ""
    authors: str = ""
    venue: str = ""
    primary_category: str = ""
    date: str = ""
    area_id: Optional[int] = None
    area_name: str = ""
    score: float = 0.0
    sim: Optional[float] = None
    cited_by_count: int = 0
    citation_velocity: float = 0.0
    matched_terms: List[str] = Field(default_factory=list)
    match: str = "related"
    match_level: Optional[int] = None
    sources: List[str] = Field(default_factory=list)
    is_new: bool = False
    in_collection: bool = True


class AreaCount(BaseModel):
    area_id: Optional[int] = None
    name: str = ""
    count: int = 0


class SearchOut(BaseModel):
    query: str
    mode: str = ""
    degraded: bool = False
    expansion: List[str] = Field(default_factory=list)
    results: List[PaperHit] = Field(default_factory=list)
    areas: List[AreaCount] = Field(default_factory=list)
    n_exact: int = 0
    n_related: int = 0
    n_exact_total: int = 0
    about_total: int = 0
    source_totals: Dict[str, int] = Field(default_factory=dict)
    source_status: Dict[str, str] = Field(default_factory=dict)
    has_more: bool = False
    live: bool = False
    live_seconds: float = 0.0
    n_found_online: int = 0
    ambiguous: bool = False
    elapsed_ms: int = 0


class StatedProblem(BaseModel):
    problem_id: str
    statement: str
    quote: str = ""
    section: str = ""
    section_kind: str = ""
    problem_type: str = ""
    anchor_url: str = ""
    verified: bool = False


class Finding(BaseModel):
    claim: str
    task: str = ""
    dataset: str = ""
    metric: str = ""
    direction: str = ""
    compared_to: str = ""


class PaperProfile(BaseModel):
    summary: str = ""
    code_url: str = ""
    data_released: Optional[bool] = None
    compute: str = "unknown"
    evaluation: Dict[str, Optional[bool]] = Field(default_factory=dict)
    mode: str = ""


class PaperLinks(BaseModel):
    abs: str = ""
    pdf: str = ""
    html: str = ""
    doi: str = ""
    openalex: str = ""
    semantic_scholar: str = ""


class AreaRef(BaseModel):
    id: int
    name: str


class PaperDetail(BaseModel):
    paper_id: str
    arxiv_id: str = ""
    doi: str = ""
    title: str
    abstract: str = ""
    authors: List[str] = Field(default_factory=list)
    venue: str = ""
    venue_type: str = ""
    date: str = ""
    primary_category: str = ""
    categories: List[str] = Field(default_factory=list)
    journal_ref: str = ""
    license: str = ""
    cited_by_count: int = 0
    reference_count: int = 0
    citation_velocity: float = 0.0
    area: Optional[AreaRef] = None
    in_collection: bool = False
    is_survey: bool = False
    sources: List[str] = Field(default_factory=list)
    links: PaperLinks = Field(default_factory=PaperLinks)
    facets: Dict[str, List[str]] = Field(default_factory=dict)
    problems: List[StatedProblem] = Field(default_factory=list)
    findings: List[Finding] = Field(default_factory=list)
    profile: Optional[PaperProfile] = None


class SimilarOut(BaseModel):
    paper_id: str
    title: str = ""
    results: List[PaperHit] = Field(default_factory=list)


class BibtexIn(BaseModel):
    paper_ids: List[str] = Field(default_factory=list)
    records: List[Dict[str, Any]] = Field(default_factory=list)


class TextOut(BaseModel):
    filename: str
    media_type: str
    content: str


# ---------------------------------------------------------------------------
# Topic workspaces
# ---------------------------------------------------------------------------
class TopicIn(BaseModel):
    query: str = Field(min_length=2, max_length=300)
    refresh: bool = False


class Concept(BaseModel):
    term: str = ""
    meaning: str = ""


class Subtopic(BaseModel):
    id: int
    parent: Optional[int] = None
    name: str
    keyword_label: str = ""
    summary: str = ""
    key_concepts: List[Concept] = Field(default_factory=list)
    beginner_entry: str = ""
    keywords: List[str] = Field(default_factory=list)
    size: int = 0
    n_collection: int = 0
    recent_share: float = 0.0
    monthly: Dict[str, int] = Field(default_factory=dict)
    top_facets: Dict[str, List[List[Any]]] = Field(default_factory=dict)
    representative: List[str] = Field(default_factory=list)
    n_open_problems: int = 0
    recently_active: bool = False


class WsPaper(BaseModel):
    paper_id: str
    title: str
    abstract: str = ""
    date: str = ""
    cited_by_count: int = 0
    url: str = ""
    in_collection: bool = True
    is_new: bool = False
    sim: Optional[float] = None
    subtopic: int = -1
    micro: int = -1


class ReadingItem(BaseModel):
    step: str
    paper_id: str
    title: str
    year: Optional[int] = None
    url: str = ""
    cited_by_count: int = 0
    reason: str = ""
    in_corpus: bool = False
    is_survey: bool = False
    openalex_id: str = ""
    why_read: str = ""
    what_you_learn: str = ""
    level: str = ""


class TopicOverview(BaseModel):
    summary: str = ""
    how_they_relate: str = ""
    prerequisites: List[str] = Field(default_factory=list)


class WorkspaceOut(BaseModel):
    key: str
    query: str
    bundle_version: str = ""
    created_at: float = 0.0
    overview: TopicOverview = Field(default_factory=TopicOverview)
    subtopics: List[Subtopic] = Field(default_factory=list)
    papers: List[WsPaper] = Field(default_factory=list)
    reading_path: List[ReadingItem] = Field(default_factory=list)
    stats: Dict[str, Any] = Field(default_factory=dict)
    llm_used: bool = False
    warnings: List[str] = Field(default_factory=list)


class RecentTopic(BaseModel):
    key: str
    query: str
    created_at: float
    n_papers: int = 0
    n_subtopics: int = 0
    has_gaps: bool = False


# ---------------------------------------------------------------------------
# Open problems and plans
# ---------------------------------------------------------------------------
class GapsOut(BaseModel):
    ws_key: str = ""
    query: str = ""
    created_at: float = 0.0
    cards: List[GapCard] = Field(default_factory=list)
    already_explored: List[GapCard] = Field(default_factory=list)
    area_cards: List[GapCard] = Field(default_factory=list)
    stats: Dict[str, Any] = Field(default_factory=dict)


class RecheckIn(BaseModel):
    ws_key: str
    card: Dict[str, Any]


class PlanIn(BaseModel):
    card: Dict[str, Any]
    ws_key: Optional[str] = None
    weeks: int = 10
    background: str = Field(default="", max_length=2000)
    compute_access: str = "Laptop only"
    goal: str = "Bachelor/master thesis"
    attempt: int = 0


class PlanOptions(BaseModel):
    weeks_options: List[int]
    default_weeks: int
    goals: List[str]
    compute: List[str]
    max_background_chars: int


class PlanExportIn(BaseModel):
    doc: Dict[str, Any]
    format: Literal["markdown", "json", "bibtex", "email"] = "markdown"


# ---------------------------------------------------------------------------
# Projects
# ---------------------------------------------------------------------------
class ProjectCounts(BaseModel):
    papers: int = 0
    gaps: int = 0
    plans: int = 0
    notes: int = 0


class ProjectSummary(BaseModel):
    id: str
    title: str
    topic_query: str = ""
    scope_name: str = ""
    bundle_version: str = ""
    created_at: str = ""
    updated_at: str = ""
    counts: ProjectCounts = Field(default_factory=ProjectCounts)


class ProjectPaper(BaseModel):
    paper_id: str
    title: str = ""
    year: Optional[int] = None
    status: str = "to_read"
    tags: List[str] = Field(default_factory=list)
    note: str = ""
    source: str = ""
    added_at: str = ""
    payload: Dict[str, Any] = Field(default_factory=dict)


class ProjectGap(BaseModel):
    gap_id: str
    title: str = ""
    status: str = "considering"
    note: str = ""
    added_at: str = ""
    payload: Dict[str, Any] = Field(default_factory=dict)


class ProjectPlan(BaseModel):
    id: int
    gap_id: str = ""
    label: str = ""
    created_at: str = ""
    doc: Dict[str, Any] = Field(default_factory=dict)


class ProjectNote(BaseModel):
    id: int
    body: str
    created_at: str = ""
    updated_at: str = ""


class ProjectDetail(ProjectSummary):
    papers: List[ProjectPaper] = Field(default_factory=list)
    gaps: List[ProjectGap] = Field(default_factory=list)
    plans: List[ProjectPlan] = Field(default_factory=list)
    notes: List[ProjectNote] = Field(default_factory=list)


class ProjectIn(BaseModel):
    title: str = Field(default="My research project", max_length=200)
    topic_query: str = Field(default="", max_length=300)


class ProjectPatch(BaseModel):
    title: Optional[str] = Field(default=None, max_length=200)
    topic_query: Optional[str] = Field(default=None, max_length=300)


class AddPaperIn(BaseModel):
    paper_id: str
    record: Optional[Dict[str, Any]] = None
    source: str = "web"


class PaperPatch(BaseModel):
    paper_id: str
    status: Optional[str] = None
    tags: Optional[List[str]] = None
    note: Optional[str] = None


class AddGapIn(BaseModel):
    card: Dict[str, Any]


class GapPatch(BaseModel):
    status: Optional[str] = None
    note: Optional[str] = None


class AddPlanIn(BaseModel):
    doc: Dict[str, Any]
    label: str = ""


class NoteIn(BaseModel):
    body: str = Field(max_length=10000)


class ImportIn(BaseModel):
    data: Dict[str, Any]


# ---------------------------------------------------------------------------
# Areas, trends, map
# ---------------------------------------------------------------------------
class GrowthWindow(BaseModel):
    months: int
    recent_count: int = 0
    previous_count: int = 0
    relative_growth: Optional[float] = None
    ci: Optional[List[float]] = None
    direction: Optional[str] = None
    passes_gate: bool = False


class AreaSummary(BaseModel):
    id: int
    name: str
    label: str = ""
    size: int = 0
    color: str = ""
    keywords: List[str] = Field(default_factory=list)
    top_categories: Dict[str, int] = Field(default_factory=dict)
    recent_papers: int = 0
    crowdedness: float = 0.0
    growth: Optional[float] = None
    growth_ci: Optional[List[float]] = None
    reliable: bool = False
    quadrant: str = ""
    advice: str = ""
    open_problems: int = 0
    stated_per_100: Optional[float] = None
    stability: Optional[float] = None


class AreaDetail(AreaSummary):
    monthly: Dict[str, int] = Field(default_factory=dict)
    windows: List[GrowthWindow] = Field(default_factory=list)
    growth_text: str = ""
    representative: List[PaperHit] = Field(default_factory=list)
    most_cited: List[PaperHit] = Field(default_factory=list)
    newest: List[PaperHit] = Field(default_factory=list)
    top_facets: Dict[str, List[List[Any]]] = Field(default_factory=dict)
    reading_path: List[ReadingItem] = Field(default_factory=list)
    gap_cards: List[GapCard] = Field(default_factory=list)


class AreaPapersOut(BaseModel):
    total: int
    results: List[PaperHit] = Field(default_factory=list)


class TrendsOut(BaseModel):
    reference_date: str = ""
    default_window: int = 6
    windows: List[int] = Field(default_factory=list)
    corpus_growth: Dict[str, float] = Field(default_factory=dict)
    history_days: int = 0
    sufficient_history: bool = False
    ci_level: float = 0.9
    quadrants: Dict[str, str] = Field(default_factory=dict)
    areas: List[AreaSummary] = Field(default_factory=list)
    corpus_monthly: Dict[str, int] = Field(default_factory=dict)
    area_monthly: Dict[str, Dict[str, int]] = Field(default_factory=dict)


class MapHighlight(BaseModel):
    query: str
    items: List[List[float]] = Field(default_factory=list)   # [payload index, score]
    ambiguous: bool = False


# ---------------------------------------------------------------------------
# Settings, releases, judgments
# ---------------------------------------------------------------------------
class QuotaRow(BaseModel):
    route: str
    used_today: int = 0
    remaining_today: Optional[int] = None
    limit_per_day: Optional[int] = None


class TaskRoute(BaseModel):
    task: str
    route: List[str]


class SettingsOut(BaseModel):
    llm: LLMStatus
    quota: List[QuotaRow] = Field(default_factory=list)
    tasks: List[TaskRoute] = Field(default_factory=list)
    config_path: str = ""
    release_pin: Optional[str] = None
    db: str = ""
    live_sources: List[str] = Field(default_factory=list)


class ByokIn(BaseModel):
    key: str = Field(min_length=10, max_length=200)


class ReleaseRow(BaseModel):
    id: str
    created_at: str = ""
    current: bool = False
    serving: bool = False
    n_papers: int = 0
    embedding_model: str = ""
    gates_passed: Optional[bool] = None
    ndcg_at_10: Optional[float] = None
    size_mb: float = 0.0
    files: List[str] = Field(default_factory=list)


class MethodologyOut(BaseModel):
    release: ReleaseInfo
    manifest: Dict[str, Any] = Field(default_factory=dict)
    validation: Dict[str, Any] = Field(default_factory=dict)
    backends: Dict[str, Any] = Field(default_factory=dict)
    params: Dict[str, Any] = Field(default_factory=dict)
    coverage: Dict[str, Any] = Field(default_factory=dict)
    judged_queries: int = 0


class JudgeQuery(BaseModel):
    query: str
    area: str = ""
    n_judged: int = 0


class JudgeCandidate(BaseModel):
    paper_id: str
    title: str
    abstract: str = ""
    date: str = ""
    primary_category: str = ""
    grade: Optional[int] = None


class JudgePool(BaseModel):
    query: str
    candidates: List[JudgeCandidate] = Field(default_factory=list)


class JudgeIn(BaseModel):
    query: str = Field(min_length=1, max_length=300)
    paper_id: str
    grade: Optional[int] = Field(default=None, ge=0, le=2)


# ---------------------------------------------------------------------------
# Research assistant
# ---------------------------------------------------------------------------
class BriefIn(BaseModel):
    question: str = Field(min_length=5, max_length=500)
    use_live: bool = True
    max_papers: int = Field(default=12, ge=4, le=20)
