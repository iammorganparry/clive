import { useParams, useNavigate } from "react-router-dom";
import { useMemory, useDeleteMemory } from "@/api/hooks";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MetadataPanel } from "./MetadataPanel";
import { EditForm } from "./EditForm";
import { MEMORY_TYPE_COLORS, MEMORY_TYPE_LABELS } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { ArrowLeft, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from "@/components/ui/dialog";

export function DetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: memory, isLoading } = useMemory(id!);
  const deleteMutation = useDeleteMemory();

  if (isLoading) {
    return <p className="text-muted-foreground">Loading...</p>;
  }
  if (!memory) {
    return <p className="text-muted-foreground">Memory not found.</p>;
  }

  function handleDelete() {
    deleteMutation.mutate(memory!.id, {
      onSuccess: () => navigate("/memories"),
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
          <ArrowLeft className="size-4" />
          Back
        </Button>
        <Badge
          variant="outline"
          className={cn("text-xs", MEMORY_TYPE_COLORS[memory.memoryType])}
        >
          {MEMORY_TYPE_LABELS[memory.memoryType] ?? memory.memoryType}
        </Badge>
        <Badge variant={memory.tier === "long" ? "default" : "secondary"}>
          {memory.tier}
        </Badge>
        <div className="ml-auto">
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="destructive" size="sm">
                <Trash2 className="size-4" />
                Delete
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Delete memory</DialogTitle>
                <DialogDescription>
                  This will permanently delete this memory. This action cannot be
                  undone.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="outline">Cancel</Button>
                </DialogClose>
                <Button variant="destructive" onClick={handleDelete}>
                  Delete
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Content</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="whitespace-pre-wrap text-sm leading-relaxed">
            {memory.content}
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <EditForm memory={memory} />
        <MetadataPanel memory={memory} />
      </div>
    </div>
  );
}
