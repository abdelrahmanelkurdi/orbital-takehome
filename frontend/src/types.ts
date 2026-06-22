export interface Conversation {
	id: string;
	title: string;
	created_at: string;
	updated_at: string;
	document_count: number;
}

export interface CitedDocument {
	document_id: string;
	citation_count: number;
}

export interface Message {
	id: string;
	conversation_id: string;
	role: "user" | "assistant" | "system";
	content: string;
	sources_cited: number;
	cited_documents?: CitedDocument[];
	created_at: string;
}

export interface DocumentSummary {
	id: string;
	filename: string;
	page_count: number;
	uploaded_at: string;
	token_count: number;
	has_extracted_text: boolean;
}

export interface Document extends DocumentSummary {
	conversation_id: string;
}

export interface ConversationDetail extends Conversation {
	documents: DocumentSummary[];
}

export interface ContextUsageDocumentItem {
	id: string;
	filename: string;
	tokens: number;
}

export interface ContextUsageCategory {
	key: "system" | "history" | "documents" | "overhead";
	label: string;
	tokens: number;
	items?: ContextUsageDocumentItem[];
}

export interface ContextUsage {
	model: string;
	context_window: number;
	reserved_output: number;
	categories: ContextUsageCategory[];
	used_tokens: number;
	used_fraction: number;
}
