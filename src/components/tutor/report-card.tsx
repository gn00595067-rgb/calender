"use client";

import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { AlertTriangle, CalendarCheck, Loader2, MessageSquare, Pencil, Trash2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { asDaily, asLesson, hoursText } from "@/lib/tutor";
import { addComment, deleteComment, useComments, type TutorReport } from "@/lib/client/tutor";
import { D } from "@/lib/date";
import { cn } from "@/lib/utils";

const WD = "日一二三四五六";
const dateLabel = (ds: string) =>
  `${Number(ds.slice(5, 7))}/${Number(ds.slice(8, 10))}（${WD[new Date(`${ds}T12:00:00Z`).getUTCDay()]}）`;

/** 吸收程度條：<60 紅、<80 橘、其餘綠 */
export function PctBar({ value }: { value: number }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="h-2 w-20 overflow-hidden rounded-full bg-muted">
        <span
          className={cn(
            "block h-full rounded-full",
            value < 60 ? "bg-red-500" : value < 80 ? "bg-amber-500" : "bg-emerald-500",
          )}
          style={{ width: `${value}%` }}
        />
      </span>
      <span className="text-sm font-semibold tabular-nums">{value}%</span>
    </span>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  if (children == null || children === "" || children === false) return null;
  return (
    <div className="flex gap-2 text-sm">
      <span className="w-20 shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">{children}</span>
    </div>
  );
}

/**
 * 一筆填報（上課紀錄或每日回報）的唯讀內容＋留言。
 * 老師端、家長端、家庭老師看專科紀錄都用這張卡。
 */
export function ReportCard({
  report,
  studentName,
  userId,
  canComment,
  commentCount,
  onEdit,
  onDelete,
}: {
  report: TutorReport;
  studentName: (id: string) => string;
  userId: string;
  canComment: boolean;
  commentCount?: number;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  const [showComments, setShowComments] = useState(false);
  const edited = Date.parse(report.updated_at) - Date.parse(report.created_at) > 60_000;
  const isLesson = report.kind === "lesson";

  return (
    <div className="space-y-2.5 rounded-xl border bg-card p-3">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="text-base font-bold">{dateLabel(report.report_date)}</span>
        {isLesson && report.start_time && (
          <span className="tabular-nums">
            {report.start_time.slice(0, 5)}–{report.end_time?.slice(0, 5)}
          </span>
        )}
        <span className="text-sm text-muted-foreground">{hoursText(report.minutes)}</span>
        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
          {isLesson ? report.subject : "每日回報"}
        </span>
        <span className="text-sm">{report.teacher_name}老師</span>
        {report.event_id && (
          <span title="已連到行事曆那堂課" className="text-emerald-600">
            <CalendarCheck className="inline size-3.5" />
          </span>
        )}
        <span className="ml-auto flex gap-1">
          {onEdit && (
            <Button size="sm" variant="ghost" className="h-8 px-2" onClick={onEdit}>
              <Pencil className="size-3.5" />
              修改
            </Button>
          )}
          {onDelete && (
            <Button size="sm" variant="ghost" className="h-8 px-2 text-muted-foreground hover:text-red-600" onClick={onDelete}>
              <Trash2 className="size-3.5" />
            </Button>
          )}
        </span>
      </div>
      {edited && (
        <div className="text-xs text-amber-700 dark:text-amber-400">最後修改：{D.full(report.updated_at)}</div>
      )}

      {isLesson ? <LessonBody report={report} studentName={studentName} /> : <DailyBody report={report} studentName={studentName} />}

      <div className="border-t pt-2">
        <button
          type="button"
          onClick={() => setShowComments(!showComments)}
          className="flex min-h-9 items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <MessageSquare className="size-4" />
          留言{commentCount ? `（${commentCount}）` : ""}
        </button>
        {showComments && <Comments reportId={report.id} userId={userId} canComment={canComment} />}
      </div>
    </div>
  );
}

function LessonBody({ report, studentName }: { report: TutorReport; studentName: (id: string) => string }) {
  const c = asLesson(report.content);
  return (
    <div className="space-y-2">
      <div className="space-y-1">
        <Row label="型式">{[report.mode, c.lessonType].filter(Boolean).join("・")}</Row>
        <Row label="單元">{c.unit}</Row>
        <Row label="教學重點">{c.focus}</Row>
        <Row label="教材頁碼">{c.materials}</Row>
        <Row label="教學方式">{c.method}</Row>
      </div>
      {c.students.map((f) => (
        <div key={f.id} className="space-y-1 rounded-lg bg-muted/40 p-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{studentName(f.id)}</span>
            <PctBar value={f.absorption} />
            {f.score && <span className="text-sm">測驗 {f.score} 分</span>}
          </div>
          <Row label="表現">{f.performance}</Row>
          <Row label="錯誤類型">{[...f.errors, f.errorNote].filter(Boolean).join("、")}</Row>
          <Row label="下次加強">{f.nextFocus}</Row>
        </div>
      ))}
    </div>
  );
}

function DailyBody({ report, studentName }: { report: TutorReport; studentName: (id: string) => string }) {
  const c = asDaily(report.content);
  const pcts = (m: Record<string, number>) =>
    Object.entries(m).map(([id, v]) => (
      <span key={id} className="mr-3 inline-flex items-center gap-1">
        {studentName(id)} <PctBar value={v} />
      </span>
    ));
  return (
    <div className="space-y-2">
      <Row label="工作時段">
        {c.segments.map((s, i) => (
          <span key={i} className="mr-2 inline-block tabular-nums">
            {s.start}–{s.end} {s.category}
          </span>
        ))}
      </Row>
      {c.homework && (
        <div className="space-y-1 rounded-lg bg-muted/40 p-2.5">
          <div className="font-semibold">學校作業：{c.homework.status}</div>
          <Row label="內容">{c.homework.note}</Row>
          <Row label="特殊狀況">{c.homework.special}</Row>
        </div>
      )}
      {c.reviews.map((r, i) => (
        <div key={i} className="space-y-1 rounded-lg bg-muted/40 p-2.5">
          <div className="font-semibold">
            {r.subject} {r.unit}
          </div>
          <div className="text-sm">{pcts(r.absorption)}</div>
          <Row label="複習方式">{r.method}</Row>
          <Row label="觀察">{r.observation}</Row>
        </div>
      ))}
      {c.english.map((e, i) => (
        <div key={i} className="space-y-1 rounded-lg bg-muted/40 p-2.5">
          <div className="font-semibold">
            英文 {e.course} {e.range}
          </div>
          <div className="text-sm">{pcts(e.mastery)}</div>
          <Row label="項目">{e.items.join("、")}</Row>
          <Row label="補習班作業">{e.hwDone}</Row>
          <Row label="說明">{e.note}</Row>
        </div>
      ))}
      {c.project && (
        <div className="space-y-1 rounded-lg bg-muted/40 p-2.5">
          <div className="font-semibold">
            專題：{c.project.name}（{c.project.progress}）
          </div>
          <Row label="截止日">{c.project.due}</Row>
          <Row label="下一步">{c.project.next}</Row>
        </div>
      )}
      {c.contacts.map((k, i) => (
        <div
          key={i}
          className={cn("space-y-1 rounded-lg p-2.5", k.needsParent ? "bg-red-50 dark:bg-red-950/30" : "bg-muted/40")}
        >
          <div className="flex items-center gap-1.5 font-semibold">
            {k.needsParent && <AlertTriangle className="size-4 text-red-600" />}
            聯繫 {k.who}
            {k.needsParent && <span className="text-xs font-normal text-red-600">需家長處理</span>}
          </div>
          <div className="whitespace-pre-wrap text-sm">{k.matter}</div>
        </div>
      ))}
      {c.purchases.map((p, i) => (
        <Row key={i} label={p.category}>
          {p.item}
          {p.amount && `（$${p.amount}）`} · {p.status}
        </Row>
      ))}
      {c.toParent && (
        <div className="rounded-lg border-l-4 border-primary bg-primary/5 p-2.5 text-sm whitespace-pre-wrap">
          給家長：{c.toParent}
        </div>
      )}
    </div>
  );
}

function Comments({ reportId, userId, canComment }: { reportId: string; userId: string; canComment: boolean }) {
  const qc = useQueryClient();
  const { data: comments = [], isLoading } = useComments(reportId);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);

  async function send() {
    if (!body.trim()) return;
    setSending(true);
    const err = await addComment(reportId, userId, body);
    setSending(false);
    if (err) return void toast.error(err);
    setBody("");
    await qc.invalidateQueries({ queryKey: ["tutor", "comments", reportId] });
    await qc.invalidateQueries({ queryKey: ["tutor", "comment-counts"] });
  }

  return (
    <div className="mt-1 space-y-2">
      {isLoading ? (
        <div className="text-sm text-muted-foreground">載入中…</div>
      ) : comments.length === 0 ? (
        <div className="text-sm text-muted-foreground">還沒有留言</div>
      ) : (
        comments.map((m) => (
          <div key={m.id} className="rounded-lg bg-muted/40 p-2 text-sm">
            <div className="mb-0.5 flex items-center gap-2 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{m.author_name}</span>
              {D.full(m.created_at)}
              {m.author_id === userId && (
                <button
                  type="button"
                  className="ml-auto hover:text-red-600"
                  onClick={async () => {
                    const err = await deleteComment(m.id);
                    if (err) return void toast.error(err);
                    await qc.invalidateQueries({ queryKey: ["tutor"] });
                  }}
                >
                  刪除
                </button>
              )}
            </div>
            <div className="whitespace-pre-wrap">{m.body}</div>
          </div>
        ))
      )}
      {canComment && (
        <div className="flex items-end gap-2">
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={2} placeholder="留言…" className="text-base" />
          <Button onClick={() => void send()} disabled={sending || !body.trim()} className="h-10">
            {sending ? <Loader2 className="size-4 animate-spin" /> : "送出"}
          </Button>
        </div>
      )}
    </div>
  );
}
