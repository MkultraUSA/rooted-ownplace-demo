import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";

type TimelineEntry = { id: string; title: string; authorId: string; createdAt: string };
type Timeline = { stories: TimelineEntry[] };
type Story = { id: string; title: string; body: string; createdAt: string; authorId: string };

async function loadTimeline(backend: string): Promise<TimelineEntry[]> {
  const res = await fetch(`/stores/${backend}/timeline.json`);
  if (!res.ok) return [];
  const parsed = (await res.json()) as Partial<Timeline>;
  if (!parsed || !Array.isArray(parsed.stories)) return [];
  return parsed.stories.filter(
    (s): s is TimelineEntry =>
      typeof s?.id === "string" && typeof s?.title === "string"
  );
}

async function loadStory(backend: string, id: string): Promise<Story | null> {
  const res = await fetch(`/stores/${backend}/timeline/${id}/story.json`);
  if (!res.ok) return null;
  return (await res.json()) as Story;
}

function useBackend(backend: string) {
  const [entries, setEntries] = useState<TimelineEntry[]>([]);
  const [stories, setStories] = useState<Record<string, Story>>({});
  useEffect(() => {
    loadTimeline(backend).then(async (list) => {
      setEntries(list);
      const pairs = await Promise.all(
        list.map(async (e) => [e.id, await loadStory(backend, e.id)] as const)
      );
      setStories(Object.fromEntries(pairs.filter(([, s]) => s !== null) as [string, Story][]));
    });
  }, [backend]);
  return { entries, stories };
}

function BackendColumn({ backend }: { backend: string }) {
  const { entries, stories } = useBackend(backend);
  return (
    <article>
      <div className="card-head">
        <span className="dot" />
        <div>
          <p className="label">Simulated backend</p>
          <h2>{backend}</h2>
        </div>
      </div>
      {entries.length === 0 ? (
        <p>No stories yet — run <code>npm run post</code>.</p>
      ) : (
        entries.map((e) => {
          const s = stories[e.id];
          return (
            <div key={e.id} className="story">
              <p className="date">{new Date(e.createdAt).toLocaleString()}</p>
              <h3>{e.title}</h3>
              {s ? <p>{s.body}</p> : <p>Loading…</p>}
              <footer>
                <code>{e.id}</code>
              </footer>
            </div>
          );
        })
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
