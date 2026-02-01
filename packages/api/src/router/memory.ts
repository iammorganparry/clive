import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";

import { createTRPCRouter, publicProcedure } from "../trpc.js";

const MEMORY_SERVER = process.env.MEMORY_SERVER_URL ?? "http://localhost:8741";

async function memoryFetch(path: string, options?: RequestInit) {
	const res = await fetch(`${MEMORY_SERVER}${path}`, {
		...options,
		headers: {
			"Content-Type": "application/json",
			...options?.headers,
		},
	});
	if (!res.ok) {
		const body = await res.text().catch(() => "");
		throw new TRPCError({
			code: "INTERNAL_SERVER_ERROR",
			message: `Memory server error (${res.status}): ${body}`,
		});
	}
	return res.json();
}

export const memoryRouter = createTRPCRouter({
	list: publicProcedure
		.input(
			z.object({
				page: z.number().optional(),
				limit: z.number().optional(),
				sort: z.string().optional(),
				order: z.enum(["asc", "desc"]).optional(),
				workspaceId: z.string().optional(),
				memoryType: z.string().optional(),
				tier: z.string().optional(),
				source: z.string().optional(),
			}).optional(),
		)
		.query(async ({ input }) => {
			const params = new URLSearchParams();
			if (input?.page) params.set("page", String(input.page));
			if (input?.limit) params.set("limit", String(input.limit));
			if (input?.sort) params.set("sort", input.sort);
			if (input?.order) params.set("order", input.order);
			if (input?.workspaceId) params.set("workspace_id", input.workspaceId);
			if (input?.memoryType) params.set("memory_type", input.memoryType);
			if (input?.tier) params.set("tier", input.tier);
			if (input?.source) params.set("source", input.source);
			const qs = params.toString();
			return memoryFetch(`/memories${qs ? `?${qs}` : ""}`);
		}),

	getById: publicProcedure
		.input(z.object({ id: z.string() }))
		.query(async ({ input }) => {
			return memoryFetch(`/memories/${input.id}`);
		}),

	impactLeaders: publicProcedure
		.input(
			z.object({
				workspaceId: z.string().optional(),
				limit: z.number().optional(),
			}).optional(),
		)
		.query(async ({ input }) => {
			const params = new URLSearchParams();
			if (input?.workspaceId) params.set("workspace_id", input.workspaceId);
			if (input?.limit) params.set("limit", String(input.limit));
			const qs = params.toString();
			return memoryFetch(`/memories/impact-leaders${qs ? `?${qs}` : ""}`);
		}),

	impactEvents: publicProcedure
		.input(z.object({ id: z.string() }))
		.query(async ({ input }) => {
			return memoryFetch(`/memories/${input.id}/impact`);
		}),

	recordImpact: publicProcedure
		.input(
			z.object({
				id: z.string(),
				signal: z.enum(["helpful", "promoted", "cited"]),
				source: z.string(),
				sessionId: z.string().optional(),
			}),
		)
		.mutation(async ({ input }) => {
			return memoryFetch(`/memories/${input.id}/impact`, {
				method: "POST",
				body: JSON.stringify({
					signal: input.signal,
					source: input.source,
					sessionId: input.sessionId,
				}),
			});
		}),

	promote: publicProcedure
		.input(z.object({ id: z.string() }))
		.mutation(async ({ input }) => {
			return memoryFetch(`/memories/${input.id}`, {
				method: "PATCH",
				body: JSON.stringify({ tier: "long" }),
			});
		}),

	update: publicProcedure
		.input(
			z.object({
				id: z.string(),
				tier: z.string().optional(),
				confidence: z.number().optional(),
				tags: z.array(z.string()).optional(),
				content: z.string().optional(),
				memoryType: z.string().optional(),
			}),
		)
		.mutation(async ({ input }) => {
			const { id, ...body } = input;
			return memoryFetch(`/memories/${id}`, {
				method: "PATCH",
				body: JSON.stringify(body),
			});
		}),

	delete: publicProcedure
		.input(z.object({ id: z.string() }))
		.mutation(async ({ input }) => {
			await memoryFetch(`/memories/${input.id}`, { method: "DELETE" });
			return { success: true };
		}),

	workspaces: publicProcedure.query(async () => {
		return memoryFetch("/workspaces");
	}),

	workspaceStats: publicProcedure
		.input(z.object({ id: z.string() }))
		.query(async ({ input }) => {
			return memoryFetch(`/workspaces/${input.id}/stats`);
		}),
});
