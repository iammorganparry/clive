import { useNavigate } from "react-router-dom";
import type { Memory } from "@/api/types";
import { useDeleteMemory, useUpdateMemory } from "@/api/hooks";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoreHorizontal, Eye, ArrowUp, Trash2 } from "lucide-react";

interface MemoryActionsProps {
  memory: Memory;
}

export function MemoryActions({ memory }: MemoryActionsProps) {
  const navigate = useNavigate();
  const deleteMutation = useDeleteMemory();
  const updateMutation = useUpdateMemory();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={(e) => e.stopPropagation()}
        >
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuItem onClick={() => navigate(`/memories/${memory.id}`)}>
          <Eye className="size-4" />
          View details
        </DropdownMenuItem>
        {memory.tier === "short" && (
          <DropdownMenuItem
            onClick={() =>
              updateMutation.mutate({ id: memory.id, tier: "long" })
            }
          >
            <ArrowUp className="size-4" />
            Promote to long-term
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          onClick={() => deleteMutation.mutate(memory.id)}
        >
          <Trash2 className="size-4" />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
