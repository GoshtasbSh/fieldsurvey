// components/analyses/settings-drawer.tsx
"use client";
import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import type { SpatialCardCatalogEntry, SettingSchema } from "@/lib/analyses/types";
import { useAnalysisResult } from "@/hooks/use-analysis-result";
import { QuestionPicker } from "./inputs/question-picker";
import { AnswerPicker } from "./inputs/answer-picker";
import { PoiPicker } from "./inputs/poi-picker";
import { SettingSlider } from "./inputs/setting-slider";
import { SettingSelect } from "./inputs/setting-select";
import { SettingToggle } from "./inputs/setting-toggle";

type Props = {
  open: boolean;
  card: SpatialCardCatalogEntry;
  projectId: string;
  globalActiveQuestion: string | null;
  settings: Record<string, unknown>;
  onChange: (patch: Record<string, unknown>) => void;
  onClose: () => void;
  /** Called with the raw result payload when the user clicks "Pin to left panel". */
  onPin: (result: unknown) => void;
};

function renderField(
  schema: SettingSchema,
  ctx: { projectId: string; globalActiveQuestion: string | null; settings: Record<string, unknown>; emit: (key: string, v: unknown) => void },
) {
  const { projectId, globalActiveQuestion, settings, emit } = ctx;
  switch (schema.type) {
    case "question_picker":
      return (
        <QuestionPicker
          key={schema.key} label={schema.label} projectId={projectId}
          value={(settings[schema.key] as string | "inherit_global" | undefined) ?? schema.defaultValue ?? "inherit_global"}
          globalActiveQuestion={globalActiveQuestion}
          onChange={(v) => emit(schema.key, v)}
        />
      );
    case "answer_picker": {
      const qk = (settings[schema.questionKeyRef] as string | undefined) ?? "";
      return (
        <AnswerPicker
          key={schema.key} label={schema.label} projectId={projectId}
          questionKey={qk}
          value={(settings[schema.key] as string | undefined) ?? ""}
          onChange={(v) => emit(schema.key, v)}
        />
      );
    }
    case "poi_picker":
      return (
        <PoiPicker
          key={schema.key} label={schema.label}
          value={(settings[schema.key] as { lat: number; lon: number } | null | undefined) ?? null}
          onChange={(v) => emit(schema.key, v)}
        />
      );
    case "slider":
      return (
        <SettingSlider
          key={schema.key} label={schema.label}
          min={schema.min} max={schema.max} step={schema.step}
          value={(settings[schema.key] as number | undefined) ?? schema.defaultValue}
          onChange={(v) => emit(schema.key, v)}
        />
      );
    case "select":
      return (
        <SettingSelect
          key={schema.key} label={schema.label} options={schema.options}
          value={(settings[schema.key] as string | number | undefined) ?? schema.defaultValue}
          onChange={(v) => emit(schema.key, v)}
        />
      );
    case "toggle":
      return (
        <SettingToggle
          key={schema.key} label={schema.label}
          value={(settings[schema.key] as boolean | undefined) ?? schema.defaultValue}
          onChange={(v) => emit(schema.key, v)}
        />
      );
  }
}

function ResultPanel({
  loading,
  error,
  data,
  computedAt,
  onPin,
}: {
  loading: boolean;
  error: string | null;
  data: unknown | null;
  computedAt: string | null;
  onPin: (result: unknown) => void;
}) {
  if (loading) {
    return (
      <div className="rounded-lg bg-[var(--shell-2)] p-3 animate-pulse">
        <div className="h-2 w-2/3 rounded bg-[var(--shell-border)] mb-2" />
        <div className="h-2 w-1/2 rounded bg-[var(--shell-border)]" />
      </div>
    );
  }
  if (error) {
    return (
      <div className="rounded-lg bg-red-500/10 border border-red-500/20 p-3 text-[11.5px] text-red-400">
        {error}
      </div>
    );
  }
  if (data === null) return null;

  const isWavePending =
    typeof data === "object" &&
    data !== null &&
    (data as Record<string, unknown>).reason === "wave-pending";

  return (
    <div className="rounded-lg border border-[var(--shell-border)] bg-[var(--shell-2)] p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[9.5px] uppercase tracking-[0.06em] text-[var(--shell-text-muted)]">
          Result
        </span>
        {computedAt && (
          <span className="font-mono text-[9px] text-[var(--shell-text-muted)]">
            {new Date(computedAt).toLocaleTimeString()}
          </span>
        )}
      </div>
      {isWavePending ? (
        <p className="text-[11.5px] text-[var(--shell-text-muted)]">
          Compute backend ships in a later wave — result preview not available yet.
        </p>
      ) : (
        <p className="text-[11.5px] font-mono break-all text-[var(--shell-text-muted)]">
          {JSON.stringify(data).slice(0, 200)}…
        </p>
      )}
      {!isWavePending && (
        <button
          onClick={() => onPin(data)}
          aria-label="Pin to left panel"
          className="w-full rounded-md bg-[var(--shell-1)] border border-[var(--shell-border)] text-[12px] font-semibold py-1.5 px-3 hover:bg-[var(--accent-1,#0EA5E9)] hover:text-white hover:border-transparent transition-colors"
        >
          📌 Pin to left panel
        </button>
      )}
    </div>
  );
}

export function SettingsDrawer(p: Props) {
  const emit = (key: string, v: unknown) => p.onChange({ ...p.settings, [key]: v });
  const { data, loading, error, computedAt, run } = useAnalysisResult(p.projectId, p.card.id, p.settings);
  const [hasRun, setHasRun] = useState(false);

  const handleRun = async () => {
    setHasRun(true);
    await run();
  };

  return (
    <Dialog.Root open={p.open} onOpenChange={(o) => !o && p.onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/30 z-40" />
        <Dialog.Content
          className="fixed z-50 right-0 top-0 h-full w-[min(420px,100vw)]
                     bg-[var(--shell-1)] border-l border-[var(--shell-border)] shadow-2xl
                     flex flex-col"
        >
          <header className="p-4 border-b border-[var(--shell-border)] flex items-start justify-between">
            <div>
              <Dialog.Title className="text-sm font-semibold">{p.card.name}</Dialog.Title>
              <p className="text-[11px] text-[var(--shell-text-muted)] font-mono">{p.card.id}</p>
            </div>
            <Dialog.Close aria-label="Close" className="text-[var(--shell-text-muted)] hover:text-[var(--shell-text)]">
              ✕
            </Dialog.Close>
          </header>

          <div className="flex-1 overflow-auto p-4 space-y-4">
            <section className="space-y-3">
              <div className="font-mono text-[10px] uppercase tracking-[0.06em] text-[var(--shell-text-muted)]">
                Inputs
              </div>
              {p.card.settingsSchema.map((s) =>
                renderField(s, {
                  projectId: p.projectId,
                  globalActiveQuestion: p.globalActiveQuestion,
                  settings: p.settings,
                  emit,
                }),
              )}
            </section>

            <section>
              <div className="font-mono text-[10px] uppercase tracking-[0.06em] text-[var(--shell-text-muted)] mb-1">
                Method
              </div>
              <p className="text-[12px] leading-snug">{p.card.whatItDoes}</p>
              {p.card.sourceInspiration && (
                <p className="text-[11px] text-[var(--shell-text-muted)] mt-1">
                  {p.card.sourceInspiration}
                </p>
              )}
            </section>

            {hasRun && (
              <ResultPanel
                loading={loading}
                error={error}
                data={data}
                computedAt={computedAt}
                onPin={p.onPin}
              />
            )}
          </div>

          <footer className="p-3 border-t border-[var(--shell-border)] flex justify-end gap-2">
            <button
              onClick={handleRun}
              disabled={loading}
              aria-label="Run analysis"
              className="rounded-md bg-[var(--accent-1,#0EA5E9)] text-white text-[12px] font-semibold py-1.5 px-3 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {loading ? "Running…" : "Run analysis"}
            </button>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
