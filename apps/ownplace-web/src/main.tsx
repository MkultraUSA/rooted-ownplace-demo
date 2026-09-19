import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";

type Story = { title: string; body: string; createdAt: string; authorId: string };
type Package = { story: Story; signature: { algorithm: string; note: string }; manifest: { objects: { path: string; sha256: string }[] } };
async function load(backend: string): Promise<Package> {
  const get = async (file: string) => (await fetch(`/stores/${backend}/${file}`)).json();
  return { story: await get("story.json"), signature: await get("signature.json"), manifest: await get("manifest.json") };
}
function App() {
  const [packages, setPackages] = useState<Record<string, Package>>({});
  useEffect(() => { Promise.all(["nextcloud-sim", "google-drive-sim"].map(async (backend) => [backend, await load(backend)] as const)).then((items) => setPackages(Object.fromEntries(items))); }, []);
  return <main><header><p className="eyebrow">ROOTED / OWNPLACE</p><h1>Your place, wherever your data lives.</h1><p className="lede">One Kinfolk story, read from two independent storage backends.</p></header><section className="boundary"><strong>Demo boundary</strong><span>SHA-256 content hashes are real. Signing and encryption are placeholders, not production security.</span></section><div className="grid">{["nextcloud-sim", "google-drive-sim"].map((backend) => { const item = packages[backend]; return <article key={backend}><div className="card-head"><span className="dot" /><div><p className="label">Simulated backend</p><h2>{backend}</h2></div></div>{item ? <><p className="date">{new Date(item.story.createdAt).toLocaleDateString()}</p><h3>{item.story.title}</h3><p>{item.story.body}</p><footer>Package: <code>rooted-demo-first-light</code><br />Signature: {item.signature.algorithm}</footer></> : <p>Loading package...</p>}</article>; })}</div></main>;
}
createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
