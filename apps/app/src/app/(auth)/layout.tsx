import { GalleryVerticalEnd } from "lucide-react";

export default function AuthLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-[#2e026d] to-[#15162c] p-6">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center gap-2 text-center">
          <div className="flex size-12 items-center justify-center rounded-lg bg-white/10">
            <GalleryVerticalEnd className="size-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white">Clive</h1>
          <p className="text-sm text-white/70">Your AI E2E Test Writer</p>
        </div>
        {children}
      </div>
    </div>
  );
}
