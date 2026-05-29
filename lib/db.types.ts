export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      analysis_versions: {
        Row: {
          data_type: string
          delta_summary: Json
          id: string
          is_daily_rollup: boolean
          payload: Json
          project_id: string
          snapshot_at: string
          trigger: string
        }
        Insert: {
          data_type: string
          delta_summary?: Json
          id?: string
          is_daily_rollup?: boolean
          payload: Json
          project_id: string
          snapshot_at?: string
          trigger?: string
        }
        Update: {
          data_type?: string
          delta_summary?: Json
          id?: string
          is_daily_rollup?: boolean
          payload?: Json
          project_id?: string
          snapshot_at?: string
          trigger?: string
        }
        Relationships: [
          {
            foreignKeyName: "analysis_versions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "analysis_versions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_project_caps"
            referencedColumns: ["project_id"]
          },
        ]
      }
      change_report_recipients: {
        Row: {
          added_by: string | null
          created_at: string
          email: string
          id: string
          last_sent_at: string | null
          name: string | null
          paused: boolean
          project_id: string
        }
        Insert: {
          added_by?: string | null
          created_at?: string
          email: string
          id?: string
          last_sent_at?: string | null
          name?: string | null
          paused?: boolean
          project_id: string
        }
        Update: {
          added_by?: string | null
          created_at?: string
          email?: string
          id?: string
          last_sent_at?: string | null
          name?: string | null
          paused?: boolean
          project_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "change_report_recipients_added_by_fkey"
            columns: ["added_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "change_report_recipients_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "change_report_recipients_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_project_caps"
            referencedColumns: ["project_id"]
          },
        ]
      }
      chat_message_attachments: {
        Row: {
          created_at: string
          height_px: number | null
          id: string
          message_id: string
          mime: string
          name: string
          path: string
          size: number
          width_px: number | null
        }
        Insert: {
          created_at?: string
          height_px?: number | null
          id?: string
          message_id: string
          mime: string
          name: string
          path: string
          size: number
          width_px?: number | null
        }
        Update: {
          created_at?: string
          height_px?: number | null
          id?: string
          message_id?: string
          mime?: string
          name?: string
          path?: string
          size?: number
          width_px?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "chat_message_attachments_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "chat_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_messages: {
        Row: {
          author_id: string
          body: string
          created_at: string
          edited_at: string | null
          id: string
          mentions: string[]
          project_id: string
        }
        Insert: {
          author_id: string
          body: string
          created_at?: string
          edited_at?: string | null
          id?: string
          mentions?: string[]
          project_id: string
        }
        Update: {
          author_id?: string
          body?: string
          created_at?: string
          edited_at?: string | null
          id?: string
          mentions?: string[]
          project_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_messages_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_messages_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_project_caps"
            referencedColumns: ["project_id"]
          },
        ]
      }
      dashboard_cache: {
        Row: {
          computed_at: string
          data_type: string
          payload: Json
          project_id: string
        }
        Insert: {
          computed_at?: string
          data_type: string
          payload: Json
          project_id: string
        }
        Update: {
          computed_at?: string
          data_type?: string
          payload?: Json
          project_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "dashboard_cache_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dashboard_cache_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_project_caps"
            referencedColumns: ["project_id"]
          },
        ]
      }
      guest_sessions: {
        Row: {
          code: string
          expires_at: string
          id: string
          issued_at: string
          issued_by: string | null
          label: string | null
          project_id: string
          revoked_at: string | null
        }
        Insert: {
          code: string
          expires_at?: string
          id?: string
          issued_at?: string
          issued_by?: string | null
          label?: string | null
          project_id: string
          revoked_at?: string | null
        }
        Update: {
          code?: string
          expires_at?: string
          id?: string
          issued_at?: string
          issued_by?: string | null
          label?: string | null
          project_id?: string
          revoked_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "guest_sessions_issued_by_fkey"
            columns: ["issued_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guest_sessions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_prefs: {
        Row: {
          email_caps: boolean
          email_digest: boolean
          email_invites: boolean
          email_role: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          email_caps?: boolean
          email_digest?: boolean
          email_invites?: boolean
          email_role?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          email_caps?: boolean
          email_digest?: boolean
          email_invites?: boolean
          email_role?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_prefs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      point_photos: {
        Row: {
          height_px: number | null
          id: string
          point_id: string
          storage_path: string
          uploaded_at: string
          uploaded_by: string | null
          width_px: number | null
        }
        Insert: {
          height_px?: number | null
          id?: string
          point_id: string
          storage_path: string
          uploaded_at?: string
          uploaded_by?: string | null
          width_px?: number | null
        }
        Update: {
          height_px?: number | null
          id?: string
          point_id?: string
          storage_path?: string
          uploaded_at?: string
          uploaded_by?: string | null
          width_px?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "point_photos_point_id_fkey"
            columns: ["point_id"]
            isOneToOne: false
            referencedRelation: "points"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "point_photos_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      points: {
        Row: {
          accuracy_m: number | null
          address: string | null
          client_id: string
          collected_at: string
          collector_id: string | null
          created_at: string
          geocode_source: string | null
          geocoded_at: string | null
          guest_session_id: string | null
          id: string
          is_offline_sync: boolean
          lat: number
          lon: number
          matched_response_id: string | null
          notes: string | null
          project_id: string
          status_id: string
          updated_at: string
        }
        Insert: {
          accuracy_m?: number | null
          address?: string | null
          client_id: string
          collected_at?: string
          collector_id?: string | null
          created_at?: string
          geocode_source?: string | null
          geocoded_at?: string | null
          guest_session_id?: string | null
          id?: string
          is_offline_sync?: boolean
          lat: number
          lon: number
          matched_response_id?: string | null
          notes?: string | null
          project_id: string
          status_id: string
          updated_at?: string
        }
        Update: {
          accuracy_m?: number | null
          address?: string | null
          client_id?: string
          collected_at?: string
          collector_id?: string | null
          created_at?: string
          geocode_source?: string | null
          geocoded_at?: string | null
          guest_session_id?: string | null
          id?: string
          is_offline_sync?: boolean
          lat?: number
          lon?: number
          matched_response_id?: string | null
          notes?: string | null
          project_id?: string
          status_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_points_matched_response"
            columns: ["matched_response_id"]
            isOneToOne: false
            referencedRelation: "survey_responses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "points_collector_id_fkey"
            columns: ["collector_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "points_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "points_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_project_caps"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "points_status_id_fkey"
            columns: ["status_id"]
            isOneToOne: false
            referencedRelation: "project_statuses"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          email: string
          id: string
          last_export_at: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          email: string
          id: string
          last_export_at?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          email?: string
          id?: string
          last_export_at?: string | null
        }
        Relationships: []
      }
      project_invites: {
        Row: {
          accepted_at: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string
          project_id: string
          role: string
          token: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by: string
          project_id: string
          role: string
          token?: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string
          project_id?: string
          role?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_invites_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_invites_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_invites_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_project_caps"
            referencedColumns: ["project_id"]
          },
        ]
      }
      project_members: {
        Row: {
          joined_at: string
          project_id: string
          role: string
          user_id: string
        }
        Insert: {
          joined_at?: string
          project_id: string
          role: string
          user_id: string
        }
        Update: {
          joined_at?: string
          project_id?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_members_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_members_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_project_caps"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "project_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      project_settings: {
        Row: {
          canvass_mode: boolean
          external_id_column: string | null
          external_survey_url: string | null
          geocoder: string
          match_radius_m: number
          project_id: string
          qualtrics_match_field: string | null
          qualtrics_survey_id: string | null
          response_address_column: string | null
          symbology_overrides: Json
          trust_response_geo: boolean
          updated_at: string
        }
        Insert: {
          canvass_mode?: boolean
          external_id_column?: string | null
          external_survey_url?: string | null
          geocoder?: string
          match_radius_m?: number
          project_id: string
          qualtrics_match_field?: string | null
          qualtrics_survey_id?: string | null
          response_address_column?: string | null
          symbology_overrides?: Json
          trust_response_geo?: boolean
          updated_at?: string
        }
        Update: {
          canvass_mode?: boolean
          external_id_column?: string | null
          external_survey_url?: string | null
          geocoder?: string
          match_radius_m?: number
          project_id?: string
          qualtrics_match_field?: string | null
          qualtrics_survey_id?: string | null
          response_address_column?: string | null
          symbology_overrides?: Json
          trust_response_geo?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_settings_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_settings_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
            referencedRelation: "v_project_caps"
            referencedColumns: ["project_id"]
          },
        ]
      }
      project_statuses: {
        Row: {
          color: string
          icon: string | null
          id: string
          is_default: boolean
          label: string
          project_id: string
          sort_order: number
        }
        Insert: {
          color: string
          icon?: string | null
          id?: string
          is_default?: boolean
          label: string
          project_id: string
          sort_order?: number
        }
        Update: {
          color?: string
          icon?: string | null
          id?: string
          is_default?: boolean
          label?: string
          project_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "project_statuses_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_statuses_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_project_caps"
            referencedColumns: ["project_id"]
          },
        ]
      }
      projects: {
        Row: {
          archived: boolean
          center_lat: number
          center_lon: number
          created_at: string
          default_zoom: number
          description: string | null
          id: string
          name: string
          owner_id: string
          updated_at: string
          visibility: string
        }
        Insert: {
          archived?: boolean
          center_lat: number
          center_lon: number
          created_at?: string
          default_zoom?: number
          description?: string | null
          id?: string
          name: string
          owner_id: string
          updated_at?: string
          visibility?: string
        }
        Update: {
          archived?: boolean
          center_lat?: number
          center_lon?: number
          created_at?: string
          default_zoom?: number
          description?: string | null
          id?: string
          name?: string
          owner_id?: string
          updated_at?: string
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      survey_imports: {
        Row: {
          address_column: string | null
          ambiguous_count: number
          completed_at: string | null
          created_at: string
          created_by: string | null
          error_message: string | null
          external_id_column: string | null
          field_only_count: number
          filename: string
          id: string
          matched_count: number
          project_id: string
          response_only_count: number
          row_count: number
          status: string
        }
        Insert: {
          address_column?: string | null
          ambiguous_count?: number
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          error_message?: string | null
          external_id_column?: string | null
          field_only_count?: number
          filename: string
          id?: string
          matched_count?: number
          project_id: string
          response_only_count?: number
          row_count?: number
          status: string
        }
        Update: {
          address_column?: string | null
          ambiguous_count?: number
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          error_message?: string | null
          external_id_column?: string | null
          field_only_count?: number
          filename?: string
          id?: string
          matched_count?: number
          project_id?: string
          response_only_count?: number
          row_count?: number
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "survey_imports_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "survey_imports_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "survey_imports_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_project_caps"
            referencedColumns: ["project_id"]
          },
        ]
      }
      survey_responses: {
        Row: {
          address_used: string | null
          external_id: string | null
          geocode_source: string | null
          geocoded_lat: number | null
          geocoded_lon: number | null
          id: string
          imported_at: string
          imported_by: string | null
          match_distance_m: number | null
          matched_at: string | null
          point_id: string | null
          project_id: string
          raw_data: Json
          source: string
        }
        Insert: {
          address_used?: string | null
          external_id?: string | null
          geocode_source?: string | null
          geocoded_lat?: number | null
          geocoded_lon?: number | null
          id?: string
          imported_at?: string
          imported_by?: string | null
          match_distance_m?: number | null
          matched_at?: string | null
          point_id?: string | null
          project_id: string
          raw_data: Json
          source: string
        }
        Update: {
          address_used?: string | null
          external_id?: string | null
          geocode_source?: string | null
          geocoded_lat?: number | null
          geocoded_lon?: number | null
          id?: string
          imported_at?: string
          imported_by?: string | null
          match_distance_m?: number | null
          matched_at?: string | null
          point_id?: string | null
          project_id?: string
          raw_data?: Json
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "survey_responses_imported_by_fkey"
            columns: ["imported_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "survey_responses_point_id_fkey"
            columns: ["point_id"]
            isOneToOne: false
            referencedRelation: "points"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "survey_responses_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "survey_responses_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_project_caps"
            referencedColumns: ["project_id"]
          },
        ]
      }
      survey_universe: {
        Row: {
          address: string
          created_at: string
          external_id: string | null
          id: string
          lat: number | null
          lon: number | null
          point_id: string | null
          project_id: string
          raw_data: Json
          status: string
          updated_at: string
          visited_at: string | null
          visited_by: string | null
        }
        Insert: {
          address: string
          created_at?: string
          external_id?: string | null
          id?: string
          lat?: number | null
          lon?: number | null
          point_id?: string | null
          project_id: string
          raw_data?: Json
          status?: string
          updated_at?: string
          visited_at?: string | null
          visited_by?: string | null
        }
        Update: {
          address?: string
          created_at?: string
          external_id?: string | null
          id?: string
          lat?: number | null
          lon?: number | null
          point_id?: string | null
          project_id?: string
          raw_data?: Json
          status?: string
          updated_at?: string
          visited_at?: string | null
          visited_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "survey_universe_point_id_fkey"
            columns: ["point_id"]
            isOneToOne: false
            referencedRelation: "points"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "survey_universe_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "survey_universe_visited_by_fkey"
            columns: ["visited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      system_limits: {
        Row: {
          id: number
          max_pending_invites: number
          max_photo_bytes_per_project: number
          max_points_per_project: number
          max_projects_per_user: number
          updated_at: string
          warn_at_pct: number
        }
        Insert: {
          id?: number
          max_pending_invites?: number
          max_photo_bytes_per_project?: number
          max_points_per_project?: number
          max_projects_per_user?: number
          updated_at?: string
          warn_at_pct?: number
        }
        Update: {
          id?: number
          max_pending_invites?: number
          max_photo_bytes_per_project?: number
          max_points_per_project?: number
          max_projects_per_user?: number
          updated_at?: string
          warn_at_pct?: number
        }
        Relationships: []
      }
    }
    Views: {
      v_match_status: {
        Row: {
          collected_at: string | null
          is_matched: boolean | null
          lat: number | null
          lon: number | null
          match_status: string | null
          point_id: string | null
          project_id: string | null
          response_id: string | null
          status_id: string | null
          status_label: string | null
        }
        Relationships: []
      }
      v_match_status_counts: {
        Row: {
          f1_count: number | null
          m1_count: number | null
          project_id: string | null
          r1_count: number | null
          total_with_status: number | null
        }
        Relationships: []
      }
      v_project_caps: {
        Row: {
          max_pending_invites: number | null
          max_points_per_project: number | null
          pending_invites: number | null
          points_count: number | null
          project_id: string | null
          warn_at_pct: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      accept_invite: { Args: { p_token: string }; Returns: string }
      is_project_member: { Args: { p_project: string }; Returns: boolean }
      is_public_project: { Args: { p_project: string }; Returns: boolean }
      project_role: { Args: { p_project: string }; Returns: string }
      prune_analysis_versions: {
        Args: { p_project_id: string }
        Returns: undefined
      }
      validate_guest_code: {
        Args: { p_code: string }
        Returns: Array<{
          session_id: string
          project_id: string
          expires_at: string
        }>
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
