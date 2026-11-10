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
          /** 0026 使用習慣（自己寫的） */
          habits_text?: string | null;
        };
        Insert: {
          id: string;
          email: string;
          display_name: string;
          created_at?: string;
          habits_text?: string | null;
        };
        Update: {
          id?: string;
          email?: string;
          display_name?: string;
          created_at?: string;
          habits_text?: string | null;
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
          reminder_push_sent_at?: string | null;
          // 0022 第二個提醒
          reminder2_minutes?: number | null;
          reminder2_email_sent_at?: string | null;
          reminder2_push_sent_at?: string | null;
          created_at: string;
          updated_at: string;
          // 0009 司機接送（套 migration 前查不到，故標為可選）
          needs_driver?: boolean;
          driver_trip?: "to" | "from" | "round" | null;
          driver_pickup_minutes?: number | null;
          driver_pickup_location?: string | null;
          driver_note?: string | null;
          // 0019 回程下車地點、修改紀錄（套 migration 前查不到，故標為可選）
          driver_dropoff_location?: string | null;
          edited_at?: string | null;
          edited_by?: string | null;
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
          reminder_push_sent_at?: string | null;
          // 0022 第二個提醒
          reminder2_minutes?: number | null;
          reminder2_email_sent_at?: string | null;
          reminder2_push_sent_at?: string | null;
          created_at?: string;
          updated_at?: string;
          // 0009 司機接送（套 migration 前查不到，故標為可選）
          needs_driver?: boolean;
          driver_trip?: "to" | "from" | "round" | null;
          driver_pickup_minutes?: number | null;
          driver_pickup_location?: string | null;
          driver_note?: string | null;
          // 0019 回程下車地點、修改紀錄（套 migration 前查不到，故標為可選）
          driver_dropoff_location?: string | null;
          edited_at?: string | null;
          edited_by?: string | null;
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
          reminder_push_sent_at?: string | null;
          // 0022 第二個提醒
          reminder2_minutes?: number | null;
          reminder2_email_sent_at?: string | null;
          reminder2_push_sent_at?: string | null;
          created_at?: string;
          updated_at?: string;
          // 0009 司機接送（套 migration 前查不到，故標為可選）
          needs_driver?: boolean;
          driver_trip?: "to" | "from" | "round" | null;
          driver_pickup_minutes?: number | null;
          driver_pickup_location?: string | null;
          driver_note?: string | null;
          // 0019 回程下車地點、修改紀錄（套 migration 前查不到，故標為可選）
          driver_dropoff_location?: string | null;
          edited_at?: string | null;
          edited_by?: string | null;
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
          // 0014 固定作息（套 migration 前查不到）
          routine?: unknown;
          // 0015 空檔顯示方式、是否本人
          gap_mode?: "off" | "always" | "free_days";
          is_self?: boolean;
          // 0017 別名（英文名等）
          aliases?: string[];
          // 0018 月薪（工作效益比對用）
          monthly_salary?: number | null;
          // 0020 排行程預設
          default_calendar_id?: string | null;
          default_tag_names?: string[];
          // 0021 老師自填回饋
          needs_feedback?: boolean;
          teacher_user_id?: string | null;
          // 0023 家教填報
          tutor_kind?: "specialist" | "home" | null;
          tutor_subjects?: string[];
          tutor_shared?: boolean;
          is_student?: boolean;
          default_payment_method:
            | "monthly"
            | "per_time"
            | "per_time_cash"
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
          routine?: unknown;
          // 0015 空檔顯示方式、是否本人
          gap_mode?: "off" | "always" | "free_days";
          is_self?: boolean;
          // 0017 別名（英文名等）
          aliases?: string[];
          monthly_salary?: number | null;
          // 0020 排行程預設
          default_calendar_id?: string | null;
          default_tag_names?: string[];
          // 0021 老師自填回饋
          needs_feedback?: boolean;
          teacher_user_id?: string | null;
          // 0023 家教填報
          tutor_kind?: "specialist" | "home" | null;
          tutor_subjects?: string[];
          tutor_shared?: boolean;
          is_student?: boolean;
          default_payment_method?:
            | "monthly"
            | "per_time"
            | "per_time_cash"
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
          routine?: unknown;
          // 0015 空檔顯示方式、是否本人
          gap_mode?: "off" | "always" | "free_days";
          is_self?: boolean;
          // 0017 別名（英文名等）
          aliases?: string[];
          monthly_salary?: number | null;
          // 0020 排行程預設
          default_calendar_id?: string | null;
          default_tag_names?: string[];
          // 0021 老師自填回饋
          needs_feedback?: boolean;
          teacher_user_id?: string | null;
          // 0023 家教填報
          tutor_kind?: "specialist" | "home" | null;
          tutor_subjects?: string[];
          tutor_shared?: boolean;
          is_student?: boolean;
          default_payment_method?:
            | "monthly"
            | "per_time"
            | "per_time_cash"
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
      work_categories: {
        Row: {
          id: string;
          owner_id: string;
          contact_id: string;
          name: string;
          sub_label: string | null;
          hourly_rate: number;
          aliases: string[];
          position: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          owner_id: string;
          contact_id: string;
          name: string;
          sub_label?: string | null;
          hourly_rate?: number;
          aliases?: string[];
          position?: number;
          created_at?: string;
        };
        Update: {
          name?: string;
          sub_label?: string | null;
          hourly_rate?: number;
          aliases?: string[];
          position?: number;
        };
        Relationships: [];
      };
      work_logs: {
        Row: {
          id: string;
          owner_id: string;
          contact_id: string;
          work_date: string;
          start_time: string | null;
          end_time: string | null;
          hours: number;
          content: string | null;
          category_raw: string | null;
          category_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          owner_id: string;
          contact_id: string;
          work_date: string;
          start_time?: string | null;
          end_time?: string | null;
          hours: number;
          content?: string | null;
          category_raw?: string | null;
          category_id?: string | null;
          created_at?: string;
        };
        Update: {
          category_id?: string | null;
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
          billing_mode: "fixed" | "hourly" | "monthly";
          rate: number;
          position: number;
          created_at: string;
          // 0011 適用小孩（套 migration 前查不到）
          subject_ids?: string[];
          // 0013 每次加收
          extra_fee?: number;
          extra_label?: string | null;
        };
        Insert: {
          id?: string;
          owner_id: string;
          contact_id: string;
          label: string;
          headcount?: number;
          billing_mode: "fixed" | "hourly" | "monthly";
          rate: number;
          position?: number;
          created_at?: string;
          subject_ids?: string[];
          extra_fee?: number;
          extra_label?: string | null;
        };
        Update: {
          id?: string;
          owner_id?: string;
          contact_id?: string;
          label?: string;
          headcount?: number;
          billing_mode?: "fixed" | "hourly" | "monthly";
          rate?: number;
          position?: number;
          created_at?: string;
          subject_ids?: string[];
          extra_fee?: number;
          extra_label?: string | null;
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
      push_subscriptions: {
        Row: {
          id: string;
          user_id: string;
          endpoint: string;
          p256dh: string;
          auth: string;
          user_agent: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          endpoint: string;
          p256dh: string;
          auth: string;
          user_agent?: string | null;
        };
        Update: { p256dh?: string; auth?: string; user_agent?: string | null; user_id?: string };
        Relationships: [];
      };
      // 0017 學習回饋依小孩拆分
      note_parts: {
        Row: {
          id: string;
          note_id: string;
          subject_contact_id: string | null;
          content: string;
          position: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          note_id: string;
          subject_contact_id?: string | null;
          content: string;
          position?: number;
        };
        Update: { subject_contact_id?: string | null; content?: string; position?: number };
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
            | "per_time_cash"
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
          // 0010 月薪：這筆是某位老師某月（yyyy-MM）的月薪
          salary_month?: string | null;
          // 0013 這堂含的加收（如交通費）
          extra_fee?: number | null;
          extra_label?: string | null;
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
            | "per_time_cash"
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
          // 0010 月薪：這筆是某位老師某月（yyyy-MM）的月薪
          salary_month?: string | null;
          // 0013 這堂含的加收（如交通費）
          extra_fee?: number | null;
          extra_label?: string | null;
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
            | "per_time_cash"
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
          // 0010 月薪：這筆是某位老師某月（yyyy-MM）的月薪
          salary_month?: string | null;
          // 0013 這堂含的加收（如交通費）
          extra_fee?: number | null;
          extra_label?: string | null;
        };
        Relationships: [];
      };
      // 0023 家教填報
      tutor_reports: {
        Row: {
          id: string;
          owner_id: string;
          teacher_contact_id: string;
          author_id: string;
          teacher_name: string;
          kind: "lesson" | "daily";
          report_date: string;
          subject: string | null;
          start_time: string | null;
          end_time: string | null;
          mode: string | null;
          student_ids: string[];
          event_id: string | null;
          event_note_id: string | null;
          content: Record<string, unknown>;
          minutes: number;
          minutes_by_category: Record<string, number>;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          owner_id: string;
          teacher_contact_id: string;
          author_id: string;
          teacher_name?: string;
          kind: "lesson" | "daily";
          report_date: string;
          subject?: string | null;
          start_time?: string | null;
          end_time?: string | null;
          mode?: string | null;
          student_ids?: string[];
          event_id?: string | null;
          event_note_id?: string | null;
          content?: Record<string, unknown>;
          minutes?: number;
          minutes_by_category?: Record<string, number>;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          teacher_contact_id?: string;
          kind?: "lesson" | "daily";
          report_date?: string;
          subject?: string | null;
          start_time?: string | null;
          end_time?: string | null;
          mode?: string | null;
          student_ids?: string[];
          event_id?: string | null;
          event_note_id?: string | null;
          content?: Record<string, unknown>;
          minutes?: number;
          minutes_by_category?: Record<string, number>;
        };
        Relationships: [];
      };
      // 0024 家教填報第二期
      tutor_schedule_items: {
        Row: {
          id: string;
          owner_id: string;
          item_date: string;
          start_time: string;
          end_time: string;
          title: string;
          responsible: string;
          tag: string;
          is_exam: boolean;
          status: "" | "請假" | "停課";
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          owner_id: string;
          item_date: string;
          start_time: string;
          end_time: string;
          title: string;
          responsible?: string;
          tag?: string;
          is_exam?: boolean;
          status?: "" | "請假" | "停課";
          created_by?: string | null;
        };
        Update: {
          item_date?: string;
          start_time?: string;
          end_time?: string;
          title?: string;
          responsible?: string;
          tag?: string;
          is_exam?: boolean;
          status?: "" | "請假" | "停課";
          updated_at?: string;
        };
        Relationships: [];
      };
      tutor_units: {
        Row: { owner_id: string; subject: string; units: string[]; updated_at: string };
        Insert: { owner_id: string; subject: string; units?: string[]; updated_at?: string };
        Update: { units?: string[]; updated_at?: string };
        Relationships: [];
      };
      tutor_todo_done: {
        Row: { owner_id: string; key: string; done_at: string };
        Insert: { owner_id: string; key: string; done_at?: string };
        Update: { done_at?: string };
        Relationships: [];
      };
      tutor_rate_settings: {
        Row: { contact_id: string; owner_id: string; rates: Record<string, number>; updated_at: string };
        Insert: { contact_id: string; owner_id: string; rates?: Record<string, number>; updated_at?: string };
        Update: { rates?: Record<string, number>; updated_at?: string };
        Relationships: [];
      };
      tutor_report_comments: {
        Row: {
          id: string;
          report_id: string;
          author_id: string;
          author_name: string;
          body: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          report_id: string;
          author_id: string;
          author_name?: string;
          body: string;
          created_at?: string;
        };
        Update: { body?: string };
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
          role: "editor" | "contributor" | "viewer" | "scheduler";
          created_at: string;
        };
        Insert: {
          id?: string;
          calendar_id: string;
          invited_email: string;
          member_id?: string | null;
          role: "editor" | "contributor" | "viewer" | "scheduler";
          created_at?: string;
        };
        Update: {
          id?: string;
          calendar_id?: string;
          invited_email?: string;
          member_id?: string | null;
          role?: "editor" | "contributor" | "viewer" | "scheduler";
          created_at?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      // 0021 老師自填回饋
      teacher_lessons: {
        Args: { p_from: string; p_to: string };
        Returns: {
          event_id: string;
          title: string;
          starts_at: string;
          ends_at: string;
          all_day: boolean;
          location: string | null;
          subject_names: string[];
          my_note_count: number;
          note_count: number;
        }[];
      };
      my_teacher_links: {
        Args: Record<string, never>;
        Returns: { contact_id: string; contact_name: string; owner_name: string }[];
      };
      // 0023 家教填報
      my_tutor_profile: {
        Args: Record<string, never>;
        Returns: {
          contact_id: string;
          contact_name: string;
          owner_id: string;
          tutor_kind: "specialist" | "home" | null;
          tutor_subjects: string[];
          students: { id: string; name: string }[];
        }[];
      };
    };
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
