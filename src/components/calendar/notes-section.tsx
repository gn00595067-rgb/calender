"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { MessageSquare, Trash2, Scissors, Loader2, ChevronRight, Languages, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useAppData } from "@/components/app/app-data";
import { useEventNotes, useNoteContext, type NotePartView } from "@/lib/client/notes";
import { createNoteAction, deleteNoteAction, saveNotePartsAction } from "@/lib/actions/notes";
import { teacherLabel, type NotePartDraft, type PersonLite } from "@/lib/learning";
import { looksEnglish } from "@/lib/note-translate";
import { D } from "@/lib/date";

/** AI 拆分結果（確認前的草稿） */
interface SplitDraft {
  shared: string;
  children: { subjectId: string | null; nameInText: string; content: string }[];
}

type AliasLearn = { contactId: string; alias: string };

async function requestSplit(content: string, subjects: PersonLite[]): Promise<SplitDraft> {
  const res = await fetch("/api/notes/split", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      content,
      subjects: subjects.map((s) => ({ id: s.id, name: s.name, aliases: s.aliases ?? [] })),
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? "自動拆分失敗");
  return json as SplitDraft;
}

async function requestTranslate(
  content: string,
  subjects: PersonLite[],
): Promise<{ progress: string; feedback: string }> {
  const res = await fetch("/api/notes/translate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      content,
      subjects: subjects.map((s) => ({ name: s.name, aliases: s.aliases ?? [] })),
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? "翻譯失敗");
  return json;
}

export function NotesSection({
  eventId,
  canAdd,
}: {
  eventId: string;
  canAdd: boolean;
}) {
  const { me } = useAppData();
  const { data: notes = [], isLoading } = useEventNotes(eventId);
  const { data: ctx } = useNoteContext(
    eventId,
    notes.map((n) => n.id),
  );
  const subjects = ctx?.subjects ?? [];
  const teacher = ctx?.teacher ?? null;
  // 兩個以上小孩一起上課 → 回饋要依小孩拆開
  const multi = subjects.length >= 2;
  const qc = useQueryClient();
  const router = useRouter();
  const [content, setContent] = useState("");
  const [progress, setProgress] = useState("");
  const [pending, startTransition] = useTransition();
  const [splitting, setSplitting] = useState(false);
  const [translating, setTranslating] = useState(false);
  /** 翻譯前的原文（可還原） */
  const [original, setOriginal] = useState<{ content: string; progress: string } | null>(null);
  /** 正在確認的拆分：new＝新回饋；否則為既有回饋 id */
  const [review, setReview] = useState<{ target: "new" | string; draft: SplitDraft } | null>(
    null,
  );

  const refresh = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["notes", eventId] }),
      qc.invalidateQueries({ queryKey: ["note-context", eventId] }),
      qc.invalidateQueries({ queryKey: ["events"] }),
      qc.invalidateQueries({ queryKey: ["learning"] }),
    ]);
    router.refresh();
  };

  const saveNew = (parts?: NotePartDraft[], learn?: AliasLearn[]) => {
    startTransition(async () => {
      const res = await createNoteAction({
        eventId,
        content: content.trim(),
        progressLabel: progress.trim() || null,
        parts,
        learnAliases: learn,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setContent("");
      setProgress("");
      setOriginal(null);
      setReview(null);
      if (res.data.partsWarning) toast.warning(res.data.partsWarning);
      else toast.success(parts?.length ? "已新增回饋，並依小孩拆開" : "已新增回饋");
      await refresh();
    });
  };

  const split = async (target: "new" | string, text: string) => {
    setSplitting(true);
    try {
      const draft = await requestSplit(text, subjects);
      setReview({ target, draft });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "自動拆分失敗");
      // 新回饋拆分失敗：仍讓使用者可以整篇存
      if (target === "new") setReview({ target, draft: { shared: text, children: [] } });
    } finally {
      setSplitting(false);
    }
  };

  // 英文課堂日誌 → 中文：共同內容進「課程進度」、每位學生的評語進回饋
  const translate = async () => {
    setTranslating(true);
    try {
      const out = await requestTranslate(content.trim(), subjects);
      setOriginal({ content, progress });
      const toProgress = !progress.trim() && out.progress;
      if (toProgress) setProgress(out.progress);
      setContent(
        [toProgress ? "" : out.progress, out.feedback].filter(Boolean).join("\n\n") || content,
      );
      toast.success("已翻成中文，看過再送出");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "翻譯失敗");
    } finally {
      setTranslating(false);
    }
  };

  const undoTranslate = () => {
    if (!original) return;
    setContent(original.content);
    setProgress(original.progress);
    setOriginal(null);
  };

  const submit = () => {
    if (!content.trim()) return;
    if (multi) void split("new", content.trim());
    else saveNew();
  };

  const confirmReview = (parts: NotePartDraft[], learn: AliasLearn[]) => {
    if (!review) return;
    if (review.target === "new") {
      saveNew(parts, learn);
      return;
    }
    const noteId = review.target;
    startTransition(async () => {
      const res = await saveNotePartsAction({ noteId, parts, learnAliases: learn });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setReview(null);
      toast.success("已依小孩拆開");
      await refresh();
    });
  };

  const remove = (id: string) => {
    startTransition(async () => {
      const res = await deleteNoteAction(id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      await refresh();
    });
  };

  const nameOf = (id: string | null) => subjects.find((s) => s.id === id)?.name ?? "（已刪除的人物）";

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1.5 text-sm font-semibold">
        <MessageSquare className="size-4" />
        回饋與筆記
        {notes.length > 0 && (
          <span className="text-muted-foreground">（{notes.length}）</span>
        )}
        <Link
          href="/learning"
          className="ml-auto inline-flex items-center text-xs font-normal text-primary hover:underline"
        >
          學習回饋總整理
          <ChevronRight className="size-3.5" />
        </Link>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">載入中…</p>
      ) : notes.length === 0 ? (
        <p className="text-sm text-muted-foreground">尚無回饋。</p>
      ) : (
        <ul className="space-y-2">
          {notes.map((n) => {
            const parts = ctx?.partsByNote.get(n.id) ?? [];
            const mine = n.author_id === me.id;
            return (
              <li key={n.id} className="rounded-lg border bg-card p-3">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                  {/* 署名：那堂課的老師；輸入的帳號不同時標「代填」 */}
                  {teacher ? (
                    <>
                      <span className="font-medium text-foreground">{teacherLabel(teacher)}</span>
                      {n.authorName !== teacher.name && <span>· {n.authorName} 代填</span>}
                    </>
                  ) : (
                    <span className="font-medium text-foreground">{n.authorName}</span>
                  )}
                  <span>{D.full(n.created_at)}</span>
                  {mine && (
                    <button
                      type="button"
                      onClick={() => remove(n.id)}
                      className="ml-auto text-muted-foreground hover:text-destructive"
                      aria-label="刪除回饋"
                      disabled={pending}
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  )}
                </div>

                {n.progress_label && <ProgressBlock text={n.progress_label} />}

                {review?.target === n.id ? (
                  <SplitReview
                    subjects={subjects}
                    draft={review.draft}
                    pending={pending}
                    onConfirm={confirmReview}
                    onCancel={() => setReview(null)}
                  />
                ) : parts.length > 0 ? (
                  <SplitView parts={parts} nameOf={nameOf} />
                ) : (
                  <>
                    <p className="mt-1.5 whitespace-pre-wrap text-sm">{n.content}</p>
                    {multi && mine && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="mt-2"
                        disabled={splitting || pending}
                        onClick={() => void split(n.id, n.content)}
                      >
                        {splitting ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <Scissors className="size-4" />
                        )}
                        依小孩拆開（{subjects.map((s) => s.name).join("、")}）
                      </Button>
                    )}
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {canAdd &&
        (review?.target === "new" ? (
          <div className="rounded-lg border bg-muted/30 p-3">
            <SplitReview
              subjects={subjects}
              draft={review.draft}
              pending={pending}
              onConfirm={confirmReview}
              onSaveWhole={() => saveNew()}
              onCancel={() => setReview(null)}
            />
          </div>
        ) : (
          <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
            <Textarea
              value={progress}
              onChange={(e) => setProgress(e.target.value)}
              placeholder="課程進度（選填）：當天教學進度與章節，例：公里和公尺的單位換算"
              rows={progress.includes("\n") ? 4 : 2}
            />
            <Textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="學習回饋：學生當堂表現與理解度（例：單位換算熟練，進位偶爾漏掉）"
              rows={content.includes("\n") ? 6 : 2}
            />
            {original ? (
              <button
                type="button"
                onClick={undoTranslate}
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
              >
                <Undo2 className="size-3.5" />
                還原英文原文
              </button>
            ) : (
              looksEnglish(content) && (
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  看起來是英文
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => void translate()}
                    disabled={translating || pending || splitting}
                  >
                    {translating ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Languages className="size-4" />
                    )}
                    {translating ? "翻譯中…" : "翻成中文"}
                  </Button>
                </div>
              )
            )}
            {multi && (
              <p className="text-xs text-muted-foreground">
                這堂課有 {subjects.map((s) => s.name).join("、")}，送出後會自動依小孩拆開，確認後才存。
              </p>
            )}
            <div className="flex justify-end">
              <Button
                onClick={submit}
                disabled={pending || splitting || translating || !content.trim()}
                className="shrink-0"
              >
                {splitting && <Loader2 className="size-4 animate-spin" />}
                {splitting ? "拆分中…" : "送出回饋"}
              </Button>
            </div>
          </div>
        ))}
    </div>
  );
}

/** 課程進度（當天教學進度與章節） */
export function ProgressBlock({ text }: { text: string }) {
  return (
    <div className="mt-1.5 rounded-md bg-muted/50 px-2.5 py-1.5 text-sm">
      <span className="text-xs font-medium text-muted-foreground">課程進度</span>
      <p className="whitespace-pre-wrap">{text}</p>
    </div>
  );
}

/** 已拆分的回饋：共同內容（淡色）＋每個小孩一段 */
function SplitView({
  parts,
  nameOf,
}: {
  parts: NotePartView[];
  nameOf: (id: string | null) => string;
}) {
  return (
    <div className="mt-1.5 space-y-2">
      {parts.map((p) =>
        p.subject_contact_id ? (
          <div key={p.id} className="rounded-md border-l-4 border-primary/60 bg-muted/30 px-2.5 py-1.5">
            <Badge variant="secondary" className="mb-1">
              {nameOf(p.subject_contact_id)}
            </Badge>
            <p className="whitespace-pre-wrap text-sm">{p.content}</p>
          </div>
        ) : (
          <p key={p.id} className="whitespace-pre-wrap text-sm text-muted-foreground">
            {p.content}
          </p>
        ),
      )}
    </div>
  );
}

/** 拆分確認：每段可改內容、改對應的小孩；確認後才存 */
function SplitReview({
  subjects,
  draft,
  pending,
  onConfirm,
  onSaveWhole,
  onCancel,
}: {
  subjects: PersonLite[];
  draft: SplitDraft;
  pending: boolean;
  onConfirm: (parts: NotePartDraft[], learn: AliasLearn[]) => void;
  onSaveWhole?: () => void;
  onCancel: () => void;
}) {
  const [shared, setShared] = useState(draft.shared);
  // 只剩一段沒對應、也只剩一個小孩沒被選 → 用刪去法帶入（如 Rick＝哥哥 已知，Iris 就是妹妹）
  const [children, setChildren] = useState(() => {
    const unassigned = draft.children.filter((c) => !c.subjectId);
    const unused = subjects.filter((s) => !draft.children.some((c) => c.subjectId === s.id));
    if (unassigned.length !== 1 || unused.length !== 1) return draft.children;
    return draft.children.map((c) => (c.subjectId ? c : { ...c, subjectId: unused[0].id }));
  });
  const missing = children.some((c) => !c.subjectId);
  const rowsOf = (t: string) => Math.min(10, Math.max(2, t.split("\n").length + 1));

  const confirm = () => {
    const parts: NotePartDraft[] = [
      ...(shared.trim() ? [{ subjectId: null, content: shared.trim() }] : []),
      ...children
        .filter((c) => c.content.trim())
        .map((c) => ({ subjectId: c.subjectId, content: c.content.trim() })),
    ];
    // 原文稱呼（如 Rick）不是本名也不是已知別名 → 記成別名，下次自動認得
    const learn: AliasLearn[] = children.flatMap((c) => {
      const s = subjects.find((x) => x.id === c.subjectId);
      const alias = c.nameInText.trim();
      if (!s || !alias || alias.length > 20 || alias === s.name) return [];
      if ((s.aliases ?? []).some((a) => a.toLowerCase() === alias.toLowerCase())) return [];
      return [{ contactId: s.id, alias }];
    });
    onConfirm(parts, learn);
  };

  return (
    <div className="mt-2 space-y-3">
      <p className="text-sm font-medium">確認依小孩拆開的內容</p>
      {children.length === 0 && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          沒有拆出各小孩的段落，可直接整篇存。
        </p>
      )}
      <div className="space-y-1">
        <span className="text-xs text-muted-foreground">共同內容（每個小孩都看得到）</span>
        <Textarea value={shared} onChange={(e) => setShared(e.target.value)} rows={rowsOf(shared)} />
      </div>
      {children.map((c, i) => (
        <div key={i} className="space-y-1 rounded-md border-l-4 border-primary/60 pl-2">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            這段是
            <select
              value={c.subjectId ?? ""}
              onChange={(e) =>
                setChildren((arr) =>
                  arr.map((x, j) => (j === i ? { ...x, subjectId: e.target.value || null } : x)),
                )
              }
              className="h-8 rounded-md border bg-background px-2 text-sm text-foreground"
            >
              <option value="">（請選擇）</option>
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            {c.nameInText && <span>原文寫「{c.nameInText}」</span>}
          </div>
          <Textarea
            value={c.content}
            onChange={(e) =>
              setChildren((arr) => arr.map((x, j) => (j === i ? { ...x, content: e.target.value } : x)))
            }
            rows={rowsOf(c.content)}
          />
        </div>
      ))}
      {missing && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          有段落還沒選是哪個小孩；選好後系統會記住（例如 Rick＝哥哥），下次自動對應。
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={pending}>
          取消
        </Button>
        {onSaveWhole && (
          <Button type="button" variant="outline" size="sm" onClick={onSaveWhole} disabled={pending}>
            不拆，整篇存
          </Button>
        )}
        {children.length > 0 && (
          <Button type="button" size="sm" onClick={confirm} disabled={pending || missing}>
            {pending && <Loader2 className="size-4 animate-spin" />}
            確認儲存
          </Button>
        )}
      </div>
    </div>
  );
}
