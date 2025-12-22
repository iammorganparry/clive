import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@clive/auth";
import { CallbackContent, type UserInfo } from "./callback-content";

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

  // Use session token for Bearer auth (not JWT from getToken)
  // The bearer() plugin in better-auth validates session tokens, not JWTs
  const token: string | null = session.session.token;

  // Extract user info from session for extension UI
  const userInfo: UserInfo | null = {
    userId: session.user.id,
    email: session.user.email,
    name: session.user.name,
    image: session.user.image ?? undefined,
    organizationId: session.session.activeOrganizationId ?? undefined,
  };

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <CallbackContent
        token={token}
        userInfo={userInfo}
        error={null}
        callbackUrl={callbackUrl ?? null}
      />
    </div>
  );
}
