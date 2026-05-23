export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  __InternalSupabase: { PostgrestVersion: "14.5" }
  public: {
    Tables: {
      point_photos: { Row: { height_px: number | null; id: string; point_id: string; storage_path: string; uploaded_at: string; uploaded_by: string | null; width_px: number | null }; Insert: { height_px?: number | null; id?: string; point_id: string; storage_path: string; uploaded_at?: string; uploaded_by?: string | null; width_px?: number | null }; Update: { height_px?: number | null; id?: string; point_id?: string; storage_path?: string; uploaded_at?: string; uploaded_by?: string | null; width_px?: number | null }; Relationships: [] }
      points: { Row: { accuracy_m: number | null; address: string | null; client_id: string; collected_at: string; collector_id: string | null; created_at: string; geocode_source: string | null; geocoded_at: string | null; id: string; is_offline_sync: boolean; lat: number; lon: number; matched_response_id: string | null; notes: string | null; project_id: string; status_id: string; updated_at: string }; Insert: { accuracy_m?: number | null; address?: string | null; client_id: string; collected_at?: string; collector_id?: string | null; created_at?: string; geocode_source?: string | null; geocoded_at?: string | null; id?: string; is_offline_sync?: boolean; lat: number; lon: number; matched_response_id?: string | null; notes?: string | null; project_id: string; status_id: string; updated_at?: string }; Update: Partial<{ accuracy_m: number | null; address: string | null; client_id: string; collected_at: string; collector_id: string | null; created_at: string; geocode_source: string | null; geocoded_at: string | null; id: string; is_offline_sync: boolean; lat: number; lon: number; matched_response_id: string | null; notes: string | null; project_id: string; status_id: string; updated_at: string }>; Relationships: [] }
      profiles: { Row: { avatar_url: string | null; created_at: string; display_name: string | null; email: string; id: string }; Insert: { avatar_url?: string | null; created_at?: string; display_name?: string | null; email: string; id: string }; Update: Partial<{ avatar_url: string | null; created_at: string; display_name: string | null; email: string; id: string }>; Relationships: [] }
      project_invites: { Row: { accepted_at: string | null; created_at: string; email: string; expires_at: string; id: string; invited_by: string; project_id: string; role: string; token: string }; Insert: { accepted_at?: string | null; created_at?: string; email: string; expires_at?: string; id?: string; invited_by: string; project_id: string; role: string; token?: string }; Update: Partial<{ accepted_at: string | null; created_at: string; email: string; expires_at: string; id: string; invited_by: string; project_id: string; role: string; token: string }>; Relationships: [] }
      project_members: { Row: { joined_at: string; project_id: string; role: string; user_id: string }; Insert: { joined_at?: string; project_id: string; role: string; user_id: string }; Update: Partial<{ joined_at: string; project_id: string; role: string; user_id: string }>; Relationships: [] }
      project_settings: { Row: { external_id_column: string | null; external_survey_url: string | null; geocoder: string; match_radius_m: number; project_id: string; qualtrics_match_field: string | null; qualtrics_survey_id: string | null; response_address_column: string | null; trust_response_geo: boolean; updated_at: string }; Insert: { external_id_column?: string | null; external_survey_url?: string | null; geocoder?: string; match_radius_m?: number; project_id: string; qualtrics_match_field?: string | null; qualtrics_survey_id?: string | null; response_address_column?: string | null; trust_response_geo?: boolean; updated_at?: string }; Update: Partial<{ external_id_column: string | null; external_survey_url: string | null; geocoder: string; match_radius_m: number; project_id: string; qualtrics_match_field: string | null; qualtrics_survey_id: string | null; response_address_column: string | null; trust_response_geo: boolean; updated_at: string }>; Relationships: [] }
      project_statuses: { Row: { color: string; icon: string | null; id: string; is_default: boolean; label: string; project_id: string; sort_order: number }; Insert: { color: string; icon?: string | null; id?: string; is_default?: boolean; label: string; project_id: string; sort_order?: number }; Update: Partial<{ color: string; icon: string | null; id: string; is_default: boolean; label: string; project_id: string; sort_order: number }>; Relationships: [] }
      projects: { Row: { archived: boolean; center_lat: number; center_lon: number; created_at: string; default_zoom: number; description: string | null; id: string; name: string; owner_id: string; updated_at: string; visibility: string }; Insert: { archived?: boolean; center_lat: number; center_lon: number; created_at?: string; default_zoom?: number; description?: string | null; id?: string; name: string; owner_id: string; updated_at?: string; visibility?: string }; Update: Partial<{ archived: boolean; center_lat: number; center_lon: number; created_at: string; default_zoom: number; description: string | null; id: string; name: string; owner_id: string; updated_at: string; visibility: string }>; Relationships: [] }
      survey_imports: { Row: { address_column: string | null; ambiguous_count: number; completed_at: string | null; created_at: string; created_by: string | null; error_message: string | null; external_id_column: string | null; field_only_count: number; filename: string; id: string; matched_count: number; project_id: string; response_only_count: number; row_count: number; status: string }; Insert: { address_column?: string | null; ambiguous_count?: number; completed_at?: string | null; created_at?: string; created_by?: string | null; error_message?: string | null; external_id_column?: string | null; field_only_count?: number; filename: string; id?: string; matched_count?: number; project_id: string; response_only_count?: number; row_count?: number; status: string }; Update: Partial<{ address_column: string | null; ambiguous_count: number; completed_at: string | null; created_at: string; created_by: string | null; error_message: string | null; external_id_column: string | null; field_only_count: number; filename: string; id: string; matched_count: number; project_id: string; response_only_count: number; row_count: number; status: string }>; Relationships: [] }
      survey_responses: { Row: { address_used: string | null; external_id: string | null; geocode_source: string | null; geocoded_lat: number | null; geocoded_lon: number | null; id: string; imported_at: string; imported_by: string | null; match_distance_m: number | null; matched_at: string | null; point_id: string | null; project_id: string; raw_data: Json; source: string }; Insert: { address_used?: string | null; external_id?: string | null; geocode_source?: string | null; geocoded_lat?: number | null; geocoded_lon?: number | null; id?: string; imported_at?: string; imported_by?: string | null; match_distance_m?: number | null; matched_at?: string | null; point_id?: string | null; project_id: string; raw_data: Json; source: string }; Update: Partial<{ address_used: string | null; external_id: string | null; geocode_source: string | null; geocoded_lat: number | null; geocoded_lon: number | null; id: string; imported_at: string; imported_by: string | null; match_distance_m: number | null; matched_at: string | null; point_id: string | null; project_id: string; raw_data: Json; source: string }>; Relationships: [] }
    }
    Views: {
      v_match_status: { Row: { is_matched: boolean | null; lat: number | null; lon: number | null; match_status: string | null; point_id: string | null; project_id: string | null; response_id: string | null; status_id: string | null; status_label: string | null }; Relationships: [] }
      v_match_status_counts: { Row: { f1_count: number | null; m1_count: number | null; project_id: string | null; r1_count: number | null; total_with_status: number | null }; Relationships: [] }
    }
    Functions: {
      accept_invite: { Args: { p_token: string }; Returns: string }
      is_project_member: { Args: { p_project: string }; Returns: boolean }
      is_public_project: { Args: { p_project: string }; Returns: boolean }
      project_role: { Args: { p_project: string }; Returns: string }
    }
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">
type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<T extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])> =
  (DefaultSchema["Tables"] & DefaultSchema["Views"])[T] extends { Row: infer R } ? R : never
export type TablesInsert<T extends keyof DefaultSchema["Tables"]> =
  DefaultSchema["Tables"][T] extends { Insert: infer I } ? I : never
export type TablesUpdate<T extends keyof DefaultSchema["Tables"]> =
  DefaultSchema["Tables"][T] extends { Update: infer U } ? U : never
