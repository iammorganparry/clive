import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@clive/auth";
import { DeviceApprovalContent } from "./device-approval-content";

interface DeviceApprovePageProps {
  searchParams: Promise<{ user_code?: string }>;
}

export default async function DeviceApprovePage({
  searchParams,
}: DeviceApprovePageProps) {
  const { user_code: userCode } = await searchParams;
  const reqHeaders = await headers();

  if (!userCode) {
    redirect("/device");
  }

  // Check if user is authenticated
  const session = await auth.api.getSession({ headers: reqHeaders });

  if (!session?.user) {
    // Redirect to sign-in with return URL
    const returnUrl = `/device/approve?user_code=${userCode}`;
    redirect(`/sign-in?callbackUrl=${encodeURIComponent(returnUrl)}`);
  }

  return (
    <DeviceApprovalContent
      userCode={userCode}
      user={{
        name: session.user.name,
        email: session.user.email,
        image: session.user.image,
      }}
    />
  );
}
