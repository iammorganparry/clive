import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@clive/auth";
import { CallbackContent } from "./callback-content";

interface CallbackPageProps {
  searchParams: Promise<{ callback_url?: string }>;
}

async function getActiveOrganization(reqHeaders: Headers) {
  const session = await auth.api.getSession({ headers: reqHeaders });
  return session?.session?.activeOrganizationId ?? null;
}

export default async function CallbackPage({
  searchParams,
}: CallbackPageProps) {
  const { callback_url: callbackUrl } = await searchParams;
  const reqHeaders = await headers();

  // Get session server-side
  const session = await auth.api.getSession({ headers: reqHeaders });

  if (!session?.session) {
    redirect("/sign-in");
  }

  // Check for active organization - redirect to onboarding if none
  const activeOrgId = await getActiveOrganization(reqHeaders);
  if (!activeOrgId) {
    const onboardingUrl = callbackUrl
      ? `/onboarding?callback_url=${encodeURIComponent(callbackUrl)}`
      : "/onboarding";
    redirect(onboardingUrl);
  }

  // Generate token server-side
  let token: string | null = null;
  let error: string | null = null;

  try {
    const tokenResponse = await auth.api.getToken({ headers: reqHeaders });
    token = tokenResponse?.token ?? null;
  } catch (e) {
    error = e instanceof Error ? e.message : "Failed to generate token";
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <CallbackContent
        token={token}
        error={error}
        callbackUrl={callbackUrl ?? null}
      />
    </div>
  );
}
