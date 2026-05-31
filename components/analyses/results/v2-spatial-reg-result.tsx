// components/analyses/results/v2-spatial-reg-result.tsx
"use client";

type Coefficient = {
  name: string;
  beta: number;
  se?: number;
  t?: number;
  p?: number;
};

type ModelSpec = {
  r2: number;
  aic: number;
  coefficients?: Coefficient[];
  moran_I_residuals?: number;
  moran_p_residuals?: number;
  rho?: number;
  lambda?: number;
  error?: string;
};

type V2SpatialRegData = {
  ols: ModelSpec;
  spatial_lag?: ModelSpec | null;
  spatial_error?: ModelSpec | null;
  best_model: string;
  aic_delta: Record<string, number>;
  moran_I: number;
  moran_p: number;
  spatial_autocorrelation_significant: boolean;
  spatial_models_computed: boolean;
  verdict: string;
  n: number;
  y_key: string;
  x_keys: string[];
  error?: string;
  message?: string;
};

function ModelCard({ label, model, isBest, aic_delta }: {
  label: string; model: ModelSpec | null | undefined; isBest: boolean; aic_delta?: number;
}) {
  if (!model) return null;
  if ("error" in model && model.error) {
    return (
      <div className="rounded bg-[var(--shell-1)] border border-[var(--shell-border)] p-2 opacity-60">
        <p className="text-[10px] font-mono text-[var(--shell-text-muted)]">{label} — failed: {model.error as string}</p>
      </div>
    );
  }
  return (
    <div className={`rounded border p-2 space-y-1 ${isBest ? "border-[var(--accent-1,#0EA5E9)] bg-[var(--accent-1,#0EA5E9)]/5" : "border-[var(--shell-border)] bg-[var(--shell-1)]"}`}>
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] font-semibold">{label}{isBest ? " ✓ best" : ""}</span>
        <span className="font-mono text-[10px] text-[var(--shell-text-muted)]">ΔAIC {aic_delta != null ? aic_delta.toFixed(1) : "—"}</span>
      </div>
      <div className="flex gap-3 text-[10.5px]">
        <span>R² <strong>{model.r2.toFixed(3)}</strong></span>
        <span>AIC <strong>{model.aic.toFixed(1)}</strong></span>
        {model.rho != null && <span>ρ <strong>{model.rho.toFixed(3)}</strong></span>}
        {model.lambda != null && <span>λ <strong>{model.lambda.toFixed(3)}</strong></span>}
      </div>
      {model.coefficients && model.coefficients.length > 0 && (
        <div className="space-y-0.5 pt-1 border-t border-[var(--shell-border)]">
          {model.coefficients.map(c => (
            <div key={c.name} className="flex justify-between text-[10px]">
              <span className="font-mono text-[var(--shell-text-muted)] truncate max-w-[120px]">{c.name}</span>
              <span className="font-mono">
                β={c.beta.toFixed(3)}
                {c.p != null && (
                  <span className={c.p < 0.05 ? " text-[var(--accent-1,#0EA5E9)]" : " text-[var(--shell-text-muted)]"}>
                    {" "}p={c.p.toFixed(3)}
                  </span>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function V2SpatialRegResult({ data }: { data: unknown }) {
  const d = data as V2SpatialRegData;

  if (d.error) {
    return <p className="text-[11.5px] text-amber-400">{d.message ?? d.error}</p>;
  }

  const moranSig = d.spatial_autocorrelation_significant;
  const delta = d.aic_delta ?? {};

  return (
    <div className="space-y-3 text-[var(--shell-text)]">
      {/* Moran banner */}
      <div className={`rounded p-2.5 text-[11px] leading-snug ${moranSig ? "bg-amber-500/10 border border-amber-500/30 text-amber-300" : "bg-emerald-500/10 border border-emerald-500/30 text-emerald-300"}`}>
        <span className="font-semibold">Moran I = {d.moran_I.toFixed(3)}</span>
        <span className="text-[10px] ml-1">(p = {d.moran_p.toFixed(3)})</span>
        <span className="ml-2">{moranSig ? "⚠ Spatial autocorrelation in residuals — spatial model recommended" : "✓ OLS residuals appear spatially random"}</span>
      </div>

      {/* n summary */}
      <div className="text-[10px] text-[var(--shell-text-muted)]">
        n = {d.n} &nbsp;·&nbsp; Y = <code className="font-mono">{d.y_key}</code> &nbsp;·&nbsp; X = <code className="font-mono">{(d.x_keys ?? []).join(", ")}</code>
      </div>

      {/* Model cards */}
      <div className="space-y-2">
        <ModelCard label="OLS" model={d.ols} isBest={d.best_model === "OLS"} aic_delta={delta["OLS"]} />
        {d.spatial_models_computed ? (
          <>
            <ModelCard label="Spatial Lag (2SLS)" model={d.spatial_lag} isBest={d.best_model === "Spatial Lag"} aic_delta={delta["Spatial Lag"]} />
            <ModelCard label="Spatial Error (FGLS)" model={d.spatial_error} isBest={d.best_model === "Spatial Error"} aic_delta={delta["Spatial Error"]} />
          </>
        ) : (
          <p className="text-[10px] text-[var(--shell-text-muted)]">Spatial models skipped (n &gt; 1000 — dense W matrix too large).</p>
        )}
      </div>

      {/* Verdict */}
      <p className="text-[10.5px] text-[var(--shell-text-muted)] leading-snug border-t border-[var(--shell-border)] pt-2">
        {d.verdict}
      </p>
    </div>
  );
}
