export function fmtInt(n: number | null | undefined): string {
  return n == null ? "—" : n.toLocaleString("en-US");
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function fmtDate(d: string | null | undefined): string {
  if (!d) return "";
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(d);
  if (!m) return d;
  const month = MONTHS[Number(m[2]) - 1] ?? "";
  return m[3] ? `${Number(m[3])} ${month} ${m[1]}` : `${month} ${m[1]}`;
}

export function fmtMonth(ym: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(ym);
  return m ? `${MONTHS[Number(m[2]) - 1]} ${m[1]}` : ym;
}

export function year(d: string | null | undefined): string {
  return d ? d.slice(0, 4) : "";
}

export function shortAuthors(authors: string | string[] | null | undefined, n = 3): string {
  const list = Array.isArray(authors)
    ? authors
    : String(authors ?? "")
        .split(authors && String(authors).includes(";") ? ";" : ",")
        .map((a) => a.trim())
        .filter(Boolean);
  if (!list.length) return "";
  return list.length > n ? `${list.slice(0, n).join(", ")} et al.` : list.join(", ");
}

export function ago(ts: number | string | null | undefined): string {
  if (!ts) return "";
  // Server timestamps without a zone are UTC (SQLite drops the offset).
  const iso = typeof ts === "string" && /T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(ts) ? `${ts}Z` : ts;
  const t = typeof iso === "number" ? iso * 1000 : Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  const d = Math.round(s / 86400);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

export function pct(x: number | null | undefined, digits = 0): string {
  return x == null ? "—" : `${(x * 100).toFixed(digits)}%`;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${fmtInt(n)} ${n === 1 ? one : many}`;
}

export function paperHref(id: string): string {
  return `/paper?id=${encodeURIComponent(id)}`;
}

export function topicHref(q: string, tab?: string): string {
  return `/topic?q=${encodeURIComponent(q)}${tab ? `&tab=${tab}` : ""}`;
}

/** Split text into parts with the given terms marked (case-insensitive, whole substrings). */
export function highlightParts(text: string, terms: string[] | undefined): { t: string; hit: boolean }[] {
  const clean = (terms ?? []).map((t) => t.trim()).filter((t) => t.length > 1);
  if (!clean.length || !text) return [{ t: text, hit: false }];
  const esc = clean.sort((a, b) => b.length - a.length).map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const re = new RegExp(`(${esc.join("|")})`, "gi");
  return text
    .split(re)
    .filter((p) => p !== "")
    .map((p) => ({ t: p, hit: clean.some((c) => c.toLowerCase() === p.toLowerCase()) }));
}
