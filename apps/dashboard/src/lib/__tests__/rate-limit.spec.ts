import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";
import { checkTokenEndpointRateLimit, RateLimiter } from "../rate-limit.js";

describe("RateLimiter", () => {
	let limiter: RateLimiter;

	beforeEach(() => {
		limiter = new RateLimiter(60_000, 10); // 10 requests per 60 seconds
	});

	describe("isRateLimited", () => {
		it("should allow requests under the limit", () => {
			const identifier = "test-ip";
			for (let i = 0; i < 10; i++) {
				expect(limiter.isRateLimited(identifier)).toBe(false);
			}
		});

		it("should block requests over the limit", () => {
			const identifier = "test-ip";
			// Make 10 requests (all should pass)
			for (let i = 0; i < 10; i++) {
				expect(limiter.isRateLimited(identifier)).toBe(false);
			}
			// 11th request should be blocked
			expect(limiter.isRateLimited(identifier)).toBe(true);
		});

		it("should allow requests after window expires", async () => {
			const identifier = "test-ip";
			const shortWindowLimiter = new RateLimiter(100, 2); // 2 requests per 100ms

			// Make 2 requests
			expect(shortWindowLimiter.isRateLimited(identifier)).toBe(false);
			expect(shortWindowLimiter.isRateLimited(identifier)).toBe(false);

			// 3rd should be blocked
			expect(shortWindowLimiter.isRateLimited(identifier)).toBe(true);

			// Wait for window to expire
			await new Promise((resolve) => setTimeout(resolve, 150));

			// Should allow requests again
			expect(shortWindowLimiter.isRateLimited(identifier)).toBe(false);
		});

		it("should isolate limits per identifier", () => {
			const ip1 = "192.168.1.1";
			const ip2 = "192.168.1.2";

			// Fill up limit for ip1
			for (let i = 0; i < 10; i++) {
				expect(limiter.isRateLimited(ip1)).toBe(false);
			}

			// ip2 should still have full limit
			expect(limiter.isRateLimited(ip2)).toBe(false);
			expect(limiter.isRateLimited(ip1)).toBe(true); // ip1 is still blocked
		});
	});

	describe("getRemaining", () => {
		it("should return correct remaining count", () => {
			const identifier = "test-ip";
			expect(limiter.getRemaining(identifier)).toBe(10);

			// Make 3 requests
			limiter.isRateLimited(identifier);
			limiter.isRateLimited(identifier);
			limiter.isRateLimited(identifier);

			expect(limiter.getRemaining(identifier)).toBe(7);
		});

		it("should return 0 when limit exceeded", () => {
			const identifier = "test-ip";
			// Make 10 requests
			for (let i = 0; i < 10; i++) {
				limiter.isRateLimited(identifier);
			}

			expect(limiter.getRemaining(identifier)).toBe(0);
		});
	});

	describe("getResetTime", () => {
		it("should return future timestamp when no requests", () => {
			const identifier = "test-ip";
			const resetTime = limiter.getResetTime(identifier);
			const now = Date.now();

			expect(resetTime).toBeGreaterThan(now);
			expect(resetTime).toBeLessThanOrEqual(now + 60_000);
		});

		it("should return correct reset time based on oldest request", () => {
			const identifier = "test-ip";
			const startTime = Date.now();

			// Make a request
			limiter.isRateLimited(identifier);

			const resetTime = limiter.getResetTime(identifier);
			// Reset time should be startTime + windowMs (within a small margin)
			expect(resetTime).toBeGreaterThanOrEqual(startTime + 60_000);
			expect(resetTime).toBeLessThan(startTime + 60_000 + 100); // Allow 100ms margin
		});
	});

	describe("cleanup", () => {
		it("should clean up expired entries", async () => {
			const shortWindowLimiter = new RateLimiter(50, 5);
			const identifier = "test-ip";

			// Make some requests
			shortWindowLimiter.isRateLimited(identifier);
			shortWindowLimiter.isRateLimited(identifier);

			// Wait for window to expire
			await new Promise((resolve) => setTimeout(resolve, 100));

			// Manually trigger cleanup by checking (which calls cleanup if size > 1000)
			// But we can't easily test cleanup without making 1000+ requests
			// So we'll test that expired requests don't count
			expect(shortWindowLimiter.getRemaining(identifier)).toBe(5);
		});
	});
});

describe("checkTokenEndpointRateLimit", () => {
	const createMockRequest = (ip?: string, headers?: Record<string, string>) => {
		const mockHeaders = new Headers();
		if (ip) {
			mockHeaders.set("x-forwarded-for", ip);
		}
		if (headers) {
			Object.entries(headers).forEach(([key, value]) => {
				mockHeaders.set(key, value);
			});
		}

		return {
			headers: mockHeaders,
		} as unknown as NextRequest;
	};

	beforeEach(() => {
		// Reset the limiter by creating a new instance
		// Since tokenEndpointLimiter is a module-level singleton,
		// we need to test it carefully
	});

	it("should allow requests under limit", () => {
		const request = createMockRequest("192.168.1.1");
		const result = checkTokenEndpointRateLimit(request);

		expect(result.isLimited).toBe(false);
		expect(result.status).toBe(200);
		expect(result.headers["X-RateLimit-Limit"]).toBe("10");
		expect(result.headers["X-RateLimit-Remaining"]).toBe("9");
		expect(result.headers["X-RateLimit-Reset"]).toBeDefined();
	});

	it("should block requests over limit", () => {
		const request = createMockRequest("192.168.1.2");

		// Make 10 requests
		for (let i = 0; i < 10; i++) {
			const result = checkTokenEndpointRateLimit(request);
			expect(result.isLimited).toBe(false);
		}

		// 11th request should be blocked
		const blockedResult = checkTokenEndpointRateLimit(request);
		expect(blockedResult.isLimited).toBe(true);
		expect(blockedResult.status).toBe(429);
		expect(blockedResult.error).toBe(
			"Too many requests. Please try again later.",
		);
		expect(blockedResult.headers["X-RateLimit-Remaining"]).toBe("0");
		expect(blockedResult.headers["Retry-After"]).toBeDefined();
	});

	it("should extract IP from x-forwarded-for header", () => {
		const request = createMockRequest("192.168.1.100");
		const result = checkTokenEndpointRateLimit(request);

		expect(result.isLimited).toBe(false);
		// Make 9 more requests from same IP
		for (let i = 0; i < 9; i++) {
			checkTokenEndpointRateLimit(request);
		}
		// Should be blocked now
		const blockedResult = checkTokenEndpointRateLimit(request);
		expect(blockedResult.isLimited).toBe(true);
	});

	it("should extract IP from x-real-ip header when x-forwarded-for missing", () => {
		const request = createMockRequest(undefined, {
			"x-real-ip": "10.0.0.1",
		});
		const result = checkTokenEndpointRateLimit(request);

		expect(result.isLimited).toBe(false);
	});

	it("should use 'unknown' when no IP headers present", () => {
		const request = createMockRequest();
		const result = checkTokenEndpointRateLimit(request);

		expect(result.isLimited).toBe(false);
		// All requests with 'unknown' IP should share the same limit
		for (let i = 0; i < 9; i++) {
			checkTokenEndpointRateLimit(request);
		}
		const blockedResult = checkTokenEndpointRateLimit(request);
		expect(blockedResult.isLimited).toBe(true);
	});

	it("should handle x-forwarded-for with multiple IPs", () => {
		const request = createMockRequest("192.168.1.1, 10.0.0.1");
		const result = checkTokenEndpointRateLimit(request);

		expect(result.isLimited).toBe(false);
		// Should use first IP (192.168.1.1)
		expect(result.headers["X-RateLimit-Limit"]).toBe("10");
	});

	it("should return proper rate limit headers", () => {
		const request = createMockRequest("192.168.1.5");
		const result = checkTokenEndpointRateLimit(request);

		expect(result.headers).toHaveProperty("X-RateLimit-Limit");
		expect(result.headers).toHaveProperty("X-RateLimit-Remaining");
		expect(result.headers).toHaveProperty("X-RateLimit-Reset");
		expect(result.headers["X-RateLimit-Limit"]).toBe("10");
		const remaining = result.headers["X-RateLimit-Remaining"];
		expect(remaining).toBeDefined();
		if (remaining) {
			expect(Number.parseInt(remaining, 10)).toBeGreaterThanOrEqual(0);
			expect(Number.parseInt(remaining, 10)).toBeLessThanOrEqual(10);
		}
	});
});
