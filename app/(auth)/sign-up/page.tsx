"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "@/components/ui/card";
import { signUpAction } from "./actions";
import Link from "next/link";

export default function SignUpPage() {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display text-2xl">Create your account</CardTitle>
      </CardHeader>
      <form
        action={(fd) => startTransition(async () => {
          const res = await signUpAction(fd);
          if (res?.error) setError(res.error);
        })}
      >
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="displayName">Name</Label>
            <Input id="displayName" name="displayName" placeholder="Ada Lovelace" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" required autoComplete="email" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">Password</Label>
            <Input id="password" name="password" type="password" required minLength={8} autoComplete="new-password" />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </CardContent>
        <CardFooter className="flex flex-col gap-2">
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? "Creating..." : "Create account"}
          </Button>
          <p className="text-sm text-muted-foreground">
            Already have one? <Link href="/sign-in" className="underline">Sign in</Link>
          </p>
        </CardFooter>
      </form>
    </Card>
  );
}
