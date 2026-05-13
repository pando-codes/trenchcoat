export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      api_keys: {
        Row: {
          created_at: string | null
          expires_at: string | null
          id: string
          key_hash: string
          key_prefix: string
          last_used_at: string | null
          name: string
          rate_limit_tier: string
          scopes: string[]
          user_id: string
        }
        Insert: {
          created_at?: string | null
          expires_at?: string | null
          id?: string
          key_hash: string
          key_prefix: string
          last_used_at?: string | null
          name: string
          rate_limit_tier?: string
          scopes?: string[]
          user_id: string
        }
        Update: {
          created_at?: string | null
          expires_at?: string | null
          id?: string
          key_hash?: string
          key_prefix?: string
          last_used_at?: string | null
          name?: string
          rate_limit_tier?: string
          scopes?: string[]
          user_id?: string
        }
        Relationships: []
      }
      daily_aggregates: {
        Row: {
          agent_calls: number | null
          created_at: string | null
          date: string
          events: number | null
          hourly_distribution: Json | null
          id: string
          input_tokens: number | null
          output_tokens: number | null
          sessions: number | null
          stop_reasons: Json | null
          tool_breakdown: Json | null
          tool_uses: number | null
          total_duration_ms: number | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          agent_calls?: number | null
          created_at?: string | null
          date: string
          events?: number | null
          hourly_distribution?: Json | null
          id?: string
          input_tokens?: number | null
          output_tokens?: number | null
          sessions?: number | null
          stop_reasons?: Json | null
          tool_breakdown?: Json | null
          tool_uses?: number | null
          total_duration_ms?: number | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          agent_calls?: number | null
          created_at?: string | null
          date?: string
          events?: number | null
          hourly_distribution?: Json | null
          id?: string
          input_tokens?: number | null
          output_tokens?: number | null
          sessions?: number | null
          stop_reasons?: Json | null
          tool_breakdown?: Json | null
          tool_uses?: number | null
          total_duration_ms?: number | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      events: {
        Row: {
          created_at: string
          data: Json | null
          duration_ms: number | null
          event_type: string
          id: string
          seq: number
          session_id: string
          timestamp: string
          tool_name: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          data?: Json | null
          duration_ms?: number | null
          event_type: string
          id?: string
          seq?: number
          session_id: string
          timestamp: string
          tool_name?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          data?: Json | null
          duration_ms?: number | null
          event_type?: string
          id?: string
          seq?: number
          session_id?: string
          timestamp?: string
          tool_name?: string | null
          user_id?: string
        }
        Relationships: []
      }
      model_pricing: {
        Row: {
          input_cost_per_1m: number
          model_id: string
          output_cost_per_1m: number
          updated_at: string | null
        }
        Insert: {
          input_cost_per_1m: number
          model_id: string
          output_cost_per_1m: number
          updated_at?: string | null
        }
        Update: {
          input_cost_per_1m?: number
          model_id?: string
          output_cost_per_1m?: number
          updated_at?: string | null
        }
        Relationships: []
      }
      sessions: {
        Row: {
          created_at: string | null
          duration_ms: number | null
          ended_at: string | null
          event_count: number | null
          git_branch: string | null
          id: string
          input_tokens: number | null
          model: string | null
          output_tokens: number | null
          session_id: string
          started_at: string
          stop_reason: string | null
          tool_count: number | null
          updated_at: string | null
          user_id: string
          working_directory: string | null
        }
        Insert: {
          created_at?: string | null
          duration_ms?: number | null
          ended_at?: string | null
          event_count?: number | null
          git_branch?: string | null
          id?: string
          input_tokens?: number | null
          model?: string | null
          output_tokens?: number | null
          session_id: string
          started_at: string
          stop_reason?: string | null
          tool_count?: number | null
          updated_at?: string | null
          user_id: string
          working_directory?: string | null
        }
        Update: {
          created_at?: string | null
          duration_ms?: number | null
          ended_at?: string | null
          event_count?: number | null
          git_branch?: string | null
          id?: string
          input_tokens?: number | null
          model?: string | null
          output_tokens?: number | null
          session_id?: string
          started_at?: string
          stop_reason?: string | null
          tool_count?: number | null
          updated_at?: string | null
          user_id?: string
          working_directory?: string | null
        }
        Relationships: []
      }
      team_invitations: {
        Row: {
          created_at: string | null
          email: string
          expires_at: string | null
          id: string
          invited_by: string
          role: string
          status: string
          team_id: string
        }
        Insert: {
          created_at?: string | null
          email: string
          expires_at?: string | null
          id?: string
          invited_by: string
          role?: string
          status?: string
          team_id: string
        }
        Update: {
          created_at?: string | null
          email?: string
          expires_at?: string | null
          id?: string
          invited_by?: string
          role?: string
          status?: string
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_invitations_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      team_members: {
        Row: {
          id: string
          joined_at: string | null
          role: string
          team_id: string
          user_id: string
        }
        Insert: {
          id?: string
          joined_at?: string | null
          role?: string
          team_id: string
          user_id: string
        }
        Update: {
          id?: string
          joined_at?: string | null
          role?: string
          team_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_members_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      team_shares: {
        Row: {
          created_at: string
          created_by: string
          date_from: string
          date_to: string
          id: string
          snapshot: Json
          team_id: string
          token: string
        }
        Insert: {
          created_at?: string
          created_by: string
          date_from: string
          date_to: string
          id?: string
          snapshot: Json
          team_id: string
          token?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          date_from?: string
          date_to?: string
          id?: string
          snapshot?: Json
          team_id?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_shares_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      teams: {
        Row: {
          created_at: string | null
          created_by: string
          id: string
          name: string
          slug: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          created_by: string
          id?: string
          name: string
          slug: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string
          id?: string
          name?: string
          slug?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      user_profiles: {
        Row: {
          avatar_url: string | null
          created_at: string | null
          display_name: string | null
          email: string | null
          id: string
          settings: Json | null
          timezone: string | null
          updated_at: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string | null
          display_name?: string | null
          email?: string | null
          id: string
          settings?: Json | null
          timezone?: string | null
          updated_at?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string | null
          display_name?: string | null
          email?: string | null
          id?: string
          settings?: Json | null
          timezone?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      check_shared_team: {
        Args: { p_user_a: string; p_user_b: string }
        Returns: boolean
      }
      create_events_partition: { Args: never; Returns: undefined }
      get_cost_by_model: {
        Args: { p_from: string; p_to: string; p_user_id: string }
        Returns: Json
      }
      get_daily_cost: {
        Args: { p_from: string; p_to: string; p_user_id: string }
        Returns: Json
      }
      get_overview_stats: {
        Args: { p_from: string; p_to: string; p_user_id: string }
        Returns: Json
      }
      get_team_member_stats: {
        Args: { p_from: string; p_team_id: string; p_to: string }
        Returns: {
          avatar_url: string
          display_name: string
          last_active: string
          sessions: number
          top_tool: string
          total_cost_usd: number
          user_id: string
        }[]
      }
      get_team_overview_stats: {
        Args: { p_from: string; p_team_id: string; p_to: string }
        Returns: Json
      }
      get_team_trend: {
        Args: { p_from: string; p_team_id: string; p_to: string }
        Returns: {
          date: string
          sessions: number
        }[]
      }
      get_top_agents: {
        Args: {
          p_from: string
          p_limit?: number
          p_to: string
          p_user_id: string
        }
        Returns: Json
      }
      get_top_tools: {
        Args: {
          p_from: string
          p_limit?: number
          p_to: string
          p_user_id: string
        }
        Returns: Json
      }
      update_daily_aggregate: {
        Args: { p_date: string; p_user_id: string }
        Returns: undefined
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
