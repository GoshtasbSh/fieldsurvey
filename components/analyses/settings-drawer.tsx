// components/analyses/settings-drawer.tsx
"use client";
import * as Dialog from "@radix-ui/react-dialog";
import type { SpatialCardCatalogEntry, SettingSchema } from "@/lib/analyses/types";
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
  onRecompute: () => void;
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

export function SettingsDrawer(p: Props) {
  const emit = (key: string, v: unknown) => p.onChange({ ...p.settings, [key]: v });

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
            <Dialog.Close aria-label="Close" className="text-[var(--shell-text-muted)] hover:text-[var(--shell-text)]">✕</Dialog.Close>
          </header>
          <div className="flex-1 overflow-auto p-4 space-y-4">
            <section className="space-y-3">
              <div className="font-mono text-[10px] uppercase tracking-[0.06em] text-[var(--shell-text-muted)]">
                Inputs
              </div>
              {p.card.settingsSchema.map((s) =>
                renderField(s, { projectId: p.projectId, globalActiveQuestion: p.globalActiveQuestion, settings: p.settings, emit })
              )}
            </section>
            <section>
              <div className="font-mono text-[10px] uppercase tracking-[0.06em] text-[var(--shell-text-muted)] mb-1">
                Method
              </div>
              <button
                type="button"
                title={p.card.whatItDoes}
                aria-label={p.card.whatItDoes}
                className="text-[11px] text-[var(--shell-text-muted)] underline decoration-dotted cursor-help text-left"
              >
                What does this analysis do?
              </button>
              {p.card.sourceInspiration && (
                <p className="text-[11px] text-[var(--shell-text-muted)] mt-1">
                  {p.card.sourceInspiration}
                </p>
              )}
            </section>
          </div>
          <footer className="p-3 border-t border-[var(--shell-border)] flex justify-end gap-2">
            <button
              onClick={p.onRecompute}
              className="rounded-md bg-[var(--accent-1,#0EA5E9)] text-white text-[12px] font-semibold py-1.5 px-3"
            >
              Re-compute
            </button>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
