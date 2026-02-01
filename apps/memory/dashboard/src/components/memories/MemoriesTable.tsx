import { useNavigate } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import type { Memory, Pagination, ListParams } from "@/api/types";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MemoryActions } from "./MemoryActions";
import { MEMORY_TYPE_COLORS, MEMORY_TYPE_LABELS } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { ArrowUpDown, ChevronLeft, ChevronRight, FileCode } from "lucide-react";

interface MemoriesTableProps {
  memories: Memory[];
  pagination: Pagination | undefined;
  isLoading: boolean;
  params: ListParams;
  onParamsChange: (updates: Partial<ListParams>) => void;
}

const columnHelper = createColumnHelper<Memory>();

export function MemoriesTable({
  memories,
  pagination,
  isLoading,
  params,
  onParamsChange,
}: MemoriesTableProps) {
  const navigate = useNavigate();

  function toggleSort(col: string) {
    if (params.sort === col) {
      onParamsChange({ order: params.order === "asc" ? "desc" : "asc" });
    } else {
      onParamsChange({ sort: col, order: "desc" });
    }
  }

  const columns = [
    columnHelper.accessor("memoryType", {
      header: "Type",
      cell: (info) => (
        <Badge
          variant="outline"
          className={cn("text-[10px]", MEMORY_TYPE_COLORS[info.getValue()])}
        >
          {MEMORY_TYPE_LABELS[info.getValue()] ?? info.getValue()}
        </Badge>
      ),
    }),
    columnHelper.accessor("content", {
      header: "Content",
      cell: (info) => (
        <span className="block max-w-md truncate text-sm">
          {info.getValue()}
        </span>
      ),
    }),
    columnHelper.accessor("tier", {
      header: "Tier",
      cell: (info) => (
        <Badge variant={info.getValue() === "long" ? "default" : "secondary"}>
          {info.getValue()}
        </Badge>
      ),
    }),
    columnHelper.accessor("confidence", {
      header: "Confidence",
      cell: (info) => (
        <span className="text-sm tabular-nums">
          {(info.getValue() * 100).toFixed(0)}%
        </span>
      ),
    }),
    columnHelper.accessor("accessCount", {
      header: "Hits",
      cell: (info) => (
        <span className="text-sm tabular-nums">{info.getValue()}</span>
      ),
    }),
    columnHelper.display({
      id: "files",
      header: "Files",
      cell: (info) => {
        const files = info.row.original.relatedFiles;
        if (!files?.length) {
          return <span className="text-muted-foreground">&mdash;</span>;
        }
        return (
          <div className="flex flex-wrap gap-1">
            {files.slice(0, 3).map((f) => (
              <Badge
                key={f}
                variant="secondary"
                className="gap-1 text-[10px] font-normal"
                title={f}
              >
                <FileCode className="size-3" />
                {f.split("/").pop()}
              </Badge>
            ))}
            {files.length > 3 && (
              <span className="text-xs text-muted-foreground">
                +{files.length - 3}
              </span>
            )}
          </div>
        );
      },
    }),
    columnHelper.accessor("createdAt", {
      header: "Created",
      cell: (info) => (
        <span className="text-xs text-muted-foreground">
          {formatDistanceToNow(info.getValue() * 1000, { addSuffix: true })}
        </span>
      ),
    }),
    columnHelper.display({
      id: "actions",
      cell: (info) => <MemoryActions memory={info.row.original} />,
    }),
  ];

  const table = useReactTable({
    data: memories,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <div className="space-y-4">
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => {
                const sortable = ["created_at", "updated_at", "confidence", "access_count"];
                const colId =
                  header.column.id === "createdAt"
                    ? "created_at"
                    : header.column.id === "accessCount"
                      ? "access_count"
                      : header.column.id;
                const isSortable = sortable.includes(colId);

                return (
                  <TableHead key={header.id}>
                    {isSortable ? (
                      <button
                        className="flex items-center gap-1"
                        onClick={() => toggleSort(colId)}
                      >
                        {flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                        <ArrowUpDown className="size-3" />
                      </button>
                    ) : (
                      flexRender(
                        header.column.columnDef.header,
                        header.getContext(),
                      )
                    )}
                  </TableHead>
                );
              })}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <TableRow>
              <TableCell colSpan={columns.length} className="text-center py-8 text-muted-foreground">
                Loading...
              </TableCell>
            </TableRow>
          ) : memories.length === 0 ? (
            <TableRow>
              <TableCell colSpan={columns.length} className="text-center py-8 text-muted-foreground">
                No memories found.
              </TableCell>
            </TableRow>
          ) : (
            table.getRowModel().rows.map((row) => (
              <TableRow
                key={row.id}
                className="cursor-pointer"
                onClick={() => navigate(`/memories/${row.original.id}`)}
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      {pagination && pagination.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Page {pagination.page} of {pagination.totalPages} ({pagination.total} total)
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={pagination.page <= 1}
              onClick={() => onParamsChange({ page: pagination.page - 1 })}
            >
              <ChevronLeft className="size-4" />
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={pagination.page >= pagination.totalPages}
              onClick={() => onParamsChange({ page: pagination.page + 1 })}
            >
              Next
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
