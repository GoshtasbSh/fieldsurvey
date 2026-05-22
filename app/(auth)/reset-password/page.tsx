"use client";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "@/components/ui/card";
import { resetPasswordAction } from "./actions";

export default function ResetPasswordPage() {
  const [msg, setMsg] = useState<{ ok?: boolean; error?: string }>({});
  const [pending, startTransition] = useTransition();

  return (
    <Card>
      <CardHeader><CardTitle className="font-display text-2xl">Reset password</CardTitle></CardHeader>
      <form action={(fd) => startTransition(async () => setMsg(await resetPasswordAction(fd)))}>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" required />
          </div>
          {msg.error && <p className="text-sm text-destructive">{msg.error}</p>}
          {msg.ok && <p className="text-sm text-emerald-400">Check your inbox for a reset link.</p>}
        </CardContent>
        <CardFooter>
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? "Sending..." : "Send reset link"}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
