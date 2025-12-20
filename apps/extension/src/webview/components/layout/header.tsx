import type React from "react";
import { ArrowLeft, LogOut, Settings } from "lucide-react";
import { Button } from "../../../components/ui/button.js";
import { UserDropdown } from "../user-dropdown.js";
import { useRouter, Routes } from "../../router/index.js";
import { useAuth } from "../../contexts/auth-context.js";

export const Header: React.FC = () => {
  const { logout } = useAuth();
  const { route, navigate, goBack } = useRouter();

  return (
    <div className="flex items-center w-full justify-between border-b border-border px-4 py-2">
      <div className="flex items-center gap-2">
        {route !== Routes.dashboard && (
          <Button
            variant="ghost"
            size="icon"
            onClick={goBack}
            title="Back"
            className="h-8 w-8"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
        )}
        <UserDropdown />
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant={route === Routes.settings ? "default" : "ghost"}
          size="icon"
          onClick={() => navigate(Routes.settings)}
          title="Settings"
          className="h-8 w-8"
        >
          <Settings className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={logout}
          title="Logout"
          className="h-8 w-8"
        >
          <LogOut className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
};
