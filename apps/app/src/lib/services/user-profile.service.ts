import type { SupabaseClient } from "@supabase/supabase-js";
import type { ServiceResult } from "./types";

export interface UserProfile {
  display_name: string | null;
  timezone: string;
}

export interface UpdateProfileParams {
  display_name: string;
  timezone: string;
}

export async function getProfile(
  supabase: SupabaseClient,
  userId: string
): Promise<ServiceResult<UserProfile | null>> {
  const { data, error } = await supabase
    .from("user_profiles")
    .select("display_name, timezone")
    .eq("id", userId)
    .single();

  if (error) {
    return {
      success: false,
      error: { code: "QUERY_FAILED", message: "Failed to get profile", details: error.message },
    };
  }

  return { success: true, data };
}

export async function updateProfile(
  supabase: SupabaseClient,
  userId: string,
  params: UpdateProfileParams
): Promise<ServiceResult<void>> {
  const { error } = await supabase
    .from("user_profiles")
    .update({ display_name: params.display_name, timezone: params.timezone })
    .eq("id", userId);

  if (error) {
    return {
      success: false,
      error: { code: "UPDATE_FAILED", message: "Failed to update profile", details: error.message },
    };
  }

  return { success: true, data: undefined };
}
