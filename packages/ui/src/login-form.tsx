"use client";

import { GalleryVerticalEnd } from "lucide-react";

import { cn } from "./lib/utils";
import { Button } from "./button";
import { Field, FieldDescription, FieldGroup } from "./field";
import { GitHubLogoIcon } from "@radix-ui/react-icons";

export interface LoginFormProps {
  className?: string;
  title?: string;
  description?: string;
  signUpLink?: string;
  signUpText?: string;
  onSubmit?: (email: string) => void | Promise<void>;
  onGitHubClick?: () => void | Promise<void>;
  isLoading?: boolean;
  error?: string | null;
}

export function LoginForm({
  className,
  title = "Clive",
  description = "Build with confidence",
  onGitHubClick,
  isLoading = false,
  error,
}: LoginFormProps) {
  return (
    <div className={cn("flex flex-col gap-6 max-w-sm", className)}>
      <FieldGroup>
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="flex flex-col items-center gap-2 font-medium">
            <div className="flex size-8 items-center justify-center rounded-md">
              <GalleryVerticalEnd className="size-6" />
            </div>
          </div>
          <h1 className="text-xl font-bold">{title}</h1>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        {error && (
          <Field>
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          </Field>
        )}
        <Field className="grid gap-3 w-full">
          {onGitHubClick && (
            <Button
              variant="outline"
              type="button"
              onClick={onGitHubClick}
              disabled={isLoading}
              className="w-full"
            >
              <GitHubLogoIcon className="size-4" />
              {isLoading ? "Connecting..." : "Continue with GitHub"}
            </Button>
          )}
        </Field>
      </FieldGroup>
      <FieldDescription className="px-6 text-center">
        By clicking continue, you agree to our{" "}
        <a href="/terms" className="underline">
          Terms of Service
        </a>{" "}
        and{" "}
        <a href="/privacy" className="underline">
          Privacy Policy
        </a>
        .
      </FieldDescription>
    </div>
  );
}
