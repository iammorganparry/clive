import type { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { logSecurityEvent, logTokenRequest } from "../audit-log.js";

describe("audit-log", () => {
	let consoleLogSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		// Set NODE_ENV to development to enable console logging
		vi.stubEnv("NODE_ENV", "development");
	});

	afterEach(() => {
		consoleLogSpy.mockRestore();
		vi.unstubAllEnvs();
	});

	const createMockRequest = (ip?: string, userAgent?: string): NextRequest => {
		const headers = new Headers();
		if (ip) {
			headers.set("x-forwarded-for", ip);
		}
		if (userAgent) {
			headers.set("user-agent", userAgent);
		}

		return {
			headers,
			method: "GET",
		} as unknown as NextRequest;
	};

	describe("logSecurityEvent", () => {
		it("should log security event with correct structure", () => {
			const request = createMockRequest("192.168.1.1", "Mozilla/5.0");
			const userId = "user-123";

			logSecurityEvent(request, {
				userId,
				endpoint: "/api/test",
				success: true,
			});

			expect(consoleLogSpy).toHaveBeenCalledTimes(1);
			const logCall = consoleLogSpy.mock.calls[0];
			expect(logCall[0]).toBe("[Audit Log]");

			const logEntry = JSON.parse(logCall[1] as string);
			expect(logEntry.userId).toBe(userId);
			expect(logEntry.ip).toBe("192.168.1.1");
			expect(logEntry.endpoint).toBe("/api/test");
			expect(logEntry.method).toBe("GET");
			expect(logEntry.success).toBe(true);
			expect(logEntry.timestamp).toBeDefined();
			expect(typeof logEntry.timestamp).toBe("number");
		});

		it("should log failed events", () => {
			const request = createMockRequest("10.0.0.1");
			const error = "Unauthorized";

			logSecurityEvent(request, {
				userId: null,
				endpoint: "/api/test",
				success: false,
				error,
			});

			expect(consoleLogSpy).toHaveBeenCalledTimes(1);
			const logCall = consoleLogSpy.mock.calls[0];
			const logEntry = JSON.parse(logCall[1] as string);

			expect(logEntry.success).toBe(false);
			expect(logEntry.error).toBe(error);
			expect(logEntry.userId).toBeNull();
		});

		it("should extract IP from x-forwarded-for header", () => {
			const request = createMockRequest("192.168.1.100");

			logSecurityEvent(request, {
				userId: "user-1",
				endpoint: "/api/test",
				success: true,
			});

			const logCall = consoleLogSpy.mock.calls[0];
			const logEntry = JSON.parse(logCall[1] as string);
			expect(logEntry.ip).toBe("192.168.1.100");
		});

		it("should extract IP from x-real-ip when x-forwarded-for missing", () => {
			const headers = new Headers();
			headers.set("x-real-ip", "10.0.0.5");
			const request = {
				headers,
				method: "POST",
			} as unknown as NextRequest;

			logSecurityEvent(request, {
				userId: "user-2",
				endpoint: "/api/test",
				success: true,
			});

			const logCall = consoleLogSpy.mock.calls[0];
			const logEntry = JSON.parse(logCall[1] as string);
			expect(logEntry.ip).toBe("10.0.0.5");
		});

		it("should use 'unknown' when no IP headers present", () => {
			const request = createMockRequest();

			logSecurityEvent(request, {
				userId: null,
				endpoint: "/api/test",
				success: false,
			});

			const logCall = consoleLogSpy.mock.calls[0];
			const logEntry = JSON.parse(logCall[1] as string);
			expect(logEntry.ip).toBe("unknown");
		});

		it("should handle x-forwarded-for with multiple IPs", () => {
			const request = createMockRequest("192.168.1.1, 10.0.0.1, 172.16.0.1");

			logSecurityEvent(request, {
				userId: "user-3",
				endpoint: "/api/test",
				success: true,
			});

			const logCall = consoleLogSpy.mock.calls[0];
			const logEntry = JSON.parse(logCall[1] as string);
			expect(logEntry.ip).toBe("192.168.1.1");
		});

		it("should include user-agent when present", () => {
			const userAgent = "Clive-Extension/1.0";
			const request = createMockRequest("192.168.1.1", userAgent);

			logSecurityEvent(request, {
				userId: "user-4",
				endpoint: "/api/test",
				success: true,
			});

			const logCall = consoleLogSpy.mock.calls[0];
			const logEntry = JSON.parse(logCall[1] as string);
			expect(logEntry.userAgent).toBe(userAgent);
		});

		it("should not include user-agent when missing", () => {
			const headers = new Headers();
			headers.set("x-forwarded-for", "192.168.1.1");
			const request = {
				headers,
				method: "GET",
			} as unknown as NextRequest;

			logSecurityEvent(request, {
				userId: "user-5",
				endpoint: "/api/test",
				success: true,
			});

			const logCall = consoleLogSpy.mock.calls[0];
			const logEntry = JSON.parse(logCall[1] as string);
			expect(logEntry.userAgent).toBeUndefined();
		});
	});

	describe("logTokenRequest", () => {
		it("should log token request with correct endpoint", () => {
			const request = createMockRequest("192.168.1.1");
			const userId = "user-token-1";

			logTokenRequest(request, userId, true);

			expect(consoleLogSpy).toHaveBeenCalledTimes(1);
			const logCall = consoleLogSpy.mock.calls[0];
			const logEntry = JSON.parse(logCall[1] as string);

			expect(logEntry.endpoint).toBe("/api/ai/token");
			expect(logEntry.userId).toBe(userId);
			expect(logEntry.success).toBe(true);
		});

		it("should log failed token requests", () => {
			const request = createMockRequest("10.0.0.1");
			const error = "Rate limit exceeded";

			logTokenRequest(request, null, false, error);

			const logCall = consoleLogSpy.mock.calls[0];
			const logEntry = JSON.parse(logCall[1] as string);

			expect(logEntry.endpoint).toBe("/api/ai/token");
			expect(logEntry.success).toBe(false);
			expect(logEntry.error).toBe(error);
			expect(logEntry.userId).toBeNull();
		});
	});
});
