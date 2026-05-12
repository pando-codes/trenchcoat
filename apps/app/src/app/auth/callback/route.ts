import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const callbackUrl = searchParams.get("callbackUrl") || "/";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      return NextResponse.redirect(new URL(callbackUrl, origin));
    }
  }

  // If code exchange fails or no code is present, redirect to login with an error indicator
  return NextResponse.redirect(new URL("/login?error=auth", origin));
}
