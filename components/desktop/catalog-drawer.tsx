"use client";

// Catalog drawer — admin-only.
// Lists all 53+ catalog cards grouped by section. Admin toggles cards on/off
// for the active Saved View; viewers do not see this UI.

import { useMemo, useState } from "react";
import { Search, X, ChevronDown, BookmarkPlus, Check } from "lucide-react";
import {
  ANALYSES_REGISTRY,
  SECTION_ORDER,
  SECTION_LABELS,
} from "@/lib/analyses/registry";
import type { CardDescriptor } from "@/lib/analyses/types";

type Filter = "all" | "default" | "wave1" | "stubs" | "admin";

type Props = {
  open: boolean;
  onClose: () => void;
  /** Active view's enabled card-ids (controlled). */
  enabledCards: Set<string>;
  /** Called when admin toggles a card. */
  onToggle: (cardId: string, enabled: boolean) => void;
  /** Called when admin clicks "Save to view". */
  onSaveToView?: (viewName: string) => void;
  /** Called when member/admin votes for a stub card. */
  onVoteStub?: (cardId: string) => void;
  /** Available saved view names for the "Save to" footer dropdown. */
  viewNames?: string[];
  /** Current viewer role. Drawer only opens if 'admin' but stub votes work for any. */
  viewerRole: "admin" | "member" | "guest" | "surveyor";
};

export function CatalogDrawer({
  open, onClose, enabledCards, onToggle, onSaveToView, onVoteStub, viewNames, viewerRole,
}: Props) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
  const [saveTargetView, setSaveTargetView] = useState<string>(viewNames?.[0] ?? "Default");

  const matchingCards = useMemo(() => {
    const term = search.toLowerCase().trim();
    return ANALYSES_REGISTRY.filter((c) => {
      if (term && !(c.name.toLowerCase().includes(term) || c.short.toLowerCase().includes(term) || c.id.toLowerCase().includes(term))) return false;
      if (filter === "default" && !c.defaultPack) return false;
      if (filter === "wave1" && (!c.m7Wave1 || c.defaultPack)) return false;
      if (filter === "stubs" && !c.stub) return false;
      if (filter === "admin" && c.roleGate !== "admin") return false;
      return true;
    });
  }, [search, filter]);

  const grouped = useMemo(() => {
    const out: Record<string, CardDescriptor[]> = {};
    for (const c of matchingCards) {
      (out[c.section] ||= []).push(c);
    }
    return out;
  }, [matchingCards]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex justify-end" aria-modal="true" role="dialog">
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Close catalog"
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Sheet */}
      <div className="relative flex h-full w-full max-w-[420px] flex-col border-l border-[var(--shell-border)] bg-[var(--shell-base)] shadow-2xl">
        {/* Header */}
        <div className="border-b border-[var(--shell-border)] px-4 py-3">
          <div className="mb-2 flex items-center justify-between">
            <div className="font-display text-[14px] font-extrabold tracking-tight">Analyses Catalog</div>
            <button onClick={onClose} className="rounded-md p-1 hover:bg-[var(--shell-2)]" aria-label="Close">
              <X className="h-4 w-4" strokeWidth={1.7} />
            </button>
          </div>

          <div className="mb-2 flex items-center gap-2 rounded-lg border border-[var(--shell-border)] bg-[var(--shell-2)] px-2">
            <Search className="h-3 w-3 text-[var(--shell-text-muted)]" strokeWidth={1.7} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Find a card by name…"
              className="w-full bg-transparent py-1.5 text-[12px] outline-none"
            />
          </div>

          <div className="flex gap-1.5">
            <FilterChip active={filter === "all"} onClick={() => setFilter("all")}>All</FilterChip>
            <FilterChip active={filter === "default"} onClick={() => setFilter("default")}>★ Default</FilterChip>
            <FilterChip active={filter === "wave1"} onClick={() => setFilter("wave1")}>◆ Wave-1</FilterChip>
            <FilterChip active={filter === "stubs"} onClick={() => setFilter("stubs")}>○ Coming</FilterChip>
            <FilterChip active={filter === "admin"} onClick={() => setFilter("admin")}>🔒 Admin</FilterChip>
          </div>

          <div className="mt-2 font-mono text-[9.5px] uppercase tracking-[0.07em] text-[var(--shell-text-muted)]">
            {matchingCards.length} of {ANALYSES_REGISTRY.length} cards
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 py-3">
          {SECTION_ORDER.map((sec) => {
            const cards = grouped[sec];
            if (!cards || cards.length === 0) return null;
            const collapsed = collapsedSections.has(sec);
            return (
              <div key={sec} className="mb-3">
                <button
                  onClick={() => {
                    const next = new Set(collapsedSections);
                    if (collapsed) next.delete(sec); else next.add(sec);
                    setCollapsedSections(next);
                  }}
                  className="mb-1.5 flex w-full items-center justify-between text-left"
                >
                  <span className="font-display text-[11px] font-extrabold uppercase tracking-[0.06em] text-[var(--shell-text-2)]">
                    {SECTION_LABELS[sec]}
                  </span>
                  <ChevronDown
                    className={`h-3 w-3 text-[var(--shell-text-muted)] transition-transform ${collapsed ? "-rotate-90" : ""}`}
                    strokeWidth={1.7}
                  />
                </button>
                {!collapsed && (
                  <div className="space-y-1.5">
                    {cards.map((c) => (
                      <CardRow
                        key={c.id}
                        card={c}
                        enabled={enabledCards.has(c.id)}
                        canEdit={viewerRole === "admin"}
                        onToggle={(en) => onToggle(c.id, en)}
                        onVoteStub={onVoteStub}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Footer — Save to view */}
        {viewerRole === "admin" && viewNames && viewNames.length > 0 && (
          <div className="border-t border-[var(--shell-border)] bg-[var(--shell-2)] px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-[var(--shell-text-muted)]">
                Save to view:
              </span>
              <select
                value={saveTargetView}
                onChange={(e) => setSaveTargetView(e.target.value)}
                className="flex-1 rounded-md border border-[var(--shell-border)] bg-[var(--shell-base)] px-2 py-1 text-[11.5px]"
              >
                {viewNames.map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
              <button
                onClick={() => onSaveToView?.(saveTargetView)}
                className="inline-flex items-center gap-1 rounded-md bg-[var(--shell-text)] px-2.5 py-1 font-mono text-[10.5px] font-bold uppercase tracking-[0.07em] text-[var(--shell-base)] hover:opacity-90"
              >
                <BookmarkPlus className="h-3 w-3" strokeWidth={1.7} />
                Save
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full border px-2 py-1 text-[10px] font-bold transition-colors ${
        active
          ? "border-[var(--shell-text)] bg-[var(--shell-text)] text-[var(--shell-base)]"
          : "border-[var(--shell-border)] text-[var(--shell-text-2)] hover:bg-[var(--shell-2)]"
      }`}
    >
      {children}
    </button>
  );
}

function CardRow({
  card, enabled, canEdit, onToggle, onVoteStub,
}: {
  card: CardDescriptor;
  enabled: boolean;
  canEdit: boolean;
  onToggle: (enabled: boolean) => void;
  onVoteStub?: (cardId: string) => void;
}) {
  const [voted, setVoted] = useState(false);
  return (
    <div
      className={`rounded-lg border px-3 py-2.5 transition-colors ${
        card.stub
          ? "border-[var(--shell-border)] bg-[var(--shell-2)] opacity-90"
          : enabled
          ? "border-[var(--shell-text-muted)] bg-[var(--shell-2)]"
          : "border-[var(--shell-border)] hover:bg-[var(--shell-2)]"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-[12px] font-bold text-[var(--shell-text)]">{card.name}</span>
            <span className="font-mono text-[9px] text-[var(--shell-text-muted)]">{card.id}</span>
          </div>
          <div className="mt-0.5 text-[10.5px] leading-snug text-[var(--shell-text-muted)]">{card.short}</div>

          <div className="mt-1 flex flex-wrap items-center gap-1">
            {card.defaultPack && <Badge tone="gold">★ Default</Badge>}
            {card.m7Wave1 && !card.defaultPack && <Badge tone="blue">◆ Wave-1</Badge>}
            {card.stub && <Badge tone="gray">○ Coming</Badge>}
            {card.roleGate === "admin" && <Badge tone="red">🔒 Admin</Badge>}
            {card.nMin > 0 && <Badge tone="ghost">n≥{card.nMin}</Badge>}
            <Badge tone="ghost">{card.computeStrategy === "python_sidecar" ? "sidecar" : card.computeStrategy}</Badge>
          </div>
        </div>

        {card.stub ? (
          <button
            disabled={voted}
            onClick={() => {
              setVoted(true);
              onVoteStub?.(card.id);
            }}
            className={`shrink-0 rounded-md border px-2 py-1 font-mono text-[9.5px] font-bold uppercase tracking-[0.06em] transition-colors ${
              voted
                ? "border-[var(--shell-border)] bg-[var(--shell-3)] text-[var(--shell-text-muted)]"
                : "border-[var(--shell-border)] text-[var(--shell-text-2)] hover:bg-[var(--shell-3)]"
            }`}
            title="Vote up to prioritize this card"
          >
            {voted ? <Check className="h-3 w-3" /> : "↑ vote"}
          </button>
        ) : (
          <Toggle enabled={enabled} disabled={!canEdit} onChange={onToggle} />
        )}
      </div>
    </div>
  );
}

function Badge({ tone, children }: { tone: "gold" | "blue" | "gray" | "red" | "ghost"; children: React.ReactNode }) {
  const map: Record<typeof tone, string> = {
    gold: "border-[oklch(86%_0.18_88/0.4)] text-[oklch(82%_0.17_86)]",
    blue: "border-[oklch(70%_0.155_234/0.4)] text-[oklch(78%_0.155_234)]",
    gray: "border-[var(--shell-border)] text-[var(--shell-text-muted)]",
    red: "border-[oklch(70%_0.18_25/0.4)] text-[oklch(72%_0.18_25)]",
    ghost: "border-[var(--shell-border)] text-[var(--shell-text-muted)]",
  };
  return (
    <span className={`rounded-full border px-1.5 py-px font-mono text-[8.5px] font-bold uppercase tracking-[0.05em] ${map[tone]}`}>
      {children}
    </span>
  );
}

function Toggle({ enabled, disabled, onChange }: { enabled: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={enabled}
      disabled={disabled}
      onClick={() => onChange(!enabled)}
      className={`relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors ${
        enabled ? "bg-[var(--shell-text)]" : "bg-[var(--shell-3)]"
      } ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
    >
      <span
        className={`inline-block h-3 w-3 transform rounded-full transition-transform ${
          enabled ? "translate-x-3.5 bg-[var(--shell-base)]" : "translate-x-0.5 bg-[var(--shell-text-muted)]"
        }`}
      />
    </button>
  );
}
