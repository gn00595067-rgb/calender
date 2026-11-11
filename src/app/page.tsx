import { redirect } from "next/navigation";
import { homePath } from "@/lib/home";

export default async function RootPage() {
  redirect(await homePath());
}
