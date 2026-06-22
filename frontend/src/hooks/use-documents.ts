import { useCallback, useEffect, useMemo, useState } from "react";
import * as api from "../lib/api";
import type { Document } from "../types";

function pickActiveId(
	documents: Document[],
	current: string | null,
): string | null {
	if (current && documents.some((doc) => doc.id === current)) {
		return current;
	}
	return documents[0]?.id ?? null;
}

export interface UploadQueueItem {
	key: string;
	filename: string;
	status: "pending" | "uploading" | "success" | "error";
	error?: string;
}

export function useDocuments(conversationId: string | null) {
	const [documents, setDocuments] = useState<Document[]>([]);
	const [activeDocumentId, setActiveDocumentId] = useState<string | null>(null);
	const [uploading, setUploading] = useState(false);
	const [uploadQueue, setUploadQueue] = useState<UploadQueueItem[]>([]);
	const [error, setError] = useState<string | null>(null);

	const refresh = useCallback(async () => {
		if (!conversationId) {
			setDocuments([]);
			setActiveDocumentId(null);
			return;
		}
		try {
			setError(null);
			const docs = await api.listDocuments(conversationId);
			setDocuments(docs);
			setActiveDocumentId((current) => pickActiveId(docs, current));
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to load documents");
		}
	}, [conversationId]);

	useEffect(() => {
		setActiveDocumentId(null);
		refresh();
	}, [refresh]);

	const upload = useCallback(
		async (files: File | File[]) => {
			if (!conversationId) return { uploaded: [], errors: [] };

			const batch = Array.isArray(files) ? files : [files];
			if (batch.length === 0) return { uploaded: [], errors: [] };

			const queue: UploadQueueItem[] = batch.map((file, index) => ({
				key: `${file.name}-${file.lastModified}-${index}`,
				filename: file.name,
				status: "pending",
			}));

			try {
				setUploading(true);
				setError(null);
				setUploadQueue(queue);

				const uploaded: Document[] = [];
				const errors: { file: File; error: Error }[] = [];

				for (const [index, file] of batch.entries()) {
					setUploadQueue((prev) =>
						prev.map((item, itemIndex) =>
							itemIndex === index ? { ...item, status: "uploading" } : item,
						),
					);

					try {
						const doc = await api.uploadDocument(conversationId, file);
						uploaded.push(doc);
						setUploadQueue((prev) =>
							prev.map((item, itemIndex) =>
								itemIndex === index ? { ...item, status: "success" } : item,
							),
						);
					} catch (err) {
						const message =
							err instanceof Error ? err.message : "Upload failed";
						errors.push({
							file,
							error: err instanceof Error ? err : new Error(message),
						});
						setUploadQueue((prev) =>
							prev.map((item, itemIndex) =>
								itemIndex === index
									? { ...item, status: "error", error: message }
									: item,
							),
						);
					}
				}

				if (uploaded.length > 0) {
					setDocuments((prev) => [...prev, ...uploaded]);
					setActiveDocumentId((current) => current ?? uploaded[0]?.id ?? null);
				}

				if (errors.length > 0 && uploaded.length === 0) {
					setError(errors[0]?.error.message ?? "Failed to upload document");
				}

				return { uploaded, errors };
			} catch (err) {
				const message =
					err instanceof Error ? err.message : "Failed to upload document";
				setError(message);
				return {
					uploaded: [],
					errors: [{ file: batch[0], error: new Error(message) }],
				};
			} finally {
				setUploading(false);
				setUploadQueue((prev) =>
					prev.filter((item) => item.status === "error"),
				);
			}
		},
		[conversationId],
	);

	const remove = useCallback(
		async (documentId: string) => {
			if (!conversationId) return false;

			try {
				setError(null);
				await api.deleteDocument(documentId);
				setDocuments((prev) => {
					const next = prev.filter((doc) => doc.id !== documentId);
					setActiveDocumentId((current) => pickActiveId(next, current));
					return next;
				});
				return true;
			} catch (err) {
				setError(
					err instanceof Error ? err.message : "Failed to remove document",
				);
				return false;
			}
		},
		[conversationId],
	);

	const activeDocument = useMemo(
		() => documents.find((doc) => doc.id === activeDocumentId) ?? null,
		[documents, activeDocumentId],
	);

	return {
		documents,
		activeDocumentId,
		activeDocument,
		setActiveDocument: setActiveDocumentId,
		uploading,
		uploadQueue,
		error,
		upload,
		remove,
		refresh,
		hasDocuments: documents.length > 0,
	};
}
