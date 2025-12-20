import type React from "react";
import { Loader2 } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../../../components/ui/card.js";

interface AgentStatusProps {
  status: string;
  isActive: boolean;
}

const AgentStatus: React.FC<AgentStatusProps> = ({ status, isActive }) => {
  if (!isActive || !status) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          Agent Activity
        </CardTitle>
      </CardHeader>
      <CardContent>
        <CardDescription className="text-sm">{status}</CardDescription>
      </CardContent>
    </Card>
  );
};

export default AgentStatus;
