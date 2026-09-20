import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";

type TimelineEntry = { id: string; title: string; authorId: string; createdAt: string };
type Timeline = { stories: TimelineEntry[] };
type Story = { id: string; title: string; body: string; createdAt: string; authorId: string };
type Contact = { id: string; displayName: string; addedAt: string };
type ContactList = { contacts: Contact[] };

const BACKENDS = ["nextcloud-sim", "google-drive-sim"];

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
    res = await fetch(`/api/timeline?backend=${encodeURIComponent(backend)}`);
  } catch {
    throw new Error("unreachable");
  }
  if (res.status === 404) return [];
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
    res = await fetch(`/api/story?backend=${encodeURIComponent(backend)}&id=${encodeURIComponent(id)}`);
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const parsed = await safeJson(res);
  if (!parsed || typeof (parsed as Story).title !== "string") return null;
  return parsed as Story;
}

function useBackend(backend: string, refresh: number) {
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "error"; message: string }
    | { status: "empty" }
    | { status: "ready"; entries: TimelineEntry[]; stories: Record<string, Story> }
  >({ status: "loading" });
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await loadTimeline(backend);
        if (list.length === 0) {
          if (!cancelled) setState({ status: "empty" });
          return;
        }
        const pairs = await Promise.all(
          list.map(async (e) => [e.id, await loadStory(backend, e.id)] as const)
        );
        if (!cancelled) {
          setState({
            status: "ready",
            entries: list,
            stories: Object.fromEntries(pairs.filter(([, s]) => s !== null) as [string, Story][]),
          });
        }
      } catch (e) {
        if (!cancelled) setState({ status: "error", message: (e as Error).message });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [backend, refresh]);
  return state;
}

function Composer({ onPosted }: { onPosted: () => void }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [status, setStatus] = useState<string>("");
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setStatus("");
    try {
      const res = await fetch("/api/post", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, body }),
      });
      const parsed = (await safeJson(res)) as { storyId?: string; error?: string } | null;
      if (!res.ok) {
        setStatus(`Post failed: ${parsed?.error ?? res.status}`);
      } else {
        setStatus(`Posted ${parsed?.storyId ?? ""} — syndicated to all backends.`);
        setTitle("");
        setBody("");
        onPosted();
      }
    } catch (err) {
      setStatus(`Post failed: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="composer">
      <h2>New post</h2>
      <p className="lede">Posting goes to everyone syndicated with you.</p>
      <form onSubmit={submit}>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title (max 140)"
          maxLength={140}
          aria-label="Title"
        />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="What is happening?"
          maxLength={5000}
          rows={4}
          aria-label="Body"
        />
        <button type="submit" disabled={busy || !title.trim() || !body.trim()}>
          {busy ? "Posting…" : "Post to timeline"}
        </button>
      </form>
      {status && <p className="date">{status}</p>}
    </section>
  );
}

function Contacts() {
  const [list, setList] = useState<Contact[]>([]);
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [status, setStatus] = useState("");
  async function refresh() {
    try {
      const res = await fetch("/api/contacts");
      const parsed = (await safeJson(res)) as ContactList | null;
      setList(Array.isArray(parsed?.contacts) ? parsed.contacts : []);
    } catch {
      setList([]);
    }
  }
  useEffect(() => {
    refresh();
  }, []);
  async function add(e: React.FormEvent) {
    e.preventDefault();
    setStatus("");
    const res = await fetch("/api/contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, displayName: name }),
    });
    const parsed = (await safeJson(res)) as { error?: string } | null;
    if (!res.ok) {
      setStatus(`Couldn't add: ${parsed?.error ?? res.status}`);
    } else {
      setId("");
      setName("");
      refresh();
    }
  }
  async function remove(contactId: string) {
    if (!window.confirm(`Unfollow ${contactId}?`)) return;
    setStatus("");
    const res = await fetch(`/api/contacts?id=${encodeURIComponent(contactId)}`, { method: "DELETE" });
    if (!res.ok) {
      const parsed = (await safeJson(res)) as { error?: string } | null;
      setStatus(`Couldn't remove: ${parsed?.error ?? res.status}`);
      return;
    }
    refresh();
  }
  return (
    <section className="composer">
      <h2>Syndication contacts</h2>
      <p className="lede">Kinfolk you follow. Posts reach everyone here.</p>
      <ul>
        {list.map((c) => (
          <li key={c.id}>
            {c.displayName} <code>{c.id}</code>{" "}
            <button onClick={() => remove(c.id)}>Unfollow</button>
          </li>
        ))}
        {list.length === 0 && <li>No contacts yet.</li>}
      </ul>
      <form onSubmit={add}>
        <input value={id} onChange={(e) => setId(e.target.value)} placeholder="kinfolk id" aria-label="Contact id" />
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Display name" aria-label="Display name" />
        <button type="submit" disabled={!id.trim() || !name.trim()}>Follow</button>
      </form>
      {status && <p className="date">{status}</p>}
    </section>
  );
}

function BackendColumn({ backend, refresh }: { backend: string; refresh: number }) {
  const state = useBackend(backend, refresh);
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
          No stories yet — post above or run <code>npm run post</code>.
        </p>
      )}
      {state.status === "ready" && (
        <>
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
  const [refresh, setRefresh] = useState(0);
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
      <Composer onPosted={() => setRefresh((n) => n + 1)} />
      <Contacts />
      <div className="grid">
        {BACKENDS.map((b) => (
          <BackendColumn key={b} backend={b} refresh={refresh} />
        ))}
      </div>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
