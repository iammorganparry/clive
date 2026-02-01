"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "~/trpc/react";

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

const SIGNAL_LABELS: Record<string, string> = {
	helpful: "Helpful",
	promoted: "Promoted",
	cited: "Cited",
};

function formatDate(unix: number): string {
	return new Date(unix * 1000).toLocaleString();
}

function relativeTime(unix: number): string {
	const diff = Date.now() / 1000 - unix;
	if (diff < 60) return "just now";
	if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
	if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
	return `${Math.floor(diff / 86400)}d ago`;
}

export default function MemoryDetailPage() {
	const params = useParams<{ id: string }>();
	const router = useRouter();
	const id = params.id;

	const [editingTags, setEditingTags] = useState(false);
	const [tagsInput, setTagsInput] = useState("");
	const [editingConfidence, setEditingConfidence] = useState(false);
	const [confidenceInput, setConfidenceInput] = useState("");

	const memoryQuery = api.memory.getById.useQuery({ id });
	const eventsQuery = api.memory.impactEvents.useQuery({ id });

	const promoteMutation = api.memory.promote.useMutation({
		onSuccess: () => memoryQuery.refetch(),
	});

	const impactMutation = api.memory.recordImpact.useMutation({
		onSuccess: () => {
			memoryQuery.refetch();
			eventsQuery.refetch();
		},
	});

	const updateMutation = api.memory.update.useMutation({
		onSuccess: () => {
			memoryQuery.refetch();
			setEditingTags(false);
			setEditingConfidence(false);
		},
	});

	const deleteMutation = api.memory.delete.useMutation({
		onSuccess: () => router.push("/memories"),
	});

	const memory = memoryQuery.data;
	const events = eventsQuery.data?.events ?? [];

	if (memoryQuery.isLoading) {
		return (
			<main className="mx-auto max-w-4xl px-4 py-8">
				<div className="text-gray-500">Loading...</div>
			</main>
		);
	}

	if (!memory) {
		return (
			<main className="mx-auto max-w-4xl px-4 py-8">
				<div className="text-gray-500">Memory not found</div>
				<Link href="/memories" className="text-blue-600 hover:underline">
					Back to memories
				</Link>
			</main>
		);
	}

	return (
		<main className="mx-auto max-w-4xl px-4 py-8">
			{/* Header */}
			<div className="mb-6 flex items-center gap-4">
				<Link
					href="/memories"
					className="text-sm text-gray-500 hover:text-gray-700"
				>
					← Back
				</Link>
				<h1 className="text-xl font-bold">Memory Detail</h1>
			</div>

			{/* Content */}
			<div className="mb-6 rounded-lg border p-6">
				<div className="mb-3 flex flex-wrap gap-2">
					<span
						className={`rounded px-2 py-1 text-xs font-medium ${TYPE_COLORS[memory.memoryType] ?? "bg-gray-100"}`}
					>
						{memory.memoryType}
					</span>
					<span
						className={`rounded px-2 py-1 text-xs font-medium ${
							memory.tier === "long"
								? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
								: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200"
						}`}
					>
						{memory.tier}
					</span>
				</div>
				<p className="whitespace-pre-wrap text-base">{memory.content}</p>
			</div>

			{/* Metadata Grid */}
			<div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
				<div className="rounded border p-3">
					<div className="text-xs text-gray-500">Confidence</div>
					{editingConfidence ? (
						<div className="mt-1 flex gap-1">
							<input
								type="number"
								step="0.05"
								min="0"
								max="1"
								className="w-20 rounded border px-2 py-0.5 text-sm"
								value={confidenceInput}
								onChange={(e) => setConfidenceInput(e.target.value)}
							/>
							<button
								className="rounded bg-blue-600 px-2 py-0.5 text-xs text-white"
								onClick={() =>
									updateMutation.mutate({
										id,
										confidence: parseFloat(confidenceInput),
									})
								}
							>
								Save
							</button>
							<button
								className="text-xs text-gray-500"
								onClick={() => setEditingConfidence(false)}
							>
								Cancel
							</button>
						</div>
					) : (
						<div
							className="mt-1 cursor-pointer text-lg font-bold"
							onClick={() => {
								setConfidenceInput(String(memory.confidence ?? 0.8));
								setEditingConfidence(true);
							}}
						>
							{memory.confidence?.toFixed(2)}
						</div>
					)}
				</div>
				<div className="rounded border p-3">
					<div className="text-xs text-gray-500">Access Count</div>
					<div className="mt-1 text-lg font-bold">{memory.accessCount}</div>
				</div>
				<div className="rounded border p-3">
					<div className="text-xs text-gray-500">Impact Score</div>
					<div className="mt-1 text-lg font-bold text-blue-600">
						{(memory.impactScore ?? 0).toFixed(2)}
					</div>
				</div>
				<div className="rounded border p-3">
					<div className="text-xs text-gray-500">Created</div>
					<div className="mt-1 text-sm">{formatDate(memory.createdAt)}</div>
				</div>
			</div>

			{/* Tags */}
			<div className="mb-6 rounded border p-4">
				<div className="mb-2 flex items-center justify-between">
					<h3 className="text-sm font-semibold">Tags</h3>
					<button
						className="text-xs text-blue-600 hover:underline"
						onClick={() => {
							setTagsInput((memory.tags ?? []).join(", "));
							setEditingTags(!editingTags);
						}}
					>
						{editingTags ? "Cancel" : "Edit"}
					</button>
				</div>
				{editingTags ? (
					<div className="flex gap-2">
						<input
							className="flex-1 rounded border px-3 py-1 text-sm"
							value={tagsInput}
							onChange={(e) => setTagsInput(e.target.value)}
							placeholder="comma-separated tags"
						/>
						<button
							className="rounded bg-blue-600 px-3 py-1 text-sm text-white"
							onClick={() =>
								updateMutation.mutate({
									id,
									tags: tagsInput
										.split(",")
										.map((t) => t.trim())
										.filter(Boolean),
								})
							}
						>
							Save
						</button>
					</div>
				) : (
					<div className="flex flex-wrap gap-1">
						{(memory.tags ?? []).map((tag: string) => (
							<span
								key={tag}
								className="rounded bg-gray-100 px-2 py-0.5 text-xs dark:bg-gray-700"
							>
								{tag}
							</span>
						))}
						{(!memory.tags || memory.tags.length === 0) && (
							<span className="text-xs text-gray-400">No tags</span>
						)}
					</div>
				)}
			</div>

			{/* Metadata Details */}
			<div className="mb-6 rounded border p-4">
				<h3 className="mb-2 text-sm font-semibold">Details</h3>
				<dl className="grid grid-cols-2 gap-2 text-sm">
					<dt className="text-gray-500">ID</dt>
					<dd className="font-mono text-xs">{memory.id}</dd>
					<dt className="text-gray-500">Source</dt>
					<dd>{memory.source || "—"}</dd>
					<dt className="text-gray-500">Session ID</dt>
					<dd className="font-mono text-xs">{memory.sessionId || "—"}</dd>
					<dt className="text-gray-500">Updated</dt>
					<dd>{formatDate(memory.updatedAt)}</dd>
				</dl>
			</div>

			{/* Related Files */}
			{memory.relatedFiles && memory.relatedFiles.length > 0 && (
				<div className="mb-6 rounded border p-4">
					<h3 className="mb-2 text-sm font-semibold">Related Files</h3>
					<ul className="space-y-1">
						{memory.relatedFiles.map((f: string) => (
							<li key={f} className="font-mono text-sm text-gray-700 dark:text-gray-300">
								{f}
							</li>
						))}
					</ul>
				</div>
			)}

			{/* Actions */}
			<div className="mb-6 flex flex-wrap gap-2">
				{memory.tier === "short" && (
					<button
						className="rounded bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
						disabled={promoteMutation.isPending}
						onClick={() => promoteMutation.mutate({ id })}
					>
						{promoteMutation.isPending ? "Promoting..." : "Promote to Long-term"}
					</button>
				)}
				<button
					className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
					disabled={impactMutation.isPending}
					onClick={() =>
						impactMutation.mutate({ id, signal: "helpful", source: "dashboard" })
					}
				>
					Signal Helpful
				</button>
				<button
					className="rounded bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700 disabled:opacity-50"
					disabled={impactMutation.isPending}
					onClick={() =>
						impactMutation.mutate({ id, signal: "cited", source: "dashboard" })
					}
				>
					Signal Cited
				</button>
				<button
					className="rounded bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
					disabled={deleteMutation.isPending}
					onClick={() => {
						if (confirm("Delete this memory permanently?")) {
							deleteMutation.mutate({ id });
						}
					}}
				>
					Delete
				</button>
			</div>

			{/* Impact Timeline */}
			<div className="rounded border p-4">
				<h3 className="mb-3 text-sm font-semibold">Impact Timeline</h3>
				{eventsQuery.isLoading ? (
					<div className="text-sm text-gray-500">Loading events...</div>
				) : events.length === 0 ? (
					<div className="text-sm text-gray-500">No impact events recorded</div>
				) : (
					<div className="space-y-2">
						{events.map((event: any) => (
							<div
								key={event.id}
								className="flex items-center gap-3 text-sm"
							>
								<div className="h-2 w-2 rounded-full bg-blue-500" />
								<span className="font-medium">
									{SIGNAL_LABELS[event.signal] ?? event.signal}
								</span>
								<span className="text-gray-500">from {event.source}</span>
								<span className="text-xs text-gray-400">
									{relativeTime(event.createdAt)}
								</span>
							</div>
						))}
					</div>
				)}
			</div>
		</main>
	);
}
