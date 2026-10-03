/**
 * 資料庫型別定義。
 *
 * 註：正式流程應以 `npm run gen:types`（= supabase gen types typescript）自遠端 schema 產生。
 * 由於本機無 Docker 且 MVP 尚未連上雲端專案，這裡先手寫一份與 migrations 完全對應的型別，
 * 供 `@supabase/supabase-js` 泛型使用。schema 有變動時請以指令重新產生覆蓋本檔。
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          email: string;
          display_name: string;
          created_at: string;
        };
        Insert: {
          id: string;
          email: string;
          display_name: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          email?: string;
          display_name?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      calendars: {
        Row: {
          id: string;
          owner_id: string;
          name: string;
          kind: "self" | "child" | "work" | "private" | "other";
          color: string;
          position: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          owner_id: string;
          name: string;
          kind: "self" | "child" | "work" | "private" | "other";
          color: string;
          position?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          owner_id?: string;
          name?: string;
          kind?: "self" | "child" | "work" | "private" | "other";
          color?: string;
          position?: number;
          created_at?: string;
        };
        Relationships: [];
      };
      events: {
        Row: {
          id: string;
          calendar_id: string;
          creator_id: string;
          title: string;
          description: string | null;
          location: string | null;
          starts_at: string;
          ends_at: string;
          all_day: boolean;
          is_important: boolean;
          recurrence_rule: string | null;
          recurrence_group_id: string | null;
          source_uid: string | null;
          reminder_minutes: number | null;
          reminder_email_sent_at: string | null;
          created_at: string;
          updated_at: string;
          // 0009 司機接送（套 migration 前查不到，故標為可選）
          needs_driver?: boolean;
          driver_trip?: "to" | "from" | "round" | null;
          driver_pickup_minutes?: number | null;
          driver_pickup_location?: string | null;
          driver_note?: string | null;
        };
        Insert: {
          id?: string;
          calendar_id: string;
          creator_id: string;
          title: string;
          description?: string | null;
          location?: string | null;
          starts_at: string;
          ends_at: string;
          all_day?: boolean;
          is_important?: boolean;
          recurrence_rule?: string | null;
          recurrence_group_id?: string | null;
          source_uid?: string | null;
          reminder_minutes?: number | null;
          reminder_email_sent_at?: string | null;
          created_at?: string;
          updated_at?: string;
          // 0009 司機接送（套 migration 前查不到，故標為可選）
          needs_driver?: boolean;
          driver_trip?: "to" | "from" | "round" | null;
          driver_pickup_minutes?: number | null;
          driver_pickup_location?: string | null;
          driver_note?: string | null;
        };
        Update: {
          id?: string;
          calendar_id?: string;
          creator_id?: string;
          title?: string;
          description?: string | null;
          location?: string | null;
          starts_at?: string;
          ends_at?: string;
          all_day?: boolean;
          is_important?: boolean;
          recurrence_rule?: string | null;
          recurrence_group_id?: string | null;
          source_uid?: string | null;
          reminder_minutes?: number | null;
          reminder_email_sent_at?: string | null;
          created_at?: string;
          updated_at?: string;
          // 0009 司機接送（套 migration 前查不到，故標為可選）
          needs_driver?: boolean;
          driver_trip?: "to" | "from" | "round" | null;
          driver_pickup_minutes?: number | null;
          driver_pickup_location?: string | null;
          driver_note?: string | null;
        };
        Relationships: [];
      };
      contacts: {
        Row: {
          id: string;
          owner_id: string;
          name: string;
          role_label: string | null;
          phone: string | null;
          note: string | null;
          email: string | null;
          is_family: boolean;
          billing_mode: "fixed" | "hourly" | null;
          default_rate: number | null;
          default_category_id: string | null;
          default_direction: "expense" | "income" | null;
          default_payment_method:
            | "monthly"
            | "per_time"
            | "prepaid_deduct"
            | "prepaid_term"
            | null;
        };
        Insert: {
          id?: string;
          owner_id: string;
          name: string;
          role_label?: string | null;
          phone?: string | null;
          note?: string | null;
          email?: string | null;
          is_family?: boolean;
          billing_mode?: "fixed" | "hourly" | null;
          default_rate?: number | null;
          default_category_id?: string | null;
          default_direction?: "expense" | "income" | null;
          default_payment_method?:
            | "monthly"
            | "per_time"
            | "prepaid_deduct"
            | "prepaid_term"
            | null;
        };
        Update: {
          id?: string;
          owner_id?: string;
          name?: string;
          role_label?: string | null;
          phone?: string | null;
          note?: string | null;
          email?: string | null;
          is_family?: boolean;
          billing_mode?: "fixed" | "hourly" | null;
          default_rate?: number | null;
          default_category_id?: string | null;
          default_direction?: "expense" | "income" | null;
          default_payment_method?:
            | "monthly"
            | "per_time"
            | "prepaid_deduct"
            | "prepaid_term"
            | null;
        };
        Relationships: [];
      };
      expense_categories: {
        Row: {
          id: string;
          owner_id: string;
          name: string;
          group_label: string | null;
          position: number;
          is_archived: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          owner_id: string;
          name: string;
          group_label?: string | null;
          position?: number;
          is_archived?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          owner_id?: string;
          name?: string;
          group_label?: string | null;
          position?: number;
          is_archived?: boolean;
          created_at?: string;
        };
        Relationships: [];
      };
      contact_rate_plans: {
        Row: {
          id: string;
          owner_id: string;
          contact_id: string;
          label: string;
          headcount: number;
          billing_mode: "fixed" | "hourly";
          rate: number;
          position: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          owner_id: string;
          contact_id: string;
          label: string;
          headcount?: number;
          billing_mode: "fixed" | "hourly";
          rate: number;
          position?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          owner_id?: string;
          contact_id?: string;
          label?: string;
          headcount?: number;
          billing_mode?: "fixed" | "hourly";
          rate?: number;
          position?: number;
          created_at?: string;
        };
        Relationships: [];
      };
      prepaid_accounts: {
        Row: {
          id: string;
          owner_id: string;
          contact_id: string | null;
          calendar_id: string | null;
          label: string;
          kind: "deduct" | "term";
          total_amount: number;
          total_sessions: number | null;
          note: string | null;
          is_active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          owner_id: string;
          contact_id?: string | null;
          calendar_id?: string | null;
          label: string;
          kind: "deduct" | "term";
          total_amount?: number;
          total_sessions?: number | null;
          note?: string | null;
          is_active?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          owner_id?: string;
          contact_id?: string | null;
          calendar_id?: string | null;
          label?: string;
          kind?: "deduct" | "term";
          total_amount?: number;
          total_sessions?: number | null;
          note?: string | null;
          is_active?: boolean;
          created_at?: string;
        };
        Relationships: [];
      };
      event_contacts: {
        Row: { event_id: string; contact_id: string; role: "subject" | "participant" };
        Insert: {
          event_id: string;
          contact_id: string;
          role?: "subject" | "participant";
        };
        Update: {
          event_id?: string;
          contact_id?: string;
          role?: "subject" | "participant";
        };
        Relationships: [];
      };
      tags: {
        Row: { id: string; owner_id: string; name: string };
        Insert: { id?: string; owner_id: string; name: string };
        Update: { id?: string; owner_id?: string; name?: string };
        Relationships: [];
      };
      event_tags: {
        Row: { event_id: string; tag_id: string };
        Insert: { event_id: string; tag_id: string };
        Update: { event_id?: string; tag_id?: string };
        Relationships: [];
      };
      finance_records: {
        Row: {
          id: string;
          owner_id: string;
          calendar_id: string | null;
          event_id: string | null;
          direction: "expense" | "income";
          amount: number;
          category_label: string | null;
          category_id: string | null;
          contact_id: string | null;
          occurred_on: string;
          is_settled: boolean;
          note: string | null;
          payment_method:
            | "monthly"
            | "per_time"
            | "prepaid_deduct"
            | "prepaid_term"
            | null;
          prepaid_account_id: string | null;
          is_prepaid_topup: boolean;
          covered_by_prepaid: boolean;
          created_at: string;
          // 0008 收費方案快照（套 migration 前查不到，故標為可選）
          rate_plan_id?: string | null;
          lesson_label?: string | null;
          headcount?: number | null;
          learner_count?: number | null;
        };
        Insert: {
          id?: string;
          owner_id: string;
          calendar_id?: string | null;
          event_id?: string | null;
          direction: "expense" | "income";
          amount: number;
          category_label?: string | null;
          category_id?: string | null;
          contact_id?: string | null;
          occurred_on: string;
          is_settled?: boolean;
          note?: string | null;
          payment_method?:
            | "monthly"
            | "per_time"
            | "prepaid_deduct"
            | "prepaid_term"
            | null;
          prepaid_account_id?: string | null;
          is_prepaid_topup?: boolean;
          covered_by_prepaid?: boolean;
          created_at?: string;
          rate_plan_id?: string | null;
          lesson_label?: string | null;
          headcount?: number | null;
          learner_count?: number | null;
        };
        Update: {
          id?: string;
          owner_id?: string;
          calendar_id?: string | null;
          event_id?: string | null;
          direction?: "expense" | "income";
          amount?: number;
          category_label?: string | null;
          category_id?: string | null;
          contact_id?: string | null;
          occurred_on?: string;
          is_settled?: boolean;
          note?: string | null;
          payment_method?:
            | "monthly"
            | "per_time"
            | "prepaid_deduct"
            | "prepaid_term"
            | null;
          prepaid_account_id?: string | null;
          is_prepaid_topup?: boolean;
          covered_by_prepaid?: boolean;
          created_at?: string;
          rate_plan_id?: string | null;
          lesson_label?: string | null;
          headcount?: number | null;
          learner_count?: number | null;
        };
        Relationships: [];
      };
      event_notes: {
        Row: {
          id: string;
          event_id: string;
          author_id: string;
          content: string;
          progress_label: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          event_id: string;
          author_id: string;
          content: string;
          progress_label?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          event_id?: string;
          author_id?: string;
          content?: string;
          progress_label?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      calendar_shares: {
        Row: {
          id: string;
          calendar_id: string;
          invited_email: string;
          member_id: string | null;
          role: "editor" | "contributor" | "viewer";
          created_at: string;
        };
        Insert: {
          id?: string;
          calendar_id: string;
          invited_email: string;
          member_id?: string | null;
          role: "editor" | "contributor" | "viewer";
          created_at?: string;
        };
        Update: {
          id?: string;
          calendar_id?: string;
          invited_email?: string;
          member_id?: string | null;
          role?: "editor" | "contributor" | "viewer";
          created_at?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}

/** 便捷別名 */
export type Tables<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Row"];
export type TablesInsert<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Insert"];
export type TablesUpdate<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Update"];
