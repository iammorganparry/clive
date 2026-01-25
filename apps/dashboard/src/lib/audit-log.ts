import type { NextRequest } from "next/server";

export interface AuditLogEntry {
	userId: string | null;
	timestamp: number;
	ip: string;
	endpoint: string;
	method: string;
	success: boolean;
	error?: string;
	userAgent?: string;
}

/**
 * Get client IP address from request
 */
function getClientIp(request: NextRequest): string {
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
 * Log security events for audit trail
 * In production, this should write to a proper logging service (e.g., Datadog, CloudWatch, etc.)
 */
export function logSecurityEvent(
	request: NextRequest,
	options: {
		userId: string | null;
		endpoint: string;
		success: boolean;
		error?: string;
	},
): void {
	const entry: AuditLogEntry = {
		userId: options.userId,
		timestamp: Date.now(),
		ip: getClientIp(request),
		endpoint: options.endpoint,
		method: request.method,
		success: options.success,
		error: options.error,
		userAgent: request.headers.get("user-agent") || undefined,
	};

	// In development, log to console
	if (process.env.NODE_ENV === "development") {
		console.log("[Audit Log]", JSON.stringify(entry, null, 2));
	}

	// TODO: In production, send to logging service
	// Example:
	// await sendToLoggingService(entry);
}

/**
 * Log token request specifically
 */
export function logTokenRequest(
	request: NextRequest,
	userId: string | null,
	success: boolean,
	error?: string,
): void {
	logSecurityEvent(request, {
		userId,
		endpoint: "/api/ai/token",
		success,
		error,
	});
}
