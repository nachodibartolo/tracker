// Regenerated from linked Supabase project on 2026-05-14 via
// `supabase gen types typescript --linked > lib/supabase/database.types.ts`

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
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
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
  public: {
    Tables: {
      categories: {
        Row: {
          color: string
          created_at: string
          icon: string
          id: string
          is_system: boolean
          name: string
          parent_id: string | null
          position: number
          type: Database["public"]["Enums"]["category_type"]
          user_id: string
        }
        Insert: {
          color?: string
          created_at?: string
          icon?: string
          id?: string
          is_system?: boolean
          name: string
          parent_id?: string | null
          position?: number
          type: Database["public"]["Enums"]["category_type"]
          user_id: string
        }
        Update: {
          color?: string
          created_at?: string
          icon?: string
          id?: string
          is_system?: boolean
          name?: string
          parent_id?: string | null
          position?: number
          type?: Database["public"]["Enums"]["category_type"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "categories_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      fx_rates: {
        Row: {
          base: string
          fetched_at: string
          quote: string
          rate: number
          rate_date: string
        }
        Insert: {
          base: string
          fetched_at?: string
          quote: string
          rate: number
          rate_date: string
        }
        Update: {
          base?: string
          fetched_at?: string
          quote?: string
          rate?: number
          rate_date?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          id: string
          locale: string
          main_currency: string
        }
        Insert: {
          created_at?: string
          id: string
          locale?: string
          main_currency?: string
        }
        Update: {
          created_at?: string
          id?: string
          locale?: string
          main_currency?: string
        }
        Relationships: []
      }
      telegram_agent_actions: {
        Row: {
          action_type: string
          after_payload: Json | null
          agent_summary: string | null
          before_payload: Json | null
          created_at: string
          id: string
          reversed_at: string | null
          reversed_by_action_id: string | null
          target_ids: string[]
          target_table: string
          telegram_chat_id: number
          user_id: string
        }
        Insert: {
          action_type: string
          after_payload?: Json | null
          agent_summary?: string | null
          before_payload?: Json | null
          created_at?: string
          id?: string
          reversed_at?: string | null
          reversed_by_action_id?: string | null
          target_ids: string[]
          target_table?: string
          telegram_chat_id: number
          user_id: string
        }
        Update: {
          action_type?: string
          after_payload?: Json | null
          agent_summary?: string | null
          before_payload?: Json | null
          created_at?: string
          id?: string
          reversed_at?: string | null
          reversed_by_action_id?: string | null
          target_ids?: string[]
          target_table?: string
          telegram_chat_id?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "telegram_agent_actions_reversed_by_action_id_fkey"
            columns: ["reversed_by_action_id"]
            isOneToOne: false
            referencedRelation: "telegram_agent_actions"
            referencedColumns: ["id"]
          },
        ]
      }
      telegram_link_codes: {
        Row: {
          code: string
          created_at: string
          expires_at: string
          user_id: string
        }
        Insert: {
          code: string
          created_at?: string
          expires_at: string
          user_id: string
        }
        Update: {
          code?: string
          created_at?: string
          expires_at?: string
          user_id?: string
        }
        Relationships: []
      }
      telegram_processed_updates: {
        Row: {
          processed_at: string
          update_id: number
        }
        Insert: {
          processed_at?: string
          update_id: number
        }
        Update: {
          processed_at?: string
          update_id?: number
        }
        Relationships: []
      }
      telegram_pending: {
        Row: {
          batch_id: string | null
          batch_index: number | null
          counterpart_wallet_id: string | null
          created_at: string
          duplicate_of_tx_id: string | null
          excluded: boolean
          expires_at: string
          extraction: Json
          id: string
          is_duplicate: boolean
          photo_path: string | null
          source: Database["public"]["Enums"]["tx_source"]
          suggested_category_id: string | null
          suggested_wallet_id: string | null
          telegram_chat_id: number
          telegram_message_id: number | null
          transfer_hint: boolean
          user_id: string
        }
        Insert: {
          batch_id?: string | null
          batch_index?: number | null
          counterpart_wallet_id?: string | null
          created_at?: string
          duplicate_of_tx_id?: string | null
          excluded?: boolean
          expires_at?: string
          extraction: Json
          id?: string
          is_duplicate?: boolean
          photo_path?: string | null
          source: Database["public"]["Enums"]["tx_source"]
          suggested_category_id?: string | null
          suggested_wallet_id?: string | null
          telegram_chat_id: number
          telegram_message_id?: number | null
          transfer_hint?: boolean
          user_id: string
        }
        Update: {
          batch_id?: string | null
          batch_index?: number | null
          counterpart_wallet_id?: string | null
          created_at?: string
          duplicate_of_tx_id?: string | null
          excluded?: boolean
          expires_at?: string
          extraction?: Json
          id?: string
          is_duplicate?: boolean
          photo_path?: string | null
          source?: Database["public"]["Enums"]["tx_source"]
          suggested_category_id?: string | null
          suggested_wallet_id?: string | null
          telegram_chat_id?: number
          telegram_message_id?: number | null
          transfer_hint?: boolean
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "telegram_pending_counterpart_wallet_id_fkey"
            columns: ["counterpart_wallet_id"]
            isOneToOne: false
            referencedRelation: "wallets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "telegram_pending_duplicate_of_tx_id_fkey"
            columns: ["duplicate_of_tx_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "telegram_pending_suggested_category_id_fkey"
            columns: ["suggested_category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "telegram_pending_suggested_wallet_id_fkey"
            columns: ["suggested_wallet_id"]
            isOneToOne: false
            referencedRelation: "wallets"
            referencedColumns: ["id"]
          },
        ]
      }
      telegram_chat_state: {
        Row: {
          awaiting_exclude_batch_id: string | null
          awaiting_transfer_batch_id: string | null
          expires_at: string
          set_at: string
          telegram_chat_id: number
        }
        Insert: {
          awaiting_exclude_batch_id?: string | null
          awaiting_transfer_batch_id?: string | null
          expires_at?: string
          set_at?: string
          telegram_chat_id: number
        }
        Update: {
          awaiting_exclude_batch_id?: string | null
          awaiting_transfer_batch_id?: string | null
          expires_at?: string
          set_at?: string
          telegram_chat_id?: number
        }
        Relationships: []
      }
      telegram_users: {
        Row: {
          default_wallet_id: string | null
          linked_at: string
          telegram_user_id: number
          telegram_username: string | null
          user_id: string
        }
        Insert: {
          default_wallet_id?: string | null
          linked_at?: string
          telegram_user_id: number
          telegram_username?: string | null
          user_id: string
        }
        Update: {
          default_wallet_id?: string | null
          linked_at?: string
          telegram_user_id?: number
          telegram_username?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "telegram_users_default_wallet_id_fkey"
            columns: ["default_wallet_id"]
            isOneToOne: false
            referencedRelation: "wallets"
            referencedColumns: ["id"]
          },
        ]
      }
      transactions: {
        Row: {
          amount: number
          category_id: string | null
          counterpart_amount: number | null
          counterpart_currency: string | null
          counterpart_wallet_id: string | null
          created_at: string
          currency: string
          description: string | null
          fx_rate: number | null
          id: string
          note: string | null
          occurred_at: string
          payee: string | null
          photo_path: string | null
          source: Database["public"]["Enums"]["tx_source"]
          source_metadata: Json | null
          transfer_direction: string | null
          transfer_group_id: string | null
          type: Database["public"]["Enums"]["tx_type"]
          updated_at: string
          user_id: string
          wallet_id: string
        }
        Insert: {
          amount: number
          category_id?: string | null
          counterpart_amount?: number | null
          counterpart_currency?: string | null
          counterpart_wallet_id?: string | null
          created_at?: string
          currency: string
          description?: string | null
          fx_rate?: number | null
          id?: string
          note?: string | null
          occurred_at?: string
          payee?: string | null
          photo_path?: string | null
          source?: Database["public"]["Enums"]["tx_source"]
          source_metadata?: Json | null
          transfer_direction?: string | null
          transfer_group_id?: string | null
          type: Database["public"]["Enums"]["tx_type"]
          updated_at?: string
          user_id: string
          wallet_id: string
        }
        Update: {
          amount?: number
          category_id?: string | null
          counterpart_amount?: number | null
          counterpart_currency?: string | null
          counterpart_wallet_id?: string | null
          created_at?: string
          currency?: string
          description?: string | null
          fx_rate?: number | null
          id?: string
          note?: string | null
          occurred_at?: string
          payee?: string | null
          photo_path?: string | null
          source?: Database["public"]["Enums"]["tx_source"]
          source_metadata?: Json | null
          transfer_direction?: string | null
          transfer_group_id?: string | null
          type?: Database["public"]["Enums"]["tx_type"]
          updated_at?: string
          user_id?: string
          wallet_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transactions_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_counterpart_wallet_id_fkey"
            columns: ["counterpart_wallet_id"]
            isOneToOne: false
            referencedRelation: "wallets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_wallet_id_fkey"
            columns: ["wallet_id"]
            isOneToOne: false
            referencedRelation: "wallets"
            referencedColumns: ["id"]
          },
        ]
      }
      wallets: {
        Row: {
          archived: boolean
          color: string
          created_at: string
          currency: string
          excluded_from_stats: boolean
          icon: string
          id: string
          initial_balance: number
          name: string
          position: number
          type: Database["public"]["Enums"]["wallet_type"]
          updated_at: string
          user_id: string
        }
        Insert: {
          archived?: boolean
          color?: string
          created_at?: string
          currency?: string
          excluded_from_stats?: boolean
          icon?: string
          id?: string
          initial_balance?: number
          name: string
          position?: number
          type?: Database["public"]["Enums"]["wallet_type"]
          updated_at?: string
          user_id: string
        }
        Update: {
          archived?: boolean
          color?: string
          created_at?: string
          currency?: string
          excluded_from_stats?: boolean
          icon?: string
          id?: string
          initial_balance?: number
          name?: string
          position?: number
          type?: Database["public"]["Enums"]["wallet_type"]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      agent_readonly_query: {
        Args: { p_sql: string; p_user_id: string }
        Returns: Json
      }
      create_transfer: {
        Args: {
          p_amount_from: number
          p_amount_to: number
          p_currency_from: string
          p_currency_to: string
          p_from_wallet: string
          p_fx_rate: number
          p_note: string
          p_occurred_at: string
          p_to_wallet: string
          p_user_id: string
        }
        Returns: string
      }
      daily_balance_series: {
        Args: {
          p_currency: string
          p_from: string
          p_to: string
          p_user_id: string
        }
        Returns: {
          day: string
          delta: number
        }[]
      }
      delete_transfer: {
        Args: { p_group_id: string; p_user_id: string }
        Returns: undefined
      }
      expenses_by_category: {
        Args: { p_from: string; p_to: string; p_user_id: string }
        Returns: {
          category_id: string
          currency: string
          total: number
        }[]
      }
      monthly_summary: {
        Args: { p_from: string; p_to: string; p_user_id: string }
        Returns: {
          currency: string
          expense: number
          income: number
        }[]
      }
      seed_default_categories: {
        Args: { p_user_id: string }
        Returns: undefined
      }
      wallet_balance: { Args: { p_wallet_id: string }; Returns: number }
      wallet_balances: {
        Args: { p_user_id: string }
        Returns: {
          balance: number
          currency: string
          wallet_id: string
        }[]
      }
    }
    Enums: {
      category_type: "expense" | "income"
      tx_source:
        | "manual"
        | "telegram_text"
        | "telegram_photo"
        | "telegram_audio"
      tx_type: "expense" | "income" | "transfer"
      wallet_type:
        | "general"
        | "cash"
        | "bank"
        | "credit_card"
        | "savings"
        | "investment"
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      category_type: ["expense", "income"],
      tx_source: [
        "manual",
        "telegram_text",
        "telegram_photo",
        "telegram_audio",
      ],
      tx_type: ["expense", "income", "transfer"],
      wallet_type: [
        "general",
        "cash",
        "bank",
        "credit_card",
        "savings",
        "investment",
      ],
    },
  },
} as const

// ============================================================================
// Convenience aliases (hand-maintained — kept across regenerations)
// ============================================================================

export type WalletType = Database["public"]["Enums"]["wallet_type"];
export type CategoryType = Database["public"]["Enums"]["category_type"];
export type TxType = Database["public"]["Enums"]["tx_type"];
export type TxSource = Database["public"]["Enums"]["tx_source"];
export type TransferDirection = "out" | "in";

export type Profile = Database["public"]["Tables"]["profiles"]["Row"];
export type Wallet = Database["public"]["Tables"]["wallets"]["Row"];
export type Category = Database["public"]["Tables"]["categories"]["Row"];
export type Transaction = Database["public"]["Tables"]["transactions"]["Row"];
export type TelegramUser = Database["public"]["Tables"]["telegram_users"]["Row"];
export type TelegramLinkCode = Database["public"]["Tables"]["telegram_link_codes"]["Row"];
export type FxRate = Database["public"]["Tables"]["fx_rates"]["Row"];

export type WalletInsert = Database["public"]["Tables"]["wallets"]["Insert"];
export type WalletUpdate = Database["public"]["Tables"]["wallets"]["Update"];
export type CategoryInsert = Database["public"]["Tables"]["categories"]["Insert"];
export type CategoryUpdate = Database["public"]["Tables"]["categories"]["Update"];
export type TransactionInsert = Database["public"]["Tables"]["transactions"]["Insert"];
export type TransactionUpdate = Database["public"]["Tables"]["transactions"]["Update"];
