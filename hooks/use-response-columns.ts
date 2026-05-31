// hooks/use-response-columns.ts
// Wave-0 stub: returns the distinct raw_data keys + sample values for a project.
// Wave-1 swaps this with a real fetch against /api/projects/{p}/response-schema.
"use client";
import { useEffect, useState } from "react";

export type ResponseColumn = {
  key: string;
  inferredType: "categorical" | "numeric" | "likert" | "boolean" | "text" | "date";
  distinctSample: string[];
};

export function useResponseColumns(projectId: string | undefined): {
  columns: ResponseColumn[];
  loading: boolean;
} {
  const [columns, setColumns] = useState<ResponseColumn[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    // Wave-0 fixture; replaced in Wave 1 with real fetch.
    const fixture: ResponseColumn[] = [
      { key: "Q1", inferredType: "categorical", distinctSample: ["Yes", "No", "Maybe"] },
      { key: "Q2", inferredType: "numeric", distinctSample: ["12", "34", "56"] },
      { key: "Q3", inferredType: "likert", distinctSample: ["Strongly disagree", "Disagree", "Neutral", "Agree", "Strongly agree"] },
    ];
    setTimeout(() => { if (!cancelled) { setColumns(fixture); setLoading(false); } }, 30);
    return () => { cancelled = true; };
  }, [projectId]);

  return { columns, loading };
}
