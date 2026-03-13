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
  case_profile_id?: string;
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
  case_profile_id?: string;
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

// --- CaseProfile ---
export interface CaseProfile {
  id: string;
  org_id: string;
  id_number: string;
  name: string;
  supervisor?: string;
  gender?: string;
  service_status?: string;
  phone?: string;
  address?: string;
  district?: string;
  road?: string;
  created_at: string;
  updated_at: string;
}

export interface CaseProfileCreate {
  id_number: string;
  name: string;
  supervisor?: string;
  gender?: string;
  service_status?: string;
  phone?: string;
  address?: string;
  district?: string;
  road?: string;
}

export interface CaseProfileUpdate {
  name?: string;
  supervisor?: string;
  gender?: string;
  service_status?: string;
  phone?: string;
  address?: string;
  district?: string;
  road?: string;
}

export interface ImportPreviewRow {
  id_number: string;
  name: string;
  supervisor?: string;
  gender?: string;
  service_status?: string;
  phone?: string;
  address?: string;
  district?: string;
  road?: string;
  action: "create" | "update";
}

export interface ImportPreviewResponse {
  rows: ImportPreviewRow[];
  create_count: number;
  update_count: number;
  error_rows: { name: string; reason: string }[];
}

export interface ImportConfirmResponse {
  created: number;
  updated: number;
  errors: number;
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

// --- Schedule & Compliance ---
export type ComplianceStatus = "ok" | "pending" | "due_soon" | "overdue";

export interface VisitSchedule {
  id: string;
  case_profile_id: string;
  preferred_day_of_month?: number | null;
  reminder_enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface VisitComplianceDetail {
  status: ComplianceStatus;
  last_date?: string | null;
  due_by?: string | null;
}

export interface CaseComplianceItem {
  case_profile_id: string;
  case_name: string;
  id_number: string;
  supervisor?: string | null;
  phone_compliance: VisitComplianceDetail;
  home_compliance: VisitComplianceDetail;
  overall_status: ComplianceStatus;
  schedule?: VisitSchedule | null;
}

export interface ComplianceSummary {
  ok: number;
  due_soon: number;
  overdue: number;
  total: number;
}

export interface VisitScheduleUpsert {
  preferred_day_of_month?: number | null;
  reminder_enabled: boolean;
}

export interface ComplianceListParams {
  page?: number;
  page_size?: number;
  search?: string;
  status_filter?: ComplianceStatus;
}

// --- AI ---
export type ToneStyle = "professional" | "warm" | "concise" | "detailed";

export interface RefineParams {
  text: string;
  format: "bullet" | "narrative";
  visit_type: "home" | "phone";
  tone?: ToneStyle;
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

export interface RefineSectionParams {
  section_html: string;
  context?: string;
  format: "bullet" | "narrative";
  visit_type: "home" | "phone";
  tone?: ToneStyle;
}

export interface RefineSectionResult {
  refined_html: string;
  tokens_used: number;
}
