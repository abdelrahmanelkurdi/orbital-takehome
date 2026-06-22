import { useCallback, useEffect, useRef, useState } from "react";
import * as api from "../lib/api";
import type { Message } from "../types";

/** Session cache — revisiting a chat shows messages immediately while revalidating. */
const messageCache = new Map<string, Message[]>();

function readCache(conversationId: string): Message[] | undefined {
	return messageCache.get(conversationId);
}

function writeCache(conversationId: string, messages: Message[]) {
	messageCache.set(conversationId, messages);
}

export function useMessages(conversationId: string | null) {
	const [messages, setMessages] = useState<Message[]>([]);
	const [loading, setLoading] = useState(false);
	const [refreshing, setRefreshing] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [streaming, setStreaming] = useState(false);
	const [streamingContent, setStreamingContent] = useState("");
	const fetchGenerationRef = useRef(0);

	const applyMessages = useCallback((id: string, next: Message[]) => {
		writeCache(id, next);
		setMessages(next);
	}, []);

	const refresh = useCallback(async () => {
		if (!conversationId) {
			setMessages([]);
			setLoading(false);
			setRefreshing(false);
			return;
		}

		const cached = readCache(conversationId);
		if (cached !== undefined) {
			setMessages(cached);
			setLoading(false);
		} else {
			setLoading(true);
		}

		setRefreshing(true);
		setError(null);
		const generation = ++fetchGenerationRef.current;

		try {
			const data = await api.fetchMessages(conversationId);
			if (generation !== fetchGenerationRef.current) return;
			writeCache(conversationId, data);
			setMessages(data);
		} catch (err) {
			if (generation !== fetchGenerationRef.current) return;
			setError(err instanceof Error ? err.message : "Failed to load messages");
		} finally {
			if (generation === fetchGenerationRef.current) {
				setLoading(false);
				setRefreshing(false);
			}
		}
	}, [conversationId]);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	const send = useCallback(
		async (content: string) => {
			if (!conversationId || streaming) return;

			const userMessage: Message = {
				id: `temp-${Date.now()}`,
				conversation_id: conversationId,
				role: "user",
				content,
				sources_cited: 0,
				created_at: new Date().toISOString(),
			};

			setMessages((prev) => {
				const next = [...prev, userMessage];
				writeCache(conversationId, next);
				return next;
			});
			setStreaming(true);
			setStreamingContent("");
			setError(null);

			try {
				const response = await api.sendMessage(conversationId, content);

				if (!response.body) {
					throw new Error("No response body");
				}

				const reader = response.body.getReader();
				const decoder = new TextDecoder();
				let accumulated = "";
				let buffer = "";

				while (true) {
					const { done, value } = await reader.read();
					if (done) break;

					buffer += decoder.decode(value, { stream: true });
					const lines = buffer.split("\n");
					buffer = lines.pop() ?? "";

					for (const line of lines) {
						const trimmed = line.trim();
						if (!trimmed || !trimmed.startsWith("data: ")) continue;

						const data = trimmed.slice(6);
						if (data === "[DONE]") continue;

						try {
							const parsed = JSON.parse(data) as {
								type?: string;
								content?: string;
								delta?: string;
								message?: Message;
							};

							if (parsed.type === "delta" && parsed.delta) {
								accumulated += parsed.delta;
								setStreamingContent(accumulated);
							} else if (parsed.type === "content" && parsed.content) {
								accumulated += parsed.content;
								setStreamingContent(accumulated);
							} else if (parsed.type === "message" && parsed.message) {
								setMessages((prev) => {
									const next = [...prev, parsed.message as Message];
									writeCache(conversationId, next);
									return next;
								});
								accumulated = "";
							} else if (parsed.content && !parsed.type) {
								accumulated += parsed.content;
								setStreamingContent(accumulated);
							}
						} catch {
							// Skip invalid JSON lines
						}
					}
				}

				if (accumulated) {
					const assistantMessage: Message = {
						id: `stream-${Date.now()}`,
						conversation_id: conversationId,
						role: "assistant",
						content: accumulated,
						sources_cited: 0,
						created_at: new Date().toISOString(),
					};
					setMessages((prev) => {
						const next = [...prev, assistantMessage];
						writeCache(conversationId, next);
						return next;
					});
				}

				const freshMessages = await api.fetchMessages(conversationId);
				applyMessages(conversationId, freshMessages);
			} catch (err) {
				if (err instanceof DOMException && err.name === "AbortError") return;
				setError(err instanceof Error ? err.message : "Failed to send message");
			} finally {
				setStreaming(false);
				setStreamingContent("");
			}
		},
		[conversationId, streaming, applyMessages],
	);

	return {
		messages,
		loading,
		refreshing,
		error,
		streaming,
		streamingContent,
		send,
		refresh,
	};
}

/** Visible for tests only. */
export function clearMessageCacheForTests() {
	messageCache.clear();
}
