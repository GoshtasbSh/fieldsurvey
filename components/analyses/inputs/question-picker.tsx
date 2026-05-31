// components/analyses/inputs/question-picker.tsx
"use client";
import { useResponseColumns } from "@/hooks/use-response-columns";

type Props = {
  label: string;
  projectId: string;
  value: string | "inherit_global";
  globalActiveQuestion: string | null;
  onChange: (v: string | "inherit_global") => void;
};

export function QuestionPicker({ label, projectId, value, globalActiveQuestion, onChange }: Props) {
  const { columns, loading } = useResponseColumns(projectId);
  return (
    <fieldset className="block">
      <legend className="font-mono text-[10px] uppercase tracking-[0.06em] text-[var(--shell-text-muted)]">
        {label}
      </legend>
      <div className="space-y-1 mt-1">
        <label className="flex items-center gap-2 text-[12.5px]">
          <input
            type="radio" name={`qp-${label}`} value="inherit_global"
            checked={value === "inherit_global"}
            onChange={() => onChange("inherit_global")}
          />
          Follow global active
          {globalActiveQuestion && (
            <span className="font-mono text-[10.5px] text-[var(--shell-text-muted)]">
              ({globalActiveQuestion})
            </span>
          )}
        </label>
        <label className="flex items-center gap-2 text-[12.5px]">
          <input
            type="radio" name={`qp-${label}`} value="override"
            checked={value !== "inherit_global"}
            onChange={() => onChange(columns[0]?.key ?? "")}
          />
          Override with…
          <select
            disabled={value === "inherit_global" || loading}
            value={value === "inherit_global" ? "" : value}
            onChange={(e) => onChange(e.target.value)}
            className="rounded-md border border-[var(--shell-border)] bg-[var(--shell-1)] py-1 px-2 text-[12.5px] disabled:opacity-50"
          >
            <option value="">{loading ? "Loading…" : "Pick a question"}</option>
            {columns.map((c) => (
              <option key={c.key} value={c.key}>{c.key} ({c.inferredType})</option>
            ))}
          </select>
        </label>
      </div>
    </fieldset>
  );
}
