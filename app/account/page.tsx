import { createServerSupabase } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import {
  updateProfileAction,
  updatePasswordAction,
  deleteAccountAction,
  signOutAction,
} from "./actions";

type ProfileRow = { email: string; display_name: string | null } | null;

export default async function AccountPage() {
  const sb = await createServerSupabase();
  const {
    data: { user },
  } = await sb.auth.getUser();

  const { data: profileRaw } = await sb
    .from("profiles")
    .select("email,display_name")
    .eq("id", user!.id)
    .returns<ProfileRow[]>()
    .single();
  const profile = profileRaw as ProfileRow;

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-6">
      <h1 className="font-display text-2xl font-bold">Account</h1>

      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
        </CardHeader>
        <form
          action={async (fd) => {
            "use server";
            await updateProfileAction(fd);
          }}
        >
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input value={profile?.email ?? ""} disabled readOnly />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="displayName">Name</Label>
              <Input
                id="displayName"
                name="displayName"
                defaultValue={profile?.display_name ?? ""}
                maxLength={80}
              />
            </div>
          </CardContent>
          <CardFooter>
            <Button type="submit">Save</Button>
          </CardFooter>
        </form>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Password</CardTitle>
        </CardHeader>
        <form
          action={async (fd) => {
            "use server";
            await updatePasswordAction(fd);
          }}
        >
          <CardContent>
            <div className="space-y-1.5">
              <Label htmlFor="password">New password</Label>
              <Input
                id="password"
                name="password"
                type="password"
                minLength={8}
                required
              />
            </div>
          </CardContent>
          <CardFooter>
            <Button type="submit">Change password</Button>
          </CardFooter>
        </form>
      </Card>

      <Card className="border-destructive/50">
        <CardHeader>
          <CardTitle className="text-destructive">Danger zone</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            Deleting your account will remove your profile and all projects you own. Projects
            where you are a member will remain (your role is removed).
          </p>
        </CardContent>
        <CardFooter className="flex gap-2">
          <form
            action={async () => {
              "use server";
              await signOutAction();
            }}
          >
            <Button type="submit" variant="outline">
              Sign out
            </Button>
          </form>
          <form
            action={async () => {
              "use server";
              await deleteAccountAction();
            }}
          >
            <Button type="submit" variant="destructive">
              Delete account
            </Button>
          </form>
        </CardFooter>
      </Card>
    </main>
  );
}
