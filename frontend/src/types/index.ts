// --- Auth ---
export interface User {
  id: string;
  org_id: string;
  name: string;
  email: string;
  role: "admin" | "supervisor";
  avatar?: string;
  is_active: boolean;
  created_at: string;
}

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
}

export interface AccessTokenResponse {
  access_token: string;
  token_type: string;
}

export interface LoginFormValues {
  email: string;
  password: string;
}

// --- Generic ---
export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

// --- VisitRecord ---
export interface VisitRecord {
  id: string;
  case_name: string;
  org_name: string;
  user_id: string;
  user_name: string;
  visit_type: "home" | "phone";
  visit_date: string;
  raw_input: string;
  refined_content: string;
  output_format: "bullet" | "narrative";
  auto_refine: boolean;
  status: "draft" | "completed";
  created_at: string;
  updated_at: string;
}

export interface VisitRecordCreate {
  case_name: string;
  org_name: string;
  visit_type: "home" | "phone";
  visit_date: string;
  raw_input?: string;
  refined_content?: string;
  output_format?: "bullet" | "narrative";
  auto_refine?: boolean;
  status?: "draft" | "completed";
}

export interface VisitRecordUpdate {
  visit_date?: string;
  raw_input?: string;
  refined_content?: string;
  output_format?: string;
  auto_refine?: boolean;
  status?: string;
}

export interface RecordListParams {
  page?: number;
  page_size?: number;
  case_name?: string;
  visit_type?: string;
  status?: string;
  date_from?: string;
  date_to?: string;
  user_id?: string;
}

// --- Client Card ---
export interface ClientCard {
  case_name: string;
  org_name: string;
  record_count: number;
  last_visit_date: string;
}

export interface ClientListParams {
  page?: number;
  page_size?: number;
  search?: string;
}

export interface ClientRecordParams {
  case_name: string;
  org_name: string;
  page?: number;
  page_size?: number;
}

// --- AI ---
export interface RefineParams {
  text: string;
  format: "bullet" | "narrative";
  visit_type: "home" | "phone";
  record_id?: string;
}

export interface RefineResult {
  refined_text: string;
  tokens_used: number;
}

export interface TranscribeResult {
  text: string;
  duration: number;
}

export interface OcrResult {
  text: string;
}

export interface GapItem {
  section: string;
  hint: string;
}

export interface CheckGapsResult {
  gaps: GapItem[];
}
