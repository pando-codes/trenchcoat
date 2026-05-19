import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ProfileForm } from "@/components/settings/profile-form";
import {
  getProfile,
  updateProfile as updateProfileService,
} from "@/lib/services/user-profile.service";

async function updateProfile(formData: FormData) {
  "use server";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const displayName = formData.get("display_name") as string;
  const timezone = formData.get("timezone") as string;

  await updateProfileService(supabase, user.id, { display_name: displayName, timezone });

  redirect("/settings");
}

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const profileResult = await getProfile(supabase, user.id);
  const profile = profileResult.success ? profileResult.data : null;

  const displayName = profile?.display_name ?? user.user_metadata?.display_name ?? "";
  const timezone = profile?.timezone ?? "UTC";

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Manage your profile and preferences.
        </p>
      </div>

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>
            Update your display name and timezone.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ProfileForm
            displayName={displayName}
            timezone={timezone}
            action={updateProfile}
          />
        </CardContent>
      </Card>
    </div>
  );
}
