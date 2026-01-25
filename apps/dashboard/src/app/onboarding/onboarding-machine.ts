import { authClient } from "@clive/auth/client";
import { assign, fromPromise, setup } from "xstate";

// Context type
interface OnboardingContext {
	callbackUrl: string | null;
	orgName: string;
	orgSlug: string;
	inviteCode: string;
	error: string | null;
	createdOrgId: string | null;
	joinedOrgId: string | null;
}

// Event types
type OnboardingEvent =
	| { type: "SESSION_VALID" }
	| { type: "SESSION_INVALID" }
	| { type: "SELECT_CREATE" }
	| { type: "SELECT_JOIN" }
	| { type: "BACK" }
	| { type: "UPDATE_ORG_NAME"; name: string }
	| { type: "UPDATE_ORG_SLUG"; slug: string }
	| { type: "UPDATE_INVITE_CODE"; code: string }
	| { type: "SUBMIT_CREATE" }
	| { type: "SUBMIT_JOIN" }
	| { type: "LOGOUT" }
	| { type: "RETRY" };

// Actor for checking session
const checkSessionActor = fromPromise(async () => {
	const { data } = await authClient.getSession();
	if (!data?.session) {
		throw new Error("No session");
	}
	return data.session;
});

// Actor for creating organization
const createOrgActor = fromPromise(
	async ({ input }: { input: { name: string; slug: string } }) => {
		const result = await authClient.organization.create({
			name: input.name,
			slug: input.slug,
		});

		if (result.error) {
			throw new Error(result.error.message || "Failed to create organization");
		}

		return result.data?.id;
	},
);

// Actor for joining organization
const joinOrgActor = fromPromise(
	async ({ input }: { input: { invitationId: string } }) => {
		const result = await authClient.organization.acceptInvitation({
			invitationId: input.invitationId,
		});

		if (result.error) {
			throw new Error(result.error.message || "Failed to join organization");
		}

		return result.data?.member?.organizationId;
	},
);

// Actor for setting active organization
const setActiveOrgActor = fromPromise(
	async ({ input }: { input: { organizationId: string } }) => {
		const result = await authClient.organization.setActive({
			organizationId: input.organizationId,
		});

		if (result.error) {
			throw new Error(
				result.error.message || "Failed to activate organization",
			);
		}

		return true;
	},
);

// Actor for signing out
const signOutActor = fromPromise(async () => {
	await authClient.signOut();
	return true;
});

// Generate slug from name
function generateSlug(name: string): string {
	return name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "");
}

export const onboardingMachine = setup({
	types: {
		context: {} as OnboardingContext,
		events: {} as OnboardingEvent,
		input: {} as { callbackUrl: string | null },
	},
	actors: {
		checkSession: checkSessionActor,
		createOrg: createOrgActor,
		joinOrg: joinOrgActor,
		setActiveOrg: setActiveOrgActor,
		signOut: signOutActor,
	},
	actions: {
		setError: assign({
			error: (_, params: { message: string }) => params.message,
		}),
		clearError: assign({
			error: () => null,
		}),
		updateOrgName: assign({
			orgName: (_, params: { name: string }) => params.name,
			orgSlug: ({ context }, params: { name: string }) => {
				const currentSlug = context.orgSlug;
				const expectedSlug = generateSlug(context.orgName);
				// Only auto-update slug if it matches the auto-generated one
				if (!currentSlug || currentSlug === expectedSlug) {
					return generateSlug(params.name);
				}
				return currentSlug;
			},
		}),
		updateOrgSlug: assign({
			orgSlug: (_, params: { slug: string }) => params.slug,
		}),
		updateInviteCode: assign({
			inviteCode: (_, params: { code: string }) => params.code,
		}),
		setCreatedOrgId: assign({
			createdOrgId: (_, params: { id: string }) => params.id,
		}),
		setJoinedOrgId: assign({
			joinedOrgId: (_, params: { id: string }) => params.id,
		}),
	},
	guards: {
		hasValidCreateInput: ({ context }) =>
			context.orgName.trim().length > 0 && context.orgSlug.trim().length > 0,
		hasValidJoinInput: ({ context }) => context.inviteCode.trim().length > 0,
	},
}).createMachine({
	id: "onboarding",
	initial: "checkingSession",
	context: ({ input }) => ({
		callbackUrl: input.callbackUrl,
		orgName: "",
		orgSlug: "",
		inviteCode: "",
		error: null,
		createdOrgId: null,
		joinedOrgId: null,
	}),
	states: {
		checkingSession: {
			invoke: {
				src: "checkSession",
				onDone: {
					target: "choice",
				},
				onError: {
					target: "redirectingToSignIn",
				},
			},
		},

		choice: {
			on: {
				SELECT_CREATE: {
					target: "createForm",
					actions: "clearError",
				},
				SELECT_JOIN: {
					target: "joinForm",
					actions: "clearError",
				},
				LOGOUT: {
					target: "signingOut",
				},
			},
		},

		createForm: {
			on: {
				BACK: {
					target: "choice",
					actions: "clearError",
				},
				UPDATE_ORG_NAME: {
					actions: {
						type: "updateOrgName",
						params: ({ event }) => ({ name: event.name }),
					},
				},
				UPDATE_ORG_SLUG: {
					actions: {
						type: "updateOrgSlug",
						params: ({ event }) => ({ slug: event.slug }),
					},
				},
				SUBMIT_CREATE: {
					target: "creatingOrg",
					guard: "hasValidCreateInput",
				},
			},
		},

		joinForm: {
			on: {
				BACK: {
					target: "choice",
					actions: "clearError",
				},
				UPDATE_INVITE_CODE: {
					actions: {
						type: "updateInviteCode",
						params: ({ event }) => ({ code: event.code }),
					},
				},
				SUBMIT_JOIN: {
					target: "joiningOrg",
					guard: "hasValidJoinInput",
				},
			},
		},

		creatingOrg: {
			invoke: {
				src: "createOrg",
				input: ({ context }) => ({
					name: context.orgName.trim(),
					slug: context.orgSlug.trim(),
				}),
				onDone: {
					target: "settingActiveOrg",
					actions: assign({
						createdOrgId: ({ event }) => event.output as string,
					}),
				},
				onError: {
					target: "createForm",
					actions: assign({
						error: ({ event }) =>
							(event.error as Error).message || "Failed to create organization",
					}),
				},
			},
		},

		joiningOrg: {
			invoke: {
				src: "joinOrg",
				input: ({ context }) => ({
					invitationId: context.inviteCode.trim(),
				}),
				onDone: {
					target: "settingActiveOrg",
					actions: assign({
						joinedOrgId: ({ event }) => event.output as string,
					}),
				},
				onError: {
					target: "joinForm",
					actions: assign({
						error: ({ event }) =>
							(event.error as Error).message || "Failed to join organization",
					}),
				},
			},
		},

		settingActiveOrg: {
			invoke: {
				src: "setActiveOrg",
				input: ({ context }) => ({
					organizationId: context.createdOrgId ?? context.joinedOrgId ?? "",
				}),
				onDone: {
					target: "redirecting",
				},
				onError: {
					target: "error",
					actions: assign({
						error: ({ event }) =>
							(event.error as Error).message ||
							"Team created but failed to activate. Please try again.",
					}),
				},
			},
		},

		error: {
			on: {
				RETRY: {
					target: "choice",
					actions: "clearError",
				},
			},
		},

		signingOut: {
			invoke: {
				src: "signOut",
				onDone: {
					target: "redirectingToSignIn",
				},
				onError: {
					target: "choice",
					actions: assign({
						error: () => "Failed to sign out. Please try again.",
					}),
				},
			},
		},

		redirectingToSignIn: {
			type: "final",
		},

		redirecting: {
			type: "final",
		},
	},
});

export type OnboardingMachine = typeof onboardingMachine;
