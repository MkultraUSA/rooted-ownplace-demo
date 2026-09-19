import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";

type TimelineEntry = { id: string; title: string; authorId: string; createdAt: string };
type Timeline = { stories: TimelineEntry[] };
type Story = { id: string; title: string; body: string; createdAt: string; authorId: string };

function isEntry(s: unknown): s is TimelineEntry {
  if (typeof s !== "object" || s === null) return false;
  const e = s as Record<string, unknown>;
  return (
    typeof e.id === "string" && e.id.length > 0 &&
    typeof e.title === "string" &&
    typeof e.authorId === "string" && e.authorId.length > 0 &&
    typeof e.createdAt === "string" && !Number.isNaN(Date.parse(e.createdAt))
  );
}

function sortEntries(list: TimelineEntry[]): TimelineEntry[] {
  return [...list].sort(
    (a, b) => b.createdAt.localeCompare(a.createdAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

function formatDate(iso: string): string {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? "unknown date" : new Date(t).toLocaleString();
}

async function safeJson(res: Response): Promise<unknown | null> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

async function loadTimeline(backend: string): Promise<TimelineEntry[]> {
  let res: Response;
  try {
    res = await fetch(`/stores/${backend}/timeline.json`);
  } catch {
    throw new Error("unreachable");
  }
  if (res.status === 404) return []; // legacy seed: no timeline yet (caller tries flat fallback)
  if (!res.ok) throw new Error(`backend error ${res.status}`);
  const parsed = await safeJson(res);
  if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as Timeline).stories)) {
    throw new Error("malformed timeline");
  }
  return sortEntries((parsed as Timeline).stories.filter(isEntry));
}

async function loadStory(backend: string, id: string): Promise<Story | null> {
  let res: Response;
  try {
    res = await fetch(`/stores/${backend}/timeline/${encodeURIComponent(id)}/story.json`);
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const parsed = await safeJson(res);
  if (!parsed || typeof (parsed as Story).title !== "string") return null;
  return parsed as Story;
}

// Flat fallback for legacy seeds (publish writes only flat files, no timeline/).
async function loadFlatStory(backend: string): Promise<Story | null> {
  let res: Response;
  try {
    res = await fetch(`/stores/${backend}/story.json`);
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const parsed = await safeJson(res);
  if (!parsed || typeof (parsed as Story).title !== "string") return null;
  return parsed as Story;
}

function useBackend(backend: string) {
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "error"; message: string }
    | { status: "empty" }
    | { status: "ready"; entries: TimelineEntry[]; stories: Record<string, Story>; legacy: boolean }
  >({ status: "loading" });
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await loadTimeline(backend);
        if (list.length > 0) {
          const pairs = await Promise.all(
            list.map(async (e) => [e.id, await loadStory(backend, e.id)] as const)
          );
          if (!cancelled) {
            setState({
              status: "ready",
              entries: list,
              stories: Object.fromEntries(pairs.filter(([, s]) => s !== null) as [string, Story][]),
              legacy: false,
            });
          }
          return;
        }
        const flat = await loadFlatStory(backend);
        if (!cancelled) {
          if (flat) {
            setState({
              status: "ready",
              entries: [{ id: flat.id, title: flat.title, authorId: flat.authorId, createdAt: flat.createdAt }],
              stories: { [flat.id]: flat },
              legacy: true,
            });
          } else {
            setState({ status: "empty" });
          }
        }
      } catch (e) {
        if (!cancelled) setState({ status: "error", message: (e as Error).message });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [backend]);
  return state;
}

function BackendColumn({ backend }: { backend: string }) {
  const state = useBackend(backend);
  return (
    <article>
      <div className="card-head">
        <span className="dot" />
        <div>
          <p className="label">Simulated backend</p>
          <h2>{backend}</h2>
        </div>
      </div>
      {state.status === "loading" && <p>Loading timeline…</p>}
      {state.status === "error" && (
        <p>
          Couldn&apos;t reach this backend ({state.message}). Showing nothing rather than
          pretending it&apos;s empty.
        </p>
      )}
      {state.status === "empty" && (
        <p>
          No stories yet — run <code>npm run post</code>.
        </p>
      )}
      {state.status === "ready" && (
        <>
          {state.legacy && (
            <p className="date">Legacy seed (flat copy — run npm run post for a timeline).</p>
          )}
          {state.entries.map((e) => {
            const s = state.stories[e.id];
            return (
              <div key={e.id} className="story">
                <p className="date">{formatDate(e.createdAt)}</p>
                <h3>{e.title}</h3>
                {s ? <p>{s.body}</p> : <p>Story file missing for this entry.</p>}
                <footer>
                  <code>{e.id}</code>
                </footer>
              </div>
            );
          })}
        </>
      )}
    </article>
  );
}

function App() {
  return (
    <main>
      <header>
        <p className="eyebrow">ROOTED / OWNPLACE</p>
        <h1>Your place, wherever your data lives.</h1>
        <p className="lede">
          Kinfolk timelines, read from two independent storage backends.
          Posting goes to everyone syndicated with you.
        </p>
      </header>
      <section className="boundary">
        <strong>Demo boundary</strong>
        <span>
          SHA-256 content hashes are real. Signing and encryption are
          placeholders, not production security.
        </span>
      </section>
      <div className="grid">
        <BackendColumn backend="nextcloud-sim" />
        <BackendColumn backend="google-drive-sim" />
      </div>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
