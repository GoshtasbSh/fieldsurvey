// components/analyses/inputs/answer-picker.tsx
"use client";
import { useResponseColumns } from "@/hooks/use-response-columns";

type Props = {
  label: string;
  projectId: string;
  questionKey: string;
  value: string;
  onChange: (v: string) => void;
};

export function AnswerPicker({ label, projectId, questionKey, value, onChange }: Props) {
  const { columns } = useResponseColumns(projectId);
  const col = columns.find((c) => c.key === questionKey);
  const options = col?.distinctSample ?? [];

  return (
    <label className="block">
      <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-[var(--shell-text-muted)]">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={!col}
        className="mt-1 w-full rounded-md border border-[var(--shell-border)] bg-[var(--shell-1)] py-1.5 px-2 text-[12.5px] disabled:opacity-50"
      >
        <option value="">{col ? "Pick an answer" : "Select a question first"}</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );
}
