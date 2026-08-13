"use client";

import { useState, useTransition } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Mail, Trash2, UserCheck, Clock } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState, ListSkeleton } from "@/components/app/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAppData } from "@/components/app/app-data";
import { createClient } from "@/lib/supabase/client";
import { SHARE_ROLES, SHARE_ROLE_LABEL, type ShareRole } from "@/lib/constants";
import {
  inviteShareAction,
  updateShareRoleAction,
  removeShareAction,
} from "@/lib/actions/shares";

interface ShareRow {
  id: string;
  calendar_id: string;
  invited_email: string;
  member_id: string | null;
  role: ShareRole;
  memberName: string | null;
}

function useShares(ownedIds: string[]) {
  return useQuery({
    queryKey: ["shares", ownedIds],
    enabled: ownedIds.length > 0,
    queryFn: async (): Promise<ShareRow[]> => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("calendar_shares")
        .select("id, calendar_id, invited_email, member_id, role")
        .in("calendar_id", ownedIds)
        .order("created_at", { ascending: true });
      if (error) throw new Error(error.message);
      const rows = data ?? [];
      const memberIds = [...new Set(rows.map((r) => r.member_id).filter(Boolean))] as string[];
      const nameById = new Map<string, string>();
      if (memberIds.length) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, display_name")
          .in("id", memberIds);
        for (const p of profiles ?? []) nameById.set(p.id, p.display_name);
      }
      return rows.map((r) => ({
        ...r,
        role: r.role as ShareRole,
        memberName: r.member_id ? (nameById.get(r.member_id) ?? null) : null,
      }));
    },
  });
}

export default function SharesSettingsPage() {
  const { ownedCalendars } = useAppData();
  const ownedIds = ownedCalendars.map((c) => c.id);
  const { data: shares = [], isLoading } = useShares(ownedIds);
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["shares"] });

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="分享與權限"
        description="以 Email 邀請成員並指定角色。受邀者用該 Email 註冊／登入後自動生效。"
      />

      {isLoading ? (
        <ListSkeleton rows={3} />
      ) : ownedCalendars.length === 0 ? (
        <EmptyState title="尚無可分享的行事曆" />
      ) : (
        <div className="space-y-4">
          {ownedCalendars.map((cal) => (
            <CalendarShareCard
              key={cal.id}
              calendarId={cal.id}
              calendarName={cal.name}
              color={cal.color}
              shares={shares.filter((s) => s.calendar_id === cal.id)}
              onChanged={invalidate}
            />
          ))}
        </div>
      )}

      <div className="mt-6 rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">角色說明</p>
        <ul className="mt-1 space-y-0.5">
          {SHARE_ROLES.map((r) => (
            <li key={r.value}>
              <span className="font-medium text-foreground">{r.label}</span>：{r.hint}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function CalendarShareCard({
  calendarId,
  calendarName,
  color,
  shares,
  onChanged,
}: {
  calendarId: string;
  calendarName: string;
  color: string;
  shares: ShareRow[];
  onChanged: () => void;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<ShareRole>("contributor");
  const [pending, startTransition] = useTransition();

  const invite = () => {
    startTransition(async () => {
      const res = await inviteShareAction({ calendarId, email, role });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`已邀請 ${email}`);
      setEmail("");
      onChanged();
    });
  };

  const changeRole = (shareId: string, newRole: ShareRole) => {
    startTransition(async () => {
      const res = await updateShareRoleAction(shareId, newRole);
      if (!res.ok) toast.error(res.error);
      else onChanged();
    });
  };

  const remove = (shareId: string) => {
    startTransition(async () => {
      const res = await removeShareAction(shareId);
      if (!res.ok) toast.error(res.error);
      else {
        toast.success("已移除成員");
        onChanged();
      }
    });
  };

  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="size-3.5 rounded-md" style={{ backgroundColor: color }} />
        <h3 className="font-semibold">{calendarName}</h3>
        <Badge variant="secondary" className="ml-1">
          {shares.length} 位成員
        </Badge>
      </div>

      {shares.length > 0 && (
        <ul className="mb-3 divide-y rounded-lg border">
          {shares.map((s) => (
            <li key={s.id} className="flex items-center gap-2 p-2.5">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 truncate text-sm font-medium">
                  {s.memberName ?? s.invited_email}
                  {s.member_id ? (
                    <span className="inline-flex items-center gap-0.5 text-xs text-emerald-600">
                      <UserCheck className="size-3" />
                      已加入
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-0.5 text-xs text-amber-600">
                      <Clock className="size-3" />
                      待加入
                    </span>
                  )}
                </div>
                {s.memberName && (
                  <div className="truncate text-xs text-muted-foreground">
                    {s.invited_email}
                  </div>
                )}
              </div>
              <Select
                value={s.role}
                onValueChange={(v) => changeRole(s.id, v as ShareRole)}
              >
                <SelectTrigger className="h-8 w-28 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SHARE_ROLES.map((r) => (
                    <SelectItem key={r.value} value={r.value}>
                      {SHARE_ROLE_LABEL[r.value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="ghost"
                size="icon"
                className="size-8 text-destructive hover:text-destructive"
                onClick={() => remove(s.id)}
                disabled={pending}
                aria-label="移除"
              >
                <Trash2 className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Mail className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="輸入成員 Email"
            className="pl-8"
            onKeyDown={(e) => {
              if (e.key === "Enter" && email.trim()) invite();
            }}
          />
        </div>
        <Select value={role} onValueChange={(v) => setRole(v as ShareRole)}>
          <SelectTrigger className="w-full sm:w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SHARE_ROLES.map((r) => (
              <SelectItem key={r.value} value={r.value}>
                {r.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button onClick={invite} disabled={pending || !email.trim()}>
          邀請
        </Button>
      </div>
    </div>
  );
}
