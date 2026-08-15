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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      citation_usage: {
        Row: {
          id: string
          user_id: string
          usage_date: string
          count: number
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          usage_date?: string
          count?: number
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          usage_date?: string
          count?: number
          created_at?: string
        }
        Relationships: []
      }
      cards: {
        Row: {
          answer: string
          client_id: string
          created_at: string
          deck_id: string
          due_at: string
          id: string
          interval_days: number
          last_reviewed_at: string | null
          question: string
          review_count: number
          tag: string | null
          topic: string
          topic_emoji: string | null
          user_id: string
        }
        Insert: {
          answer: string
          client_id: string
          created_at?: string
          deck_id: string
          due_at?: string
          id?: string
          interval_days?: number
          last_reviewed_at?: string | null
          question: string
          review_count?: number
          tag?: string | null
          topic: string
          topic_emoji?: string | null
          user_id: string
        }
        Update: {
          answer?: string
          client_id?: string
          created_at?: string
          deck_id?: string
          due_at?: string
          id?: string
          interval_days?: number
          last_reviewed_at?: string | null
          question?: string
          review_count?: number
          tag?: string | null
          topic?: string
          topic_emoji?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cards_deck_id_fkey"
            columns: ["deck_id"]
            isOneToOne: false
            referencedRelation: "decks"
            referencedColumns: ["id"]
          },
        ]
      }
      decks: {
        Row: {
          created_at: string
          id: string
          topic: string
          topic_emoji: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          topic: string
          topic_emoji?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          topic?: string
          topic_emoji?: string | null
          user_id?: string
        }
        Relationships: []
      }
      curriculum_topics: {
        Row: {
          created_at: string
          generator_prompt: string | null
          id: string
          is_active: boolean
          level: number
          parent_id: string | null
          sort_order: number
          system: string
          title: string
          yield_tier: string
        }
        Insert: {
          created_at?: string
          generator_prompt?: string | null
          id?: string
          is_active?: boolean
          level?: number
          parent_id?: string | null
          sort_order?: number
          system: string
          title: string
          yield_tier?: string
        }
        Update: {
          created_at?: string
          generator_prompt?: string | null
          id?: string
          is_active?: boolean
          level?: number
          parent_id?: string | null
          sort_order?: number
          system?: string
          title?: string
          yield_tier?: string
        }
        Relationships: [
          {
            foreignKeyName: "curriculum_topics_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "curriculum_topics"
            referencedColumns: ["id"]
          },
        ]
      }
      pro_codes: {
        Row: {
          code: string
          created_at: string
          duration_days: number
          redeemed_at: string | null
          redeemed_by: string | null
        }
        Insert: {
          code: string
          created_at?: string
          duration_days?: number
          redeemed_at?: string | null
          redeemed_by?: string | null
        }
        Update: {
          code?: string
          created_at?: string
          duration_days?: number
          redeemed_at?: string | null
          redeemed_by?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          email: string
          id: string
          is_pro: boolean
          pro_expires_at: string | null
          pro_source: string | null
          premium_used: number
          preferred_model: string
        }
        Insert: {
          created_at?: string
          email: string
          id: string
          is_pro?: boolean
          pro_expires_at?: string | null
          pro_source?: string | null
          premium_used?: number
          preferred_model?: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          is_pro?: boolean
          pro_expires_at?: string | null
          pro_source?: string | null
          premium_used?: number
          preferred_model?: string
        }
        Relationships: []
      }
      review_sessions: {
        Row: {
          card_id: string
          id: string
          rating: string
          reviewed_at: string
          user_id: string
        }
        Insert: {
          card_id: string
          id?: string
          rating: string
          reviewed_at?: string
          user_id: string
        }
        Update: {
          card_id?: string
          id?: string
          rating?: string
          reviewed_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "review_sessions_card_id_fkey"
            columns: ["card_id"]
            isOneToOne: false
            referencedRelation: "cards"
            referencedColumns: ["id"]
          },
        ]
      }
      study_history: {
        Row: {
          created_at: string
          curriculum_topic_id: string | null
          difficulty: string | null
          exam_mode: string | null
          focus: string | null
          id: string
          input: string
          length: string | null
          output: string
          topic: string
          user_id: string
        }
        Insert: {
          created_at?: string
          curriculum_topic_id?: string | null
          difficulty?: string | null
          exam_mode?: string | null
          focus?: string | null
          id?: string
          input: string
          length?: string | null
          output: string
          topic: string
          user_id: string
        }
        Update: {
          created_at?: string
          curriculum_topic_id?: string | null
          difficulty?: string | null
          exam_mode?: string | null
          focus?: string | null
          id?: string
          input?: string
          length?: string | null
          output?: string
          topic?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "study_history_curriculum_topic_id_fkey"
            columns: ["curriculum_topic_id"]
            isOneToOne: false
            referencedRelation: "curriculum_topics"
            referencedColumns: ["id"]
          },
        ]
      }
      usage_records: {
        Row: {
          count: number
          id: string
          kind: string
          usage_date: string
          user_id: string
        }
        Insert: {
          count?: number
          id?: string
          kind: string
          usage_date: string
          user_id: string
        }
        Update: {
          count?: number
          id?: string
          kind?: string
          usage_date?: string
          user_id?: string
        }
        Relationships: []
      }
      questions: {
        Row: {
          id: string
          subject: string
          domain: string
          topic: string
          difficulty: 'Easy' | 'Medium' | 'Hard'
          reasoning_order: '1st' | '2nd' | '3rd'
          competency: string
          question_text: string
          option_a: string
          option_b: string
          option_c: string
          option_d: string
          option_e: string
          correct_option: 'a' | 'b' | 'c' | 'd' | 'e'
          explanation: string
          teaching_point: string
          is_active: boolean
          created_at: string
          external_id: string | null
        }
        Insert: {
          id?: string
          subject: string
          domain: string
          topic: string
          difficulty: 'Easy' | 'Medium' | 'Hard'
          reasoning_order: '1st' | '2nd' | '3rd'
          competency: string
          question_text: string
          option_a: string
          option_b: string
          option_c: string
          option_d: string
          option_e: string
          correct_option: 'a' | 'b' | 'c' | 'd' | 'e'
          explanation: string
          teaching_point: string
          is_active?: boolean
          created_at?: string
          external_id?: string | null
        }
        Update: {
          id?: string
          subject?: string
          domain?: string
          topic?: string
          difficulty?: 'Easy' | 'Medium' | 'Hard'
          reasoning_order?: '1st' | '2nd' | '3rd'
          competency?: string
          question_text?: string
          option_a?: string
          option_b?: string
          option_c?: string
          option_d?: string
          option_e?: string
          correct_option?: 'a' | 'b' | 'c' | 'd' | 'e'
          explanation?: string
          teaching_point?: string
          is_active?: boolean
          created_at?: string
          external_id?: string | null
        }
        Relationships: []
      }
      media: {
        Row: {
          id: string
          file_url: string
          media_type: 'ecg' | 'histology_slide' | 'chest_xray' | 'anatomical_diagram' | 'action_potential_diagram' | 'pressure_volume_diagram'
          tags: string[]
          description: string
          source_url: string
          license: 'CC0' | 'CC-BY' | 'public_domain' | 'ODC-BY' | 'proprietary'
          attribution: string | null
          created_at: string
        }
        Insert: {
          id?: string
          file_url: string
          media_type: 'ecg' | 'histology_slide' | 'chest_xray' | 'anatomical_diagram' | 'action_potential_diagram' | 'pressure_volume_diagram'
          tags?: string[]
          description: string
          source_url: string
          license: 'CC0' | 'CC-BY' | 'public_domain' | 'ODC-BY' | 'proprietary'
          attribution?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          file_url?: string
          media_type?: 'ecg' | 'histology_slide' | 'chest_xray' | 'anatomical_diagram' | 'action_potential_diagram' | 'pressure_volume_diagram'
          tags?: string[]
          description?: string
          source_url?: string
          license?: 'CC0' | 'CC-BY' | 'public_domain' | 'ODC-BY' | 'proprietary'
          attribution?: string | null
          created_at?: string
        }
        Relationships: []
      }
      question_media: {
        Row: {
          id: string
          question_id: string
          media_id: string
          display_order: number
          caption: string | null
          display_context: string
        }
        Insert: {
          id?: string
          question_id: string
          media_id: string
          display_order?: number
          caption?: string | null
          display_context?: string
        }
        Update: {
          id?: string
          question_id?: string
          media_id?: string
          display_order?: number
          caption?: string | null
          display_context?: string
        }
        Relationships: [
          {
            foreignKeyName: "question_media_question_id_fkey"
            columns: ["question_id"]
            referencedRelation: "questions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "question_media_media_id_fkey"
            columns: ["media_id"]
            referencedRelation: "media"
            referencedColumns: ["id"]
          }
        ]
      }
      user_attempts: {
        Row: {
          id: string
          user_id: string
          question_id: string
          selected_option: 'a' | 'b' | 'c' | 'd' | 'e'
          is_correct: boolean
          time_taken_ms: number | null
          attempted_at: string
          session_id: string | null
        }
        Insert: {
          id?: string
          user_id: string
          question_id: string
          selected_option: 'a' | 'b' | 'c' | 'd' | 'e'
          is_correct: boolean
          time_taken_ms?: number | null
          attempted_at?: string
          session_id?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          question_id?: string
          selected_option?: 'a' | 'b' | 'c' | 'd' | 'e'
          is_correct?: boolean
          time_taken_ms?: number | null
          attempted_at?: string
          session_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "user_attempts_user_id_fkey"
            columns: ["user_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_attempts_question_id_fkey"
            columns: ["question_id"]
            referencedRelation: "questions"
            referencedColumns: ["id"]
          }
        ]
      }
      flagged_questions: {
        Row: {
          id: string
          user_id: string
          question_id: string
          flagged_at: string
          session_id: string | null
        }
        Insert: {
          id?: string
          user_id: string
          question_id: string
          flagged_at?: string
          session_id?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          question_id?: string
          flagged_at?: string
          session_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "flagged_questions_user_id_fkey"
            columns: ["user_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flagged_questions_question_id_fkey"
            columns: ["question_id"]
            referencedRelation: "questions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flagged_questions_session_id_fkey"
            columns: ["session_id"]
            referencedRelation: "qbank_sessions"
            referencedColumns: ["id"]
          }
        ]
      }
      qbank_sessions: {
        Row: {
          id: string
          user_id: string
          started_at: string
          ended_at: string
          score: number
          total: number
          total_time_ms: number
          system: string
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          started_at: string
          ended_at: string
          score: number
          total: number
          total_time_ms: number
          system?: string
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          started_at?: string
          ended_at?: string
          score?: number
          total?: number
          total_time_ms?: number
          system?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "qbank_sessions_user_id_fkey"
            columns: ["user_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      redeem_pro_code: { Args: { code_input: string }; Returns: Json }
      start_qbank_session: {
        Args: {
          p_domains: string[] | null
          p_limit: number
          p_system: string | null
          p_question_ids: string[] | null
        }
        Returns: Json
      }
      submit_answer: {
        Args: {
          p_session: string
          p_question: string
          p_selected: string
          p_time_ms: number
        }
        Returns: Json
      }
      end_qbank_session: {
        Args: { p_session: string }
        Returns: Json
      }
      get_session_review: {
        Args: { p_session: string }
        Returns: Json
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
