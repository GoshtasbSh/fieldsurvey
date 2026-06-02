"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/mobile/icons/icons";

type Props = {
  projectId: string;
};

type Stage = "form" | "sending" | "sent" | "error";

/**
 * Guest-only "Send Report" form. Title + body + optional photo + auto-
 * location (captured silently on mount; user can opt out by tapping the
 * location chip). On success shows a sent-state card; tapping again starts
 * a fresh report.
 */
export function GuestReportForm({ projectId }: Props) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [coords, setCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [locationOn, setLocationOn] = useState(true);
  const [stage, setStage] = useState<Stage>("form");
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!("geolocation" in navigator)) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => setCoords({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      () => setLocationOn(false),
      { enableHighAccuracy: true, timeout: 8_000 },
    );
  }, []);

  useEffect(() => {
    return () => {
      if (photoPreview) URL.revokeObjectURL(photoPreview);
    };
  }, [photoPreview]);

  function onPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhoto(f);
    setPhotoPreview(f ? URL.createObjectURL(f) : null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (title.trim().length === 0 || body.trim().length === 0) {
      setError("Title and body are required.");
      return;
    }
    setStage("sending");
    setError(null);
    const fd = new FormData();
    fd.append("title", title.trim());
    fd.append("body", body.trim());
    if (locationOn && coords) {
      fd.append("lat", String(coords.lat));
      fd.append("lon", String(coords.lon));
    }
    if (photo) fd.append("photo", photo);
    try {
      const res = await fetch("/api/reports/guest", {
        method: "POST",
        body: fd,
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (!res.ok || !json.ok) {
        setError(json.error ?? `Send failed (HTTP ${res.status})`);
        setStage("error");
        return;
      }
      setStage("sent");
    } catch (e) {
      setError((e as Error).message);
      setStage("error");
    }
  }

  if (stage === "sent") {
    return <SentCard onAnother={() => {
      setTitle("");
      setBody("");
      setPhoto(null);
      if (photoPreview) URL.revokeObjectURL(photoPreview);
      setPhotoPreview(null);
      setStage("form");
    }} />;
  }

  return (
    <form
      onSubmit={submit}
      style={{
        position: "absolute",
        inset: 0,
        background: "var(--m-bg)",
        display: "flex",
        flexDirection: "column",
        padding: "16px 14px",
        overflowY: "auto",
      }}
    >
      <h1 style={{ fontSize: 20, fontWeight: 800, marginBottom: 6 }}>
        Send a report
      </h1>
      <p style={{ fontSize: 13, color: "var(--m-ink-2)", lineHeight: 1.5, marginBottom: 18 }}>
        Tell the project admins what you saw. They&apos;ll get an in-app
        notification with your message and (if you allow it) your current
        location.
      </p>

      <Field
        label="Title"
        hint={`${title.length}/80`}
        input={
          <input
            type="text"
            required
            maxLength={80}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Brief description"
            style={inputStyle}
          />
        }
      />

      <Field
        label="Details"
        hint={`${body.length}/1000`}
        input={
          <textarea
            required
            maxLength={1000}
            rows={6}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="What happened, where, when, anything we should know"
            style={{ ...inputStyle, minHeight: 120, resize: "vertical" as const }}
          />
        }
      />

      <Field
        label="Photo (optional)"
        input={
          <div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={onPhoto}
              style={{ display: "none" }}
            />
            {photoPreview ? (
              <div
                style={{
                  position: "relative",
                  borderRadius: 12,
                  overflow: "hidden",
                  border: "1px solid var(--m-line)",
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={photoPreview}
                  alt="Selected attachment"
                  style={{ width: "100%", maxHeight: 200, objectFit: "cover", display: "block" }}
                />
                <button
                  type="button"
                  onClick={() => {
                    setPhoto(null);
                    if (photoPreview) URL.revokeObjectURL(photoPreview);
                    setPhotoPreview(null);
                    if (fileRef.current) fileRef.current.value = "";
                  }}
                  aria-label="Remove photo"
                  style={{
                    position: "absolute",
                    top: 8,
                    right: 8,
                    width: 32,
                    height: 32,
                    borderRadius: "50%",
                    background: "rgba(0,0,0,0.7)",
                    border: "none",
                    color: "#fff",
                    cursor: "pointer",
                  }}
                >
                  <Icon name="x" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "12px 14px",
                  background: "var(--m-card)",
                  border: "1px dashed var(--m-line-2)",
                  borderRadius: 10,
                  color: "var(--m-ink-2)",
                  fontSize: 13,
                  width: "100%",
                  textAlign: "left",
                  cursor: "pointer",
                }}
              >
                <Icon name="install" />
                Take or choose a photo
              </button>
            )}
          </div>
        }
      />

      <div style={{ marginBottom: 20 }}>
        <button
          type="button"
          onClick={() => setLocationOn((v) => !v)}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "8px 12px",
            borderRadius: 100,
            background: locationOn ? "var(--m-accent-dim)" : "var(--m-card)",
            color: locationOn ? "var(--m-accent)" : "var(--m-ink-2)",
            border: locationOn ? "1px solid var(--m-accent-bdr)" : "1px solid var(--m-line)",
            fontSize: 12,
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          <Icon name="locate" />
          {locationOn && coords
            ? `Location: ${coords.lat.toFixed(5)}, ${coords.lon.toFixed(5)}`
            : locationOn
              ? "Location: capturing…"
              : "Location off"}
        </button>
      </div>

      {error ? (
        <div
          role="alert"
          style={{
            marginBottom: 14,
            padding: "10px 12px",
            borderRadius: 10,
            background: "rgba(239,68,68,0.1)",
            color: "var(--m-danger)",
            fontSize: 12.5,
            border: "1px solid rgba(239,68,68,0.25)",
          }}
        >
          {error}
        </div>
      ) : null}

      <button
        type="submit"
        disabled={stage === "sending"}
        style={{
          width: "100%",
          padding: "14px 16px",
          borderRadius: 12,
          background: "var(--m-accent)",
          color: "var(--m-accent-on)",
          border: "none",
          fontSize: 15,
          fontWeight: 800,
          cursor: stage === "sending" ? "not-allowed" : "pointer",
          opacity: stage === "sending" ? 0.7 : 1,
          marginTop: 4,
        }}
      >
        {stage === "sending" ? "Sending…" : "Send report"}
      </button>
    </form>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "12px 14px",
  background: "var(--m-card)",
  border: "1px solid var(--m-line)",
  borderRadius: 10,
  color: "var(--m-ink)",
  fontSize: 14,
  outline: "none",
};

function Field({
  label,
  hint,
  input,
}: {
  label: string;
  hint?: string;
  input: React.ReactNode;
}) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          marginBottom: 6,
        }}
      >
        <label
          style={{
            fontSize: 11,
            fontWeight: 800,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--m-ink-2)",
          }}
        >
          {label}
        </label>
        {hint ? (
          <span style={{ fontSize: 11, color: "var(--m-ink-3)" }}>{hint}</span>
        ) : null}
      </div>
      {input}
    </div>
  );
}

function SentCard({ onAnother }: { onAnother: () => void }) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "grid",
        placeItems: "center",
        padding: 32,
        background: "var(--m-bg)",
        textAlign: "center",
      }}
    >
      <div style={{ maxWidth: 280 }}>
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: "50%",
            background: "var(--m-success)",
            color: "#fff",
            display: "grid",
            placeItems: "center",
            margin: "0 auto 16px",
            fontSize: 28,
            fontWeight: 800,
          }}
        >
          ✓
        </div>
        <h2 style={{ fontSize: 18, fontWeight: 800, marginBottom: 8 }}>
          Report sent
        </h2>
        <p style={{ fontSize: 13, color: "var(--m-ink-2)", lineHeight: 1.5, marginBottom: 20 }}>
          The project admins have been notified. They&apos;ll review and
          follow up if needed.
        </p>
        <button
          type="button"
          onClick={onAnother}
          style={{
            padding: "10px 18px",
            borderRadius: 10,
            background: "var(--m-card)",
            color: "var(--m-ink)",
            border: "1px solid var(--m-line)",
            fontSize: 13,
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          Send another report
        </button>
      </div>
    </div>
  );
}
