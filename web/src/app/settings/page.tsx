"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Container } from "@/components/shell";
import { Button, Callout, ErrorState, Input, JobProgress, ListSkeleton, PageHeader, SectionTitle, Tag } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { fmtDate, fmtInt } from "@/lib/format";
import { useBuild } from "@/lib/hooks";
import { useToast } from "@/lib/project";
import type { Job, ReleaseRow, Settings } from "@/lib/types";

const TASK_NAMES: Record<string, string> = {
  extract: "Reading papers (offline)",
  label: "Sub-topic names and summaries",
  reason: "Reading-path reasons",
  judge: "Checking open problems",
  synthesize_gap: "Writing open-problem cards",
  plan: "Research plans",
  check: "Key check",
  brief: "Research briefs",
};

export default function SettingsPage() {
  const qc = useQueryClient();
  const { push } = useToast();
  const s = useQuery({ queryKey: ["settings"], queryFn: () => api.get<Settings>("/settings") });
  const rel = useQuery({ queryKey: ["releases"], queryFn: () => api.get<ReleaseRow[]>("/releases") });
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const activate = useBuild(() => {
    qc.invalidateQueries();
    push({ tone: "ok", text: "Now serving the selected release." });
  });

  const setByok = async () => {
    setBusy(true);
    try {
      await api.post("/settings/byok", { key });
      setKey("");
      push({ tone: "ok", text: "Your Gemini key is active until the server restarts." });
      qc.invalidateQueries({ queryKey: ["settings"] });
      qc.invalidateQueries({ queryKey: ["status"] });
    } catch (err) {
      push({ tone: "error", text: err instanceof ApiError ? err.message : "That key didn't work." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Container>
      <PageHeader title="Settings" lead="AI provider and free quota, the data release being served, and where your projects are stored." />
      {s.isError ? <ErrorState error={s.error} onRetry={() => s.refetch()} /> : null}
      {!s.data ? (
        <ListSkeleton rows={4} />
      ) : (
        <div className="space-y-14">
          <section>
            <SectionTitle meta={s.data.llm.available ? "available" : "not available"}>AI provider</SectionTitle>
            <p className="max-w-[70ch] text-ink-2">
              Mode: <b>{s.data.llm.provider}</b>
              {s.data.llm.providers.length ? <> using {s.data.llm.providers.join(", ")}</> : null}.{" "}
              {s.data.llm.provider === "none"
                ? "AI features fall back to keyword labels, template cards and extractive briefs."
                : s.data.llm.provider === "fake"
                  ? "A fake AI is answering (demo or tests)."
                  : "Free-tier models; each task tries its models in order until one has quota left."}
            </p>
            {s.data.quota.length ? (
              <table className="mt-5 w-full max-w-2xl text-[0.9375rem]">
                <thead>
                  <tr className="border-b border-line-strong text-left text-sm text-muted">
                    <th className="py-2 font-semibold">Model</th>
                    <th className="py-2 text-right font-semibold">Used today</th>
                    <th className="py-2 text-right font-semibold">Left today</th>
                  </tr>
                </thead>
                <tbody>
                  {s.data.quota.map((q) => (
                    <tr key={q.route} className="border-b border-line">
                      <td className="py-2 break-all">{q.route}</td>
                      <td className="py-2 text-right tabular">{fmtInt(q.used_today)}</td>
                      <td className="py-2 text-right tabular">{q.remaining_today == null ? "no limit set" : `${fmtInt(q.remaining_today)} of ${fmtInt(q.limit_per_day ?? 0)}`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
            <details className="mt-5 max-w-2xl text-sm">
              <summary className="cursor-pointer font-semibold text-ink">Which model does what</summary>
              <ul className="mt-2 space-y-1 text-ink-2">
                {s.data.tasks.map((t) => (
                  <li key={t.task}>
                    {TASK_NAMES[t.task] ?? t.task}: <span className="text-muted">{t.route.join(" then ")}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-muted">Change routes and limits under <code>llm:</code> in <code>{s.data.config_path || "configs/config.yaml"}</code>. Keys go in <code>.env</code>.</p>
            </details>
          </section>

          {s.data.llm.allow_byok ? (
            <section>
              <SectionTitle meta={s.data.llm.byok_active ? "active" : undefined}>Your own Gemini key</SectionTitle>
              <p className="max-w-[70ch] text-ink-2">
                When the shared free quota runs out, paste your own free key from{" "}
                <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer" className="text-pen underline">Google AI Studio</a>.
                It stays in the server&apos;s memory only and is forgotten on restart.
              </p>
              {s.data.llm.byok_active ? (
                <Button className="mt-4" onClick={async () => { await api.del("/settings/byok"); qc.invalidateQueries(); }}>Remove my key</Button>
              ) : (
                <form className="mt-4 flex max-w-xl gap-2" onSubmit={(e) => { e.preventDefault(); setByok(); }}>
                  <label htmlFor="key" className="sr-only">Gemini API key</label>
                  <Input id="key" type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder="Paste your key" />
                  <Button type="submit" variant="primary" loading={busy} disabled={key.trim().length < 10}>Use my key</Button>
                </form>
              )}
            </section>
          ) : null}

          <section>
            <SectionTitle>Data releases</SectionTitle>
            <p className="max-w-[70ch] text-ink-2">
              Each release is a frozen, validated build of the collection. Import a new one (for example from the Kaggle
              notebooks) with <code>python -m scholargrid.release import &lt;folder or zip&gt;</code>, then switch to it here.
            </p>
            {s.data.release_pin ? (
              <Callout tone="info" className="mt-4">A pin is set (<code>{s.data.release_pin}</code>), so switching here is disabled.</Callout>
            ) : null}
            {activate.state.phase === "running" ? <div className="mt-4"><JobProgress job={activate.state.job} /></div> : null}
            {activate.state.phase === "error" ? <Callout tone="error" className="mt-4">{activate.state.message}</Callout> : null}
            {rel.data ? (
              <ul className="mt-5 divide-y divide-line border-y border-line">
                {rel.data.map((r) => (
                  <li key={r.id} className="flex flex-col gap-2 py-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="font-medium text-ink">
                        {r.id} {r.serving ? <Tag tone="verd" className="ml-2">Serving</Tag> : null}
                        {r.gates_passed === false ? <Tag tone="amber" className="ml-2">Checks not all passed</Tag> : null}
                      </p>
                      <p className="text-sm text-muted">
                        {fmtInt(r.n_papers)} papers, {r.embedding_model.split("@")[0] || "unknown model"}, {r.size_mb} MB
                        {r.ndcg_at_10 != null ? `, nDCG@10 ${r.ndcg_at_10.toFixed(3)}` : ""}, built {fmtDate(r.created_at.slice(0, 10))}
                      </p>
                    </div>
                    {!r.serving && !s.data.release_pin ? (
                      <Button size="sm" onClick={() => activate.start(() => api.post<Job>(`/releases/${r.id}/activate`))}>Serve this release</Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </section>

          <section>
            <SectionTitle>Storage</SectionTitle>
            <dl className="space-y-1 text-[0.9375rem] text-ink-2">
              <div><dt className="inline text-muted">Projects database: </dt><dd className="inline break-all">{s.data.db}</dd></div>
              <div><dt className="inline text-muted">Live sources: </dt><dd className="inline">{s.data.live_sources.join(", ") || "off"}</dd></div>
            </dl>
          </section>
        </div>
      )}
    </Container>
  );
}
