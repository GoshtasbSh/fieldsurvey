"use client";

import { useEffect, useState } from "react";
import { LayoutGrid, List } from "lucide-react";

export type HomeView = "grid" | "list";

export function useHomeView(): [HomeView, (v: HomeView) => void] {
  const [view, setView] = useState<HomeView>("grid");
  useEffect(() => {
    try {
      const stored = localStorage.getItem("fs-home-view");
      if (stored === "grid" || stored === "list") setView(stored);
    } catch {
      /* ignore */
    }
  }, []);
  const setAndStore = (v: HomeView) => {
    setView(v);
    try {
      localStorage.setItem("fs-home-view", v);
    } catch {
      /* ignore */
    }
  };
  return [view, setAndStore];
}

export function ViewToggle({
  view,
  onChange,
}: {
  view: HomeView;
  onChange: (v: HomeView) => void;
}) {
  return (
    <div className="bento-seg">
      <button
        onClick={() => onChange("grid")}
        className={view === "grid" ? "bento-seg-on" : ""}
        aria-pressed={view === "grid"}
        type="button"
      >
        <LayoutGrid size={13} /> Grid
      </button>
      <button
        onClick={() => onChange("list")}
        className={view === "list" ? "bento-seg-on" : ""}
        aria-pressed={view === "list"}
        type="button"
      >
        <List size={13} /> List
      </button>
    </div>
  );
}
