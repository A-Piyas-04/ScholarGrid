"use client";

import { useQueryClient } from "@tanstack/react-query";
import { FolderPlus, Upload } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Container } from "@/components/shell";
import { Button, Callout, EmptyState, Input, PageHeader, Tag } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { ago, topicHref } from "@/lib/format";
import { useProject, useToast } from "@/lib/project";
import type { ProjectSummary } from "@/lib/types";

export default function ProjectsPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const { enabled, projects, activeId, setActive, createProject } = useProject();
  const { push } = useToast();
  const [title, setTitle] = useState("");
  const [creating, setCreating] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const importFile = async (file: File) => {
    try {
      const data = JSON.parse(await file.text());
      const p = await api.post<ProjectSummary>("/projects/import", { data });
      qc.invalidateQueries({ queryKey: ["projects"] });
      push({ tone: "ok", text: `Imported “${p.title}”.` });
      router.push(`/projects/${p.id}`);
    } catch (err) {
      push({ tone: "error", text: err instanceof ApiError ? err.message : "That file isn't a ScholarGrid project export." });
    }
  };

  if (!enabled)
    return (
      <Container>
        <PageHeader title="Projects" />
        <Callout tone="warn" title="Projects are turned off">
          Set <code>persistence.enabled: true</code> in the configuration to keep papers, open problems and plans.
        </Callout>
      </Container>
    );

  return (
    <Container>
      <PageHeader
        title="Projects"
        lead="A project keeps the papers you save, the open problems you are weighing, your plans and notes. Everything stays on this computer."
        actions={
          <>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])}
            />
            <Button onClick={() => fileRef.current?.click()}>
              <Upload className="size-4" aria-hidden /> Import a project file
            </Button>
          </>
        }
      />
      <form
        className="mb-10 flex max-w-xl gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          setCreating(true);
          try {
            const p = await createProject(title.trim() || "My research project");
            setTitle("");
            router.push(`/projects/${p.id}`);
          } finally {
            setCreating(false);
          }
        }}
      >
        <label htmlFor="ptitle" className="sr-only">Project name</label>
        <Input id="ptitle" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Name a new project, e.g. Final-year thesis" maxLength={200} />
        <Button type="submit" variant="primary" loading={creating}>
          <FolderPlus className="size-4" aria-hidden /> Create
        </Button>
      </form>

      {projects.length ? (
        <ul className="divide-y divide-line border-y border-line">
          {projects.map((p) => (
            <li key={p.id} className="flex flex-col gap-3 py-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <Link href={`/projects/${p.id}`} className="serif text-[1.375rem] leading-snug text-ink hover:text-pen">
                  {p.title}
                </Link>
                <p className="mt-1 flex flex-wrap gap-x-4 text-sm text-muted">
                  <span className="tabular">{p.counts.papers} papers</span>
                  <span className="tabular">{p.counts.gaps} open problems</span>
                  <span className="tabular">{p.counts.plans} plans</span>
                  <span className="tabular">{p.counts.notes} notes</span>
                  <span>updated {ago(p.updated_at)}</span>
                </p>
                {p.topic_query ? (
                  <Link href={topicHref(p.topic_query)} className="mt-1 inline-block text-sm text-pen underline underline-offset-2">
                    Topic: {p.topic_query}
                  </Link>
                ) : null}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {activeId === p.id ? (
                  <Tag tone="verd" title="Saved items go to this project">Saving here</Tag>
                ) : (
                  <Button size="sm" onClick={() => setActive(p.id)}>Save new items here</Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title="No projects yet">
          Create one above, or just press <b>Save</b> on any paper or open problem: a project is created for you.
        </EmptyState>
      )}
    </Container>
  );
}
