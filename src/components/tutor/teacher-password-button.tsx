"use client";

import { useState } from "react";
import { ChangePasswordDialog } from "@/components/app/change-password-dialog";

/** 老師頁頂端的「修改密碼」按鈕（老師頁是 server component，對話框狀態放這裡） */
export function TeacherPasswordButton({ email }: { email: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
      >
        修改密碼
      </button>
      <ChangePasswordDialog open={open} onOpenChange={setOpen} email={email} />
    </>
  );
}
