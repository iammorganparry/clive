"use client";

import * as React from "react";
import { GalleryVerticalEnd } from "lucide-react";

import { cn } from "./lib/utils";
import { Button } from "./button";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
} from "./field";
import { Input } from "./input";
import { GitHubLogoIcon } from "@radix-ui/react-icons";

export interface LoginFormProps {
  className?: string;
  title?: string;
  signUpLink?: string;
  signUpText?: string;
  onSubmit?: (email: string, password?: string) => void | Promise<void>;
  onGitHubClick?: () => void | Promise<void>;
  isLoading?: boolean;
  error?: string | null;
  showPassword?: boolean;
  description?: string;
}

export function LoginForm({
  className,
  title = "Welcome to Acme Inc.",
  signUpLink,
  description,
  signUpText = "Don't have an account?",
  onSubmit,
  onGitHubClick,
  isLoading = false,
  error,
  showPassword = false,
}: LoginFormProps) {
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (onSubmit) {
      await onSubmit(email, showPassword ? password : undefined);
    }
  };

  return (
    <div className={cn("flex flex-col gap-6 max-w-sm", className)}>
      <form onSubmit={handleSubmit}>
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
          <Field>
            <FieldLabel htmlFor="email">Email</FieldLabel>
            <Input
              id="email"
              type="email"
              placeholder="m@example.com"
              value={email}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setEmail(e.target.value)
              }
              required
              disabled={isLoading}
            />
          </Field>
          {showPassword && (
            <Field>
              <FieldLabel htmlFor="password">Password</FieldLabel>
              <Input
                id="password"
                type="password"
                placeholder="Enter your password"
                value={password}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setPassword(e.target.value)
                }
                required
                disabled={isLoading}
              />
            </Field>
          )}
          <Field>
            <Button type="submit" disabled={isLoading} className="w-full">
              {isLoading ? "Loading..." : "Continue"}
            </Button>
          </Field>
          <FieldSeparator>Or</FieldSeparator>
          <Field className="grid gap-4 sm:grid-cols-2">
            {onGitHubClick && (
              <Button
                variant="outline"
                type="button"
                onClick={onGitHubClick}
                disabled={isLoading}
                className="w-full"
              >
                <GitHubLogoIcon className="size-4" />
                Continue with GitHub
              </Button>
            )}
          </Field>
        </FieldGroup>
      </form>
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
