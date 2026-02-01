"use client";

import Link from "next/link";
import { useState } from "react";
import { api } from "~/trpc/react";

const MEMORY_TYPES = [
	"GOTCHA",
	"WORKING_SOLUTION",
	"DECISION",
	"PATTERN",
	"FAILURE",
	"PREFERENCE",
	"CONTEXT",
	"SKILL_HINT",
] as const;

const TYPE_COLORS: Record<string, string> = {
	GOTCHA: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
	WORKING_SOLUTION: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
	DECISION: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
	PATTERN: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
	FAILURE: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
	PREFERENCE: "bg-pink-100 text-pink-800 dark:bg-pink-900 dark:text-pink-200",
	CONTEXT: "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200",
	SKILL_HINT: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-200",
};

function relativeTime(unix: number): string {
	const diff = Date.now() / 1000 - unix;
	if (diff < 60) return "just now";
	if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
	if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
	return `${Math.floor(diff / 86400)}d ago`;
}

function truncate(s: string, max: number): string {
	return s.length <= max ? s : s.slice(0, max) + "\u2026";
}

export default function MemoriesPage() {
	const [page, setPage] = useState(1);
	const [sort, setSort] = useState("created_at");
	const [order, setOrder] = useState<"asc" | "desc">("desc");
	const [workspaceId, setWorkspaceId] = useState("");
	const [memoryType, setMemoryType] = useState("");
	const [tier, setTier] = useState("");
	const [tab, setTab] = useState<"all" | "leaders">("all");

	const listQuery = api.memory.list.useQuery({
		page,
		limit: 25,
		sort,
		order,
		workspaceId: workspaceId || undefined,
		memoryType: memoryType || undefined,
		tier: tier || undefined,
	});

	const leadersQuery = api.memory.impactLeaders.useQuery({ limit: 10 });
	const workspacesQuery = api.memory.workspaces.useQuery();

	const promoteMutation = api.memory.promote.useMutation({
		onSuccess: () => {
			listQuery.refetch();
			leadersQuery.refetch();
		},
	});

	const deleteMutation = api.memory.delete.useMutation({
		onSuccess: () => {
			listQuery.refetch();
			leadersQuery.refetch();
		},
	});

	const memories = listQuery.data?.memories ?? [];
	const pagination = listQuery.data?.pagination;
	const leaders = leadersQuery.data?.memories ?? [];
	const workspaces = workspacesQuery.data ?? [];

	// Derive stats from current page
	const totalMemories = pagination?.total ?? 0;
	const shortCount = memories.filter((m: any) => m.tier === "short").length;
	const longCount = memories.filter((m: any) => m.tier === "long").length;
	const maxImpact = memories.reduce(
		(max: number, m: any) => Math.max(max, m.impactScore ?? 0),
		0,
	);

	return (
		<main className="mx-auto max-w-7xl px-4 py-8">
			<h1 className="mb-6 text-2xl font-bold">Memory Browser</h1>

			{/* Stats */}
			<div className="mb-6 grid grid-cols-4 gap-4">
				<div className="rounded-lg border p-4">
					<div className="text-sm text-gray-500">Total Memories</div>
					<div className="text-2xl font-bold">{totalMemories}</div>
				</div>
				<div className="rounded-lg border p-4">
					<div className="text-sm text-gray-500">Short-term (page)</div>
					<div className="text-2xl font-bold text-yellow-600">{shortCount}</div>
				</div>
				<div className="rounded-lg border p-4">
					<div className="text-sm text-gray-500">Long-term (page)</div>
					<div className="text-2xl font-bold text-green-600">{longCount}</div>
				</div>
				<div className="rounded-lg border p-4">
					<div className="text-sm text-gray-500">Highest Impact (page)</div>
					<div className="text-2xl font-bold text-blue-600">
						{maxImpact.toFixed(2)}
					</div>
				</div>
			</div>

			{/* Tabs */}
			<div className="mb-4 flex gap-2 border-b">
				<button
					className={`px-4 py-2 ${tab === "all" ? "border-b-2 border-blue-500 font-semibold" : "text-gray-500"}`}
					onClick={() => setTab("all")}
				>
					All Memories
				</button>
				<button
					className={`px-4 py-2 ${tab === "leaders" ? "border-b-2 border-blue-500 font-semibold" : "text-gray-500"}`}
					onClick={() => setTab("leaders")}
				>
					Impact Leaders
				</button>
			</div>

			{tab === "all" && (
				<>
					{/* Filters */}
					<div className="mb-4 flex flex-wrap gap-3">
						<select
							className="rounded border px-3 py-1.5 text-sm"
							value={workspaceId}
							onChange={(e) => {
								setWorkspaceId(e.target.value);
								setPage(1);
							}}
						>
							<option value="">All Workspaces</option>
							{workspaces.map((ws: any) => (
								<option key={ws.id} value={ws.id}>
									{ws.name}
								</option>
							))}
						</select>

						<select
							className="rounded border px-3 py-1.5 text-sm"
							value={memoryType}
							onChange={(e) => {
								setMemoryType(e.target.value);
								setPage(1);
							}}
						>
							<option value="">All Types</option>
							{MEMORY_TYPES.map((t) => (
								<option key={t} value={t}>
									{t}
								</option>
							))}
						</select>

						<select
							className="rounded border px-3 py-1.5 text-sm"
							value={tier}
							onChange={(e) => {
								setTier(e.target.value);
								setPage(1);
							}}
						>
							<option value="">All Tiers</option>
							<option value="short">Short-term</option>
							<option value="long">Long-term</option>
						</select>

						<select
							className="rounded border px-3 py-1.5 text-sm"
							value={sort}
							onChange={(e) => {
								setSort(e.target.value);
								setPage(1);
							}}
						>
							<option value="created_at">Created At</option>
							<option value="impact_score">Impact Score</option>
							<option value="access_count">Access Count</option>
							<option value="confidence">Confidence</option>
							<option value="updated_at">Updated At</option>
						</select>

						<button
							className="rounded border px-3 py-1.5 text-sm"
							onClick={() => setOrder(order === "desc" ? "asc" : "desc")}
						>
							{order === "desc" ? "\u2193 Desc" : "\u2191 Asc"}
						</button>
					</div>

					{/* Table */}
					{listQuery.isLoading ? (
						<div className="py-8 text-center text-gray-500">Loading...</div>
					) : memories.length === 0 ? (
						<div className="py-8 text-center text-gray-500">
							No memories found
						</div>
					) : (
						<div className="overflow-x-auto">
							<table className="w-full text-left text-sm">
								<thead className="border-b text-xs uppercase text-gray-500">
									<tr>
										<th className="px-3 py-2">Content</th>
										<th className="px-3 py-2">Type</th>
										<th className="px-3 py-2">Tier</th>
										<th className="px-3 py-2">Confidence</th>
										<th className="px-3 py-2">Access</th>
										<th className="px-3 py-2">Impact</th>
										<th className="px-3 py-2">Files</th>
										<th className="px-3 py-2">Created</th>
										<th className="px-3 py-2">Actions</th>
									</tr>
								</thead>
								<tbody>
									{memories.map((m: any) => (
										<tr key={m.id} className="border-b hover:bg-gray-50 dark:hover:bg-gray-800">
											<td className="max-w-xs px-3 py-2">
												<Link
													href={`/memories/${m.id}`}
													className="text-blue-600 hover:underline"
												>
													{truncate(m.content, 100)}
												</Link>
											</td>
											<td className="px-3 py-2">
												<span
													className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${TYPE_COLORS[m.memoryType] ?? "bg-gray-100"}`}
												>
													{m.memoryType}
												</span>
											</td>
											<td className="px-3 py-2">
												<span
													className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${
														m.tier === "long"
															? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
															: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200"
													}`}
												>
													{m.tier}
												</span>
											</td>
											<td className="px-3 py-2">{m.confidence?.toFixed(2)}</td>
											<td className="px-3 py-2">{m.accessCount}</td>
											<td className="px-3 py-2">
												<div className="flex items-center gap-1">
													<div
														className="h-2 rounded bg-blue-500"
														style={{ width: `${(m.impactScore ?? 0) * 60}px` }}
													/>
													<span className="text-xs">
														{(m.impactScore ?? 0).toFixed(2)}
													</span>
												</div>
											</td>
											<td className="px-3 py-2">
												{m.relatedFiles?.length > 0 ? (
													<div className="flex flex-wrap gap-1">
														{m.relatedFiles.slice(0, 3).map((f: string) => (
															<span
																key={f}
																title={f}
																className="inline-block rounded bg-gray-100 px-1.5 py-0.5 text-xs dark:bg-gray-700"
															>
																{f.split("/").pop()}
															</span>
														))}
														{m.relatedFiles.length > 3 && (
															<span className="text-xs text-gray-400">
																+{m.relatedFiles.length - 3}
															</span>
														)}
													</div>
												) : (
													<span className="text-xs text-gray-400">&mdash;</span>
												)}
											</td>
											<td className="whitespace-nowrap px-3 py-2 text-xs text-gray-500">
												{relativeTime(m.createdAt)}
											</td>
											<td className="px-3 py-2">
												<div className="flex gap-1">
													{m.tier === "short" && (
														<button
															className="rounded bg-green-600 px-2 py-1 text-xs text-white hover:bg-green-700 disabled:opacity-50"
															disabled={promoteMutation.isPending}
															onClick={() => promoteMutation.mutate({ id: m.id })}
														>
															Promote
														</button>
													)}
													<button
														className="rounded bg-red-600 px-2 py-1 text-xs text-white hover:bg-red-700 disabled:opacity-50"
														disabled={deleteMutation.isPending}
														onClick={() => {
															if (confirm("Delete this memory?")) {
																deleteMutation.mutate({ id: m.id });
															}
														}}
													>
														Delete
													</button>
												</div>
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					)}

					{/* Pagination */}
					{pagination && pagination.totalPages > 1 && (
						<div className="mt-4 flex items-center justify-between">
							<div className="text-sm text-gray-500">
								Page {pagination.page} of {pagination.totalPages} ({pagination.total} total)
							</div>
							<div className="flex gap-2">
								<button
									className="rounded border px-3 py-1 text-sm disabled:opacity-50"
									disabled={page <= 1}
									onClick={() => setPage(page - 1)}
								>
									Previous
								</button>
								<button
									className="rounded border px-3 py-1 text-sm disabled:opacity-50"
									disabled={page >= pagination.totalPages}
									onClick={() => setPage(page + 1)}
								>
									Next
								</button>
							</div>
						</div>
					)}
				</>
			)}

			{tab === "leaders" && (
				<div>
					{leadersQuery.isLoading ? (
						<div className="py-8 text-center text-gray-500">Loading...</div>
					) : leaders.length === 0 ? (
						<div className="py-8 text-center text-gray-500">
							No impact data yet
						</div>
					) : (
						<div className="space-y-3">
							{leaders.map((m: any, i: number) => (
								<div
									key={m.id}
									className="flex items-start gap-4 rounded-lg border p-4"
								>
									<div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-100 text-sm font-bold text-blue-700">
										{i + 1}
									</div>
									<div className="flex-1">
										<Link
											href={`/memories/${m.id}`}
											className="font-medium text-blue-600 hover:underline"
										>
											{truncate(m.content, 150)}
										</Link>
										<div className="mt-1 flex flex-wrap gap-2 text-xs text-gray-500">
											<span
												className={`rounded px-2 py-0.5 font-medium ${TYPE_COLORS[m.memoryType] ?? "bg-gray-100"}`}
											>
												{m.memoryType}
											</span>
											<span>Impact: {(m.impactScore ?? 0).toFixed(2)}</span>
											<span>Confidence: {m.confidence?.toFixed(2)}</span>
											<span>Accessed: {m.accessCount}x</span>
											<span>{relativeTime(m.createdAt)}</span>
										</div>
									</div>
								</div>
							))}
						</div>
					)}
				</div>
			)}
		</main>
	);
}
