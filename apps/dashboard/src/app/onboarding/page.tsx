"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { authClient } from "@clive/auth/client";
import { Button } from "@clive/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@clive/ui/card";
import { Input } from "@clive/ui/input";
import { Field, FieldGroup, FieldLabel } from "@clive/ui/field";
import { Building2, Users, Loader2, LogOut } from "lucide-react";

type OnboardingMode = "choice" | "create" | "join";

export default function OnboardingPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callback_url");

  // Check session - redirect to sign-in if not logged in
  const { isLoading: isCheckingSession } = useQuery({
    queryKey: ["session-check"],
    queryFn: async () => {
      const { data } = await authClient.getSession();
      if (!data?.session) {
        router.push("/sign-in");
        return null;
      }
      return data.session;
    },
    retry: false,
    refetchOnWindowFocus: false,
  });

  const [mode, setMode] = useState<OnboardingMode>("choice");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Create org form state
  const [orgName, setOrgName] = useState("");
  const [orgSlug, setOrgSlug] = useState("");

  // Join org form state
  const [inviteCode, setInviteCode] = useState("");

  const handleLogout = async () => {
    await authClient.signOut();
    router.push("/sign-in");
  };

  const generateSlug = (name: string) => {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  };

  const handleNameChange = (name: string) => {
    setOrgName(name);
    if (!orgSlug || orgSlug === generateSlug(orgName)) {
      setOrgSlug(generateSlug(name));
    }
  };

  const handleCreateOrg = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgName.trim() || !orgSlug.trim()) {
      setError("Please fill in all required fields");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const result = await authClient.organization.create({
        name: orgName.trim(),
        slug: orgSlug.trim(),
      });

      if (result.error) {
        setError(result.error.message || "Failed to create organization");
        setIsLoading(false);
        return;
      }

      // Set the new organization as active
      const setActiveResult = await authClient.organization.setActive({
        organizationId: result.data?.id,
      });

      if (setActiveResult.error) {
        setError(
          setActiveResult.error.message ||
            "Team created but failed to activate. Please try again.",
        );
        setIsLoading(false);
        return;
      }

      // Redirect to callback or home
      if (callbackUrl) {
        router.push(
          `/callback?callback_url=${encodeURIComponent(callbackUrl)}`,
        );
      } else {
        router.push("/");
      }
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to create organization";
      setError(errorMessage);
      setIsLoading(false);
    }
  };

  const handleJoinOrg = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteCode.trim()) {
      setError("Please enter an invite code");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const result = await authClient.organization.acceptInvitation({
        invitationId: inviteCode.trim(),
      });

      if (result.error) {
        setError(result.error.message || "Failed to join organization");
        setIsLoading(false);
        return;
      }

      // Set the joined organization as active
      if (result.data?.member?.organizationId) {
        const setActiveResult = await authClient.organization.setActive({
          organizationId: result.data.member.organizationId,
        });

        if (setActiveResult.error) {
          setError(
            setActiveResult.error.message ||
              "Joined team but failed to activate. Please try again.",
          );
          setIsLoading(false);
          return;
        }
      }

      // Redirect to callback or home
      if (callbackUrl) {
        router.push(
          `/callback?callback_url=${encodeURIComponent(callbackUrl)}`,
        );
      } else {
        router.push("/");
      }
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to join organization";
      setError(errorMessage);
      setIsLoading(false);
    }
  };

  // Show loading while checking session
  if (isCheckingSession) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center p-6">
        <Card className="w-full max-w-md">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Loader2 className="size-8 animate-spin text-primary" />
            <p className="mt-4 text-sm text-muted-foreground">Loading...</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (mode === "choice") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center p-6">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <CardTitle className="text-2xl">Welcome to Clive</CardTitle>
            <CardDescription>
              Create or join a team to start collaborating on your codebase
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button
              variant="outline"
              className="w-full h-24 flex flex-col items-center justify-center gap-2"
              onClick={() => setMode("create")}
            >
              <Building2 className="size-8" />
              <div className="text-center">
                <div className="font-semibold">Create a Team</div>
                <div className="text-xs text-muted-foreground">
                  Start a new team for your organization
                </div>
              </div>
            </Button>

            <Button
              variant="outline"
              className="w-full h-24 flex flex-col items-center justify-center gap-2"
              onClick={() => setMode("join")}
            >
              <Users className="size-8" />
              <div className="text-center">
                <div className="font-semibold">Join a Team</div>
                <div className="text-xs text-muted-foreground">
                  Join an existing team with an invite
                </div>
              </div>
            </Button>

            <div className="pt-4 border-t">
              <Button
                variant="ghost"
                className="w-full text-muted-foreground"
                onClick={handleLogout}
              >
                <LogOut className="mr-2 size-4" />
                Sign out and use a different account
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (mode === "create") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center p-6">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <CardTitle>Create Your Team</CardTitle>
            <CardDescription>
              Set up a team to share indexed codebases with your colleagues
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreateOrg}>
              <FieldGroup>
                {error && (
                  <Field>
                    <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                      {error}
                    </div>
                  </Field>
                )}
                <Field>
                  <FieldLabel htmlFor="orgName">Team Name</FieldLabel>
                  <Input
                    id="orgName"
                    type="text"
                    placeholder="Acme Inc."
                    value={orgName}
                    onChange={(e) => handleNameChange(e.target.value)}
                    required
                    disabled={isLoading}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="orgSlug">Team URL</FieldLabel>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">
                      clive.dev/
                    </span>
                    <Input
                      id="orgSlug"
                      type="text"
                      placeholder="acme-inc"
                      value={orgSlug}
                      onChange={(e) => setOrgSlug(e.target.value)}
                      required
                      disabled={isLoading}
                      className="flex-1"
                    />
                  </div>
                </Field>
                <Field className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setMode("choice");
                      setError(null);
                    }}
                    disabled={isLoading}
                  >
                    Back
                  </Button>
                  <Button type="submit" disabled={isLoading} className="flex-1">
                    {isLoading ? (
                      <>
                        <Loader2 className="mr-2 size-4 animate-spin" />
                        Creating...
                      </>
                    ) : (
                      "Create Team"
                    )}
                  </Button>
                </Field>
              </FieldGroup>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  // mode === "join"
  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle>Join a Team</CardTitle>
          <CardDescription>
            Enter the invite code you received from your team admin
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleJoinOrg}>
            <FieldGroup>
              {error && (
                <Field>
                  <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                    {error}
                  </div>
                </Field>
              )}
              <Field>
                <FieldLabel htmlFor="inviteCode">Invite Code</FieldLabel>
                <Input
                  id="inviteCode"
                  type="text"
                  placeholder="Enter your invite code"
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value)}
                  required
                  disabled={isLoading}
                />
              </Field>
              <Field className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setMode("choice");
                    setError(null);
                  }}
                  disabled={isLoading}
                >
                  Back
                </Button>
                <Button type="submit" disabled={isLoading} className="flex-1">
                  {isLoading ? (
                    <>
                      <Loader2 className="mr-2 size-4 animate-spin" />
                      Joining...
                    </>
                  ) : (
                    "Join Team"
                  )}
                </Button>
              </Field>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
