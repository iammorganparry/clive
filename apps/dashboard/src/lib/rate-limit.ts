import type { NextRequest } from "next/server";

/**
 * In-memory rate limiter
 * For production scale, consider using Upstash Redis or similar
 */
export class RateLimiter {
	private requests: Map<string, number[]> = new Map();
	private readonly windowMs: number;
	private readonly maxRequests: number;

	constructor(windowMs: number, maxRequests: number) {
		this.windowMs = windowMs;
		this.maxRequests = maxRequests;
	}

	/**
	 * Check if request should be rate limited
	 * @param identifier - Unique identifier (IP address, user ID, etc.)
	 * @returns true if rate limit exceeded, false otherwise
	 */
	isRateLimited(identifier: string): boolean {
		const now = Date.now();
		const requests = this.requests.get(identifier) || [];

		// Remove requests outside the time window
		const validRequests = requests.filter(
			(timestamp) => now - timestamp < this.windowMs,
		);

		// Check if limit exceeded
		if (validRequests.length >= this.maxRequests) {
			return true;
		}

		// Add current request
		validRequests.push(now);
		this.requests.set(identifier, validRequests);

		// Cleanup old entries periodically (every 1000 requests)
		if (this.requests.size > 1000) {
			this.cleanup(now);
		}

		return false;
	}

	/**
	 * Get remaining requests in current window
	 */
	getRemaining(identifier: string): number {
		const now = Date.now();
		const requests = this.requests.get(identifier) || [];
		const validRequests = requests.filter(
			(timestamp) => now - timestamp < this.windowMs,
		);
		return Math.max(0, this.maxRequests - validRequests.length);
	}

	/**
	 * Get reset time (when the rate limit window resets)
	 */
	getResetTime(identifier: string): number {
		const now = Date.now();
		const requests = this.requests.get(identifier) || [];
		if (requests.length === 0) {
			return now + this.windowMs;
		}
		const oldestRequest = Math.min(...requests);
		return oldestRequest + this.windowMs;
	}

	private cleanup(now: number): void {
		for (const [identifier, requests] of this.requests.entries()) {
			const validRequests = requests.filter(
				(timestamp) => now - timestamp < this.windowMs,
			);
			if (validRequests.length === 0) {
				this.requests.delete(identifier);
			} else {
				this.requests.set(identifier, validRequests);
			}
		}
	}
}

/**
 * Rate limiter for token endpoint: 10 requests per minute per IP
 */
const tokenEndpointLimiter = new RateLimiter(60_000, 10);

/**
 * Get client IP address from request
 */
function getClientIp(request: NextRequest): string {
	// Check various headers for IP (in order of preference)
	const forwarded = request.headers.get("x-forwarded-for");
	if (forwarded) {
		return forwarded.split(",")[0]?.trim() || "unknown";
	}

	const realIp = request.headers.get("x-real-ip");
	if (realIp) {
		return realIp;
	}

	// Fallback if no IP headers found
	return "unknown";
}

/**
 * Check rate limit for token endpoint
 * @returns Rate limit result with headers (always includes rate limit headers)
 */
export function checkTokenEndpointRateLimit(request: NextRequest): {
	isLimited: boolean;
	error?: string;
	status: number;
	headers: Record<string, string>;
} {
	const ip = getClientIp(request);
	const isLimited = tokenEndpointLimiter.isRateLimited(ip);
	const remaining = tokenEndpointLimiter.getRemaining(ip);
	const resetTime = tokenEndpointLimiter.getResetTime(ip);

	if (isLimited) {
		return {
			isLimited: true,
			error: "Too many requests. Please try again later.",
			status: 429,
			headers: {
				"Retry-After": Math.ceil((resetTime - Date.now()) / 1000).toString(),
				"X-RateLimit-Limit": "10",
				"X-RateLimit-Remaining": "0",
				"X-RateLimit-Reset": resetTime.toString(),
			},
		};
	}

	return {
		isLimited: false,
		status: 200,
		headers: {
			"X-RateLimit-Limit": "10",
			"X-RateLimit-Remaining": remaining.toString(),
			"X-RateLimit-Reset": resetTime.toString(),
		},
	};
}
