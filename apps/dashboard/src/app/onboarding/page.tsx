"use client";

import { Button } from "@clive/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@clive/ui/card";
import { Field, FieldGroup, FieldLabel } from "@clive/ui/field";
import { Input } from "@clive/ui/input";
import { useMachine } from "@xstate/react";
import { AlertCircle, Building2, Loader2, LogOut, Users } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { onboardingMachine } from "./onboarding-machine";

export default function OnboardingPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callback_url");

  const [state, send] = useMachine(onboardingMachine, {
    input: { callbackUrl },
  });

  // Handle redirects when machine reaches final states
  useEffect(() => {
    if (state.matches("redirectingToSignIn")) {
      router.push("/sign-in");
    } else if (state.matches("redirecting")) {
      const url = state.context.callbackUrl
        ? `/callback?callback_url=${encodeURIComponent(state.context.callbackUrl)}`
        : "/";
      router.push(url);
    }
  }, [state, router]);

  const { orgName, orgSlug, inviteCode, error } = state.context;

  const isCheckingSession = state.matches("checkingSession");
  const isError = state.matches("error");
  const isChoice = state.matches("choice");
  const isCreateForm = state.matches("createForm");
  const isCreatingOrg = state.matches("creatingOrg");
  const isJoinForm = state.matches("joinForm");
  const isJoiningOrg = state.matches("joiningOrg");
  const isSettingActiveOrg = state.matches("settingActiveOrg");
  const isSigningOut = state.matches("signingOut");

  const isLoading =
    isCreatingOrg || isJoiningOrg || isSettingActiveOrg || isSigningOut;
  const showCreateForm = isCreateForm || isCreatingOrg || isSettingActiveOrg;
  const showJoinForm = isJoinForm || isJoiningOrg;
  const isCreateSubmitting = isCreatingOrg || isSettingActiveOrg;

  // Loading state - checking session
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

  // Error state - failed to activate org
  if (isError) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center p-6">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-destructive/10">
              <AlertCircle className="size-6 text-destructive" />
            </div>
            <CardTitle>Something went wrong</CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => send({ type: "RETRY" })} className="w-full">
              Try Again
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Choice state - select create or join
  if (isChoice) {
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
            {error && (
              <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                {error}
              </div>
            )}

            <Button
              variant="outline"
              className="w-full h-24 flex flex-col items-center justify-center gap-2"
              onClick={() => send({ type: "SELECT_CREATE" })}
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
              onClick={() => send({ type: "SELECT_JOIN" })}
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
                onClick={() => send({ type: "LOGOUT" })}
                disabled={isLoading}
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

  // Create form state
  if (showCreateForm) {
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
            <form
              onSubmit={(e) => {
                e.preventDefault();
                send({ type: "SUBMIT_CREATE" });
              }}
            >
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
                    onChange={(e) =>
                      send({ type: "UPDATE_ORG_NAME", name: e.target.value })
                    }
                    required
                    disabled={isCreateSubmitting}
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
                      onChange={(e) =>
                        send({ type: "UPDATE_ORG_SLUG", slug: e.target.value })
                      }
                      required
                      disabled={isCreateSubmitting}
                      className="flex-1"
                    />
                  </div>
                </Field>
                <Field className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => send({ type: "BACK" })}
                    disabled={isCreateSubmitting}
                  >
                    Back
                  </Button>
                  <Button
                    type="submit"
                    disabled={isCreateSubmitting}
                    className="flex-1"
                  >
                    {isCreateSubmitting ? (
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

  // Join form state
  if (showJoinForm) {
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
            <form
              onSubmit={(e) => {
                e.preventDefault();
                send({ type: "SUBMIT_JOIN" });
              }}
            >
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
                    onChange={(e) =>
                      send({ type: "UPDATE_INVITE_CODE", code: e.target.value })
                    }
                    required
                    disabled={isJoiningOrg}
                  />
                </Field>
                <Field className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => send({ type: "BACK" })}
                    disabled={isJoiningOrg}
                  >
                    Back
                  </Button>
                  <Button
                    type="submit"
                    disabled={isJoiningOrg}
                    className="flex-1"
                  >
                    {isJoiningOrg ? (
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

  // Fallback loading state for any other states (redirecting, etc.)
  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardContent className="flex flex-col items-center justify-center py-16">
          <Loader2 className="size-8 animate-spin text-primary" />
          <p className="mt-4 text-sm text-muted-foreground">Please wait...</p>
        </CardContent>
      </Card>
    </div>
  );
}
