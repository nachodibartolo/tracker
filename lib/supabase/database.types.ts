// Hand-written from supabase/migrations/0001..0004.
// Will be regenerated via `supabase gen types typescript --linked` after provisioning (Wave 6).

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type WalletType =
  | "general"
  | "cash"
  | "bank"
  | "credit_card"
  | "savings"
  | "investment";

export type CategoryType = "expense" | "income";

export type TxType = "expense" | "income" | "transfer";

// Wave 4A: transfers store two rows per transfer; this column distinguishes
// the outgoing and incoming legs (null for non-transfer rows).
export type TransferDirection = "out" | "in";

export type TxSource =
  | "manual"
  | "telegram_text"
  | "telegram_photo"
  | "telegram_audio";

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          main_currency: string;
          locale: string;
          created_at: string;
        };
        Insert: {
          id: string;
          main_currency?: string;
          locale?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          main_currency?: string;
          locale?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      wallets: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          type: WalletType;
          currency: string;
          initial_balance: number;
          color: string;
          icon: string;
          excluded_from_stats: boolean;
          archived: boolean;
          position: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          name: string;
          type?: WalletType;
          currency?: string;
          initial_balance?: number;
          color?: string;
          icon?: string;
          excluded_from_stats?: boolean;
          archived?: boolean;
          position?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          name?: string;
          type?: WalletType;
          currency?: string;
          initial_balance?: number;
          color?: string;
          icon?: string;
          excluded_from_stats?: boolean;
          archived?: boolean;
          position?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      categories: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          type: CategoryType;
          parent_id: string | null;
          color: string;
          icon: string;
          position: number;
          is_system: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          name: string;
          type: CategoryType;
          parent_id?: string | null;
          color?: string;
          icon?: string;
          position?: number;
          is_system?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          name?: string;
          type?: CategoryType;
          parent_id?: string | null;
          color?: string;
          icon?: string;
          position?: number;
          is_system?: boolean;
          created_at?: string;
        };
        Relationships: [];
      };
      transactions: {
        Row: {
          id: string;
          user_id: string;
          wallet_id: string;
          category_id: string | null;
          type: TxType;
          amount: number;
          currency: string;
          occurred_at: string;
          description: string | null;
          note: string | null;
          payee: string | null;
          photo_path: string | null;
          transfer_group_id: string | null;
          transfer_direction: TransferDirection | null;
          counterpart_wallet_id: string | null;
          counterpart_amount: number | null;
          counterpart_currency: string | null;
          fx_rate: number | null;
          source: TxSource;
          source_metadata: Json | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          wallet_id: string;
          category_id?: string | null;
          type: TxType;
          amount: number;
          currency: string;
          occurred_at?: string;
          description?: string | null;
          note?: string | null;
          payee?: string | null;
          photo_path?: string | null;
          transfer_group_id?: string | null;
          transfer_direction?: TransferDirection | null;
          counterpart_wallet_id?: string | null;
          counterpart_amount?: number | null;
          counterpart_currency?: string | null;
          fx_rate?: number | null;
          source?: TxSource;
          source_metadata?: Json | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          wallet_id?: string;
          category_id?: string | null;
          type?: TxType;
          amount?: number;
          currency?: string;
          occurred_at?: string;
          description?: string | null;
          note?: string | null;
          payee?: string | null;
          photo_path?: string | null;
          transfer_group_id?: string | null;
          transfer_direction?: TransferDirection | null;
          counterpart_wallet_id?: string | null;
          counterpart_amount?: number | null;
          counterpart_currency?: string | null;
          fx_rate?: number | null;
          source?: TxSource;
          source_metadata?: Json | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      telegram_users: {
        Row: {
          user_id: string;
          telegram_user_id: number;
          telegram_username: string | null;
          default_wallet_id: string | null;
          linked_at: string;
        };
        Insert: {
          user_id: string;
          telegram_user_id: number;
          telegram_username?: string | null;
          default_wallet_id?: string | null;
          linked_at?: string;
        };
        Update: {
          user_id?: string;
          telegram_user_id?: number;
          telegram_username?: string | null;
          default_wallet_id?: string | null;
          linked_at?: string;
        };
        Relationships: [];
      };
      telegram_link_codes: {
        Row: {
          code: string;
          user_id: string;
          expires_at: string;
          created_at: string;
        };
        Insert: {
          code: string;
          user_id: string;
          expires_at: string;
          created_at?: string;
        };
        Update: {
          code?: string;
          user_id?: string;
          expires_at?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      fx_rates: {
        Row: {
          rate_date: string;
          base: string;
          quote: string;
          rate: number;
          fetched_at: string;
        };
        Insert: {
          rate_date: string;
          base: string;
          quote: string;
          rate: number;
          fetched_at?: string;
        };
        Update: {
          rate_date?: string;
          base?: string;
          quote?: string;
          rate?: number;
          fetched_at?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      seed_default_categories: {
        Args: { p_user_id: string };
        Returns: void;
      };
    };
    Enums: {
      wallet_type: WalletType;
      category_type: CategoryType;
      tx_type: TxType;
      tx_source: TxSource;
    };
    CompositeTypes: Record<string, never>;
  };
}

// Convenience aliases
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
