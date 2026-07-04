import { getSession } from "@/lib/auth-server";
import { redirect } from "next/navigation";
import NotificationSettingsContent from "./content";

export default async function NotificationSettingsPage() {
  const user = await getSession();
  if (!user) redirect("/login");

  return <NotificationSettingsContent />;
}
