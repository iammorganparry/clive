import { REGEXP_ONLY_CHARS } from "input-otp";
import { AlertCircle, Laptop2 } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { Button } from "../../button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../card";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSeparator,
  InputOTPSlot,
} from "../../input-otp";

export interface DeviceCodeEntryProps {
  onSubmit: (code: string) => void | Promise<void>;
  isLoading?: boolean;
  error?: string | null;
  initialCode?: string;
  autoSubmit?: boolean;
  title?: string;
  description?: string;
  className?: string;
}

/**
 * Card component for entering device authorization codes with OTP input.
 */
export function DeviceCodeEntry({
  onSubmit,
  isLoading = false,
  error,
  initialCode = "",
  autoSubmit = true,
  title = "Connect Your Device",
  description = "Enter the code shown in your VS Code extension to connect it to your account.",
  className,
}: DeviceCodeEntryProps) {
  const [userCode, setUserCode] = useState(initialCode.toUpperCase());

  // Auto-submit when code is complete (8 characters)
  useEffect(() => {
    if (autoSubmit && userCode.length === 8) {
      onSubmit(userCode);
    }
  }, [userCode, autoSubmit, onSubmit]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (userCode.length >= 4) {
      await onSubmit(userCode);
    }
  };

  return (
    <Card
      className={`w-full max-w-md border-0 bg-card/50 backdrop-blur ${className ?? ""}`}
    >
      <CardHeader className="text-center">
        <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-primary/10">
          <Laptop2 className="size-6 text-primary" />
        </div>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>

      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="flex flex-col items-center space-y-4">
            <InputOTP
              maxLength={8}
              value={userCode}
              onChange={(value: string) => setUserCode(value.toUpperCase())}
              pattern={REGEXP_ONLY_CHARS}
              autoFocus
            >
              <InputOTPGroup>
                <InputOTPSlot index={0} />
                <InputOTPSlot index={1} />
                <InputOTPSlot index={2} />
                <InputOTPSlot index={3} />
              </InputOTPGroup>
              <InputOTPSeparator />
              <InputOTPGroup>
                <InputOTPSlot index={4} />
                <InputOTPSlot index={5} />
                <InputOTPSlot index={6} />
                <InputOTPSlot index={7} />
              </InputOTPGroup>
            </InputOTP>

            {error && (
              <div className="flex items-center gap-2 text-sm text-destructive">
                <AlertCircle className="size-4" />
                {error}
              </div>
            )}
          </div>

          <Button
            type="submit"
            className="w-full"
            disabled={isLoading || userCode.length < 4}
          >
            {isLoading ? "Verifying..." : "Continue"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
