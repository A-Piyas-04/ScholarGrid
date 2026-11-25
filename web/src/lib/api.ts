// Small typed fetch client for the ScholarGrid API (same origin; Next rewrites /api to FastAPI).

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function sessionId(): string {
  if (typeof window === "undefined") return "";
  try {
    let id = window.sessionStorage.getItem("sg-session");
    if (!id) {
      id = Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
      window.sessionStorage.setItem("sg-session", id);
    }
    return id;
  } catch {
    return "";
  }
}

type Query = Record<string, string | number | boolean | undefined | null | string[]>;

export function qs(params: Query = {}): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    if (Array.isArray(v)) v.forEach((x) => sp.append(k, x));
    else sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

async function request<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        "x-sg-session": sessionId(),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
      cache: "no-store",
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    throw new ApiError(0, "Can't reach the ScholarGrid server. Start it with: python -m scholargrid.api");
  }
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    let code: string | undefined;
    try {
      const data = await res.json();
      if (typeof data.detail === "string") message = data.detail;
      else if (Array.isArray(data.detail)) message = data.detail.map((d: { msg: string }) => d.msg).join("; ");
      code = data.code;
    } catch {
      if (res.status === 500 || res.status === 502 || res.status === 504) {
        message = "The ScholarGrid server isn't answering. Check that it is running on port 8000.";
      }
    }
    throw new ApiError(res.status, message, code);
  }
  return (await res.json()) as T;
}

export const api = {
  get: <T>(path: string, params?: Query, signal?: AbortSignal) => request<T>("GET", path + qs(params), undefined, signal),
  post: <T>(path: string, body?: unknown, params?: Query) => request<T>("POST", path + qs(params), body ?? {}),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body ?? {}),
  del: <T>(path: string, params?: Query) => request<T>("DELETE", path + qs(params)),
};

export function downloadText(filename: string, content: string, mediaType = "text/plain") {
  const blob = new Blob([content], { type: `${mediaType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
