import type {
	ContextUsage,
	Conversation,
	ConversationDetail,
	Document,
	Message,
} from "../types";

const BASE = "/api";

const STARTUP_RETRY_ATTEMPTS = 12;
const STARTUP_RETRY_DELAY_MS = 500;

function isRetriableFetchError(err: unknown): boolean {
	if (err instanceof TypeError) return true;
	if (err instanceof Error) {
		return /^API error (502|503|504):/.test(err.message);
	}
	return false;
}

async function withStartupRetry<T>(fn: () => Promise<T>): Promise<T> {
	let lastError: unknown;
	for (let attempt = 0; attempt < STARTUP_RETRY_ATTEMPTS; attempt++) {
		try {
			return await fn();
		} catch (err) {
			lastError = err;
			const hasRetriesLeft = attempt < STARTUP_RETRY_ATTEMPTS - 1;
			if (!hasRetriesLeft || !isRetriableFetchError(err)) {
				throw err;
			}
			await new Promise((resolve) => {
				setTimeout(resolve, STARTUP_RETRY_DELAY_MS * (attempt + 1));
			});
		}
	}
	throw lastError;
}

async function handleResponse<T>(response: Response): Promise<T> {
	if (!response.ok) {
		const text = await response.text().catch(() => "Unknown error");
		throw new Error(`API error ${response.status}: ${text}`);
	}
	return response.json() as Promise<T>;
}

export async function fetchConversations(): Promise<Conversation[]> {
	return withStartupRetry(async () => {
		const res = await fetch(`${BASE}/conversations`);
		return handleResponse<Conversation[]>(res);
	});
}

export async function createConversation(): Promise<Conversation> {
	const res = await fetch(`${BASE}/conversations`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ title: "New conversation" }),
	});
	return handleResponse<Conversation>(res);
}

export async function deleteConversation(id: string): Promise<void> {
	const res = await fetch(`${BASE}/conversations/${id}`, {
		method: "DELETE",
	});
	if (!res.ok) {
		const text = await res.text().catch(() => "Unknown error");
		throw new Error(`API error ${res.status}: ${text}`);
	}
}

export async function fetchConversation(
	id: string,
): Promise<ConversationDetail> {
	const res = await fetch(`${BASE}/conversations/${id}`);
	return handleResponse<ConversationDetail>(res);
}

export async function fetchMessages(
	conversationId: string,
): Promise<Message[]> {
	const res = await fetch(`${BASE}/conversations/${conversationId}/messages`);
	return handleResponse<Message[]>(res);
}

export async function sendMessage(
	conversationId: string,
	content: string,
): Promise<Response> {
	const res = await fetch(`${BASE}/conversations/${conversationId}/messages`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ content }),
	});
	if (!res.ok) {
		const text = await res.text().catch(() => "Unknown error");
		throw new Error(`API error ${res.status}: ${text}`);
	}
	return res;
}

export async function listDocuments(
	conversationId: string,
): Promise<Document[]> {
	const res = await fetch(`${BASE}/conversations/${conversationId}/documents`);
	return handleResponse<Document[]>(res);
}

export async function uploadDocument(
	conversationId: string,
	file: File,
): Promise<Document> {
	const formData = new FormData();
	formData.append("file", file);
	const res = await fetch(`${BASE}/conversations/${conversationId}/documents`, {
		method: "POST",
		body: formData,
	});
	return handleResponse<Document>(res);
}

/** Upload multiple files sequentially; one failure does not abort the rest. */
export async function uploadDocuments(
	conversationId: string,
	files: File[],
): Promise<{ uploaded: Document[]; errors: { file: File; error: Error }[] }> {
	const uploaded: Document[] = [];
	const errors: { file: File; error: Error }[] = [];

	for (const file of files) {
		try {
			uploaded.push(await uploadDocument(conversationId, file));
		} catch (err) {
			errors.push({
				file,
				error: err instanceof Error ? err : new Error("Upload failed"),
			});
		}
	}

	return { uploaded, errors };
}

export async function deleteDocument(documentId: string): Promise<void> {
	const res = await fetch(`${BASE}/documents/${documentId}`, {
		method: "DELETE",
	});
	if (!res.ok) {
		const text = await res.text().catch(() => "Unknown error");
		throw new Error(`API error ${res.status}: ${text}`);
	}
}

export async function fetchContextUsage(
	conversationId: string,
): Promise<ContextUsage> {
	const res = await fetch(
		`${BASE}/conversations/${conversationId}/context-usage`,
	);
	return handleResponse<ContextUsage>(res);
}

export function getDocumentUrl(documentId: string): string {
	return `${BASE}/documents/${documentId}/content`;
}

export async function resolveCitationPage(
	documentId: string,
	params: {
		page?: number | null;
		label?: string;
		quote?: string | null;
	},
): Promise<number | null> {
	const search = new URLSearchParams();
	if (params.page != null) {
		search.set("page", String(params.page));
	}
	if (params.label) {
		search.set("label", params.label);
	}
	if (params.quote) {
		search.set("quote", params.quote);
	}
	const query = search.toString();
	const res = await fetch(
		`${BASE}/documents/${documentId}/citation-page${query ? `?${query}` : ""}`,
	);
	const body = await handleResponse<{ page: number | null }>(res);
	return body.page;
}
