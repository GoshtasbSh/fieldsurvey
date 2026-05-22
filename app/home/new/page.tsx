"use client";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "@/components/ui/card";
import { createProjectAction } from "./actions";

export default function NewProjectPage() {
  const [err, setErr] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [search, setSearch] = useState("");
  const [coords, setCoords] = useState<{ lat: number; lon: number; label: string } | null>(null);

  async function doGeocode() {
    const r = await fetch(`/api/geocode?q=${encodeURIComponent(search)}`);
    const j = await r.json();
    if (j?.lat) setCoords({ lat: j.lat, lon: j.lon, label: j.displayName });
    else setErr("Address not found. Try a more specific search.");
  }

  return (
    <main className="mx-auto max-w-lg p-8">
      <Card>
        <CardHeader><CardTitle className="font-display text-2xl">New project</CardTitle></CardHeader>
        <form
          action={(fd) => {
            if (coords) {
              fd.set("centerLat", String(coords.lat));
              fd.set("centerLon", String(coords.lon));
            }
            startTransition(async () => {
              const r = await createProjectAction(fd);
              if (r?.error) setErr(r.error);
            });
          }}
        >
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="name">Project name</Label>
              <Input id="name" name="name" required maxLength={80} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="description">Description (optional)</Label>
              <Input id="description" name="description" maxLength={1000} />
            </div>
            <div className="space-y-1.5">
              <Label>Map center</Label>
              <div className="flex gap-2">
                <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="e.g. Gainesville, FL" />
                <Button type="button" variant="outline" onClick={doGeocode}>Find</Button>
              </div>
              {coords && (
                <p className="text-xs text-muted-foreground">
                  {coords.label} ({coords.lat.toFixed(4)}, {coords.lon.toFixed(4)})
                </p>
              )}
            </div>
            {err && <p className="text-sm text-destructive">{err}</p>}
          </CardContent>
          <CardFooter>
            <Button type="submit" className="w-full" disabled={pending || !coords}>
              {pending ? "Creating..." : "Create project"}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </main>
  );
}
