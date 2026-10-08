"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { READ_ONLY } from "@/lib/api";
import { useTutorial } from "./Tutorial";

export function Header() {
  const path = usePathname();
  const router = useRouter();
  const { enabled, setEnabled, startTour } = useTutorial();
  const [token, setToken] = useState<boolean | null>(null);

  useEffect(() => {
    if (READ_ONLY) return;
    const load = () =>
      fetch("/api/status")
        .then((r) => r.json())
        .then((s) => setToken(s.tokenConfigured))
        .catch(() => {});
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

  return (
    <header className="top">
      <h1>
        <Link href="/">Vault Village</Link>
      </h1>
      <nav className="nav">
        <Link href="/" className={path === "/" ? "on" : ""}>
          Viewer
        </Link>
        <Link href="/dashboard" className={path === "/dashboard" ? "on" : ""}>
          Dashboard
        </Link>
        {!READ_ONLY && (
          <Link href="/label" className={path === "/label" ? "on" : ""}>
            Label
          </Link>
        )}
        <Link href="/guide" className={path === "/guide" ? "on" : ""} data-tour="guide-link">
          How it works
        </Link>
      </nav>
      <span className="spacer" />
      {READ_ONLY && <span className="badge">read-only</span>}
      {token !== null && <span className={`badge ${token ? "ok" : "missing"}`}>{token ? "Copilot token" : "No Copilot token"}</span>}
      <label className="switch" title="Show the guided tour and inline hints">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        <span>Tutorial</span>
      </label>
      {enabled && (
        <button
          type="button"
          className="ghost small"
          onClick={() => {
            if (path !== "/") router.push("/");
            startTour();
          }}
        >
          Take the tour
        </button>
      )}
    </header>
  );
}
