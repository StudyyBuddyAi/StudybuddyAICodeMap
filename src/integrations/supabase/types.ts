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
          grounded: boolean
          id: string
          interval_days: number
          is_leech: boolean
          lapses: number
          last_reviewed_at: string | null
          learning_steps: number
          question: string
          review_count: number
          scheduled_days: number
          srs_state: number | null
          stability: number | null
          difficulty: number | null
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
          grounded?: boolean
          id?: string
          interval_days?: number
          is_leech?: boolean
          lapses?: number
          last_reviewed_at?: string | null
          learning_steps?: number
          question: string
          review_count?: number
          scheduled_days?: number
          srs_state?: number | null
          stability?: number | null
          difficulty?: number | null
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
          grounded?: boolean
          id?: string
          interval_days?: number
          is_leech?: boolean
          lapses?: number
          last_reviewed_at?: string | null
          learning_steps?: number
          question?: string
          review_count?: number
          scheduled_days?: number
          srs_state?: number | null
          stability?: number | null
          difficulty?: number | null
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
          grounding_metadata: Json | null
          id: string
          topic: string
          topic_emoji: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          grounding_metadata?: Json | null
          id?: string
          topic: string
          topic_emoji?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          grounding_metadata?: Json | null
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
          srs_desired_retention: number
          srs_max_reviews_per_day: number
          srs_new_per_day: number
          srs_weights: Json | null
          srs_weights_log_loss: number | null
          srs_weights_review_count: number | null
          srs_weights_updated_at: string | null
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
          difficulty_after: number | null
          difficulty_before: number | null
          due_after: string | null
          duration_ms: number | null
          elapsed_days: number | null
          id: string
          rating: string
          reviewed_at: string
          scheduled_days: number | null
          stability_after: number | null
          stability_before: number | null
          state_before: number | null
          user_id: string
        }
        Insert: {
          card_id: string
          difficulty_after?: number | null
          difficulty_before?: number | null
          due_after?: string | null
          duration_ms?: number | null
          elapsed_days?: number | null
          id?: string
          rating: string
          reviewed_at?: string
          scheduled_days?: number | null
          stability_after?: number | null
          stability_before?: number | null
          state_before?: number | null
          user_id: string
        }
        Update: {
          card_id?: string
          difficulty_after?: number | null
          difficulty_before?: number | null
          due_after?: string | null
          duration_ms?: number | null
          elapsed_days?: number | null
          id?: string
          rating?: string
          reviewed_at?: string
          scheduled_days?: number | null
          stability_after?: number | null
          stability_before?: number | null
          state_before?: number | null
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
          distractor_explanations: Record<string, string> | null
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
          distractor_explanations?: Record<string, string> | null
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
          distractor_explanations?: Record<string, string> | null
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
          created_at: string
          session_id: string | null
        }
        Insert: {
          id?: string
          user_id: string
          question_id: string
          selected_option: 'a' | 'b' | 'c' | 'd' | 'e'
          is_correct: boolean
          time_taken_ms?: number | null
          created_at?: string
          session_id?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          question_id?: string
          selected_option?: 'a' | 'b' | 'c' | 'd' | 'e'
          is_correct?: boolean
          time_taken_ms?: number | null
          created_at?: string
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
          ended_at: string | null
          score: number
          total: number
          total_time_ms: number
          system: string
          created_at: string
          status: string
          mode: string
          question_ids: string[] | null
          current_index: number
          skipped_ids: string[]
          elapsed_ms: number
          expected_total: number | null
          generation: Json | null
          annotations: Json
          progress_seq: number
          last_activity_at: string | null
        }
        Insert: {
          id?: string
          user_id: string
          started_at: string
          ended_at?: string | null
          score: number
          total: number
          total_time_ms: number
          system?: string
          created_at?: string
          status?: string
          mode?: string
          question_ids?: string[] | null
        }
        Update: {
          id?: string
          user_id?: string
          started_at?: string
          ended_at?: string | null
          score?: number
          total?: number
          total_time_ms?: number
          system?: string
          created_at?: string
          status?: string
          mode?: string
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
    rag_memory_state: {
      Row: {
        user_id: string
        current_window_id: string
        turn_count: number
        created_at: string
        updated_at: string
      }
      Insert: {
        user_id: string
        current_window_id?: string
        turn_count?: number
        created_at?: string
        updated_at?: string
      }
      Update: {
        user_id?: string
        current_window_id?: string
        turn_count?: number
        created_at?: string
        updated_at?: string
      }
      Relationships: [
        {
          foreignKeyName: "rag_memory_state_user_id_fkey"
          columns: ["user_id"]
          isOneToOne: false
          referencedRelation: "users"
          referencedColumns: ["id"]
        }
      ]
    }
    rag_conversation_memory: {
      Row: {
        id: string
        user_id: string
        window_id: string
        turn_number: number
        question: string
        answer: string
        created_at: string
      }
      Insert: {
        id?: string
        user_id: string
        window_id: string
        turn_number: number
        question: string
        answer: string
        created_at?: string
      }
      Update: {
        id?: string
        user_id?: string
        window_id?: string
        turn_number?: number
        question?: string
        answer?: string
        created_at?: string
      }
      Relationships: [
        {
          foreignKeyName: "rag_conversation_memory_user_id_fkey"
          columns: ["user_id"]
          isOneToOne: false
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
      review_flashcard: {
        Args: {
          p_client_id: string
          p_rating: string
          p_expected_reps: number
          p_next: Json
          p_log: Json
        }
        Returns: Json
      }
      set_flashcard_states: {
        Args: { p_mode: string; p_states: Json }
        Returns: Json
      }
      set_srs_settings: {
        Args: {
          p_desired_retention: number
          p_new_per_day: number
          p_max_reviews_per_day: number
        }
        Returns: Json
      }
      set_srs_weights: {
        Args: { p_weights: Json | null; p_review_count: number; p_log_loss: number }
        Returns: Json
      }
      get_srs_today: {
        Args: { p_since: string }
        Returns: Json
      }
      start_qbank_session: {
        Args: {
          p_domains: string[] | null
          p_limit: number
          p_system: string | null
          p_question_ids: string[] | null
          p_mode?: string
        }
        Returns: Json
      }
      save_qbank_progress: {
        Args: {
          p_session: string
          p_seq: number
          p_current_index: number
          p_skipped_ids: string[]
          p_elapsed_ms: number
          p_expected_total: number
          p_generation: Json | null
          p_annotations: Json
          p_flagged_ids?: string[] | null
        }
        Returns: Json
      }
      set_question_flag: {
        Args: { p_session: string; p_question: string; p_flagged: boolean }
        Returns: Json
      }
      list_unfinished_sessions: {
        Args: Record<PropertyKey, never>
        Returns: {
          id: string
          mode: string
          system: string
          topic: string | null
          exam_mode: string | null
          started_at: string
          last_activity_at: string | null
          question_count: number
          expected_total: number
          answered_count: number
          flagged_count: number
          elapsed_ms: number
        }[]
      }
      resume_qbank_session: {
        Args: { p_session: string }
        Returns: Json
      }
      record_timed_answer: {
        Args: {
          p_session: string
          p_question: string
          p_selected: string | null
          p_time_ms: number
        }
        Returns: Json
      }
      claim_generated_questions: {
        Args: {
          p_session: string
          p_generation_id: string
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
      get_generation_report: {
        Args: { p_generation_id: string }
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
