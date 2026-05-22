"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "@/components/ui/card";
import { signInAction, magicLinkAction } from "./actions";

export default function SignInPage() {
  const [error, setError] = useState<string | null>(null);
  const [magicSent, setMagicSent] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display text-2xl">Sign in</CardTitle>
      </CardHeader>
      <form
        action={(fd) => startTransition(async () => {
          const r = await signInAction(fd);
          if (r?.error) setError(r.error);
        })}
      >
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" required autoComplete="email" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">Password</Label>
            <Input id="password" name="password" type="password" required autoComplete="current-password" />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          {magicSent && <p className="text-sm text-emerald-400">Magic link sent. Check your inbox.</p>}
        </CardContent>
        <CardFooter className="flex flex-col gap-2">
          <Button type="submit" className="w-full" disabled={pending}>{pending ? "Signing in..." : "Sign in"}</Button>
          <Button
            type="button"
            variant="outline"
            className="w-full"
            disabled={pending}
            onClick={(e) => {
              const form = e.currentTarget.closest("form")!;
              const fd = new FormData(form);
              startTransition(async () => {
                const r = await magicLinkAction(fd);
                if (r?.error) setError(r.error);
                if (r?.ok) setMagicSent(true);
              });
            }}
          >
            Send magic link instead
          </Button>
          <div className="flex w-full justify-between text-sm text-muted-foreground">
            <Link href="/sign-up" className="underline">Create an account</Link>
            <Link href="/reset-password" className="underline">Forgot password?</Link>
          </div>
        </CardFooter>
      </form>
    </Card>
  );
}
